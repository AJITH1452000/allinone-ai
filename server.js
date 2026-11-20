import 'dotenv/config';
import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';
import crypto from 'crypto';
import { IS_VERCEL, KEYS_FILE } from './paths.js';
import * as kb from './kb.js';
import * as usage from './usage.js';
import { webSearch, needsSearch, withResults, resolveShort } from './search.js';

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
  cerebras:   { name: 'Cerebras', tag: 'Free · ultra fast', env: 'CEREBRAS_API_KEY', base: 'https://api.cerebras.ai/v1', allFree: true, fast: true, url: 'https://cloud.cerebras.ai' },
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
    else if (id === 'ollama') p.key = IS_VERCEL && !process.env.OLLAMA_URL ? '' : 'ollama';
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
  if (id === 'openrouter') { h['HTTP-Referer'] = 'http://localhost'; h['X-Title'] = 'All-in-One AI'; }
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
    [`${f}-max`]: { label: `${FAMILY.name} Max`, desc: 'Most capable · coding & reasoning', rank: 0, vision: false, fast: false },
    [`${f}-pro`]: { label: `${FAMILY.name} Pro`, desc: 'Balanced · everyday · sees images', rank: 1, vision: true, fast: false },
    [`${f}-lite`]: { label: `${FAMILY.name} Lite`, desc: 'Fastest · quick answers', rank: 2, vision: false, fast: true },
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
const KEEP_ALIVE = process.env.OLLAMA_KEEP_ALIVE || '2h';
const BAKED = new Map(); // model → its built-in SYSTEM prompt
async function bakedSystem(model) {
  if (BAKED.has(model)) return BAKED.get(model);
  try {
    const j = await (await fetch(`${OLLAMA_NATIVE}/api/show`, { method: 'POST', body: JSON.stringify({ model }), signal: AbortSignal.timeout(5000) })).json();
    BAKED.set(model, j.system || '');
  } catch { return ''; }
  return BAKED.get(model);
}

// Loads the model into memory and pre-processes its system prompt, so the first real message starts instantly.
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
    await fetch(`${OLLAMA_NATIVE}/api/chat`, {
      method: 'POST',
      body: JSON.stringify({
        model, stream: false, keep_alive: KEEP_ALIVE, options: { num_predict: 1 },
        messages: sys ? [{ role: 'system', content: sys }, { role: 'user', content: 'hi' }] : [{ role: 'user', content: 'hi' }],
      }),
    });
  } catch {}
  done(); // replies when the model is loaded and its prompt is cached → the app shows "Ready"
});

const textOf = (m) => (typeof m?.content === 'string' ? m.content : (m?.content || []).filter((p) => p.type === 'text').map((p) => p.text).join(' '));

app.post('/api/chat', async (req, res) => {
  const { provider, model, messages = [], temperature, maxTokens, kbId, webSearch: webSearchMode = 'auto' } = req.body;
  let { system } = req.body;
  const p = PROVIDERS[provider];
  res.setHeader('Content-Type', 'application/x-ndjson; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('X-Accel-Buffering', 'no');
  const send = (obj) => res.write(JSON.stringify(obj) + '\n');

  if (!p || !p.key) { send({ t: 'error', v: `${p?.name || provider} is not connected — add its API key in Models → Connect providers` }); return res.end(); }

  const ctrl = new AbortController();
  res.on('close', () => { if (!res.writableEnded) ctrl.abort(); });

  // Your own Learn models: a system message would REPLACE the instructions built into the model,
  // so we put the built-in instructions first and add the app's extras (name, language…) after them.
  if (provider === 'ollama' && OWN[String(model).replace(/:latest$/, '')]) {
    const baked = await bakedSystem(model);
    if (baked) system = system ? `${baked}\n\n${system}` : baked;
  }

  // RAG: put the most relevant parts of this model's files into the LATEST user message.
  // (Not the system prompt — keeping system + history identical lets Ollama reuse its cache = much faster.)
  let msgs = messages;
  if (kbId) {
    const users = messages.filter((m) => m.role === 'user');
    const query = [textOf(users[users.length - 2]).slice(0, 300), textOf(users[users.length - 1])].join('\n');
    const hits = await kb.search(kbId, query).catch(() => []);
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
  if (webSearchMode === 'on' || (webSearchMode === 'auto' && needsSearch(lastText))) {
    send({ t: 'searching', v: lastText.slice(0, 120) });
    const found = await webSearch(lastText, searchKeys()).catch(() => ({ results: [] }));
    // Everything the app needs for an instant knowledge card (photo, summary, dated news, related topics)
    const card = ({ kind, title, name, url, description, image, date, source, text }) =>
      ({ kind, title, name, url, description, image, date, source, text: kind === 'wiki' ? text : undefined });
    send({ t: 'search', v: { engine: found.engine, results: (found.results || []).map(card), related: (found.related || []).map(card) } });
    // Always attach: the results (placed before the question), or a "nothing found → don't guess" note
    const last = msgs[msgs.length - 1];
    const withCtx = typeof last.content === 'string' ? { ...last, content: withResults(found, last.content) }
      : { ...last, content: last.content.map((p, i) => (i === 0 && p.type === 'text' ? { ...p, text: withResults(found, p.text) } : p)) };
    msgs = [...msgs.slice(0, -1), withCtx];
  }

  // The model must know today's date, or "current" facts come from its old training data
  const today = new Date().toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  system = `${system ? `${system}\n\n` : ''}Today's date is ${today}.`;

  const body = {
    model,
    stream: true,
    messages: system ? [{ role: 'system', content: system }, ...msgs] : msgs,
  };
  if (temperature != null) body.temperature = Number(temperature);
  if (maxTokens) body.max_tokens = Number(maxTokens);
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
      send({ t: 'error', v: `${r.status} — ${msg}` });
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
  res.end();
});

// ---------- Usage & billing ----------
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
  console.log(`\n  All-in-One AI API → http://localhost:${PORT}`);
  console.log('  Providers:', Object.keys(PROVIDERS).filter((k) => PROVIDERS[k].key).join(', '), '\n');
});
