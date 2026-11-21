// Office mode — encryption at rest for everything under data/ (AES-256-GCM).
// The master key (32 random bytes) is created on first start and stored ONLY protected by Windows DPAPI for the account
// that runs the server (data/.master.key.dpapi). Fallback (other OS / DPAPI unavailable): a key derived with scrypt from
// OFFICE_MASTER_PASSWORD (or asked once at start in a terminal). The key never exists in plain text on disk.
//
// installDataEncryption() patches fs.readFileSync / writeFileSync / appendFileSync for paths under data/, so every module
// (kb.js, usage.js, training, audit, users…) is encrypted without changes. Encrypted file format:
//   "EVXENC1\n" + one line per record: base64(iv[12] | tag[16] | ciphertext)   — appends add a record, reads join them.
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { spawnSync } from 'child_process';
import { syncBuiltinESMExports } from 'module';
import { DATA_DIR } from '../paths.js';

const MAGIC = 'EVXENC1\n';
const KEY_FILE = path.join(DATA_DIR, '.master.key.dpapi');
const SALT_FILE = path.join(DATA_DIR, '.master.salt');
const CHECK_FILE = path.join(DATA_DIR, '.master.check');
// Not encrypted: Vite build scratch folders and cloned open-source repos (tools must read them), and the key files themselves
const PLAIN = [path.join(DATA_DIR, 'builds'), path.join(DATA_DIR, 'open-code'), KEY_FILE, SALT_FILE, CHECK_FILE];
let KEY = null;
const real = { readFileSync: fs.readFileSync, writeFileSync: fs.writeFileSync, appendFileSync: fs.appendFileSync };

const dpapi = (mode, b64) => {
  const ps = `Add-Type -AssemblyName System.Security; $in=[Console]::In.ReadToEnd().Trim(); $b=[Convert]::FromBase64String($in); `
    + `$o=[System.Security.Cryptography.ProtectedData]::${mode}($b,$null,[System.Security.Cryptography.DataProtectionScope]::CurrentUser); [Convert]::ToBase64String($o)`;
  const r = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', ps], { input: b64, encoding: 'utf8', windowsHide: true, timeout: 20_000 });
  if (r.status !== 0 || !r.stdout.trim()) throw new Error(`DPAPI ${mode} failed: ${(r.stderr || '').trim().split('\n')[0]}`);
  return r.stdout.trim();
};

function askPassword() {
  if (!process.stdin.isTTY) throw new Error('Set OFFICE_MASTER_PASSWORD (DPAPI is not available here).');
  process.stdout.write('Office master password (protects all data; same one every start): ');
  const buf = Buffer.alloc(256); let n = 0;
  try { n = fs.readSync(0, buf, 0, 256, null); } catch { /* raw read not available */ }
  return buf.slice(0, n).toString('utf8').trim();
}

export function loadMasterKey() {
  if (KEY) return KEY;
  fs.mkdirSync(DATA_DIR, { recursive: true });
  if (process.platform === 'win32' && !process.env.OFFICE_MASTER_PASSWORD) {
    try {
      if (fs.existsSync(KEY_FILE)) KEY = Buffer.from(dpapi('Unprotect', real.readFileSync(KEY_FILE, 'utf8')), 'base64');
      else {
        const k = crypto.randomBytes(32);
        real.writeFileSync(KEY_FILE, dpapi('Protect', k.toString('base64')));
        KEY = k;
      }
      return KEY;
    } catch (e) { console.warn(`[office] ${e.message} — falling back to OFFICE_MASTER_PASSWORD`); }
  }
  const pw = process.env.OFFICE_MASTER_PASSWORD || askPassword();
  if (!pw || pw.length < 12) throw new Error('OFFICE_MASTER_PASSWORD must be at least 12 characters.');
  if (!fs.existsSync(SALT_FILE)) real.writeFileSync(SALT_FILE, crypto.randomBytes(16).toString('hex'));
  KEY = crypto.scryptSync(pw, Buffer.from(real.readFileSync(SALT_FILE, 'utf8'), 'hex'), 32, { N: 2 ** 15, r: 8, p: 1, maxmem: 64 * 1024 * 1024 });
  // A known value encrypted with the key → a wrong password is detected instead of silently corrupting data
  if (fs.existsSync(CHECK_FILE)) { try { decryptRecord(real.readFileSync(CHECK_FILE, 'utf8')); } catch { KEY = null; throw new Error('Wrong OFFICE_MASTER_PASSWORD.'); } }
  else real.writeFileSync(CHECK_FILE, encryptRecord(Buffer.from('evolvix-ok')));
  return KEY;
}

