// Shared helpers for the training scripts (self-train, add-my-code, fetch-open-code, get-datasets, clean-data).
// Rule: training data comes ONLY from Learn's own verified work, your own code/edits, and permissively licensed
// human-written open-source code (MIT / Apache-2.0 / BSD / ISC). Never from Claude, GPT, Gemini or other online AIs.
import '../office/boot.js'; // office mode: data/ is encrypted at rest — the scripts read/write it through the same layer
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { spawnSync } from 'child_process';
import { fileURLToPath } from 'url';

export const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
export const DATA = path.join(ROOT, 'data', 'training');
fs.mkdirSync(DATA, { recursive: true });
export const OLLAMA = (process.env.OLLAMA_URL || 'http://localhost:11434/v1').replace(/\/v1\/?$/, '');

export const THINK = /<think(?:ing)?>[\s\S]*?(?:<\/think(?:ing)?>|$)/gi;
export const noThink = (t) => String(t || '').replace(THINK, '').trim();
// Hidden text the app adds to a message (docs, analysis, tool results) — never part of a training sample
export const stripHidden = (t) => noThink(t).replace(/\s*\/(no_)?think\s*$/, '')
  .replace(/\n*\((Reference docs|My earlier working code|Your analysis|Earlier in this chat|Tool results|Think briefly|Think step by step|Give a short overview|I mean|npm registry results|PyPI (Python) results|Packagist (PHP) results|Reply mode|Style|Data file attached|Research mode)[\s\S]*?\)\s*(?=\n\n|$)/g, '')
  .replace(/\s*\/(no_)?think\s*$/, '').trim();
export const hash = (s) => crypto.createHash('sha1').update(String(s)).digest('hex');
export const SECRET = /api[_-]?key|secret|password|passwd|token|private[_-]?key/i;

export const readJsonl = (file) => {
  const f = path.isAbsolute(file) ? file : path.join(DATA, file);
  if (!fs.existsSync(f)) return [];
  return fs.readFileSync(f, 'utf8').split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
};
export const appendJsonl = (file, row) => fs.appendFileSync(path.isAbsolute(file) ? file : path.join(DATA, file), JSON.stringify(row) + '\n');
export const countLines = (file) => readJsonl(file).length;

// Resume state per script: data/training/state-<name>.json
export function state(name) {
  const f = path.join(DATA, `state-${name}.json`);
  const s = fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8')) : {};
  return { s, save: () => fs.writeFileSync(f, JSON.stringify(s, null, 1)) };
}

// ---------- licences ----------
const PERMISSIVE = [
  ['MIT', /\bMIT License\b|Permission is hereby granted, free of charge/i],
  ['Apache-2.0', /Apache License,?\s+Version 2\.0/i],
  ['BSD', /Redistribution and use in source and binary forms/i],
  ['ISC', /\bISC License\b|Permission to use, copy, modify, and\/or distribute this software for any purpose/i],
];
/** → 'MIT' | 'Apache-2.0' | 'BSD' | 'ISC' | null (anything else, e.g. GPL, no licence, custom) */
export function licenseOf(text) {
  if (!text) return null;
  if (/GNU (Affero )?General Public License|Creative Commons|All rights reserved\.?\s*$/im.test(text) && !/Permission is hereby granted/i.test(text)) return null;
  return PERMISSIVE.find(([, re]) => re.test(text))?.[0] || null;
}
export const PERMISSIVE_IDS = /^(mit|apache-2\.0|bsd-2-clause|bsd-3-clause|bsd|isc|0bsd|unlicense)$/i;

