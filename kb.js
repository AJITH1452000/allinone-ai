// Knowledge base for "My models" — stores your files on this PC and finds the most relevant parts for each question (RAG).
// Search = keyword (BM25) + meaning (Ollama embeddings, if available). Only the top chunks are sent to the AI, so token use stays low.
import fs from 'fs';
import path from 'path';
import { createRequire } from 'module';
import { fileURLToPath } from 'url';
import { DATA_DIR } from './paths.js';

const require = createRequire(import.meta.url);
const DIR = path.join(DATA_DIR, 'kb');
fs.mkdirSync(DIR, { recursive: true });

const OLLAMA = (process.env.OLLAMA_URL || 'http://localhost:11434/v1').replace(/\/v1\/?$/, '');
const EMBED_MODEL = process.env.EMBED_MODEL || 'nomic-embed-text';
const CHUNK = 900, OVERLAP = 150;

const safeId = (id) => String(id).replace(/[^\w-]/g, '').slice(0, 64);
const file = (id) => path.join(DIR, `${safeId(id)}.json`);
const load = (id) => { try { return JSON.parse(fs.readFileSync(file(id), 'utf8')); } catch { return { docs: [] }; } };
const save = (id, kb) => fs.writeFileSync(file(id), JSON.stringify(kb));

// ---------- text extraction ----------
export async function extractText(name, base64) {
  const buf = Buffer.from(base64, 'base64');
  const ext = path.extname(name).toLowerCase();
  if (ext === '.pdf') {
    const pdf = require('pdf-parse/lib/pdf-parse.js');
    return (await pdf(buf)).text;
  }
  if (ext === '.xlsx') { // every sheet as a text table (comma-separated, first row = headers)
    const xl = require('read-excel-file/node');
    const out = [];
    for (const sheet of await xl.readSheetNames(buf)) {
      const rows = await xl.default(buf, { sheet });
      const cell = (v) => (v instanceof Date ? v.toISOString().slice(0, 10) : v == null ? '' : /[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v));
      out.push(`Sheet: ${sheet} (${Math.max(0, rows.length - 1)} rows)\n${rows.map((r) => r.map(cell).join(',')).join('\n')}`);
    }
    return out.join('\n\n');
  }
  if (ext === '.docx') {
    const mammoth = require('mammoth');
    return (await mammoth.extractRawText({ buffer: buf })).value;
  }
  if (['.html', '.htm'].includes(ext)) {
    return buf.toString('utf8').replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ');
  }
  return buf.toString('utf8');
}

// ---------- chunking ----------
function chunk(text) {
  const clean = text.replace(/\r/g, '').replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
  const out = [];
  let i = 0;
  while (i < clean.length) {
    let end = Math.min(clean.length, i + CHUNK);
    if (end < clean.length) { // try to cut at a paragraph / sentence boundary
      const cut = Math.max(clean.lastIndexOf('\n\n', end), clean.lastIndexOf('. ', end), clean.lastIndexOf('\n', end));
      if (cut > i + CHUNK * 0.5) end = cut + 1;
    }
    const t = clean.slice(i, end).trim();
    if (t) out.push(t);
    if (end >= clean.length) break;
    i = Math.max(end - OVERLAP, i + 1);
  }
  return out;
}

// ---------- embeddings (optional) ----------
let embedOk = null; // null = unknown, true/false after first try
async function embed(texts, { keepAlive = '2h' } = {}) {
  if (embedOk === false || !texts.length) return null;
  try {
    const out = [];
    for (let i = 0; i < texts.length; i += 64) {
      const r = await fetch(`${OLLAMA}/api/embed`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: EMBED_MODEL, keep_alive: keepAlive, input: texts.slice(i, i + 64).map((t) => t.slice(0, 2000)) }),
      });
      if (!r.ok) throw new Error(r.status);
      out.push(...(await r.json()).embeddings);
    }
    embedOk = true;
    return out;
  } catch {
    embedOk = false; setTimeout(() => { embedOk = null; }, 60_000); // retry later (Ollama may start)
    return null;
  }
}

// Unit-length Float32 vectors → cosine similarity is a plain dot product (fast)
const toUnit = (v) => {
  const f = Float32Array.from(v);
  let n = 0; for (let i = 0; i < f.length; i++) n += f[i] * f[i];
  n = Math.sqrt(n) || 1; for (let i = 0; i < f.length; i++) f[i] /= n;
  return f;
};
const dot = (a, b) => { let s = 0; for (let i = 0; i < a.length; i++) s += a[i] * b[i]; return s; };

// ---------- in-memory search index (built once, reused for every question) ----------
const tokenize = (s) => s.toLowerCase().normalize('NFC').match(/[\p{L}\p{M}\p{N}]+/gu)?.filter((w) => w.length > 1) || [];
const INDEX = new Map(); // kbId → { chunks: [{name, text, len, tf: Map, vec: Float32Array|null}], df: Map, avg }

function index(id) {
  if (INDEX.has(id)) return INDEX.get(id);
  const kb = load(id);
  const chunks = [];
  const df = new Map();
  for (const d of kb.docs) {
    for (const c of d.chunks) {
      const toks = tokenize(c.text);
      const tf = new Map();
      for (const w of toks) tf.set(w, (tf.get(w) || 0) + 1);
      for (const w of tf.keys()) df.set(w, (df.get(w) || 0) + 1);
      chunks.push({ name: d.name, text: c.text, len: toks.length, tf, vec: c.vec ? toUnit(c.vec) : null });
    }
  }
  const avg = chunks.reduce((n, c) => n + c.len, 0) / (chunks.length || 1);
  const idx = { chunks, df, avg };
  INDEX.set(id, idx);
  return idx;
}
const invalidate = (id) => INDEX.delete(id);

