// Office mode core: settings, audit log, outgoing-network guard, generation queue, IP allowlist, rate limits, start checks.
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import http from 'http';
import https from 'https';
import { DATA_DIR, ROOT, IS_VERCEL } from '../paths.js';
import { readRecords } from './crypto.js';

const env = process.env;
export const OFFICE = env.OFFICE_MODE === '1';
export const CFG = {
  allowedProviders: (env.OFFICE_ALLOWED_PROVIDERS || '').split(',').map((s) => s.trim()).filter(Boolean),
  allowSearchEnv: env.OFFICE_ALLOW_SEARCH === '1',
  allowedHosts: (env.OFFICE_ALLOWED_HOSTS || '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean),
  allowedIps: (env.OFFICE_ALLOWED_IPS || '').split(',').map((s) => s.trim()).filter(Boolean),
  host: env.HOST || (OFFICE ? '127.0.0.1' : '0.0.0.0'),
  httpsCert: env.HTTPS_CERT || '', httpsKey: env.HTTPS_KEY || '',
  codeAllowlist: (env.OFFICE_CODE_ALLOWLIST || '').split(';').map((s) => s.trim()).filter(Boolean),
};
export const HTTPS_ON = !!(CFG.httpsCert && CFG.httpsKey);

// ---------- small JSON store (encrypted through the fs patch) ----------
export const dataFile = (...p) => path.join(DATA_DIR, ...p);
export const readJson = (file, fb) => { try { return JSON.parse(fs.readFileSync(dataFile(file), 'utf8')); } catch { return fb; } };
export const writeJson = (file, v) => { fs.mkdirSync(path.dirname(dataFile(file)), { recursive: true }); fs.writeFileSync(dataFile(file), JSON.stringify(v, null, 1)); };
export const system = () => readJson('system.json', { ownerCreated: false, locked: false, allowTraining: false, allowSearch: false, idleMin: 30, absHours: 12 });
export const saveSystem = (patch) => writeJson('system.json', { ...system(), ...patch });
export const SAFE_ID = /^[\w-]{1,64}$/;

// ---------- audit log: append-only, every line encrypted and chained with SHA-256 of the previous line ----------
const AUDIT = dataFile('audit.log');
let lastHash = null;
const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');
export function audit(type, details = {}, req) {
  if (!OFFICE) return;
  try {
    if (lastHash === null) { const recs = readRecords(AUDIT); const last = recs[recs.length - 1]; lastHash = last?.ok ? JSON.parse(last.text).hash : '0'.repeat(64); }
    const entry = { ts: new Date().toISOString(), type, actor: req?.user?.username || details.actor || '-', ip: req ? clientIp(req) : '-', details, prev: lastHash };
    entry.hash = sha(JSON.stringify({ ...entry, hash: undefined }));
    fs.appendFileSync(AUDIT, JSON.stringify(entry) + '\n');
    lastHash = entry.hash;
  } catch (e) { console.warn('[audit]', e.message); }
}
export function readAudit(q = '') {
  return readRecords(AUDIT).filter((r) => r.ok).map((r) => { try { return JSON.parse(r.text); } catch { return null; } }).filter(Boolean)
    .filter((e) => !q || JSON.stringify(e).toLowerCase().includes(q.toLowerCase())).reverse().slice(0, 1000);
}
export function verifyAudit() {
  const recs = readRecords(AUDIT);
  let prev = '0'.repeat(64);
  for (const r of recs) {
    if (!r.ok) return { ok: false, line: r.line, why: 'the line was changed (decryption check failed)' };
    let e; try { e = JSON.parse(r.text); } catch { return { ok: false, line: r.line, why: 'not valid JSON' }; }
    if (e.prev !== prev) return { ok: false, line: r.line, why: 'the chain is broken (a line was removed or reordered)' };
    if (sha(JSON.stringify({ ...e, hash: undefined })) !== e.hash) return { ok: false, line: r.line, why: 'the content does not match its hash' };
    prev = e.hash;
  }
  return { ok: true, lines: recs.length };
}

// ---------- outgoing-network guard: in office mode only allow-listed hosts (logged), everything else blocked + audited ----------
export const netLog = new Map(); // host → { allowed, count }
let originalFetch = globalThis.fetch;
export const rawFetch = (...a) => originalFetch(...a); // only for the start-up firewall test
function hostAllowed(host) {
  const h = String(host || '').toLowerCase().replace(/^\[|\]$/g, '');
  const ollama = (() => { try { return new URL(env.OLLAMA_URL || 'http://localhost:11434').hostname.toLowerCase(); } catch { return 'localhost'; } })();
  return ['localhost', '127.0.0.1', '::1', ollama, ...CFG.allowedHosts].includes(h);
}
function note(host, allowed) {
  const k = String(host).toLowerCase();
  const n = netLog.get(k) || { allowed, count: 0 };
  n.count++; netLog.set(k, n);
  if (!allowed) audit('network-blocked', { host: k });
}
export function installNetGuard() {
  originalFetch = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    const url = new URL(typeof input === 'string' ? input : input?.url || String(input), 'http://localhost');
    const ok = hostAllowed(url.hostname);
    note(url.hostname, ok);
    if (!ok) throw new Error(`Office mode: outgoing connection to ${url.hostname} is blocked (not in OFFICE_ALLOWED_HOSTS).`);
    return originalFetch(input, init);
  };
  for (const mod of [http, https]) {
    for (const fn of ['request', 'get']) {
      const orig = mod[fn];
      mod[fn] = function (a, b, c) {
        const host = typeof a === 'string' || a instanceof URL ? new URL(a).hostname : (a?.hostname || a?.host || 'localhost');
        const ok = hostAllowed(String(host).split(':')[0]);
        note(host, ok);
        if (!ok) throw new Error(`Office mode: outgoing connection to ${host} is blocked.`);
        return orig.call(this, a, b, c);
      };
    }
  }
}
// Prepended to code the JS sandbox runs: no network at all inside it
export const SANDBOX_NO_NET = `(()=>{const no=()=>{throw new Error('network is blocked in this sandbox')};globalThis.fetch=no;try{const n=require('net');n.connect=n.createConnection=no;n.Socket.prototype.connect=no;for(const m of ['http','https','http2','dgram','tls'])try{const x=require(m);for(const k of ['request','get','connect','createSocket'])if(x[k])x[k]=no}catch{}}catch{}})();\n`;