// ---------- git (sparse / partial clones, so only the folders we need are downloaded) ----------
const git = (args, cwd) => spawnSync('git', args, { cwd, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024, windowsHide: true });
export const hasGit = () => git(['--version']).status === 0;
/** Clone (or update) github.com/<repo> into data/open-code/<repo> with only `paths` checked out. depth = commits of history to keep. */
export function sparseClone(repo, paths, { depth = 1, branch } = {}) {
  const dir = path.join(ROOT, 'data', 'open-code', repo.replace('/', '__'));
  if (!fs.existsSync(path.join(dir, '.git'))) {
    fs.mkdirSync(path.dirname(dir), { recursive: true });
    const r = git(['clone', '--filter=blob:none', '--no-checkout', `--depth=${depth}`, ...(branch ? ['--branch', branch] : []), `https://github.com/${repo}.git`, dir]);
    if (r.status !== 0) throw new Error(`git clone failed: ${r.stderr.trim().split('\n').pop()}`);
  }
  git(['sparse-checkout', 'set', '--no-cone', '/LICENSE*', '/license*', ...paths.map((p) => `/${p.replace(/^\/+/, '')}`)], dir);
  const co = git(['checkout'], dir);
  if (co.status !== 0) throw new Error(`git checkout failed: ${co.stderr.trim().split('\n').pop()}`);
  return dir;
}
export const gitIn = git;

export function readLicense(dir) {
  const f = fs.readdirSync(dir).find((n) => /^licen[sc]e(\.md|\.txt)?$/i.test(n));
  return f ? fs.readFileSync(path.join(dir, f), 'utf8') : '';
}

/** All files under dir with one of the extensions, skipping build output, secrets and big/binary files */
export function walk(dir, exts = /\.(jsx?|tsx?|css)$/i, maxBytes = 60_000) {
  const out = [];
  const go = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      if (/^(node_modules|dist|build|\.git|\.next|coverage|\.vercel|out)$/.test(e.name) || /^\.env/.test(e.name)) continue;
      const p = path.join(d, e.name);
      if (e.isDirectory()) go(p);
      else if (exts.test(e.name) && fs.statSync(p).size <= maxBytes) out.push(p);
    }
  };
  if (fs.existsSync(dir)) go(dir);
  return out;
}
export const looksBinary = (s) => /\u0000/.test(s.slice(0, 2000));

// ---------- the local Learn model writes ONE request line for a real file (the answer stays the real, human-written file) ----------
export async function requestFor(code, filePath, { model = 'learn' } = {}) {
  const r = await fetch(`${OLLAMA}/api/chat`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', ...(process.env.OLLAMA_API_KEY ? { Authorization: `Bearer ${process.env.OLLAMA_API_KEY}` } : {}) },
    signal: AbortSignal.timeout(90_000),
    body: JSON.stringify({ model, stream: false, think: false, options: { num_predict: 60, temperature: 0.3 }, messages: [{ role: 'user', content:
      `Here is a file (${filePath}):\n\n${code.slice(0, 6000)}\n\nWrite ONE short request (max 25 words) that a developer would type to get exactly this file, e.g. "Create a MUI sidebar with collapsible menu groups". Reply with the request only. /no_think` }] }),
  });
  const j = await r.json();
  return noThink(j.message?.content).split('\n').map((l) => l.trim()).find(Boolean)?.replace(/^["'`]|["'`]$/g, '').slice(0, 300) || '';
}
export const asFile = (p, code) => `<file path="${p}">\n${code.trimEnd()}\n</file>`;

// Which part of the mix a sample belongs to (Step 5: ≥70% stack, ≤15% general JS/CSS, ≤15% Tanglish/chat)
const TANGLISH = /\b(pannu|pannunga|enna|epdi|aagudhu|varudhu|irukku|irukka|venum|sollu|panna|illa|aana|romba|nalla)\b/i;
const STACK = /\b(react|jsx|tsx|usestate|useeffect|@mui|mui|material-ui|vite|recharts|<[A-Z]\w*[\s/>])/i;
export function mixOf(sample) {
  const text = (sample.messages || []).map((m) => m.content).join('\n');
  if (TANGLISH.test(text)) return 'tanglish';
  return STACK.test(text) ? 'stack' : 'general';
}
