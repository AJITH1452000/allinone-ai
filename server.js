import 'dotenv/config';
import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';
import crypto from 'crypto';
import { IS_VERCEL, KEYS_FILE } from './paths.js';
import * as kb from './kb.js';
import * as usage from './usage.js';
import { webSearch, needsSearch, withResults, resolveShort, shortUrl, isBuildRequest, isProjectRequest } from './search.js';
import { guardInjection, needsTools, runTool, parseTextToolCalls, TOOL_DEFS, REASONING, verifyMessages } from './engines.js';
import { checkProject } from './buildcheck.js';
import { parseFiles, mergeFiles, repairProject, fixRequest } from './src/lib/project.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Every provider below speaks the OpenAI-compatible chat API, so one code path serves all.
// env = the .env variable; keys pasted in the app UI are saved to keys.json and take priority.
const PROVIDERS = {
  // Keyless free provider — works with zero setup. Set POLLINATIONS=off in .env to hide it.
  pollinations: { name: 'Pollinations', tag: 'Free · no key', base: 'https://text.pollinations.ai/openai',
                  modelsUrl: 'https://text.pollinations.ai/models', builtin: true, allFree: true },
  ollama:     { name: 'Ollama (local)', tag: 'Free · unlimited', base: process.env.OLLAMA_URL || 'http://localhost:11434/v1', builtin: true, allFree: true, url: 'https://ollama.com/download' },
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
function loadFamily() {
  try { FAMILY = JSON.parse(fs.readFileSync(path.join(__dirname, 'models', 'family.json'), 'utf8')); } catch {}
  const f = FAMILY.id;
  OWN = {
    [`${f}-max`]: { label: `${FAMILY.name} Max`, desc: 'Most capable · 14B · slower · reasoning & maths', rank: 0, vision: false, fast: false },
    [`${f}-pro`]: { label: `${FAMILY.name} Pro`, desc: 'Balanced · 7B · everyday', rank: 1, vision: false, fast: false },
    [`${f}-lite`]: { label: `${FAMILY.name} Lite`, desc: 'Fastest · 4B · quick answers · sees images', rank: 2, vision: true, fast: true },
    [`${f}-code`]: { label: `${FAMILY.name} Code`, desc: 'Coding specialist · 7B · builds apps & websites', rank: 3, vision: false, fast: false },
    [`${f}-codeplus`]: { label: `${FAMILY.name} Code+`, desc: 'Your fine-tuned coder · trained on Kaggle', rank: 4, vision: false, fast: false },
  };
}
loadFamily();
const SKIP =/embed|whisper|tts|dall-e|image|moderation|audio|transcribe|realtime|guard|rerank|ocr/i;

async function listModels(id, status) {
  const p = PROVIDERS[id];
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), id === 'ollama' ? 2500 : 8000);
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
        if (own) return { provider: id, providerName: `${FAMILY.name} · Your own models`, id: mid, label: own.label, desc: own.desc, own: true, free: true, fast: own.fast, vision: own.vision };
        const vision = /vision|vl\b|gpt-4o|gpt-4\.1|gpt-5|claude|gemini|llava|pixtral|gemma-?3:(?!1b)|llama-4/i.test(mid) || !!m.vision;
        return { provider: id, providerName: p.name, id: mid, label: m.display_name || mid, free: !!free, fast: !!p.fast, vision };
      })
      .filter((m) => m.id && !SKIP.test(m.id));
    status.push({ id, name: p.name, ok: true, count: list.length });
    return list;
  } catch (e) {
    const msg = e.name === 'AbortError' ? 'not reachable (timed out)'
      : e.cause?.code === 'ECONNREFUSED' ? 'not running' : (e.cause?.code || e.message);
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
app.use(express.json({ limit: '25mb' }));

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
  if (!PASS || cookieOf(req).aio_auth === token) return next();
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

app.get('/api/models', async (req, res) => {
  if (!req.query.refresh && cache.data && Date.now() - cache.at < 10 * 60 * 1000) return res.json(cache.data);
  loadFamily();
  const active = Object.keys(PROVIDERS).filter((id) => PROVIDERS[id].key);
  const status = [];
  const lists = await Promise.all(active.map((id) => listModels(id, status)));
  const flat = lists.flat();
  const ownRank = (m) => OWN[m.id.replace(/:latest$/, '')].rank;
  const models = [
    ...flat.filter((m) => m.own).sort((a, b) => ownRank(a) - ownRank(b)), // your own models first
    ...flat.filter((m) => !m.own).sort((a, b) =>
      a.provider === b.provider ? Number(b.free) - Number(a.free) || a.id.localeCompare(b.id) : 0),
  ];
  const missingKeys = Object.keys(PROVIDERS).filter((id) => !PROVIDERS[id].key);
  const data = { models, status, missingKeys };
  lastStatus = status;
  // Only cache non-empty results, so starting Ollama / adding a key shows up on the next reload
  cache = models.length ? { at: Date.now(), data } : { at: 0, data: null };
  res.json(data);
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
app.get('/api/kb/:id', (req, res) => res.json(kb.listDocs(req.params.id)));
app.post('/api/kb/:id', async (req, res) => {
  const { name = 'notes.txt', data, text } = req.body || {};
  try {
    const content = text ?? await kb.extractText(name, data || '');
    res.json(await kb.addDoc(req.params.id, String(name).slice(0, 120), content));
  } catch (e) { res.status(400).json({ error: e.message }); }
});
app.delete('/api/kb/:id/:doc', (req, res) => { kb.removeDoc(req.params.id, req.params.doc); res.json({ ok: true }); });
app.delete('/api/kb/:id', (req, res) => { kb.removeKb(req.params.id); res.json({ ok: true }); });

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
const BAKED = new Map(); // model → its built-in SYSTEM prompt
async function bakedSystem(model) {
  const hit = BAKED.get(model);
  if (hit && Date.now() - hit.at < 60_000) return hit.system; // re-check every minute (picks up npm run build-models)
  try {
    const j = await (await fetch(`${OLLAMA_NATIVE}/api/show`, { method: 'POST', headers: OLLAMA_H, body: JSON.stringify({ model }), signal: AbortSignal.timeout(5000) })).json();
    BAKED.set(model, { system: j.system || '', at: Date.now() });
  } catch { return hit?.system || ''; }
  return BAKED.get(model).system;
}

// Loads the model into memory and pre-processes its system prompt, so the first real message starts instantly.
const WARM = new Map(); // model → the prompt it was last warmed with
app.post('/api/warm', async (req, res) => {
  const { provider, model, system, kbId } = req.body || {};
  const t0 = Date.now();
  const done = () => { if (!res.headersSent) res.json({ ok: true, ms: Date.now() - t0 }); };
  try {
    if (kbId) kb.warm(kbId).catch(() => {});
    if (provider !== 'ollama' || !model) return done();
    // Must build exactly the same system prompt as /api/chat, so the cached prompt matches
    let sys = system || '';
    if (OWN[String(model).replace(/:latest$/, '')]) { const b = await bakedSystem(model); if (b) sys = sys ? `${b}\n\n${sys}` : b; }
    const today = new Date().toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
    sys = `${sys ? `${sys}\n\n` : ''}Today's date is ${today}.`;
    // Already in memory with this exact prompt? → ready immediately (no second warm-up for the same model)
    const key = `${model}\n${sys}`;
    if (WARM.get(model) === key) {
      const ps = await (await fetch(`${OLLAMA_NATIVE}/api/ps`, { headers: OLLAMA_H, signal: AbortSignal.timeout(3000) })).json().catch(() => ({}));
      if ((ps.models || []).some((m) => m.name === model || m.model === model)) return done();
    }
    // If Ollama is busy with another long answer, don't make the app wait forever
    await fetch(`${OLLAMA_NATIVE}/api/chat`, {
      method: 'POST', headers: OLLAMA_H, signal: AbortSignal.timeout(45_000),
      body: JSON.stringify({
        model, stream: false, keep_alive: KEEP_ALIVE, options: { num_predict: 1 },
        messages: sys ? [{ role: 'system', content: sys }, { role: 'user', content: 'hi' }] : [{ role: 'user', content: 'hi' }],
      }),
    });
    WARM.set(model, key);
  } catch {}
  done(); // replies when the model is loaded and its prompt is cached → the app shows "Ready"
});

// Is this model installed in Ollama? Uses the model list if loaded, otherwise asks Ollama (works right after a restart).
async function ollamaHas(id) {
  if (cache.data) return cache.data.models.some((m) => m.id === id);
  try {
    const j = await (await fetch(`${OLLAMA_NATIVE}/api/tags`, { headers: OLLAMA_H, signal: AbortSignal.timeout(3000) })).json();
    return (j.models || []).some((m) => m.name === id || m.model === id);
  } catch { return false; }
}

const textOf = (m) => (typeof m?.content === 'string' ? m.content : (m?.content || []).filter((p) => p.type === 'text').map((p) => p.text).join(' '));
// Change the text of a message whether its content is a string or [text, image…] parts
const mapText = (m, fn) => (typeof m.content === 'string' ? { ...m, content: fn(m.content) }
  : { ...m, content: m.content.map((p, i) => (i === 0 && p.type === 'text' ? { ...p, text: fn(p.text) } : p)) });

// Best connected FREE online model for big jobs. Order: Gemini Flash → Groq → OpenRouter ":free" (checked Nov 2026).
const FREE_PREFS = [
  ['gemini', [/^gemini-2\.5-flash$/, /^gemini-[\d.]+-flash$/, /^gemini-[\d.]+-flash(?!.*(lite|image|tts|audio|live|embedding))/], 'gemini-2.5-flash'],
  ['groq', [/^openai\/gpt-oss-120b$/, /^llama-3\.3-70b-versatile$/, /qwen.*coder|kimi|deepseek/i], 'llama-3.3-70b-versatile'],
  ['openrouter', [/qwen.*coder.*:free$/i, /deepseek.*:free$/i, /(gpt-oss|llama-3\.3-70b|qwen).*:free$/i], null],
];
function bestFreeCloud() {
  const list = cache.data?.models || [];
  for (const [prov, patterns, fallback] of FREE_PREFS) {
    if (!PROVIDERS[prov]?.key) continue;
    const mine = list.filter((m) => m.provider === prov);
    for (const re of patterns) {
      const m = mine.find((x) => re.test(x.id));
      if (m) return { provider: prov, id: m.id, label: `${PROVIDERS[prov].name} · ${String(m.label || m.id).replace(/^models\//, '')}` };
    }
    if (!mine.length && fallback) return { provider: prov, id: fallback, label: `${PROVIDERS[prov].name} · ${fallback}` }; // model list not loaded yet
  }
  return null;
}

// Which models can call tools? Ollama tells us per model; these cloud APIs support OpenAI-style tools.
const TOOL_PROVIDERS = new Set(['gemini', 'openai', 'anthropic', 'groq', 'cerebras', 'mistral', 'openrouter', 'deepseek']);
const CAPS = new Map();
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
  const { messages = [], temperature, maxTokens, kbId, webSearch: webSearchMode = 'auto',
    reasoning = 'balanced', tools: toolsMode = 'auto', allowCode = false, bigJobs = 'auto' } = req.body;
  let { system, model, provider } = req.body;
  let p = PROVIDERS[provider];
  res.setHeader('Content-Type', 'application/x-ndjson; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('X-Accel-Buffering', 'no');
  const send = (obj) => res.write(JSON.stringify(obj) + '\n');

  if (!p || !p.key) { send({ t: 'error', v: `${p?.name || provider} is not connected — add its API key in Models → Connect providers` }); return res.end(); }

  // Big jobs (a full project, or fixing one) → a connected FREE online model, far stronger than what a laptop can run.
  // The Learn model's own instructions go along, so the style stays the same. Off with Settings → Models → Big jobs → Always local.
  {
    const asked = textOf(messages[messages.length - 1]);
    if (bigJobs !== 'local' && provider === 'ollama' && (isProjectRequest(asked) || /live preview of the project shows these errors/i.test(asked))) {
      const pick = bestFreeCloud();
      if (pick) {
        const from = OWN[String(model).replace(/:latest$/, '')]?.label || model;
        if (OWN[String(model).replace(/:latest$/, '')]) { const baked = await bakedSystem(model); if (baked) system = system ? `${baked}\n\n${system}` : baked; }
        provider = pick.provider; model = pick.id; p = PROVIDERS[provider];
        send({ t: 'note', v: `Big job: ${pick.label} (free, online) built this instead of ${from} — much better results for full projects. Change in Settings → Models → Big jobs.` });
      }
    }
  }

  const ctrl = new AbortController();
  res.on('close', () => { if (!res.writableEnded) ctrl.abort(); });

  // Coding on Learn Lite (1B, weak at code) → hand the message to the coding specialist, Learn Code, and say so.
  // (Done before the built-in instructions are attached, so Learn Code uses its own.)
  {
    const asked = textOf(messages[messages.length - 1]);
    const codeModel = `${FAMILY.id}-code:latest`;
    const isCode = isBuildRequest(asked) || /```|\b(code|function|component|bug|error|fix|debug|react|javascript|typescript|python|html|css|api|sql)\b/i.test(asked);
    if (provider === 'ollama' && String(model).startsWith(`${FAMILY.id}-lite`) && isCode
      && await ollamaHas(codeModel)) {
      model = codeModel;
      send({ t: 'note', v: `${FAMILY.name} Lite isn't strong at code, so ${FAMILY.name} Code answered this one.` });
    }
    // Tamil script on the Qwen-based models (Pro / Code / Max) → Learn Lite (Gemma), which writes Tamil far better.
    // Measured with npm run eval: Pro 2/4 on Tamil tests, Lite 4/4. Code inside the message keeps the chosen model.
    const tamilChars = (asked.match(/[஀-௿]/g) || []).length;
    const liteModel = `${FAMILY.id}-lite:latest`;
    if (provider === 'ollama' && /-(pro|code|codeplus|max)(:|$)/.test(String(model)) && String(model).startsWith(FAMILY.id)
      && ((tamilChars >= 4 && tamilChars >= asked.replace(/\s/g, '').length * 0.3) || (tamilChars > 0 && /\b(translat\w*|meaning|mean in|in english|in tamil)\b/i.test(asked)))
      && !/```/.test(asked)
      && await ollamaHas(liteModel)) {
      const from = OWN[String(model).replace(/:latest$/, '')]?.label || model;
      model = liteModel;
      send({ t: 'note', v: `${from} isn't strong at Tamil script, so ${FAMILY.name} Lite answered this one.` });
    }
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
          { role: 'system', content: 'You are a senior React architect. Write short, concrete build plans. No code.' },
          { role: 'user', content: `Request: ${lastText}\n\nWrite the build plan for a React + Vite + MUI ${isApp ? 'web APP with real working features' : 'website'} in at most 12 short bullet lines:\n- what the user can see and DO (pages/sections, ${isApp ? 'forms, lists, add/edit/delete, filters, ratings…' : 'sections and their content'})\n- the components (one file each, under src/components/) and what props each one receives from App\n- the data shape in src/data.js${isApp ? ' and the React state (useState) + localStorage persistence' : ''}\n- the colour scheme and layout` },
        ] }),
      });
      plan = ((await r.json()).choices?.[0]?.message?.content || '').replace(/<thinking>[\s\S]*?<\/thinking>/gi, '').trim();
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
  if (!hasImage && !hasFile && (webSearchMode === 'on' || (webSearchMode === 'auto' && needsSearch(lastText)))) {
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
  if (REASONING[reasoning]) msgs = [...msgs.slice(0, -1), mapText(msgs[msgs.length - 1], (t) => `${t}\n\n(${REASONING[reasoning]})`)];

  // The model must know today's date, or "current" facts come from its old training data
  const today = new Date().toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  system = `${system ? `${system}\n\n` : ''}Today's date is ${today}.`;

  // Learning from mistakes: a VERIFIED project becomes a training example (request → working files); if it needed fixes,
  // also a preference pair (broken first try ✗ vs fixed final ✓). Local models only — online AIs' terms forbid training on them.
  const saveLesson = (firstAnswer, finalFiles, rounds) => {
    if (provider !== 'ollama') return; // after a switch to a free online model, provider is that model's — not saved
    try {
      const dir = path.join(__dirname, 'data', 'training');
      fs.mkdirSync(dir, { recursive: true });
      const asFiles = (fs_) => fs_.filter((f) => !/node_modules|package-lock/.test(f.path)).map((f) => `<file path="${f.path}">\n${f.content.trimEnd()}\n</file>`).join('\n');
      const chosen = `${asFiles(finalFiles)}\n\nRun it: npm install, then npm run dev.`;
      fs.appendFileSync(path.join(dir, 'lessons.jsonl'), JSON.stringify({ messages: [{ role: 'user', content: lastText }, { role: 'assistant', content: chosen }], verified: true, fixRounds: rounds, model, at: new Date().toISOString() }) + '\n');
      if (rounds > 0) fs.appendFileSync(path.join(dir, 'pairs.jsonl'), JSON.stringify({ prompt: lastText, chosen, rejected: firstAnswer, model, at: new Date().toISOString() }) + '\n');
    } catch (e) { console.warn('[lessons]', e.message); }
  };

  // ---------- Build agent (Project mode): check the project like a developer, fix what's broken, check again ----------
  // 1 auto-repair (imports, index.html…) → 2 real Vite build → 3 render <App /> → errors? ask the model to fix (max 3 rounds)
  const buildAgent = async (answer) => {
    send({ t: 'step', v: { id: 'write', label: `Wrote ${parseFiles(answer).length} files`, status: 'done' } });
    if (IS_VERCEL) return;
    let files = parseFiles(answer);
    if (!files.length) return;
    let convo = [...body.messages, { role: 'assistant', content: answer }];
    for (let round = 0; round <= 3; round++) {
      if (ctrl.signal.aborted) return;
      const id = `check${round}`;
      send({ t: 'step', v: { id, label: round ? `Checking again (after fix ${round})` : 'Building with Vite & running the app', status: 'running' } });
      const repaired = repairProject(files);
      let errors;
      try { errors = await checkProject(repaired); } catch (e) { send({ t: 'step', v: { id, label: `Could not run the check: ${e.message}`, status: 'error' } }); return; }
      if (!errors.length) {
        saveLesson(answer, repaired, round);
        const fixed = repaired.flatMap((f) => f.repaired || []).length;
        send({ t: 'step', v: { id, label: `Verified — builds and runs${fixed ? ` (auto-fixed ${fixed} small issue${fixed > 1 ? 's' : ''})` : ''}`, status: 'done' } });
        send({ t: 'verify', v: { status: 'ok', label: 'Project verified: Vite build ✓ · app renders ✓' } });
        return;
      }
      send({ t: 'step', v: { id, label: `Found ${errors.length} error${errors.length > 1 ? 's' : ''}`, status: 'error', detail: errors.join('\n\n') } });
      if (round === 3) {
        send({ t: 'verify', v: { status: 'issues', text: `Still not working after 3 automatic fixes:\n\n${errors.join('\n\n')}\n\nOpen Preview → "Fix with AI", or try a stronger model (Settings → Models → Big jobs).` } });
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
        reply = ((await r.json()).choices?.[0]?.message?.content || '').replace(/<thinking>[\s\S]*?<\/thinking>/gi, '');
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
      const out = ((await r.json()).choices?.[0]?.message?.content || '').replace(/<thinking>[\s\S]*?<\/thinking>/gi, '').trim();
      if (!out) return send({ t: 'verify', v: { status: 'skipped' } });
      send({ t: 'verify', v: /^\W*verified\W*$/i.test(out) || /^\W*verified\b/i.test(out) && out.length < 40
        ? { status: 'ok' } : { status: 'issues', text: out.replace(/^\W*correction:\s*/i, '') } });
    } catch { if (!ctrl.signal.aborted) send({ t: 'verify', v: { status: 'skipped' } }); }
  };

  // ---------- Tool calling (agent loop): calculator, date/time, code runner, web search, memory ----------
  // Only when the message looks like it needs a tool — normal chat stays fast and streams word by word.
  const lastMsgForTools = messages[messages.length - 1];
  const imageIn = Array.isArray(lastMsgForTools?.content) && lastMsgForTools.content.some((x) => x.type === 'image_url');
  if (toolsMode !== 'off' && (toolsMode === 'on' || needsTools(lastText)) && !imageIn && await supportsTools(provider, model)) {
    const codeOk = !!allowCode && !IS_VERCEL;
    const defs = [TOOL_DEFS.calculator, TOOL_DEFS.get_datetime, TOOL_DEFS.date_diff, TOOL_DEFS.save_memory,
      ...(codeOk ? [TOOL_DEFS.run_javascript] : []), ...(!searched && webSearchMode !== 'off' ? [TOOL_DEFS.web_search] : [])];
    const convo = [{ role: 'system', content: `${system}\n\nYou can call tools. Use the calculator for ALL arithmetic and date_diff for counting days — never calculate in your head. Call a tool only when it helps, then answer the user normally using the results.` }, ...msgs];
    const ctx = { allowCode: codeOk, search: (q) => webSearch(q, searchKeys()), onMemory: (fact) => send({ t: 'memory', v: fact }) };
    const used = [];
    let final = null;
    const t0 = Date.now();
    try {
      for (let step = 0; step < 10 && Date.now() - t0 < 120_000; step++) {
        const r = await fetch(`${p.base}/chat/completions`, {
          method: 'POST', headers: headersFor(provider), signal: ctrl.signal,
          body: JSON.stringify({ model, messages: convo, tools: defs, stream: false,
            ...(temperature != null && { temperature: Number(temperature) }), ...(maxTokens && { max_tokens: Number(maxTokens) }) }),
        });
        if (!r.ok) break; // this model/provider refused tools → normal answer below
        const msg = (await r.json()).choices?.[0]?.message || {};
        const calls = msg.tool_calls?.length ? msg.tool_calls : parseTextToolCalls(msg.content, defs.map((d) => d.function.name));
        if (!calls.length) { final = msg.content || ''; break; }
        convo.push({ role: 'assistant', content: msg.content || '', tool_calls: calls });
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
      for (let k = 0; k < final.length; k += 40) send({ t: 'text', v: final.slice(k, k + 40) });
      usage.record({ provider, providerName: p.name, model, label: OWN[String(model).replace(/:latest$/, '')]?.label || model,
        free: !!(p.allFree || p.builtin), inTok: Math.ceil(JSON.stringify(convo).length / 4), outTok: Math.ceil(final.length / 4), estimated: true });
      flagFakeSources(final);
      await selfCheck(final);
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
  if (provider === 'anthropic' && !body.max_tokens) body.max_tokens = 8192;
  // Ask for exact token counts where the provider supports it (others are estimated)
  if (['openai', 'deepseek', 'ollama'].includes(provider)) body.stream_options = { include_usage: true };

  // Billing: is this request free, and is a paid one still within the monthly budget?
  const live = usage.livePrices.get(`${provider}:${model}`);
  const free = !!(p.allFree || p.builtin || String(model).endsWith(':free') || (live && !live.in && !live.out));
  const over = usage.budgetCheck(free);
  if (over) { send({ t: 'error', v: over }); return res.end(); }

  let outText = '', usageInfo = null;
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
          if (reasoning) send({ t: 'reasoning', v: reasoning });
          if (d.content) { outText += d.content; send({ t: 'text', v: d.content }); }
          if (reasoning) outText += reasoning;
          if (j.usage) { usageInfo = j.usage; send({ t: 'usage', v: j.usage }); }
        } catch {}
      }
    }
  } catch (e) {
    if (e.name !== 'AbortError') send({ t: 'error', v: e.message });
  }
  if (outText) logUsage(); // also logs stopped/partial answers — you still pay for those tokens
  flagFakeSources(outText);
  if (projectMode && outText && !ctrl.signal.aborted) await buildAgent(outText);
  else await selfCheck(outText);
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
    let title = (j.choices?.[0]?.message?.content || '').replace(/<thinking>[\s\S]*?<\/thinking>/g, '').split('\n').map((l) => l.trim()).find(Boolean) || '';
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
  res.type('application/jsonl').sendFile(file);
});

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

if (!IS_VERCEL) { // on Vercel the built site is served by Vercel's CDN
  app.use(express.static(path.join(__dirname, 'dist')));
  app.get('*', (_, res) => res.sendFile(path.join(__dirname, 'dist', 'index.html')));
}

export default app; // used by api/index.js on Vercel

const PORT = process.env.PORT || 3001;
if (!IS_VERCEL) app.listen(PORT, () => {
  console.log(`\n  Evolvix API → http://localhost:${PORT}`);
  console.log('  Providers:', Object.keys(PROVIDERS).filter((k) => PROVIDERS[k].key).join(', '), '\n');
});
