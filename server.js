import 'dotenv/config';
import './office/boot.js'; // office mode: refuse unsafe folders + encrypt data/ before anything reads it
import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';
import crypto from 'crypto';
import { spawn, spawnSync } from 'child_process';
import { IS_VERCEL, KEYS_FILE } from './paths.js';
import * as kb from './kb.js';
import * as usage from './usage.js';
import { webSearch, needsSearch, withResults, resolveShort, shortUrl, isBuildRequest, isProjectRequest } from './search.js';
import { guardInjection, needsTools, runTool, parseTextToolCalls, TOOL_DEFS, REASONING, verifyMessages, HAS_PYTHON } from './engines.js';
import { checkProject } from './buildcheck.js';
import { checkCode, codeBlocks, warmCodeCheck } from './codecheck.js';
import { DEVICE } from './hardware.js';
import helmet from 'helmet';
import https from 'https';
import os from 'os';
import { OFFICE, CFG, HTTPS_ON, SAFE_ID, system as officeSystem, audit, ipAllowed, clientIp, enqueue, officeStart } from './office/core.js';
import { mountOffice, sessionMiddleware, gate, ownerOnly, need, can, deny, modelAllowed } from './office/auth.js';
import { parseFiles, mergeFiles, repairProject, fixRequest } from './src/lib/project.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Every provider below speaks the OpenAI-compatible chat API, so one code path serves all.
// env = the .env variable; keys pasted in the app UI are saved to keys.json and take priority.
const normalizeOllamaBase = (u) => {
  const clean = String(u || '').trim().replace(/\/+$/, '');
  if (!clean) return 'http://localhost:11434/v1';
  return /\/v1$/i.test(clean) ? clean : `${clean}/v1`;
};

const PROVIDERS = {
  // Keyless free provider — works with zero setup. Set POLLINATIONS=off in .env to hide it.
  pollinations: { name: 'Pollinations', tag: 'Free · no key', base: 'https://text.pollinations.ai/openai',
                  modelsUrl: 'https://text.pollinations.ai/models', builtin: true, allFree: true },
  ollama:     { name: 'Ollama (local)', tag: 'Free · unlimited', base: normalizeOllamaBase(process.env.OLLAMA_URL), builtin: true, allFree: true, url: 'https://ollama.com/download' },
  gemini:     { name: 'Google Gemini', tag: 'Free tier', env: 'GEMINI_API_KEY', base: 'https://generativelanguage.googleapis.com/v1beta/openai', allFree: true, url: 'https://aistudio.google.com/apikey' },
  anthropic:  { name: 'Anthropic Claude', tag: 'Paid', env: 'ANTHROPIC_API_KEY', base: 'https://api.anthropic.com/v1', url: 'https://console.anthropic.com/settings/keys' },
  openrouter: { name: 'OpenRouter', tag: '300+ models · many free', env: 'OPENROUTER_API_KEY', base: 'https://openrouter.ai/api/v1', url: 'https://openrouter.ai/keys' },
  groq:       { name: 'Groq', tag: 'Free · ultra fast', env: 'GROQ_API_KEY', base: 'https://api.groq.com/openai/v1', allFree: true, fast: true, url: 'https://console.groq.com/keys' },
  cerebras:   { name: 'Cerebras', tag: 'Trial credits · needs a card · ultra fast', env: 'CEREBRAS_API_KEY', base: 'https://api.cerebras.ai/v1', fast: true, url: 'https://cloud.cerebras.ai' },
  mistral:    { name: 'Mistral', tag: 'Free tier', env: 'MISTRAL_API_KEY', base: 'https://api.mistral.ai/v1', allFree: true, url: 'https://console.mistral.ai/api-keys' },
  openai:     { name: 'OpenAI', tag: 'Paid', env: 'OPENAI_API_KEY', base: 'https://api.openai.com/v1', url: 'https://platform.openai.com/api-keys' },
  deepseek:   { name: 'DeepSeek', tag: 'Paid · cheap', env: 'DEEPSEEK_API_KEY', base: 'https://api.deepseek.com/v1', url: 'https://platform.deepseek.com/api_keys' },
};

// KEYS_FILE comes from paths.js (keys.json locally, /tmp on Vercel)
const readSaved = () => { try { return JSON.parse(fs.readFileSync(KEYS_FILE, 'utf8')); } catch { return {}; } };
function applyKeys() {
  const saved = readSaved();
  for (const [id, p] of Object.entries(PROVIDERS)) {
    if (id === 'pollinations') { p.key = process.env.POLLINATIONS === 'off' ? '' : (process.env.POLLINATIONS_API_KEY || 'none'); p.noAuth = !process.env.POLLINATIONS_API_KEY; }
    // Ollama runs on your PC — on Vercel it's only used if OLLAMA_URL points to a public address
    else if (id === 'ollama') p.key = IS_VERCEL && !process.env.OLLAMA_URL ? '' : (process.env.OLLAMA_API_KEY || 'ollama'); // key = the Learn tunnel's guard (npm run learn-online)
    else if (!p.custom) p.key = (saved[id] || process.env[p.env] || '').trim();
  }
  if (OFFICE) for (const [id, p] of Object.entries(PROVIDERS)) if (id !== 'ollama' && !CFG.allowedProviders.includes(id)) p.key = '';
  // Custom OpenAI-compatible endpoints added from the app (LM Studio, vLLM, Together, your own server…)
  for (const id of Object.keys(PROVIDERS)) if (PROVIDERS[id].custom) delete PROVIDERS[id];
  for (const c of saved._custom || []) {
    PROVIDERS[c.id] = {
      name: c.name, tag: 'Custom API', base: c.base.replace(/\/+$/, ''), custom: true, allFree: !!c.free,
      key: c.key || 'none', noAuth: !c.key, staticModels: c.models?.length ? c.models : null,
    };
  }
}
const writeSaved = (s) => fs.writeFileSync(KEYS_FILE, JSON.stringify(s, null, 2));
applyKeys();

const headersFor = (id) => {
  const p = PROVIDERS[id];
  const h = { 'Content-Type': 'application/json' };
  if (!p.noAuth) h.Authorization = `Bearer ${p.key}`;
  if (id === 'anthropic') { h['x-api-key'] = p.key; h['anthropic-version'] = '2023-06-01'; }
  if (id === 'openrouter') { h['HTTP-Referer'] = 'http://localhost'; h['X-Title'] = 'Evolvix'; }
  return h;
};

// Your own model family, built by `npm run build-models` from models/Modelfile.*
// The family name comes from models/family.json (re-read on every model reload, so renaming needs no restart).
let FAMILY = { name: 'AIO', id: 'aio' };
let OWN = {};
let DEFAULT_OWN = '';
function loadFamily() {
  try { FAMILY = JSON.parse(fs.readFileSync(path.join(__dirname, 'models', 'family.json'), 'utf8')); } catch {}
  const f = FAMILY.id;
  // Default own model: learn, or learn-codeplus once the exam showed it scores higher (training/compare.mjs writes this file)
  try { DEFAULT_OWN = JSON.parse(fs.readFileSync(path.join(__dirname, 'data', 'default-model.json'), 'utf8')).model || f; } catch { DEFAULT_OWN = f; }
  OWN = {
    [`${f}-codeplus`]: { label: `${FAMILY.name} Code+`, desc: 'Your fine-tuned Learn · trained on your verified work', rank: 0, vision: false, fast: false },
    [f]: { label: FAMILY.name, desc: 'Thinks first · codes · unlimited', rank: 1, vision: true, fast: true },
    [`${f}-code`]: { label: `${FAMILY.name} Code`, desc: 'Direct coder · code first, no fluff', rank: 2, vision: false, fast: true },
    [`${f}-pro`]: { label: `${FAMILY.name} Pro`, desc: 'Balanced · everyday', rank: 3, vision: true, fast: false },
    [`${f}-lite`]: { label: `${FAMILY.name} Lite`, desc: 'Fastest · quick answers', rank: 4, vision: false, fast: true },
    [`${f}-vision`]: { label: `${FAMILY.name} Vision`, desc: 'Reads images', rank: 5, vision: true, fast: false, hidden: true }, // used automatically for images
    [`${f}-max`]: { label: `${FAMILY.name} Max`, desc: 'Bigger brain for hard problems', rank: 6, vision: false, fast: false, hidden: true }, // message box → 🧠 Max quality
    [`${f}-32k`]: { label: `${FAMILY.name} 32K`, desc: 'Long window · only for Claude Code (claude-local.cmd)', rank: 7, vision: false, fast: false, hidden: true },
  };
}
loadFamily();

// Built-in Learn instructions (used whenever Learn runs via always-online cloud fallback while your PC / Ollama is offline)
function loadCoreSystem(modelId = '') {
  try {
    const core = fs.readFileSync(path.join(__dirname, 'models', 'system.md'), 'utf8').trim();
    if (/-code(:|$)/.test(modelId)) {
      return `You are ${FAMILY.name} Code, made by ${FAMILY.company || 'Evolvix'} — a direct, elite coding and technical AI assistant.\n`
        + `- Start immediately with the answer or code in the first sentence. Never use greetings or closing summaries.\n`
        + `- Output complete, clean, production-ready code with zero placeholders.\n\n${core}`;
    }
    return `You are ${FAMILY.name}, made by ${FAMILY.company || 'Evolvix'}. Only when asked who you are, say you are ${FAMILY.name} from ${FAMILY.company || 'Evolvix'}.\n\n${core}`;
  } catch { return ''; }
}
const SKIP =/embed|whisper|tts|dall-e|image|moderation|audio|transcribe|realtime|guard|rerank|ocr/i;