// ---------- one generation at a time per model; owner goes to the front ----------
const queues = new Map(); // model → [{ owner, wake, onPos }]
const running = new Map(); // model → true
export function enqueue(model, { owner = false, onPos } = {}) {
  return new Promise((resolve) => {
    const q = queues.get(model) || [];
    const me = { owner, onPos, wake: resolve };
    if (!running.get(model) && !q.length) { running.set(model, true); return resolve(release(model)); }
    if (owner) q.splice(q.findIndex((x) => !x.owner) < 0 ? q.length : q.findIndex((x) => !x.owner), 0, me); else q.push(me);
    queues.set(model, q);
    q.forEach((x, i) => x.onPos?.(i + 1));
    me.wake = () => resolve(release(model));
  });
}
function release(model) {
  let done = false;
  return () => {
    if (done) return; done = true;
    const q = queues.get(model) || [];
    const next = q.shift();
    if (next) { q.forEach((x, i) => x.onPos?.(i + 1)); next.wake(); } else running.delete(model);
  };
}
export const queueStatus = () => Object.fromEntries([...new Set([...queues.keys(), ...running.keys()])].map((m) => [m, { running: !!running.get(m), waiting: (queues.get(m) || []).length }]));

// ---------- client IP, IP allowlist (CIDR), simple rate limits ----------
export const clientIp = (req) => String(req.socket?.remoteAddress || '').replace(/^::ffff:/, '');
const ip4 = (ip) => ip.split('.').reduce((a, b) => (a << 8) + Number(b), 0) >>> 0;
export function ipAllowed(ip) {
  if (['127.0.0.1', '::1'].includes(ip)) return true;
  if (!CFG.allowedIps.length) return CFG.host === '127.0.0.1' || CFG.host === 'localhost';
  return CFG.allowedIps.some((c) => {
    const [net, bits = '32'] = c.split('/');
    if (!/^\d+\.\d+\.\d+\.\d+$/.test(ip) || !/^\d+\.\d+\.\d+\.\d+$/.test(net)) return ip === net;
    const mask = Number(bits) === 0 ? 0 : (~0 << (32 - Number(bits))) >>> 0;
    return (ip4(ip) & mask) === (ip4(net) & mask);
  });
}
const windows = new Map();
/** true when the key made more than `max` calls in the last `ms` */
export function limited(key, max, ms) {
  const now = Date.now();
  const arr = (windows.get(key) || []).filter((t) => now - t < ms);
  arr.push(now); windows.set(key, arr);
  return arr.length > max;
}

// ---------- start-up checks ----------
export async function officeStart() {
  if (!OFFICE) return {};
  // (Vercel / cloud-folder refusal and encryption at rest already ran in office/boot.js, before any data was read)
  const cloudKeys = Object.keys(env).filter((k) => /_API_KEY$/.test(k) && env[k] && !/^OLLAMA_API_KEY$/.test(k));
  if (cloudKeys.length) console.warn(`  ⚠ Office mode: cloud keys are set (${cloudKeys.join(', ')}). They are not needed and are blocked unless listed in OFFICE_ALLOWED_PROVIDERS — remove them from .env.`);
  // Firewall test: if the open internet is reachable, the OS firewall lock is off (the app guard still blocks it)
  let firewallOpen = false;
  try { await rawFetch('https://example.com', { signal: AbortSignal.timeout(3000) }); firewallOpen = true; } catch {}
  if (firewallOpen) console.warn('\n  \x1b[31m⚠ Firewall lock is OFF — outbound internet is open.\x1b[0m Run firewall-lock.ps1 as Administrator.\n');
  installNetGuard();
  // Custom model files: their SHA-256 must still match models/hashes.json
  const changed = [];
  try {
    const hashes = JSON.parse(fs.readFileSync(path.join(ROOT, 'models', 'hashes.json'), 'utf8'));
    for (const [file, h] of Object.entries(hashes)) {
      if (!fs.existsSync(file)) continue;
      const now = await sha256File(file);
      if (now !== h.sha256) changed.push(file);
    }
  } catch {}
  if (changed.length) { console.warn(`  ⚠ Model file changed since import (hash mismatch): ${changed.join(', ')}`); audit('model-hash-mismatch', { files: changed }); }
  audit('server-start', { host: CFG.host, https: HTTPS_ON, firewallOpen });
  return { firewallOpen, changedModels: changed };
}
export function sha256File(file) {
  return new Promise((resolve, reject) => {
    const h = crypto.createHash('sha256');
    fs.createReadStream(file).on('data', (d) => h.update(d)).on('end', () => resolve(h.digest('hex'))).on('error', reject);
  });
}