export function encryptRecord(buf) {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', KEY, iv);
  const ct = Buffer.concat([c.update(buf), c.final()]);
  return Buffer.concat([iv, c.getAuthTag(), ct]).toString('base64');
}
export function decryptRecord(line) {
  const b = Buffer.from(line, 'base64');
  const d = crypto.createDecipheriv('aes-256-gcm', KEY, b.subarray(0, 12));
  d.setAuthTag(b.subarray(12, 28));
  return Buffer.concat([d.update(b.subarray(28)), d.final()]);
}
/** Raw encrypted lines of a file (for integrity checks): [{ ok, text?, line }] */
export function readRecords(file) {
  if (!fs.existsSync(file)) return [];
  const raw = real.readFileSync(file, 'utf8');
  if (!raw.startsWith(MAGIC)) return raw.split('\n').filter(Boolean).map((t, i) => ({ ok: true, text: t, line: i + 1, plain: true }));
  return raw.slice(MAGIC.length).split('\n').filter(Boolean).map((l, i) => {
    try { return { ok: true, text: decryptRecord(l).toString('utf8'), line: i + 1 }; } catch { return { ok: false, line: i + 1 }; }
  });
}

const covered = (p) => {
  if (typeof p !== 'string' && !(p instanceof URL)) return false; // file descriptors etc. → untouched
  const abs = path.resolve(String(p instanceof URL ? p.pathname : p)).toLowerCase();
  const root = path.resolve(DATA_DIR).toLowerCase() + path.sep;
  return abs.startsWith(root) && !PLAIN.some((x) => abs === x.toLowerCase() || abs.startsWith(x.toLowerCase() + path.sep));
};
const encOf = (o) => (typeof o === 'string' ? o : o?.encoding);
const toBuf = (data, o) => (Buffer.isBuffer(data) ? data : data instanceof Uint8Array ? Buffer.from(data) : Buffer.from(String(data), encOf(o) || 'utf8'));

let installed = false;
export function installDataEncryption() {
  if (installed) return;
  loadMasterKey();
  installed = true;
  fs.readFileSync = function (p, o) {
    if (!covered(p)) return real.readFileSync.apply(fs, arguments);
    const raw = real.readFileSync(p);
    if (!raw.subarray(0, MAGIC.length).equals(Buffer.from(MAGIC))) return encOf(o) ? raw.toString(encOf(o)) : raw; // not migrated yet
    const parts = raw.toString('utf8').slice(MAGIC.length).split('\n').filter(Boolean).map(decryptRecord);
    const out = Buffer.concat(parts);
    return encOf(o) ? out.toString(encOf(o)) : out;
  };
  // Note: Node's own fs.appendFileSync calls fs.writeFileSync(p, data, { flag: 'a' }) internally — so an append-flag write
  // is an append here, and our appends write the raw record with real.writeFileSync (never through the patched functions).
  const append = (p, data, o) => {
    const exists = fs.existsSync(p) && fs.statSync(p).size > 0;
    if (exists && !real.readFileSync(p).subarray(0, MAGIC.length).equals(Buffer.from(MAGIC))) {
      real.writeFileSync(p, `${MAGIC}${encryptRecord(Buffer.concat([real.readFileSync(p), toBuf(data, o)]))}\n`); // plain old file → encrypt it now
      return;
    }
    real.writeFileSync(p, `${exists ? '' : MAGIC}${encryptRecord(toBuf(data, o))}\n`, { flag: 'a' });
  };
  fs.writeFileSync = function (p, data, o) {
    if (!covered(p)) return real.writeFileSync.apply(fs, arguments);
    if (/^a/.test(String((typeof o === 'object' && o?.flag) || ''))) return append(p, data, o);
    return real.writeFileSync(p, `${MAGIC}${encryptRecord(toBuf(data, o))}\n`);
  };
  fs.appendFileSync = function (p, data, o) {
    if (!covered(p)) return real.appendFileSync.apply(fs, arguments);
    return append(p, data, o);
  };
  syncBuiltinESMExports(); // modules that did  import { readFileSync } from 'fs'  see the patched versions too
}

/** First start in office mode: encrypt every existing plain file under data/ (except builds/open-code). */
export function migrateExistingData() {
  let n = 0;
  const walk = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (!covered(p) && e.isDirectory()) continue;
      if (e.isDirectory()) walk(p);
      else if (covered(p)) {
        const raw = real.readFileSync(p);
        if (!raw.subarray(0, MAGIC.length).equals(Buffer.from(MAGIC))) { fs.writeFileSync(p, raw); n++; }
      }
    }
  };
  if (fs.existsSync(DATA_DIR)) walk(DATA_DIR);
  return n;
}