async function listModels(id, status) {
  const p = PROVIDERS[id];
  const ctrl = new AbortController();
  const isLocalOllama = id === 'ollama' && /localhost|127\.0\.0\.1/i.test(p.base);
  const timer = setTimeout(() => ctrl.abort(), isLocalOllama ? 2500 : 8000);
  try {
    if (p.staticModels) {
      const list = p.staticModels.map((mid) => ({ provider: id, providerName: p.name, id: mid, label: mid, free: !!p.allFree, fast: false, vision: false }));
      status.push({ id, name: p.name, ok: true, count: list.length });
      return list;
    }
    const r = await fetch(p.modelsUrl || `${p.base}/models`, { headers: headersFor(id), signal: ctrl.signal });
    if (!r.ok) throw new Error(`HTTP ${r.status}${[400, 401, 403].includes(r.status) ? ' (invalid API key)' : ''}`);
    const j = await r.json();
    const list = (Array.isArray(j) ? j : (j.data || j.models || []))
      .map((m) => {
        const mid = String(m.id || m.name || '').replace(/^models\//, '');
        if (m.pricing) usage.livePrices.set(`${id}:${mid}`, { in: Number(m.pricing.prompt) || 0, out: Number(m.pricing.completion) || 0 });
        const free = p.allFree || mid.endsWith(':free') ||
          (m.pricing && Number(m.pricing.prompt) === 0 && Number(m.pricing.completion) === 0);
        const own = id === 'ollama' && OWN[mid.replace(/:latest$/, '')];
        if (own) return { provider: id, providerName: `${FAMILY.name} · Your own models`, id: mid, label: own.label, desc: own.desc, own: true, free: true, fast: own.fast, vision: own.vision,
          hidden: !!own.hidden, default: mid.replace(/:latest$/, '') === DEFAULT_OWN }; // hidden = learn-vision / learn-max: chosen automatically or by a toggle
        const vision = /vision|vl\b|gpt-4o|gpt-4\.1|gpt-5|claude|gemini|llava|pixtral|gemma-?3:(?!1b)|llama-4/i.test(mid) || !!m.vision;
        return { provider: id, providerName: p.name, id: mid, label: m.display_name || mid, free: !!free, fast: !!p.fast, vision };
      })
      .filter((m) => m && m.id && !SKIP.test(m.id));
    status.push({ id, name: p.name, ok: true, count: list.length });
    return list;
  } catch (e) {
    const msg = e.name === 'AbortError' ? 'not reachable (timed out)'
      : e.cause?.code === 'ECONNREFUSED' ? 'not running'
      : e.cause?.code === 'ENOTFOUND' ? `address not found (${e.cause.hostname || p.base}) — tunnel expired? run npm run learn-online`
      : (e.cause?.code || e.message);
    status.push({ id, name: p.name, ok: false, error: msg });
    if (id !== 'ollama') console.warn(`[models] ${id}: ${msg}`);
    return [];
  } finally {
    clearTimeout(timer);
  }
}

let cache = { at: 0, data: null };
let lastStatus = [];

const app = express();
if (OFFICE) {
  app.disable('x-powered-by');
  // Only allowed office IPs reach anything at all
  app.use((req, res, next) => (ipAllowed(clientIp(req)) ? next() : res.status(403).send('Forbidden')));
  // No path tricks: "..", backslashes or encoded dots anywhere in the URL → rejected
  app.use((req, res, next) => { let p = req.path; try { p = decodeURIComponent(p); } catch { return res.status(400).end(); } return /\.\.|\\|\0/.test(p) ? res.status(400).json({ error: 'Invalid path' }) : next(); });
  app.use(helmet({
    contentSecurityPolicy: { useDefaults: false, directives: { defaultSrc: ["'self'"], scriptSrc: ["'self'"], styleSrc: ["'self'", "'unsafe-inline'"], imgSrc: ["'self'", 'data:', 'blob:'],
      fontSrc: ["'self'", 'data:'], connectSrc: ["'self'"], frameSrc: ["'self'"], mediaSrc: ["'self'", 'blob:', 'data:'], workerSrc: ["'self'", 'blob:'], objectSrc: ["'none'"],
      baseUri: ["'self'"], formAction: ["'self'"], frameAncestors: ["'none'"] } },
    frameguard: { action: 'deny' }, referrerPolicy: { policy: 'no-referrer' }, crossOriginEmbedderPolicy: false, hsts: HTTPS_ON ? { maxAge: 15552000 } : false,
  }));
  // Big bodies only where files/images/chats are uploaded; 1 MB everywhere else
  const BIG = /^\/api\/(chat|extract|kb\/[\w-]+|office\/doc\/[\w-]+)$/;
  app.use((req, res, next) => express.json({ limit: BIG.test(req.path) ? '25mb' : '1mb' })(req, res, next));
  app.use(sessionMiddleware);
  app.use(gate);
  mountOffice(app);
  // Owner only: keys, billing, usage, balances, training data
  app.use(['/api/keys', '/api/custom-provider', '/api/search-keys', '/api/billing', '/api/usage', '/api/balances', '/api/training'], ownerOnly);
  // Knowledge bases: permission + safe ids
  app.use('/api/kb', (req, res, next) => (req.path.split('/').filter(Boolean).some((x) => !SAFE_ID.test(x)) ? res.status(400).json({ error: 'Invalid id' }) : next()), need('kb', 'knowledge bases'));
  app.post('/api/kb/:id', need('upload', 'uploading files'));
  app.post('/api/extract', need('upload', 'uploading files'));
} else {
  app.use(express.json({ limit: '25mb' }));
}
// Office mode: every user's knowledge bases live under their own id (u_<user>_<kb>) — nobody can open another user's
const kbOf = (req, id) => (OFFICE && req.user ? `u_${req.user.id}_${id}` : id);

// ---------- Live-site protection ----------
// 1) Optional password: set APP_PASSWORD (e.g. in Vercel → Settings → Environment Variables).
const PASS = process.env.APP_PASSWORD || '';
const token = PASS ? crypto.createHash('sha256').update(`aio:${PASS}`).digest('hex') : '';
const cookieOf = (req) => Object.fromEntries((req.headers.cookie || '').split(';').map((c) => c.trim().split('=').map(decodeURIComponent)).filter((x) => x[0]));
app.get('/api/auth', (req, res) => res.json({ required: !!PASS, ok: !PASS || cookieOf(req).aio_auth === token }));
app.post('/api/login', (req, res) => {
  if (!PASS) return res.json({ ok: true });
  const given = String(req.body?.password || '');
  const ok = given.length === PASS.length && crypto.timingSafeEqual(Buffer.from(given), Buffer.from(PASS));
  if (!ok) return res.status(401).json({ error: 'Wrong password' });
  res.setHeader('Set-Cookie', `aio_auth=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${60 * 60 * 24 * 30}${IS_VERCEL ? '; Secure' : ''}`);
  res.json({ ok: true });
});
app.use('/api', (req, res, next) => {
  if (OFFICE || !PASS || cookieOf(req).aio_auth === token) return next();
  res.status(401).json({ error: 'Password required', auth: true });
});
// 2) On a public deployment, keys/providers can't be changed from the browser (set them as environment variables instead).
const LOCKED = IS_VERCEL && process.env.ALLOW_KEY_EDIT !== '1';
const lock = (req, res, next) => (LOCKED
  ? res.status(403).json({ error: 'On the live site, API keys are set in Vercel → Settings → Environment Variables (then redeploy).' })
  : next());
app.post('/api/keys', lock);
app.post('/api/custom-provider', lock);
app.delete('/api/custom-provider/:id', lock);
app.post('/api/search-keys', lock);
app.post('/api/billing', lock);
app.delete('/api/usage', lock);

async function buildModelList() {
  loadFamily();
  const active = Object.keys(PROVIDERS).filter((id) => PROVIDERS[id].key);
  const status = [];
  const lists = await Promise.all(active.map((id) => listModels(id, status)));
  const flat = lists.flat();
  const ownRank = (m) => OWN[m.id.replace(/:latest$/, '')]?.rank ?? 99;
  let ownModels = flat.filter((m) => m.own).sort((a, b) => ownRank(a) - ownRank(b));
  const cloudModels = flat.filter((m) => !m.own).sort((a, b) =>
    a.provider === b.provider ? Number(b.free) - Number(a.free) || a.id.localeCompare(b.id) : 0);

  // Permanent 24/7 availability: if local/tunnel Ollama is offline (e.g. on Vercel when your PC is off, or before Ollama starts),
  // keep Learn, Learn Code, Learn Vision & Learn Max ALWAYS available using your system.md instructions + best connected cloud backend.
  const usingCloudFallback = !ownModels.length && cloudModels.length > 0 && !OFFICE;
  if (usingCloudFallback) {
    const f = FAMILY.id;
    ownModels = [f, `${f}-code`, `${f}-vision`, `${f}-max`].map((k) => ({
      provider: 'ollama', providerName: `${FAMILY.name} · Your own models`, id: `${k}:latest`,
      label: OWN[k].label, desc: OWN[k].desc, own: true, cloud: true, free: true,
      fast: OWN[k].fast, vision: OWN[k].vision, hidden: !!OWN[k].hidden, default: k === f,
    }));
  }

  const models = [...ownModels, ...cloudModels];
  const missingKeys = Object.keys(PROVIDERS).filter((id) => !PROVIDERS[id].key);
  const data = { models, status, missingKeys, usingCloudFallback };
  lastStatus = status;
  cache = models.length ? { at: Date.now(), ttl: usingCloudFallback ? 60_000 : 10 * 60_000, data } : { at: 0, ttl: 0, data: null };
  return data;
}

// Picks the best available FREE cloud model when Learn runs in 24/7 cloud-fallback mode (Vercel or offline Ollama)
async function pickCloudFallback(modelId = '', needVision = false) {
  const data = cache.data || await buildModelList();
  const all = (data?.models || []).filter((m) => !m.own && PROVIDERS[m.provider]?.key);
  const freePool = all.filter((m) => m.free && (!needVision || m.vision));
  const pool = freePool.length ? freePool : all.filter((m) => !needVision || m.vision);
  if (!pool.length) {
    return all.find((m) => m.free) || all[0] || (PROVIDERS.pollinations?.key ? { provider: 'pollinations', id: 'openai' } : null);
  }
  const isCode = /-code(:|$)/.test(modelId);
  const isMax = /-max(:|$)/.test(modelId);
  const find = (prov, re) => pool.find((m) => m.provider === prov && (!re || re.test(m.id)));
  if (isCode) {
    return find('gemini', /flash|pro/i) || find('groq', /qwen|coder|70b/i) || find('deepseek', /coder|chat/i)
      || find('anthropic') || find('openai') || find('openrouter', /coder.*:free|:free/i)
      || find('pollinations', /coder|qwen|large|openai$/i) || find('pollinations') || pool[0];
  }
  if (isMax) {
    return find('gemini', /pro|2\.5-flash|flash/i) || find('anthropic') || find('openai', /gpt-4|gpt-5|o3/i)
      || find('deepseek') || find('groq', /70b|qwen/i) || find('openrouter', /70b.*:free|:free/i)
      || find('pollinations', /large|claude|gemini|openai$/i) || find('pollinations') || pool[0];
  }
  return find('gemini', /flash/i) || find('groq', /70b|llama|qwen/i) || find('anthropic') || find('openai')
    || find('deepseek') || find('mistral') || find('openrouter', /:free/i)
    || find('pollinations', /^openai$|large|fast/i) || find('pollinations') || pool[0];
}

app.get('/api/models', async (req, res) => {
  if (OFFICE && req.user?.role !== 'owner') { const j = res.json.bind(res); res.json = (d) => j(d?.models ? { ...d, models: d.models.filter((m) => modelAllowed(req, m.id)), status: [], missingKeys: [] } : d); }
  if (!req.query.refresh && cache.data && Date.now() - cache.at < (cache.ttl || 10 * 60_000)) return res.json(cache.data);
  res.json(await buildModelList());
});

// Provider list for the "Connect providers" screen (never returns the keys themselves)
app.get('/api/providers', (req, res) => {
  const saved = readSaved();
  res.json(Object.entries(PROVIDERS).map(([id, p]) => ({
    id, name: p.name, tag: p.custom ? `Custom API · ${p.base}` : p.tag, url: p.url, builtin: !!p.builtin, custom: !!p.custom,
    connected: id === 'ollama' ? !!lastStatus.find((s) => s.id === 'ollama' && s.ok) : !!p.key, source: saved[id] ? 'app' : (p.env && process.env[p.env] ? 'env' : null),
    hint: p.key && !p.builtin ? `${p.key.slice(0, 4)}…${p.key.slice(-4)}` : null,
  })));
});

// Save (or remove, with empty key) a provider key. The key is tested before saving.
app.post('/api/keys', async (req, res) => {
  const { provider, key = '' } = req.body || {};
  const p = PROVIDERS[provider];
  if (!p || p.builtin || p.custom) return res.status(400).json({ error: 'Unknown provider' });
  const saved = readSaved();
  const k = String(key).trim();
  if (k) {
    const old = p.key;
    p.key = k;
    const status = [];
    const list = await listModels(provider, status);
    if (!status[0]?.ok) { p.key = old; return res.status(400).json({ error: `Key rejected — ${status[0]?.error}` }); }
    saved[provider] = k;
    fs.writeFileSync(KEYS_FILE, JSON.stringify(saved, null, 2));
    applyKeys(); cache = { at: 0, data: null };
    return res.json({ ok: true, count: list.length });
  }
  delete saved[provider];
  fs.writeFileSync(KEYS_FILE, JSON.stringify(saved, null, 2));
  applyKeys(); cache = { at: 0, data: null };
  res.json({ ok: true, count: 0 });
});

// Add a custom OpenAI-compatible API. It is tested before saving.
app.post('/api/custom-provider', async (req, res) => {
  const { name = '', base = '', key = '', models = '' } = req.body || {};
  if (!name.trim() || !/^https?:\/\/\S+$/i.test(base.trim())) return res.status(400).json({ error: 'Enter a name and a URL starting with http:// or https://' });
  const entry = {
    id: 'c_' + name.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '').slice(0, 24) + '_' + Date.now().toString(36).slice(-3),
    name: name.trim().slice(0, 40), base: base.trim(), key: key.trim(),
    models: String(models).split(/[\s,]+/).map((s) => s.trim()).filter(Boolean),
    free: /localhost|127\.0\.0\.1|192\.168\./.test(base),
  };
  const saved = readSaved();
  saved._custom = [...(saved._custom || []), entry];
  writeSaved(saved); applyKeys();
  const status = [];
  const list = await listModels(entry.id, status);
  if (!status[0]?.ok || !list.length) {
    saved._custom = saved._custom.filter((c) => c.id !== entry.id);
    writeSaved(saved); applyKeys();
    return res.status(400).json({ error: `Could not load models — ${status[0]?.error || 'none found'}. Check the URL (usually ends with /v1) or type the model names.` });
  }
  cache = { at: 0, data: null };
  res.json({ ok: true, count: list.length });
});