function bm25(idx, query) {
  const q = [...new Set(tokenize(query))].filter((w) => idx.df.has(w));
  const N = idx.chunks.length;
  const idf = q.map((w) => Math.log(1 + (N - idx.df.get(w) + 0.5) / (idx.df.get(w) + 0.5)));
  return idx.chunks.map((c) => {
    let s = 0;
    for (let i = 0; i < q.length; i++) {
      const f = c.tf.get(q[i]);
      if (f) s += idf[i] * (f * 2.2) / (f + 1.2 * (0.25 + 0.75 * c.len / idx.avg));
    }
    return s;
  });
}

// Recent query embeddings (same/similar follow-up questions don't re-embed)
const QCACHE = new Map();
async function embedQuery(q) {
  const key = q.trim().toLowerCase().slice(0, 500);
  if (QCACHE.has(key)) return QCACHE.get(key);
  const v = (await embed([q]))?.[0];
  if (v) { QCACHE.set(key, toUnit(v)); if (QCACHE.size > 200) QCACHE.delete(QCACHE.keys().next().value); }
  return v ? QCACHE.get(key) : null;
}

// ---------- background "smart search" indexing ----------
const JOBS = new Map(); // docId → { done, total }
async function embedInBackground(id, docId) {
  const kb = load(id);
  const doc = kb.docs.find((d) => d.id === docId);
  if (!doc) return;
  const total = doc.chunks.length;
  JOBS.set(docId, { done: 0, total });
  for (let i = 0; i < total; i += 64) {
    const vecs = await embed(doc.chunks.slice(i, i + 64).map((c) => c.text));
    if (!vecs) { JOBS.delete(docId); return; } // Ollama not available → keyword search only
    vecs.forEach((v, j) => { doc.chunks[i + j].vec = v.map((x) => +x.toFixed(5)); });
    JOBS.set(docId, { done: Math.min(total, i + 64), total });
  }
  const fresh = load(id); // file may have changed meanwhile
  const target = fresh.docs.find((d) => d.id === docId);
  if (target) { target.chunks = doc.chunks; save(id, fresh); invalidate(id); }
  JOBS.delete(docId);
}

// ---------- public API ----------
export function listDocs(id) {
  return load(id).docs.map(({ id: did, name, chars, chunks, addedAt }) => {
    const job = JOBS.get(did);
    return { id: did, name, chars, chunks: chunks.length, semantic: !!chunks[0]?.vec, indexing: job ? Math.round((job.done / job.total) * 100) : null, addedAt };
  });
}

/** Saves the file right away (keyword search works instantly); smart search is added in the background. */
export async function addDoc(id, name, text) {
  const pieces = chunk(text);
  if (!pieces.length) throw new Error('No readable text found in this file');
  if (pieces.length > 20000) throw new Error('File too large (max ~15 MB of text)');
  const kb = load(id);
  const doc = {
    id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6), name, chars: text.length, addedAt: Date.now(),
    chunks: pieces.map((t) => ({ text: t })),
  };
  kb.docs = [...kb.docs.filter((d) => d.name !== name), doc]; // re-upload replaces the old copy
  save(id, kb); invalidate(id);
  embedInBackground(id, doc.id).catch(() => JOBS.delete(doc.id));
  return { chunks: doc.chunks.length, semantic: false, indexing: true };
}

export function removeDoc(id, docId) { const kb = load(id); kb.docs = kb.docs.filter((d) => d.id !== docId); save(id, kb); invalidate(id); }
export function removeKb(id) { try { fs.unlinkSync(file(id)); } catch {} invalidate(id); }

/** Load the index (and the embedding model) ahead of time so the first question is fast. */
export async function warm(id) {
  const idx = index(id);
  if (idx.chunks.some((c) => c.vec)) await embedQuery('warm up');
  return idx.chunks.length;
}

/** Find the best chunks for a question. Returns [{ name, text }] — at most `k` chunks, ~budget characters total. */
export async function search(id, query, { k = 5, budget = 4000 } = {}) {
  const idx = index(id);
  if (!idx.chunks.length || !query.trim()) return [];
  const kw = bm25(idx, query);
  let maxKw = 1e-9; for (const v of kw) if (v > maxKw) maxKw = v;
  let sem = null;
  if (idx.chunks.some((c) => c.vec)) {
    const qv = await embedQuery(query);
    if (qv) sem = idx.chunks.map((c) => (c.vec && c.vec.length === qv.length ? dot(qv, c.vec) : 0));
  }
  const scored = [];
  for (let i = 0; i < idx.chunks.length; i++) {
    const s = sem ? 0.65 * sem[i] + 0.35 * (kw[i] / maxKw) : kw[i] / maxKw;
    if (s > (sem ? 0.3 : 0)) scored.push({ c: idx.chunks[i], s });
  }
  scored.sort((a, b) => b.s - a.s);
  const out = []; let used = 0;
  const top = scored[0]?.s || 0;
  for (const { c, s } of scored) {
    if (s < top * 0.75) break; // skip weak matches — saves tokens and keeps answers on-topic
    if (out.length >= k || used + c.text.length > budget) break;
    out.push({ name: c.name, text: c.text }); used += c.text.length;
  }
  return out;
}