app.delete('/api/custom-provider/:id', (req, res) => {
  const saved = readSaved();
  saved._custom = (saved._custom || []).filter((c) => c.id !== req.params.id);
  writeSaved(saved); applyKeys(); cache = { at: 0, data: null };
  res.json({ ok: true });
});

// ---------- Knowledge base ("My model" data) ----------
app.get('/api/kb/:id', (req, res) => res.json(kb.listDocs(kbOf(req, req.params.id))));
app.post('/api/kb/:id', async (req, res) => {
  const { name = 'notes.txt', data, text } = req.body || {};
  try {
    const content = text ?? await kb.extractText(name, data || '');
    res.json(await kb.addDoc(kbOf(req, req.params.id), String(name).slice(0, 120), content));
  } catch (e) { res.status(400).json({ error: e.message }); }
});
app.delete('/api/kb/:id/:doc', (req, res) => { kb.removeDoc(kbOf(req, req.params.id), req.params.doc); res.json({ ok: true }); });
app.delete('/api/kb/:id', (req, res) => { kb.removeKb(kbOf(req, req.params.id)); res.json({ ok: true }); });
// A PDF / Word / Excel file attached to a chat message → its text (the message box sends it like any other file)
app.post('/api/extract', async (req, res) => {
  const { name = 'file', data = '' } = req.body || {};
  try { res.json({ text: (await kb.extractText(String(name), data)).slice(0, 200_000) }); } catch (e) { res.status(400).json({ error: e.message }); }
});

// Short source links used in answers → redirect to the real article
app.get('/api/r/:id', (req, res) => { const u = resolveShort(req.params.id); return u ? res.redirect(302, u) : res.status(404).send('Link expired'); });

// ---------- Web search keys (Tavily / Brave — optional, free tiers) ----------
const searchKeys = () => {
  const s = readSaved()._search || {};
  return { tavily: s.tavily || process.env.TAVILY_API_KEY || '', brave: s.brave || process.env.BRAVE_API_KEY || '' };
};
app.get('/api/search-keys', (req, res) => {
  const k = searchKeys();
  res.json(Object.fromEntries(Object.entries(k).map(([n, v]) => [n, v ? `${v.slice(0, 4)}…${v.slice(-4)}` : null])));
});
app.post('/api/search-keys', async (req, res) => {
  const { engine, key = '' } = req.body || {};
  if (!['tavily', 'brave'].includes(engine)) return res.status(400).json({ error: 'Unknown search engine' });
  const k = String(key).trim();
  if (k) { // test before saving
    const r = await webSearch(`test ${Date.now()}`, { [engine]: k }).catch(() => null);
    if (!r || r.engine !== (engine === 'tavily' ? 'Tavily' : 'Brave')) return res.status(400).json({ error: 'Key rejected — check it and try again' });
  }
  const saved = readSaved();
  saved._search = { ...(saved._search || {}), [engine]: k || undefined };
  writeSaved(saved);
  res.json({ ok: true });
});

// ---------- Speed: keep local models loaded + pre-warm ----------
const OLLAMA_NATIVE = (process.env.OLLAMA_URL || 'http://localhost:11434/v1').replace(/\/v1\/?$/, '');
// Learn on the live site: requests to your PC's Ollama carry the guard's key (see tunnel/learn-online.mjs)
const OLLAMA_H = process.env.OLLAMA_API_KEY ? { Authorization: `Bearer ${process.env.OLLAMA_API_KEY}` } : {};
const KEEP_ALIVE = process.env.OLLAMA_KEEP_ALIVE || '2h';
const BAKED = new Map(); // model → { system, hybrid, at }
async function modelMeta(model) {
  const hit = BAKED.get(model);
  if (hit && Date.now() - hit.at < 60_000) return hit; // re-check every minute (picks up npm run build-models)
  try {
    const j = await (await fetch(`${OLLAMA_NATIVE}/api/show`, { method: 'POST', headers: OLLAMA_H, body: JSON.stringify({ model }), signal: AbortSignal.timeout(5000) })).json();
    const tpl = `${j.template || ''} ${(j.details?.families || []).join(' ')} ${j.details?.family || ''}`;
    const hybrid = /<think>|qwen3/i.test(tpl); // auto-detects Qwen3 hybrid thinking across any tier (1.7B, 4B, 8B, 14B, 32B, custom GGUF)
    const entry = { system: j.system || '', hybrid, at: Date.now() };
    BAKED.set(model, entry);
    return entry;
  } catch { return hit || { system: '', hybrid: !/-(code|pro|lite)(:|$)/.test(String(model)), at: 0 }; }
}
const bakedSystem = async (model) => (await modelMeta(model)).system;

// Loads the model into memory and pre-processes its system prompt, so the first real message starts instantly.
const WARM = new Map(); // model → the prompt it was last warmed with
app.post('/api/warm', async (req, res) => {
  const { provider, model, system, kbId } = req.body || {};
  const t0 = Date.now();
  const done = () => { if (!res.headersSent) res.json({ ok: true, ms: Date.now() - t0 }); };
  try {
    if (kbId) kb.warm(kbId).catch(() => {});
    if (provider !== 'ollama' || !model) return done();
    // Load model weights into memory quickly without evaluating a huge prompt that blocks the user's first chat message
    if (WARM.get(model)) return done();
    await fetch(`${OLLAMA_NATIVE}/api/generate`, {
      method: 'POST', headers: OLLAMA_H, signal: AbortSignal.timeout(15_000),
      body: JSON.stringify({ model, prompt: '', stream: false, keep_alive: KEEP_ALIVE }),
    });
    WARM.set(model, '1');
  } catch {}
  done(); // replies when the model is loaded and its prompt is cached → the app shows "Ready"
});

// Is this model actually installed and reachable on Ollama right now? (Ignores synthetic cloud-fallback entries.)
async function ollamaHas(id) {
  if (!PROVIDERS.ollama?.key) return false;
  try {
    const j = await (await fetch(`${OLLAMA_NATIVE}/api/tags`, { headers: OLLAMA_H, signal: AbortSignal.timeout(2000) })).json();
    const norm = String(id).replace(/:latest$/, '');
    return (j.models || []).some((m) => {
      const n = String(m.name || m.model || '').replace(/:latest$/, '');
      return n === norm;
    });
  } catch { return false; }
}

// Local PC permanent fix: if Ollama is installed on this machine but wasn't started yet, launch `ollama serve` in the background
async function ensureLocalOllama() {
  if (IS_VERCEL || !/^https?:\/\/(localhost|127\.0\.0\.1)\b/i.test(PROVIDERS.ollama.base)) return;
  try {
    const r = await fetch(`${OLLAMA_NATIVE}/api/version`, { signal: AbortSignal.timeout(1200) });
    if (r.ok) return;
  } catch {}
  const winExe = path.join(process.env.LOCALAPPDATA || '', 'Programs', 'Ollama', 'ollama.exe');
  const exe = os.platform() === 'win32' && fs.existsSync(winExe) ? winExe : 'ollama';
  try {
    const child = spawn(exe, ['serve'], { detached: true, stdio: 'ignore', windowsHide: true });
    child.on('error', () => {});
    child.unref();
    console.log('  ↻ Started local Ollama background service automatically');
  } catch {}
}

// qwen3 / DeepSeek-R1 think inside <think>…</think> (or <thinking>); that text never belongs in an answer, a check or a lesson
const THINK = /<think(?:ing)?>[\s\S]*?(?:<\/think(?:ing)?>|$)/gi;
const noThink = (t) => String(t || '').replace(THINK, '').trim();
const textOf = (m) => (typeof m?.content === 'string' ? m.content : (m?.content || []).filter((p) => p.type === 'text').map((p) => p.text).join(' '));
// Change the text of a message whether its content is a string or [text, image…] parts
const mapText = (m, fn) => (typeof m.content === 'string' ? { ...m, content: fn(m.content) }
  : { ...m, content: m.content.map((p, i) => (i === 0 && p.type === 'text' ? { ...p, text: fn(p.text) } : p)) });

// Which models can call tools? Ollama tells us per model; these cloud APIs support OpenAI-style tools.
const TOOL_PROVIDERS = new Set(['gemini', 'openai', 'anthropic', 'groq', 'cerebras', 'mistral', 'openrouter', 'deepseek']);
const CAPS = new Map();
const SUMMARIES = new Map(); // chat compaction: hash of the older messages → their short summary
// A short tech topic ("php", "python basics", "redux", "flexbox") → a real overview with examples, never a web search
const TECH_TOPIC = /\b(php|python|java|javascript|js|typescript|ts|react|node(\.?js)?|express|sql|mysql|postgres|mongodb|html|css|sass|tailwind|bootstrap|c\+\+|c#|golang|go|rust|kotlin|swift|dart|flutter|django|flask|fastapi|laravel|spring|next\.?js|vue|angular|svelte|vite|redux|zustand|hooks?|use[a-z]+|context|props|state ?management|jsx|dom|api|rest|graphql|git|docker|linux|bash|regex|json|oop|recursion|closures?|promises?|async|flexbox|grid|mui|recharts|webpack|npm)\b/i;
const STYLES = {             // Style chip in the message box → one line added to the last message
  concise: 'Style: concise — the shortest complete answer, nothing extra.',
  explanatory: 'Style: explanatory — teach it: explain the why step by step, with a small example.',
  formal: 'Style: formal — professional, precise wording; no emoji or slang.',
};
if (!IS_VERCEL) warmCodeCheck(); // instant code checks: load esbuild + the MUI export list now, not on the first answer
async function supportsTools(provider, model) {
  if (provider !== 'ollama') return TOOL_PROVIDERS.has(provider);
  if (!CAPS.has(model)) {
    try {
      const j = await (await fetch(`${OLLAMA_NATIVE}/api/show`, { method: 'POST', headers: OLLAMA_H, body: JSON.stringify({ model }), signal: AbortSignal.timeout(5000) })).json();
      CAPS.set(model, (j.capabilities || []).includes('tools'));
    } catch { return false; }
  }
  return CAPS.get(model);
}

app.post('/api/chat', async (req, res) => {
  if (OFFICE) {
    if (!(officeSystem().allowSearch && CFG.allowSearchEnv)) { req.body.webSearch = 'off'; req.body.research = false; } // web search off unless the owner allows it
    if (req.body.kbId) req.body.kbId = SAFE_ID.test(String(req.body.kbId)) ? kbOf(req, req.body.kbId) : undefined;
  }
  const { messages = [], temperature, maxTokens, kbId, webSearch: webSearchMode = 'auto',
    reasoning = 'balanced', tools: toolsMode = 'auto', allowCode = false, extendedThinking = false, style = '', regenerate = false, research = false, noSave = false } = req.body; // noSave: npm run self-train decides what to keep
  let { system, model, provider } = req.body;
  let p = PROVIDERS[provider];
  res.setHeader('Content-Type', 'application/x-ndjson; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('X-Accel-Buffering', 'no');
  const tStart = Date.now();
  let sentText = '', sentReasoning = '', lastVerify = null, errored = false; // remembered for the answer cache
  const send = (obj) => {
    if (obj.t === 'text') sentText += obj.v; else if (obj.t === 'reasoning') sentReasoning += obj.v;
    else if (obj.t === 'verify') lastVerify = obj.v; else if (obj.t === 'error') errored = true;
    res.write(JSON.stringify(obj) + '\n');
  };

  // Permanent local + server fix: if a Learn model is selected and local/tunnel Ollama isn't reachable (e.g. Vercel 24/7 or PC offline),
  // seamlessly run Learn on the best connected cloud backend with your exact models/system.md instructions.
  const requestedBase = String(model || '').replace(/:latest$/, '');
  const isOwnRequest = provider === 'ollama' && !!OWN[requestedBase];
  const hasUserImage = messages.some((m) => Array.isArray(m.content) && m.content.some((x) => x.type === 'image_url'));
  let cloudLearn = false;
  if (isOwnRequest && !OFFICE && !(await ollamaHas(model))) {
    const fb = await pickCloudFallback(requestedBase, hasUserImage);
    if (fb && PROVIDERS[fb.provider]?.key) {
      const coreSys = loadCoreSystem(requestedBase);
      if (coreSys) system = system ? `${coreSys}\n\n${system}` : coreSys;
      provider = fb.provider;
      model = fb.id;
      p = PROVIDERS[provider];
      cloudLearn = true;
    }
  }

  if (!p || !p.key) { send({ t: 'error', v: `${p?.name || provider} is not connected — add its API key in Models → Connect providers` }); return res.end(); }
  // Office mode: what this user may do (403 + "Ask the owner"), then one generation at a time per model (owner first)
  let trainDir = path.join(__dirname, 'data', 'training'), trainTag = {};
  if (OFFICE) {
    const lastRaw = messages[messages.length - 1];
    const ask = textOf(lastRaw);
    if (!can(req, 'chat')) return deny(res, 'chat', 'chat');
    if (!modelAllowed(req, model)) return res.status(403).json({ error: `You don't have access to the model ${model}. Ask the owner for access.`, askOwner: true, model: String(model).replace(/:latest$/, '') });
    if ((Array.isArray(lastRaw?.content) || /\n--- File: /.test(ask)) && !can(req, 'upload')) return deny(res, 'upload', 'uploading files and images');
    if (allowCode && !can(req, 'code')) return deny(res, 'code', 'running code');
    if (isProjectRequest(ask) && !can(req, 'projects')) return deny(res, 'projects', 'full projects (build agent)');
    if (kbId && !can(req, 'kb')) return deny(res, 'kb', 'knowledge bases');
    // training data: only if the owner allows it AND this user agreed; kept apart in data/training/office/
    trainDir = officeSystem().allowTraining && req.user.consentTraining ? path.join(__dirname, 'data', 'training', 'office') : null;
    trainTag = { userId: req.user.id, office: true };
    if (provider === 'ollama') {
      const release = await enqueue(String(model), { owner: req.user.role === 'owner', onPos: (n) => { try { send({ t: 'note', v: `In queue (${n} ahead)` }); } catch {} } });
      res.on('close', release); res.on('finish', release);
    }
  }


  const ctrl = new AbortController();
  res.on('close', () => { if (!res.writableEnded) ctrl.abort(); });

  // An image sent to Learn (text-only qwen3) → Learn Vision (Gemma 3) answers it, and says so
  if (provider === 'ollama' && String(model).replace(/:latest$/, '') === FAMILY.id
    && messages.some((m) => Array.isArray(m.content) && m.content.some((x) => x.type === 'image_url'))
    && await ollamaHas(`${FAMILY.id}-vision:latest`)) {
    model = `${FAMILY.id}-vision:latest`;
    send({ t: 'note', v: `${FAMILY.name} Vision read the image for this answer.` });
  }

  // Your own Learn models: a system message would REPLACE the instructions built into the model,
  // so we put the built-in instructions first and add the app's extras (name, language…) after them.
  if (provider === 'ollama' && OWN[String(model).replace(/:latest$/, '')]) {
    const baked = await bakedSystem(model);
    if (baked) system = system ? `${baked}\n\n${system}` : baked;
  }

  // Safety: attached files are data — strip text inside them that tries to command the AI
  let injections = 0;
  let msgs = messages.map((m, i) => {
    if (i !== messages.length - 1 || m.role !== 'user') return m;
    return mapText(m, (t) => {
      const at = t.indexOf('\n--- File: ');
      if (at < 0) return t;
      const g = guardInjection(t.slice(at)); injections += g.found;
      return t.slice(0, at) + g.cleaned;
    });
  });

  // ---------- Learn on this PC: think only when needed; extra passes reuse the SAME model + system prompt (prompt cache) ----------
  const ownLearn = provider === 'ollama' && !!OWN[String(model).replace(/:latest$/, '')] && !/-vision(:|$)/.test(String(model));
  // One short extra call: no thinking, short budget, Stop aborts it, 30 s limit — on failure it returns '' and the answer goes on
  const pass = async (content, { max = 400, temperature = 0.2, ms = 30_000, history = true, bare = false } = {}) => { // bare: no system prompt (tiny helper tasks)
    if (ctrl.signal.aborted) return '';
    try {
      const r = await fetch(`${p.base}/chat/completions`, {
        method: 'POST', headers: headersFor(provider), signal: AbortSignal.any([ctrl.signal, AbortSignal.timeout(ms)]),
        body: JSON.stringify({ model, stream: false, temperature, max_tokens: max,
          messages: [...(system && !bare ? [{ role: 'system', content: system }] : []), ...(history ? msgs.slice(0, -1) : []),
            { role: 'user', content: ownLearn ? `${content} /no_think` : content }] }),
      });
      return noThink((await r.json()).choices?.[0]?.message?.content);
    } catch { return ''; }
  };
  const step = (id, label, status = 'running', detail) => send({ t: 'step', v: { id, label, status, ...(detail ? { detail } : {}) } });

  // Long chats (like Claude): send only the last 6 messages; everything older becomes ONE short summary, cached per chat
  if (provider === 'ollama' && msgs.length > 6) {
    const old = msgs.slice(0, -6);
    const key = crypto.createHash('sha1').update(JSON.stringify(old.map((m) => [m.role, textOf(m)]))).digest('hex');
    let sum = SUMMARIES.get(key);
    if (sum == null) {
      sum = await pass(`Summarise this earlier part of our chat in at most 5 short lines: my goal, decisions made, file/function names and facts to remember. No intro.\n\n${old.map((m) => `${m.role}: ${textOf(m).slice(0, 1500)}`).join('\n\n')}`, { max: 200, history: false });
      if (ctrl.signal.aborted) return res.end();
      if (sum) { SUMMARIES.set(key, sum); if (SUMMARIES.size > 200) SUMMARIES.delete(SUMMARIES.keys().next().value); }
    }
    msgs = msgs.slice(-6);
    if (sum) msgs[0] = mapText(msgs[0], (t) => `(Earlier in this chat: ${sum})\n\n${t}`);
  }

  // RAG: put the most relevant parts of this model's files into the LATEST user message.
  // (Not the system prompt — keeping system + history identical lets Ollama reuse its cache = much faster.)
  if (kbId) {
    const users = messages.filter((m) => m.role === 'user');
    const query = [textOf(users[users.length - 2]).slice(0, 300), textOf(users[users.length - 1])].join('\n');
    const hits = await kb.search(kbId, query).catch(() => []);
    for (const h of hits) { const g = guardInjection(h.text); h.text = g.cleaned; injections += g.found; }
    if (hits.length) {
      send({ t: 'sources', v: [...new Set(hits.map((h) => h.name))] });
      const ctx = `\n\n---\nExcerpts from my documents (use them if relevant, mention the file name; if the answer isn't there, say so):\n\n`
        + hits.map((h, i) => `[${i + 1}] (${h.name})\n${h.text}`).join('\n\n');
      const last = msgs[msgs.length - 1];
      const withCtx = typeof last.content === 'string' ? { ...last, content: last.content + ctx }
        : { ...last, content: last.content.map((p, i) => (i === 0 && p.type === 'text' ? { ...p, text: p.text + ctx } : p)) };
      msgs = [...msgs.slice(0, -1), withCtx];
    }
  }

  // Web search: 'on' = always, 'auto' = when the question needs fresh/verifiable facts, 'off' = never
  const lastText = textOf(messages[messages.length - 1]);
  let searched = false;
  // "Build me a portfolio website" → ask for real, runnable code the app can preview (like Claude's artifacts)
  const projectMode = isProjectRequest(lastText) && typeof msgs[msgs.length - 1]?.content === 'string';
  if (projectMode) {
    // Full multi-file React + Vite project → plan first (like Claude), then all files; after the answer the build agent
    // checks it with a real Vite build + render and auto-fixes errors. The app shows the file tree, a live preview and a ZIP.
    const last = msgs[msgs.length - 1];
    const isApp = /\b(system|management|tracker|todo|to-do|dashboard|crud|admin|inventory|feedback|booking|attendance|expense|budget|quiz|chat app|store|shop|e-?commerce|form|survey|notes?|planner|calculator|game)\b/i.test(lastText)
      && !/\b(portfolio|landing page|resume|cv)\b/i.test(lastText);
    let plan = '';
    send({ t: 'step', v: { id: 'plan', label: 'Planning the project', status: 'running' } });
    try {
      const r = await fetch(`${p.base}/chat/completions`, {
        method: 'POST', headers: headersFor(provider), signal: ctrl.signal,
        body: JSON.stringify({ model, stream: false, temperature: 0.3, max_tokens: 700, messages: [
          { role: 'system', content: ownLearn && system ? system : 'You are a senior React architect. Write short, concrete build plans. No code.' }, // Claude Mode: same system prompt → prompt cache
          { role: 'user', content: `Request: ${lastText}\n\nWrite the build plan for a React + Vite + MUI ${isApp ? 'web APP with real working features' : 'website'} in at most 12 short bullet lines:\n- what the user can see and DO (pages/sections, ${isApp ? 'forms, lists, add/edit/delete, filters, ratings…' : 'sections and their content'})\n- the file tree (every file path)\n- each component (one file each, under src/components/) with the props (name: type) it receives from App\n- the data shape in src/data.js${isApp ? ' and the React state (useState) + localStorage persistence' : ''}\n- the colour scheme and layout\n(No code.)${ownLearn ? ' /no_think' : ''}` },
        ] }),
      });
      plan = ((await r.json()).choices?.[0]?.message?.content || '').replace(THINK, '').trim();
    } catch (e) { if (e.name === 'AbortError') return res.end(); }
    if (plan) send({ t: 'reasoning', v: `Build plan\n${plan}\n` });
    send({ t: 'step', v: { id: 'plan', label: plan ? 'Planned the project' : 'Planning skipped', status: plan ? 'done' : 'error' } });
    send({ t: 'step', v: { id: 'write', label: 'Writing the files', status: 'running' } });
    msgs = [...msgs.slice(0, -1), { ...last, content: `${last.content}\n\n${plan ? `Follow this plan:\n${plan}\n\n` : ''}(Build it now as a COMPLETE, runnable React + Vite project. Output EVERY file using exactly this format, one after another:
<file path="package.json">…full file…</file>
<file path="vite.config.js">…</file>
<file path="index.html">…</file>   ← MUST contain <div id="root"></div> and <script type="module" src="/src/main.jsx"></script>
<file path="src/main.jsx">…</file>   ← import React, ReactDOM from 'react-dom/client', App from './App'; render <App /> into #root
<file path="src/theme.js">…</file>   ← ONLY: import { createTheme } from '@mui/material/styles'; export default createTheme({...}). No JSX in .js files.
<file path="src/data.js">…</file>   ← export const … (named exports), realistic specific content
<file path="src/App.jsx">…</file>   ← imports theme + every component it uses; ThemeProvider + CssBaseline
<file path="src/components/Name.jsx">…</file>   ← one file per component in the plan, each with "export default"
Rules:
- package.json: react 18, react-dom 18, @mui/material 5, @mui/icons-material 5, @emotion/react, @emotion/styled; devDependencies vite and @vitejs/plugin-react; scripts dev/build/preview.
- Every component reads its props exactly as App passes them. Import EVERYTHING you use (React hooks, MUI components, icons, your own components, data).
${isApp
    ? '- This is an APP: it must really work. Use useState for the data, forms with validation (TextField, Select, Rating…), add / edit / delete, a list or table of items, search or filter, counts/summary cards, and save to localStorage so data stays after refresh. Start with 3–5 realistic sample items.'
    : '- Design like a modern professional site: sticky translucent AppBar with section links; full-height Hero with a gradient background, big title, one-line pitch and two Buttons; sections with generous padding (py: 10) and small coloured overlines; cards in a responsive Grid with hover lift; contact section; small footer.'}
- Theme: dark mode, a vivid primary colour, rounded corners (12+). Fully responsive (xs/sm/md). Use MUI icons where they help.
- Relative imports without extensions. No TODOs, no "..." placeholders, no lorem ipsum. Do not wrap files in \`\`\` fences.
After the last file: at most 3 short lines (how to run).)` }];
  }
  if (!projectMode && isBuildRequest(lastText) && typeof msgs[msgs.length - 1]?.content === 'string') {
    const last = msgs[msgs.length - 1];
    // Default stack (system prompt rule 4): React + MUI. Plain HTML only when the user asks for HTML.
    const wantsHtml = /\b(html|plain css|vanilla|no react|without react|static page)\b/i.test(lastText);
    const how = wantsHtml
      ? 'ONE complete single-file HTML page (HTML + CSS + JavaScript) wrapped in <artifact identifier="page" type="text/html" title="Page name">…</artifact>'
      : 'ONE complete React component file (JSX, functional component with hooks, MUI for the UI, all imports included, one default export) wrapped in <artifact identifier="app" type="application/react" title="Component name">…</artifact>';
    msgs = [...msgs.slice(0, -1), { ...last, content: `${last.content}\n\n(Build it now: ${how}. Include everything I asked for and nothing extra; responsive; no TODOs or placeholders in the code. After the code: at most 1–3 short lines.)` }];
  }

  // A photo or an attached file is the topic itself — never search the web for "Describe this image"
  const lastMsg = messages[messages.length - 1];
  const hasImage = Array.isArray(lastMsg?.content) && lastMsg.content.some((p) => p.type === 'image_url');
  const hasFile = /\n--- File: /.test(lastText);
  // A short message inside an ongoing chat ("give code", "explain more", "example?") continues the conversation —
  // it is never a new web question unless it explicitly asks for one
  const shortTopic = lastText.trim().split(/\s+/).length <= 4 && TECH_TOPIC.test(lastText);
  const isFollowUp = messages.filter((m) => m.role === 'user').length > 1 && lastText.trim().split(/\s+/).length <= 6
    && !/\b(search|google|look ?up|latest|news|today|current|who is|who won|when is|where is|price|weather|score)\b/i.test(lastText);
  // Research mode (message box): 3–5 searches on sub-questions → merged sources → a structured report with citations
  if (research && !projectMode && !hasImage && webSearchMode !== 'off') {
    step('research', 'Planning the research');
    const qs = (await pass(`Break this question into 3-5 short web search queries that together answer it fully. One query per line. No numbering, no other text.\n\nQuestion: ${lastText}`, { max: 150, temperature: 0.3, history: false }))
      .split('\n').map((l) => l.replace(/^[\s\-*\d.)"]+/, '').replace(/"$/, '').trim()).filter((l) => l.length > 3).slice(0, 5);
    if (ctrl.signal.aborted) return res.end();
    const queries = qs.length ? qs : [lastText.slice(0, 200)];
    step('research', `Searching ${queries.length} question${queries.length > 1 ? 's' : ''}`, 'running', queries.join('\n'));
    send({ t: 'searching', v: queries.join(' · ').slice(0, 120) });
    const found = await Promise.all(queries.map((q) => webSearch(q, searchKeys()).catch(() => ({ results: [] }))));
    const seen = new Set();
    const merged = { engine: found.find((f) => f.engine)?.engine || 'web', results: [], related: [] };
    for (const f of found) {
      for (const r of f.results || []) {
        if (!r.url || seen.has(r.url)) continue;
        seen.add(r.url);
        for (const k of ['text', 'description']) if (r[k]) { const g = guardInjection(r[k]); r[k] = g.cleaned; injections += g.found; }
        merged.results.push(r);
      }
    }
    merged.results = merged.results.slice(0, 12);
    searched = true;
    send({ t: 'search', v: { engine: merged.engine, related: [], results: merged.results.map(({ kind, title, name, url, description, image, date, source }) => ({ kind, title, name, url, short: shortUrl(url), description, image, date, source })) } });
    const last = msgs[msgs.length - 1];
    msgs = [...msgs.slice(0, -1), mapText(last, (t) => `${withResults(merged, t)}\n\n(Research mode: write a structured report — ## Summary (3-4 lines), then ## Findings with a short ### section for each sub-question, citing a source as [Site](URL) after each fact, then ## Sources. Use only the results above and say clearly what could not be verified.)`)];
    step('research', `Read ${merged.results.length} sources`, 'done');
  }
  if (!searched && !hasImage && !hasFile && (webSearchMode === 'on' || (webSearchMode === 'auto' && needsSearch(lastText) && !projectMode && !isBuildRequest(lastText) && !isFollowUp && !shortTopic))) { // build / project requests and short follow-ups never auto-search
    send({ t: 'searching', v: lastText.slice(0, 120) });
    const found = await webSearch(lastText, searchKeys()).catch(() => ({ results: [] }));
    searched = true;
    for (const r of [...(found.results || []), ...(found.related || [])]) {
      for (const k of ['text', 'description']) if (r[k]) { const g = guardInjection(r[k]); r[k] = g.cleaned; injections += g.found; }
    }
    // Everything the app needs for an instant knowledge card (photo, summary, dated news, related topics)
    const card = ({ kind, title, name, url, description, image, date, source, text, facts, qid }) =>
      ({ kind, title, name, url, short: shortUrl(url), description, image, date, source, text: kind === 'wiki' ? text : undefined, facts, qid });
    send({ t: 'search', v: { engine: found.engine, results: (found.results || []).map(card), related: (found.related || []).map(card) } });
    // Always attach: the results (placed before the question), or a "nothing found → don't guess" note
    const last = msgs[msgs.length - 1];
    const withCtx = typeof last.content === 'string' ? { ...last, content: withResults(found, last.content) }
      : { ...last, content: last.content.map((p, i) => (i === 0 && p.type === 'text' ? { ...p, text: withResults(found, p.text) } : p)) };
    msgs = [...msgs.slice(0, -1), withCtx];
  }

  if (injections) send({ t: 'note', v: `🛡️ Removed ${injections} hidden instruction${injections > 1 ? 's' : ''} found in web pages or files (prompt-injection protection).` });

  // Reasoning mode (fast / balanced / expert) — added to the latest message so the system prompt stays cacheable
  if (REASONING[reasoning] && !ownLearn) msgs = [...msgs.slice(0, -1), mapText(msgs[msgs.length - 1], (t) => `${t}\n\n(${REASONING[reasoning]})`)];
  if (STYLES[style]) msgs = [...msgs.slice(0, -1), mapText(msgs[msgs.length - 1], (t) => `${t}\n\n(${STYLES[style]})`)];
  // Data analysis on an attached CSV / Excel file: compute exactly with a code tool, show charts as a Recharts artifact
  if (/\n--- File: [^\n]*\.(csv|xlsx) ---/i.test(lastText)) msgs = [...msgs.slice(0, -1), mapText(msgs[msgs.length - 1], (t) => `${t}\n\n(Data file attached: for exact numbers use the run_python or run_javascript tool if you have it; when a chart helps, show the result as a Recharts artifact with the computed data.)`)];

  // The model must know today's date, or "current" facts come from its old training data
  const today = new Date().toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  system = `${system ? `${system}\n\n` : ''}Today's date is ${today}.`;

  // Learning from mistakes: a VERIFIED project becomes a training example (request → working files); if it needed fixes,
  // also a preference pair (broken first try ✗ vs fixed final ✓). Local models only — online AIs' terms forbid training on them.
  const saveLesson = (firstAnswer, finalFiles, rounds) => {
    if (noSave || !trainDir) return;
    if (provider !== 'ollama') return; // after a switch to a free online model, provider is that model's — not saved
    try {
      const dir = trainDir;
      fs.mkdirSync(dir, { recursive: true });
      const asFiles = (fs_) => fs_.filter((f) => !/node_modules|package-lock/.test(f.path)).map((f) => `<file path="${f.path}">\n${f.content.trimEnd()}\n</file>`).join('\n');
      const chosen = `${asFiles(finalFiles)}\n\nRun it: npm install, then npm run dev.`;
      fs.appendFileSync(path.join(dir, 'lessons.jsonl'), JSON.stringify({ messages: [{ role: 'user', content: lastText }, { role: 'assistant', content: chosen }], verified: true, fixRounds: rounds, model, ...trainTag, at: new Date().toISOString() }) + '\n');
      if (rounds > 0) fs.appendFileSync(path.join(dir, 'pairs.jsonl'), JSON.stringify({ prompt: lastText, chosen, rejected: firstAnswer, model, ...trainTag, at: new Date().toISOString() }) + '\n');
    } catch (e) { console.warn('[lessons]', e.message); }
  };

  // ---------- Build agent (Project mode): check the project like a developer, fix what's broken, check again ----------
  // 1 auto-repair (imports, index.html…) → 2 real Vite build → 3 render <App /> → errors? ask the model to fix (max 3 rounds)
  const buildAgent = async (answer, files0) => { // → true when the project is verified
    send({ t: 'step', v: { id: 'write', label: `Wrote ${parseFiles(answer).length} files`, status: 'done' } });
    if (IS_VERCEL) return;
    let files = files0?.length ? files0 : parseFiles(answer);
    if (!files.length) return;
    let convo = [...body.messages, { role: 'assistant', content: answer }];
    let freshTried = false;
    for (let round = 0; round <= 3; round++) {
      if (ctrl.signal.aborted) return;
      const id = `check${round}`;
      send({ t: 'step', v: { id, label: round ? `Checking again (after fix ${round})` : 'Building with Vite & running the app', status: 'running' } });
      const repaired = repairProject(files);
      let errors;
      try { errors = await checkProject(repaired); } catch (e) { send({ t: 'step', v: { id, label: `Could not run the check: ${e.message}`, status: 'error' } }); return; }
      if (!errors.length) {
        saveLesson(answer, repaired, round);
        logQuality('project', round ? `verified after ${round} fix round${round > 1 ? 's' : ''}` : 'verified first try');
        const fixed = repaired.flatMap((f) => f.repaired || []).length;
        send({ t: 'step', v: { id, label: `Verified — builds and runs${fixed ? ` (auto-fixed ${fixed} small issue${fixed > 1 ? 's' : ''})` : ''}`, status: 'done' } });
        send({ t: 'verify', v: { status: 'ok', label: 'Project verified: Vite build ✓ · app renders ✓' } });
        return true;
      }
      send({ t: 'step', v: { id, label: `Found ${errors.length} error${errors.length > 1 ? 's' : ''}`, status: 'error', detail: errors.join('\n\n') } });
      if (round === 2 && !freshTried && ownLearn) {
        freshTried = true;
        send({ t: 'step', v: { id: 'fresh', label: 'Fresh attempt with a new plan', status: 'running' } });
        const fresh = await pass(`${lastText}\n\n(Earlier attempts kept failing with:\n${errors.slice(0, 6).join('\n')}\nMake a NEW, simpler plan and write the complete project again: every file as <file path="...">…full file…</file>. No other text.)`, { max: 8192, temperature: 0.4, ms: 600_000, history: false });
        const ff = parseFiles(fresh);
        const fe = ff.length ? await checkProject(repairProject(ff)).catch(() => null) : null;
        if (fe && fe.length < errors.length) {
          files = ff; convo = [...body.messages, { role: 'assistant', content: fresh }];
          send({ t: 'text', v: `\n\n---\n**🔄 Fresh attempt** — a new plan, fewer errors (${fe.length} vs ${errors.length}):\n\n${fresh.trim()}\n` });
          send({ t: 'step', v: { id: 'fresh', label: `Fresh attempt kept (${fe.length} vs ${errors.length} errors)`, status: 'done' } });
          logQuality('project', 'fresh attempt was better');
          continue;
        }
        send({ t: 'step', v: { id: 'fresh', label: 'Kept the first version (fewer errors)', status: 'done' } });
      }
      if (round === 3) {
        logQuality('project', 'failed after 3 fix rounds');
        send({ t: 'verify', v: { status: 'issues', text: `Still not working after 3 automatic fixes:\n\n${errors.join('\n\n')}\n\nOpen Preview → "Fix with AI" to try again.` } });
        return;
      }
      // Ask the model to fix — the reply (only changed files) is added to the same answer, so the project card merges it
      const fixId = `fix${round + 1}`;
      send({ t: 'step', v: { id: fixId, label: `Fixing (round ${round + 1} of 3)`, status: 'running' } });
      convo = [...convo, { role: 'user', content: fixRequest(errors.join('\n\n')) }];
      let reply = '';
      try {
        const r = await fetch(`${p.base}/chat/completions`, {
          method: 'POST', headers: headersFor(provider), signal: ctrl.signal,
          body: JSON.stringify({ model, stream: false, temperature: 0.2, max_tokens: 8192, messages: convo }),
        });
        reply = ((await r.json()).choices?.[0]?.message?.content || '').replace(THINK, '');
      } catch (e) { if (e.name === 'AbortError') return; }
      const changed = parseFiles(reply);
      if (!changed.length) { send({ t: 'step', v: { id: fixId, label: 'The model did not send fixed files', status: 'error' } }); continue; }
      send({ t: 'step', v: { id: fixId, label: `Fixed ${changed.map((f) => f.path.split('/').pop()).join(', ')}`, status: 'done' } });
      send({ t: 'text', v: `\n\n---\n**🔧 Auto-fix ${round + 1}** — the build check found ${errors.length} error${errors.length > 1 ? 's' : ''}:\n\n${reply.trim()}\n` });
      convo = [...convo, { role: 'assistant', content: reply }];
      files = mergeFiles(files, changed);
    }
  };

  // Hallucination detector: the answer quotes "search results" although no search was done → it made them up
  const flagFakeSources = (answer) => {
    if (!searched && /<\/?search_results>|LIVE WEB SEARCH RESULTS/i.test(answer)) {
      send({ t: 'note', v: '⚠️ Hallucination warning: this answer pretends to quote web search results, but no search was done. It is probably made up — turn on web search or verify it yourself.' });
    }
  };

  // Expert mode, pass 2: the model reviews its own answer and reports errors
  const selfCheck = async (answer) => {
    if (reasoning !== 'expert' || !answer.trim() || ctrl.signal.aborted) return;
    send({ t: 'verify', v: { status: 'checking' } });
    try {
      const r = await fetch(`${p.base}/chat/completions`, {
        method: 'POST', headers: headersFor(provider), signal: ctrl.signal,
        body: JSON.stringify({ model, stream: false, temperature: 0, max_tokens: 600, messages: verifyMessages(lastText, answer) }),
      });
      const out = ((await r.json()).choices?.[0]?.message?.content || '').replace(THINK, '').trim();
      if (!out) return send({ t: 'verify', v: { status: 'skipped' } });
      send({ t: 'verify', v: /^\W*verified\W*$/i.test(out) || /^\W*verified\b/i.test(out) && out.length < 40
        ? { status: 'ok' } : { status: 'issues', text: out.replace(/^\W*correction:\s*/i, '') } });
    } catch { if (!ctrl.signal.aborted) send({ t: 'verify', v: { status: 'skipped' } }); }
  };

  // Think only when needed — decided in code, no model call. Hybrid qwen3 reads " /think" or " /no_think" at the end of the message.
  //   simple (greeting, small talk, short concept question) → no thinking, 600 tokens · medium (bug, error, fix, review, one component,
  //   explain code) → brief thinking, 2000 tokens · project → thinking, 8192 tokens · Extended thinking (message box) → always think
  const MEDIUM = /```|\b(package|packages|library|libraries|npm|pip|module|plugin|bug|error|errors|fix|fixed|debug|review|refactor|optimi[sz]e|not working|doesn'?t work|exception|crash|undefined|warning|component|explain (this|the|my) code|write (a|an|the|me)|function (that|to|which))\b/i;
  const level = projectMode ? 'project' : !hasImage && (isBuildRequest(lastText) || MEDIUM.test(lastText) || shortTopic) ? 'medium' : 'simple';
  let thinkMax = 0;
  if (ownLearn) {
    // Device-adaptive thinking: GPU / high-end machines think briefly on medium tasks too (~0.5s on GPU for extra accuracy);
    // CPU / low-mid laptops skip forced /think on normal chat & single-file code so streaming begins immediately.
    const remoteOllama = !/localhost|127\.0\.0\.1/i.test(p.base);
    const fastDevice = DEVICE.fastGpu || remoteOllama;
    const think = !!extendedThinking || reasoning === 'expert' || level === 'project' || (fastDevice && level === 'medium');
    const brief = level === 'project' || !think ? ''
      : level === 'medium' && !extendedThinking && reasoning !== 'expert' ? '\n\n(Think briefly: at most 8 short lines.)'
        : '\n\n(Think step by step, but keep your thinking under 15 short lines; do not repeat yourself — then answer.)';
    let ref = '';
    const ragBudget = IS_VERCEL ? 2500 : DEVICE.ragBudget;
    // The React / MUI / Vite / Recharts docs only for questions that are actually about them (else they hijack the answer)
    const aboutStack = /\b(react|mui|material[- ]ui|vite|recharts|jsx|tsx|hooks?|use[A-Z]\w+|component|props|state|theme|sx|redux|context)\b/i.test(lastText);
    if (level === 'medium' && aboutStack && !IS_VERCEL) {
      const hits = await kb.search('docs', lastText, { k: fastDevice ? 4 : 3, budget: ragBudget }).catch(() => []);
      if (hits.length) ref = `\n\n(Reference docs — use them ONLY if they are about what I asked, otherwise ignore them completely:\n${hits.map((h) => `[${h.name}]\n${h.text}`).join('\n\n')})`;
    }
    // Your own projects (npm run add-my-code) → Learn reuses your patterns and style
    if ((level === 'medium' || level === 'project') && (aboutStack || level === 'project') && !IS_VERCEL) {
      const mine = await kb.search('mycode', lastText, { k: 2, budget: ragBudget }).catch(() => []);
      if (mine.length) ref += `\n\n(My earlier working code — reuse its style ONLY if it is about what I asked, otherwise ignore it:\n${mine.map((h) => `[${h.name}]\n${h.text}`).join('\n\n')})`;
    }
    // A bare topic ("php", "redux") → ask explicitly for a tutor-style overview (small models follow a direct ask far better than a rule)
    const overview = shortTopic ? '\n\n(Give a short overview of this topic like a good tutor: what it is in 1–2 sentences, its key features or main options as bullets, one small complete code example in a code block, and when to use it. Do not ask me questions back.)' : '';
    // /think and /no_think are Qwen3 switches — auto-detected from Ollama's model template across all hardware tiers
    const { hybrid } = await modelMeta(model);
    msgs = [...msgs.slice(0, -1), mapText(msgs[msgs.length - 1], (t) => (hybrid ? `${t}${overview}${ref}${brief} ${think ? '/think' : '/no_think'}` : `${t}${overview}${ref}`))];
    thinkMax = level === 'project' ? 8192 : think ? (fastDevice ? 4096 : 2500) : (fastDevice ? 3000 : 1800);
  }
  // Verified Learn answers become training data (your own model's work; <think> and hidden docs/analysis are never saved)
  const saveTextLesson = (answer) => {
    if (noSave || !trainDir) return;
    try {
      const dir = trainDir;
      fs.mkdirSync(dir, { recursive: true });
      fs.appendFileSync(path.join(dir, 'lessons.jsonl'), JSON.stringify({ messages: [{ role: 'user', content: lastText }, { role: 'assistant', content: noThink(answer) }], verified: true, check: 'code-check', model, ...trainTag, at: new Date().toISOString() }) + '\n');
    } catch (e) { console.warn('[lessons]', e.message); }
  };
  // After the answer (Learn): instant code checks → pass = "Checked ✓". Fail → a quick fix, then up to 2 fresh
  // candidates (temperature 0.7); the first that passes is kept and shown as "🔧 Quick fix"
  // Note: saveTextLesson / savePair only save when ownLearn is true (never saves cloud fallback outputs into training data).
  const afterAnswer = async (answer) => {
    if ((!ownLearn && !cloudLearn) || IS_VERCEL) return selfCheck(answer);
    if (!answer.trim() || ctrl.signal.aborted || !codeBlocks(answer).length) return;
    const errors = await checkCode(answer).catch(() => []);
    if (!errors.length) {
      send({ t: 'verify', v: { status: 'ok', label: 'Checked ✓' } });
      if (ownLearn) saveTextLesson(answer);
      logQuality('code', 'passed first try');
      return;
    }
    step('check', `Code check found ${errors.length} problem${errors.length > 1 ? 's' : ''}`, 'error', errors.join('\n'));
    const problems = errors.map((e) => `- ${e}`).join('\n');
    const tries = [
      { label: 'Quick fix', temperature: 0.2, ask: `My question:\n${lastText}\n\nYour answer:\n${answer.slice(0, 12000)}\n\nAn automatic code check found these exact problems:\n${problems}\n\n(Fix them. Output ONLY the corrected, complete code block(s) with language tags. No explanation.)` },
      { label: 'Fresh attempt 2', temperature: 0.7, ask: `${lastText}\n\n(Answer again from scratch with complete, runnable code. An earlier answer had these problems — avoid them:\n${problems})` },
      { label: 'Fresh attempt 3', temperature: 0.7, ask: `${lastText}\n\n(Answer again from scratch with complete, runnable code. An earlier answer had these problems — avoid them:\n${problems})` },
    ];
    let left = errors;
    for (const [i, t] of tries.entries()) {
      if (ctrl.signal.aborted) return;
      step('fix', `${t.label}…`);
      const cand = await pass(t.ask, { max: 1500, temperature: t.temperature, ms: 120_000 });
      if (!cand || !codeBlocks(cand).length) continue;
      left = await checkCode(cand).catch(() => ['the check could not run']);
      if (left.length) continue;
      const block = `\n\n---\n**🔧 Quick fix**\n\n${cand}\n`;
      for (let k = 0; k < block.length; k += 40) send({ t: 'text', v: block.slice(k, k + 40) });
      step('fix', `${t.label} passed the code check`, 'done');
      send({ t: 'verify', v: { status: 'ok', label: i ? `Checked ✓ (attempt ${i + 2})` : 'Checked ✓ (after quick fix)' } });
      if (ownLearn) savePair(answer, i ? cand : `${answer}${block}`); // broken first try ✗ vs passing version ✓ → DPO pair (local Learn only)
      logQuality('code', i ? `passed on fresh attempt ${i + 1}` : 'passed after quick fix');
      return;
    }
    step('fix', 'Still has problems after 3 tries', 'error', left.join('\n'));
    send({ t: 'verify', v: { status: 'issues', text: left.join('\n') } });
    if (!/-max(:|$)/.test(String(model))) send({ t: 'note', v: 'Try 🧠 Max quality for this one (message box → ⚡ Fast / 🧠 Max quality).' });
    logQuality('code', 'failed after 3 tries');
  };
  const savePair = (rejected, chosen) => {
    if (noSave || !trainDir) return;
    try { fs.mkdirSync(trainDir, { recursive: true }); fs.appendFileSync(path.join(trainDir, 'pairs.jsonl'), JSON.stringify({ prompt: lastText, chosen: noThink(chosen), rejected: noThink(rejected), model, ...trainTag, at: new Date().toISOString() }) + '\n'); } catch {}
  };
  // Project: feature check (every feature I asked for is in the files) → build agent (Vite build + render + up to 3 fixes)
  const finishProject = async (answer) => {
    let files = parseFiles(answer);
    if (ownLearn && files.length && !ctrl.signal.aborted) {
      step('features', 'Checking every requested feature is there');
      const code = files.filter((f) => /\.(jsx?|tsx?)$/.test(f.path)).map((f) => `<file path="${f.path}">\n${f.content}\n</file>`).join('\n').slice(0, 14000);
      const missing = await pass(`My request:\n${lastText}\n\nThe project files:\n${code}\n\n(List every feature I explicitly asked for that is MISSING from these files, one per line starting with "- ". If nothing is missing, reply exactly: ALL PRESENT)`, { max: 300, temperature: 0, history: false });
      const list = /ALL PRESENT/i.test(missing) ? '' : (missing.match(/^\s*[-*]\s+.+$/gm) || []).join('\n');
      if (!missing) step('features', 'Feature check skipped', 'done');
      else if (!list) step('features', 'All requested features are there', 'done');
      else {
        step('features', 'Adding missing features', 'running', list);
        const add = await pass(`My request:\n${lastText}\n\nThe project files:\n${code}\n\n(These requested features are missing:\n${list}\nAdd them now. Output ONLY the changed or new files, each complete, in exactly this format: <file path="src/...">…full file…</file>. No other text.)`, { max: 3072, ms: 240_000, history: false });
        const changed = parseFiles(add);
        if (changed.length) {
          files = mergeFiles(files, changed);
          send({ t: 'text', v: `\n\n---\n**➕ Added missing features**\n${list}\n\n${add.trim()}\n` });
        }
        step('features', changed.length ? `Added missing features (${changed.map((f) => f.path.split('/').pop()).join(', ')})` : 'Could not add the missing features', changed.length ? 'done' : 'error', list);
      }
    }
    await buildAgent(answer, files);
  };

  // ---------- Tool calling (agent loop): calculator, date/time, code runner, web search, memory ----------
  // Only when the message looks like it needs a tool — normal chat stays fast and streams word by word.
  const lastMsgForTools = messages[messages.length - 1];
  // Docs & mycode are already injected into `ref` above and `checkCode` runs automatically after streaming — only block on non-streaming tool loop when explicitly enabled or needed
  const codingTools = ownLearn && level === 'medium' && !IS_VERCEL && toolsMode === 'on';
  const imageIn = Array.isArray(lastMsgForTools?.content) && lastMsgForTools.content.some((x) => x.type === 'image_url');
  if (toolsMode !== 'off' && (toolsMode === 'on' || needsTools(lastText) || codingTools) && !imageIn && await supportsTools(provider, model)) {
    const codeOk = !!allowCode && !IS_VERCEL;
    const defs = [TOOL_DEFS.calculator, TOOL_DEFS.get_datetime, TOOL_DEFS.date_diff, TOOL_DEFS.save_memory,
      ...(codeOk ? [TOOL_DEFS.run_javascript, ...(HAS_PYTHON ? [TOOL_DEFS.run_python] : [])] : []), ...(!searched && webSearchMode !== 'off' ? [TOOL_DEFS.web_search] : []),
      ...(codingTools ? [TOOL_DEFS.docs_search, TOOL_DEFS.mycode_search, TOOL_DEFS.run_check] : [])];
    const convo = [{ role: 'system', content: `${system}\n\nYou can call tools. Use the calculator for ALL arithmetic and date_diff for counting days — never calculate in your head. Call a tool only when it helps, then answer the user normally using the results.${codingTools ? ' For React / MUI / Vite / Recharts code: look up exact APIs with docs_search, reuse the user\'s earlier code via mycode_search, and run run_check on your code before you answer.' : ''}` }, ...msgs];
    const ctx = { allowCode: codeOk, search: (q) => webSearch(q, searchKeys()), onMemory: (fact) => send({ t: 'memory', v: fact }),
      kbSearch: (id, q) => kb.search(id, q, { k: 3, budget: 2500 }).catch(() => []), check: (code) => checkCode(code).catch(() => []) };
    const used = [];
    let final = null;
    const t0 = Date.now();
    try {
      for (let n = 0; n < (codingTools ? 4 : 10) && Date.now() - t0 < (codingTools ? 60_000 : 120_000); n++) {
        const r = await fetch(`${p.base}/chat/completions`, {
          method: 'POST', headers: headersFor(provider), signal: ctrl.signal,
          body: JSON.stringify({ model, messages: convo, tools: defs, stream: false,
            ...(temperature != null && { temperature: Number(temperature) }), ...(maxTokens && { max_tokens: Number(maxTokens) }) }),
        });
        if (!r.ok) break; // this model/provider refused tools → normal answer below
        const msg = (await r.json()).choices?.[0]?.message || {};
        const thought = msg.reasoning_content || msg.reasoning; // qwen3 thinks before choosing a tool → Thinking panel
        if (thought) send({ t: 'reasoning', v: `${thought.trim()}\n\n` });
        const calls = msg.tool_calls?.length ? msg.tool_calls : parseTextToolCalls(msg.content, defs.map((d) => d.function.name));
        if (!calls.length) { final = noThink(msg.content); break; }
        convo.push({ role: 'assistant', content: noThink(msg.content), tool_calls: calls });
        for (const c of calls) {
          let args = {};
          try { args = typeof c.function?.arguments === 'string' ? JSON.parse(c.function.arguments || '{}') : (c.function?.arguments || {}); } catch {}
          const id = c.id || `t${used.length}`;
          send({ t: 'tool', v: { id, name: c.function?.name, args, status: 'running' } });
          const result = await runTool(c.function?.name, args, ctx);
          send({ t: 'tool', v: { id, name: c.function?.name, args, status: 'done', result } });
          used.push(`${c.function?.name}(${JSON.stringify(args)}) → ${JSON.stringify(result)}`);
          convo.push({ role: 'tool', tool_call_id: id, name: c.function?.name, content: JSON.stringify(result).slice(0, 8000) });
        }
      }
    } catch (e) { if (e.name === 'AbortError') return res.end(); }
    if (final != null && final.trim()) {
      send({ t: 'speed', v: { ttft: +((Date.now() - tStart) / 1000).toFixed(1), tps: null } });
      for (let k = 0; k < final.length; k += 40) send({ t: 'text', v: final.slice(k, k + 40) });
      usage.record({ provider, providerName: p.name, model, label: OWN[String(model).replace(/:latest$/, '')]?.label || model,
        free: !!(p.allFree || p.builtin), inTok: Math.ceil(JSON.stringify(convo).length / 4), outTok: Math.ceil(final.length / 4), estimated: true });
      flagFakeSources(final);
      await afterAnswer(final);
      return res.end();
    }
    // Tools ran but no final answer yet → give the results to the normal (streaming) answer below
    if (used.length) msgs = [...msgs.slice(0, -1), mapText(msgs[msgs.length - 1], (t) => `${t}\n\n(Tool results — use them, do not recalculate:\n${used.join('\n')})`)];
  }

  const body = {
    model,
    stream: true,
    messages: system ? [{ role: 'system', content: system }, ...msgs] : msgs,
  };
  if (temperature != null) body.temperature = Number(temperature);
  if (maxTokens) body.max_tokens = Number(maxTokens);
  // A whole project, or a "Fix with AI" reply with several full files, needs room
  if (projectMode || /live preview of the project shows these errors/i.test(lastText)) body.max_tokens = Math.max(Number(maxTokens) || 0, 8192);
  if (thinkMax && !maxTokens) body.max_tokens = Math.max(body.max_tokens || 0, thinkMax); // think-level budget (Learn)
  if (provider === 'anthropic' && !body.max_tokens) body.max_tokens = 8192;
  // Ask for exact token counts where the provider supports it (others are estimated)
  if (['openai', 'deepseek', 'ollama'].includes(provider)) body.stream_options = { include_usage: true };

  // Billing: is this request free, and is a paid one still within the monthly budget?
  const live = usage.livePrices.get(`${provider}:${model}`);
  const free = !!(p.allFree || p.builtin || String(model).endsWith(':free') || (live && !live.in && !live.out));
  const over = usage.budgetCheck(free);
  if (over) { send({ t: 'error', v: over }); return res.end(); }

  let outText = '', allText = '', usageInfo = null, firstTok = 0;
  // Content may carry <think>…</think> inline (older Ollama / other hosts): route it to the Thinking panel, keep the answer clean
  let inThink = false, pend = '';
  const splitThink = (chunk) => {
    firstTok ||= Date.now(); allText += chunk; pend += chunk;
    for (;;) {
      const tag = inThink ? /<\/think(?:ing)?>/i : /<think(?:ing)?>/i;
      const m = pend.match(tag);
      if (!m) {
        const keep = pend.lastIndexOf('<') > pend.length - 12 ? pend.slice(pend.lastIndexOf('<')) : ''; // a tag may be split across chunks
        const out = pend.slice(0, pend.length - keep.length); pend = keep;
        if (out) { if (inThink) send({ t: 'reasoning', v: out }); else { outText += out; send({ t: 'text', v: out }); } }
        return;
      }
      const before = pend.slice(0, m.index);
      if (before) { if (inThink) send({ t: 'reasoning', v: before }); else { outText += before; send({ t: 'text', v: before }); } }
      pend = pend.slice(m.index + m[0].length); inThink = !inThink;
    }
  };

  const logUsage = () => {
    const inEst = Math.ceil(JSON.stringify(body.messages).length / 4);
    const row = usage.record({
      provider, providerName: p.name, model, label: OWN[String(model).replace(/:latest$/, '')]?.label || model, free,
      inTok: usageInfo?.prompt_tokens ?? inEst, outTok: usageInfo?.completion_tokens ?? Math.ceil(outText.length / 4),
      estimated: !usageInfo,
    });
    if (!res.writableEnded) send({ t: 'cost', v: { cost: row.cost, free, estimated: row.estimated } });
  };

  try {
    const r = await fetch(`${p.base}/chat/completions`, {
      method: 'POST', headers: headersFor(provider), body: JSON.stringify(body), signal: ctrl.signal,
    });
    if (!r.ok) {
      const txt = await r.text();
      let msg = txt;
      try { const j = JSON.parse(txt); msg = j.error?.message || j.message || txt; } catch {}
      const oom = /out of memory|CUDA error|failed to allocate/i.test(msg);
      send({ t: 'error', v: oom
        ? `This model needs more memory than your PC has free right now. Close other apps or pick a smaller model (Learn Lite / Learn Code) — or connect a free online key (Models → Connect providers). (${msg.slice(0, 120)})`
        : `${r.status} — ${msg}` });
      return res.end();
    }

    const reader = r.body.getReader();
    const dec = new TextDecoder();
    let buf = '';
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      const lines = buf.split('\n');
      buf = lines.pop();
      for (const line of lines) {
        const s = line.trim();
        if (!s.startsWith('data:')) continue;
        const data = s.slice(5).trim();
        if (data === '[DONE]') continue;
        try {
          const j = JSON.parse(data);
          if (j.error) { send({ t: 'error', v: j.error.message || 'Stream error' }); continue; }
          const d = j.choices?.[0]?.delta || {};
          const reasoning = d.reasoning_content || d.reasoning;
          if (reasoning) { firstTok ||= Date.now(); send({ t: 'reasoning', v: reasoning }); }
          if (d.content) splitThink(d.content);
          if (reasoning) allText += reasoning;
          if (j.usage) { usageInfo = j.usage; send({ t: 'usage', v: j.usage }); }
        } catch {}
      }
    }
  } catch (e) {
    if (e.name !== 'AbortError') send({ t: 'error', v: e.message });
  }
  if (pend && !inThink) { outText += pend; send({ t: 'text', v: pend }); }
  outText = noThink(outText);
  // Speed meter: time to first token + tokens per second (shown in grey under the answer)
  if (firstTok) send({ t: 'speed', v: { ttft: +((firstTok - tStart) / 1000).toFixed(1), tps: usageInfo?.completion_tokens ? Math.round(usageInfo.completion_tokens / Math.max(0.1, (Date.now() - firstTok) / 1000)) : null } });
  if (outText || allText) logUsage(); // also logs stopped/partial answers — you still pay for those tokens
  flagFakeSources(outText);
  if (projectMode && outText && !ctrl.signal.aborted) await finishProject(outText);
  else await afterAnswer(outText);
  res.end();
});

// ---------- Smart chat titles (like Claude/ChatGPT: "Greeting", "Pongal festival dates") ----------
app.post('/api/title', async (req, res) => {
  const { provider, model, text = '', reply = '' } = req.body || {};
  // Use the fastest model available: Learn Lite locally, otherwise the chat's own model
  // Only cloud models write titles (fast + reliable). Small local models on a CPU are slow and often wrong,
  // so for them the app keeps its instant rule-based title.
  if (['ollama', 'pollinations'].includes(provider) || PROVIDERS[provider]?.custom) return res.json({ title: '' });
  const use = { provider, model };
  const p = PROVIDERS[use.provider];
  if (!p?.key) return res.json({ title: '' });
  try {
    const r = await fetch(`${p.base}/chat/completions`, {
      method: 'POST', headers: headersFor(use.provider), signal: AbortSignal.timeout(20000),
      body: JSON.stringify({
        model: use.model, stream: false, max_tokens: 16, temperature: 0.2,
        messages: [
          { role: 'system', content: 'You name chats. Reply with ONLY a 1-4 word topic title in Title Case: a noun phrase describing the topic, not a sentence. Same language as the user. No quotes.' },
          { role: 'user', content: 'how are you' }, { role: 'assistant', content: 'Greeting' },
          { role: 'user', content: 'pongal festival date this year' }, { role: 'assistant', content: 'Pongal Festival Date' },
          { role: 'user', content: 'write a python function to reverse a string' }, { role: 'assistant', content: 'Python String Reversal' },
          { role: 'user', content: String(text).slice(0, 400) },
        ],
      }),
    });
    const j = await r.json();
    let title = (j.choices?.[0]?.message?.content || '').replace(THINK, '').split('\n').map((l) => l.trim()).find(Boolean) || '';
    title = title.replace(/^(title\s*:\s*)/i, '').replace(/^["'*#\s]+|["'*.\s]+$/g, '').slice(0, 60);
    res.json({ title: title.split(/\s+/).length <= 8 ? title : '' });
  } catch { res.json({ title: '' }); }
});

// ---------- Usage & billing ----------
// ---------- Lessons from the build agent → training file for the Learn Code+ Kaggle notebook ----------
app.get('/api/training/export', (req, res) => {
  const kind = req.query.kind === 'pairs' ? 'pairs' : 'lessons';
  const file = path.join(__dirname, 'data', 'training', `${kind}.jsonl`);
  const day = new Date().toISOString().slice(0, 10);
  if (!fs.existsSync(file) || !fs.statSync(file).size) {
    return res.type('text/plain').send('No lessons yet. Ask a local Learn model for a full project (for example "build a todo app with react vite"); every project the build agent verifies is saved here.');
  }
  res.setHeader('Content-Disposition', `attachment; filename="evolvix-training-${kind}-${day}.jsonl"`);
  res.type('application/jsonl').send(fs.readFileSync(file));
});

// ---------- Feedback = training data (👍 good · 👎 bad · ✏️ corrected) — ONLY for answers from your local Learn models ----------
const TRAIN_DIR = path.join(__dirname, 'data', 'training');
const appendTrain = (name, row) => { fs.mkdirSync(TRAIN_DIR, { recursive: true }); fs.appendFileSync(path.join(TRAIN_DIR, name), JSON.stringify(row) + '\n'); };
const HIDDEN_RE = /\n*\((Reference docs|My earlier working code|Your analysis|Earlier in this chat|Tool results|Think briefly|Think step by step|Give a short overview|I mean|Reply mode|Style|Data file attached|Research mode)[\s\S]*?\)\s*(?=\n\n|$)/g;
const cleanForTraining = (t) => noThink(t).replace(/\s*\/(no_)?think\s*$/, '').replace(HIDDEN_RE, '').trim();
app.post('/api/feedback', (req, res) => {
  const { chatId, messageId, model = '', provider = '', prompt = [], answer = '', rating, corrected = '', note = '' } = req.body || {};
  // Online AIs' terms forbid training on their outputs → never saved
  if (provider !== 'ollama') return res.json({ ok: false, note: 'Only answers from your local Learn models are saved as training data (online AIs forbid it).' });
  if (!['good', 'bad', 'corrected'].includes(rating) || !String(answer).trim()) return res.status(400).json({ ok: false, note: 'rating and answer are required' });
  if (IS_VERCEL) return res.json({ ok: false, note: 'Training data is saved only when the app runs on your PC.' });
  const ctx = (Array.isArray(prompt) ? prompt : [{ role: 'user', content: String(prompt) }]).slice(-5)
    .filter((m) => ['user', 'assistant'].includes(m.role) && m.content).map((m) => ({ role: m.role, content: cleanForTraining(m.content) }));
  if (!ctx.length || ctx[ctx.length - 1].role !== 'user') return res.status(400).json({ ok: false, note: 'the user message is missing' });
  const orig = cleanForTraining(answer);
  const base = { chatId, messageId, model, at: new Date().toISOString(), ...(OFFICE ? { userId: req.user.id, office: true } : {}) };
  if (OFFICE && !(officeSystem().allowTraining && req.user.consentTraining)) return res.json({ ok: false, note: 'Training data is off in office mode (the owner must allow it and you must agree in Settings → Training).' });
  const appendTrain = (name, row) => { const d = OFFICE ? path.join(TRAIN_DIR, 'office') : TRAIN_DIR; fs.mkdirSync(d, { recursive: true }); fs.appendFileSync(path.join(d, name), JSON.stringify(row) + '\n'); };
  try {
    if (rating === 'good') appendTrain('lessons.jsonl', { messages: [...ctx, { role: 'assistant', content: orig }], verified: true, source: 'feedback-good', ...base });
    else if (rating === 'corrected') {
      const fixed = cleanForTraining(corrected);
      if (!fixed || fixed === orig) return res.status(400).json({ ok: false, note: 'the corrected answer is empty or unchanged' });
      appendTrain('lessons.jsonl', { messages: [...ctx, { role: 'assistant', content: fixed }], verified: true, source: 'feedback-corrected', weight: 2, ...base });
      appendTrain('pairs.jsonl', { prompt: ctx[ctx.length - 1].content, context: ctx.slice(0, -1), chosen: fixed, rejected: orig, source: 'feedback-corrected', weight: 2, ...base });
    } else appendTrain('bad.jsonl', { prompt: ctx[ctx.length - 1].content, context: ctx.slice(0, -1), answer: orig, note: String(note).slice(0, 1000), ...base });
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ ok: false, note: e.message }); }
});
// Counts for Settings → Training, and downloads of each file
const TRAIN_FILES = ['lessons', 'pairs', 'bad', 'mycode', 'opencode', 'fixes', 'commitpack', 'mui', 'recharts', 'train', 'quality'];
const jsonlRows = (name) => { try { return fs.readFileSync(path.join(TRAIN_DIR, `${name}.jsonl`), 'utf8').split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean); } catch { return []; } };
app.get('/api/training/stats', (req, res) => {
  const lessons = jsonlRows('lessons');
  const by = (src) => lessons.filter((l) => l.source === src).length;
  const quality = {};
  for (const q of jsonlRows('quality')) quality[`${q.kind}: ${q.path}`] = (quality[`${q.kind}: ${q.path}`] || 0) + 1;
  res.json({
    good: by('feedback-good'), corrected: by('feedback-corrected'), bad: jsonlRows('bad').length, pairs: jsonlRows('pairs').length,
    lessons: lessons.length, files: Object.fromEntries(TRAIN_FILES.map((n) => [n, n === 'lessons' ? lessons.length : jsonlRows(n).length])), quality,
  });
});
app.get('/api/training/file/:name', (req, res) => {
  const name = String(req.params.name);
  if (!TRAIN_FILES.includes(name)) return res.status(404).end();
  const file = path.join(TRAIN_DIR, `${name}.jsonl`);
  if (!fs.existsSync(file)) return res.type('text/plain').send(`No ${name}.jsonl yet.`);
  res.setHeader('Content-Disposition', `attachment; filename="evolvix-${name}-${new Date().toISOString().slice(0, 10)}.jsonl"`);
  res.type('application/jsonl').send(fs.readFileSync(file));
});
// Which path answers take (first try passed / quick fix / extra candidate / failed …) → Settings → Training
const logQuality = (kind, pathName, extra = {}) => { if (IS_VERCEL) return; try { appendTrain('quality.jsonl', { at: new Date().toISOString(), kind, path: pathName, ...extra }); } catch {} };

app.get('/api/usage', (req, res) => res.json(usage.summary(Math.min(90, Math.max(1, Number(req.query.days) || 30)))));
app.delete('/api/usage', (req, res) => { usage.clear(); res.json({ ok: true }); });
app.post('/api/billing', (req, res) => res.json(usage.saveBilling(req.body || {})));

// Credit balances straight from providers that offer a balance API; others link to their billing page.
const BILLING_PAGES = {
  openai: 'https://platform.openai.com/settings/organization/billing/overview',
  anthropic: 'https://console.anthropic.com/settings/billing',
  openrouter: 'https://openrouter.ai/settings/credits',
  deepseek: 'https://platform.deepseek.com/usage',
  gemini: 'https://aistudio.google.com/',
  groq: 'https://console.groq.com/',
  cerebras: 'https://cloud.cerebras.ai',
  mistral: 'https://console.mistral.ai/',
};
app.get('/api/balances', async (req, res) => {
  const out = [];
  await Promise.all(Object.entries(PROVIDERS).filter(([, p]) => p.key && !p.builtin && !p.custom).map(async ([id, p]) => {
    const row = { id, name: p.name, paid: !p.allFree, page: BILLING_PAGES[id] || p.url, balance: null, note: p.allFree ? 'Free tier — daily limits, no charge' : null };
    try {
      if (id === 'openrouter') {
        const j = await (await fetch('https://openrouter.ai/api/v1/key', { headers: headersFor(id), signal: AbortSignal.timeout(6000) })).json();
        const d = j.data || {};
        row.balance = d.limit != null ? `$${(d.limit - (d.usage || 0)).toFixed(2)} left of $${Number(d.limit).toFixed(2)}` : `$${Number(d.usage || 0).toFixed(4)} used`;
        if (d.is_free_tier) row.note = 'Free tier — :free models only, daily request limit';
      } else if (id === 'deepseek') {
        const j = await (await fetch('https://api.deepseek.com/user/balance', { headers: headersFor(id), signal: AbortSignal.timeout(6000) })).json();
        row.balance = (j.balance_infos || []).map((b) => `${b.total_balance} ${b.currency}`).join(' · ') || null;
      }
    } catch { row.note = row.note || 'Could not read balance'; }
    if (!row.balance && !row.note) row.note = 'Balance not available by API — open the billing page';
    out.push(row);
  }));
  res.json(out);
});

// Live preview runs in its own sandboxed page (opaque origin → no access to the app's cookies or API), with its own CSP.
// The app posts the document into it. Vendor scripts (React, MUI, Babel, Recharts, Mermaid…) come from public/vendor (npm run vendor).
app.use('/vendor', (req, res, next) => { res.setHeader('Access-Control-Allow-Origin', '*'); res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin'); next(); });
app.get('/preview-frame', (req, res) => {
  const self = `${req.protocol}://${req.get('host')}`;
  res.removeHeader('X-Frame-Options');
  res.setHeader('Content-Security-Policy', `default-src 'none'; script-src 'unsafe-inline' 'unsafe-eval' ${self}/vendor/; style-src 'unsafe-inline' ${self}/vendor/; img-src data: blob:${OFFICE ? '' : ' https:'}; font-src data: ${self}/vendor/; connect-src 'none'; frame-ancestors 'self'; form-action 'none'`);
  res.type('html').send('<!doctype html><html><head><meta charset="utf-8"></head><body><script>addEventListener("message",function(e){if(e.source!==parent||!e.data||e.data.type!=="evx-doc")return;document.open();document.write(e.data.html);document.close();});parent.postMessage({evxFrameReady:true},"*");</script></body></html>');
});

if (!IS_VERCEL) { // on Vercel the built site is served by Vercel's CDN
  app.use(express.static(path.join(__dirname, 'dist')));
  app.get('*', (_, res) => res.sendFile(path.join(__dirname, 'dist', 'index.html')));
}

export default app; // used by api/index.js on Vercel

const PORT = process.env.PORT || 3001;
if (!IS_VERCEL) {
  ensureLocalOllama();
  const started = await officeStart();
  globalThis.__evxFirewallOpen = !!started.firewallOpen;
  const server = HTTPS_ON ? https.createServer({ cert: fs.readFileSync(CFG.httpsCert), key: fs.readFileSync(CFG.httpsKey) }, app) : app;
  const onUp = () => {
    const proto = HTTPS_ON ? 'https' : 'http';
    console.log(`\n  Evolvix API → ${proto}://localhost:${PORT}${OFFICE ? '   🔒 Office mode · local only' : ''}`);
    if (CFG.host === '0.0.0.0') for (const nets of Object.values(os.networkInterfaces())) for (const n of nets || []) if (n.family === 'IPv4' && !n.internal) console.log(`  LAN → ${proto}://${n.address}:${PORT}`);
    if (OFFICE && CFG.host === '0.0.0.0' && !HTTPS_ON) console.warn('\n  \x1b[33m⚠⚠  HOST=0.0.0.0 WITHOUT HTTPS: passwords and chats cross the office network unencrypted. Set HTTPS_CERT / HTTPS_KEY (see OFFICE-SETUP.md).\x1b[0m');
    if (OFFICE && CFG.host === '0.0.0.0' && !CFG.allowedIps.length) console.warn('  ⚠ HOST=0.0.0.0 but OFFICE_ALLOWED_IPS is empty → only this PC is allowed in. Set e.g. OFFICE_ALLOWED_IPS=192.168.1.0/24');
    console.log(`  Device tier: ${DEVICE.tier} — ${DEVICE.label}`);
    console.log('  Providers:', Object.keys(PROVIDERS).filter((k) => PROVIDERS[k].key).join(', '), '\n');
  };
  const listening = OFFICE ? server.listen(PORT, CFG.host, onUp) : server.listen(PORT, onUp);
  // Port already taken (another Evolvix server is running) → a clear message instead of a crash
  listening.on('error', (e) => {
    if (e.code !== 'EADDRINUSE') throw e;
    console.error(`\n  ✘ Port ${PORT} is already in use — another Evolvix server is probably running.\n    Close it, or start this one on another port:  set PORT=3002  (and point Vite's proxy at it).\n    Find what uses it (PowerShell):  Get-NetTCPConnection -LocalPort ${PORT} | Select OwningProcess\n`);
    process.exit(1);
  });
}
