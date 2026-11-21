// Evolvix engines — the parts of an "advanced AI" that are real code, not model settings:
//   Math engine (exact calculator) · Code execution (sandboxed) · Tool calling (agent loop)
//   Reasoning modes (fast / balanced / expert + self-check) · Safety (prompt-injection guard)
import { spawn, spawnSync } from 'child_process';
import os from 'os';
import fs from 'fs';
import { SANDBOX_NO_NET } from './office/core.js';
import path from 'path';

// ───────────────────────── Math engine ─────────────────────────
// A small, safe expression parser (no eval). Supports + - * / ^, mod, %, !, parentheses,
// functions (sqrt, sin, log, round…) and constants (pi, e). Trig uses radians; use deg(x) to convert.
const FN = {
  sqrt: Math.sqrt, cbrt: Math.cbrt, abs: Math.abs, exp: Math.exp, ln: Math.log, log2: Math.log2,
  log: (x, b) => (b == null ? Math.log10(x) : Math.log(x) / Math.log(b)),
  sin: Math.sin, cos: Math.cos, tan: Math.tan, asin: Math.asin, acos: Math.acos, atan: Math.atan,
  sinh: Math.sinh, cosh: Math.cosh, tanh: Math.tanh, deg: (x) => (x * Math.PI) / 180, rad2deg: (x) => (x * 180) / Math.PI,
  floor: Math.floor, ceil: Math.ceil, trunc: Math.trunc, sign: Math.sign,
  round: (x, d = 0) => { const f = 10 ** d; return Math.round((x + Number.EPSILON) * f) / f; },
  min: Math.min, max: Math.max, pow: Math.pow, hypot: Math.hypot,
  avg: (...a) => a.reduce((s, v) => s + v, 0) / a.length, sum: (...a) => a.reduce((s, v) => s + v, 0),
  ncr: (n, r) => fact(n) / (fact(r) * fact(n - r)), npr: (n, r) => fact(n) / fact(n - r),
};
const CONST = { pi: Math.PI, π: Math.PI, e: Math.E, tau: 2 * Math.PI };
function fact(n) {
  if (!Number.isInteger(n) || n < 0) throw new Error('factorial needs a whole number ≥ 0');
  if (n > 170) return Infinity;
  let r = 1; for (let i = 2; i <= n; i++) r *= i; return r;
}

export function calculate(input) {
  let src = String(input).toLowerCase()
    .replace(/×/g, '*').replace(/÷/g, '/').replace(/−/g, '-').replace(/\*\*/g, '^').replace(/,(?=\d{3}\b)/g, '')
    .replace(/(\d+(?:\.\d+)?)\s*%\s*of\s*/g, '($1/100)*'); // "15% of 200"
  const tokens = src.match(/\d+(?:\.\d+)?(?:e[+-]?\d+)?|[a-zπ_][a-z0-9_]*|[-+*/^%()!,]/g) || [];
  if (tokens.join('') !== src.replace(/\s+/g, '')) throw new Error(`Unsupported characters in "${input}"`);
  let i = 0;
  const peek = () => tokens[i];
  const eat = (t) => { if (tokens[i] !== t) throw new Error(`Expected "${t}"`); i++; };
  const expr = () => {
    let v = term();
    while (peek() === '+' || peek() === '-') { const op = tokens[i++]; const r = term(); v = op === '+' ? v + r : v - r; }
    return v;
  };
  const term = () => {
    let v = unary();
    for (;;) {
      const t = peek();
      if (t === '*') { i++; v *= unary(); } else if (t === '/') { i++; v /= unary(); }
      else if (t === 'mod') { i++; v %= unary(); }
      else if (t === '(' || (t && /^[a-zπ\d]/.test(t) && t !== 'mod')) v *= power(); // implicit: 2pi, 3(4+1)
      else return v;
    }
  };
  // -3^2 = -9 (power binds tighter than the minus sign); 2^-1 = 0.5
  const unary = () => { if (peek() === '-') { i++; return -unary(); } if (peek() === '+') { i++; return unary(); } return power(); };
  const power = () => { const b = postfix(); if (peek() === '^') { i++; return b ** unary(); } return b; };
  const postfix = () => {
    let v = primary();
    for (;;) { if (peek() === '!') { i++; v = fact(v); } else if (peek() === '%') { i++; v /= 100; } else return v; }
  };
  const primary = () => {
    const t = tokens[i++];
    if (t == null) throw new Error('Expression ended too early');
    if (/^\d/.test(t)) return parseFloat(t);
    if (t === '(') { const v = expr(); eat(')'); return v; }
    if (FN[t]) {
      eat('('); const args = [];
      if (peek() !== ')') { args.push(expr()); while (peek() === ',') { i++; args.push(expr()); } }
      eat(')'); return FN[t](...args);
    }
    if (t in CONST) return CONST[t];
    throw new Error(`Unknown name "${t}"`);
  };
  const v = expr();
  if (i < tokens.length) throw new Error(`Unexpected "${tokens[i]}"`);
  if (Number.isNaN(v)) throw new Error('Result is not a number');
  return v;
}
export const formatNumber = (v) => (!Number.isFinite(v) ? String(v)
  : Number.isInteger(v) && Math.abs(v) < 1e21 ? String(v) : String(Number(v.toPrecision(14))));

// ───────────────────────── Code execution (sandboxed) ─────────────────────────
// Runs JavaScript in a separate Node process with Node's permission model ON and no permissions
// granted: no file writes/reads, no child processes, no worker threads, no native addons.
// Hard limits: 5 s run time, 64 MB memory, 8 000 characters of output.
export function runJavaScript(code, { timeoutMs = 5000 } = {}) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [
      '--experimental-permission', '--disable-warning=ExperimentalWarning', '--max-old-space-size=64', '-',
    ], { cwd: os.tmpdir(), env: { NODE_OPTIONS: '' }, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
    let out = '', err = '', done = false;
    const cap = (s) => (s.length > 8000 ? `${s.slice(0, 8000)}\n…[output trimmed]` : s);
    const finish = (extra) => { if (done) return; done = true; clearTimeout(t); resolve({ ok: !extra && !err, stdout: cap(out), stderr: cap(err + (extra || '')) }); };
    const t = setTimeout(() => { child.kill('SIGKILL'); finish(`\nStopped: took longer than ${timeoutMs / 1000} s`); }, timeoutMs);
    child.stdout.on('data', (d) => { out += d; if (out.length > 20000) child.kill('SIGKILL'); });
    child.stderr.on('data', (d) => { err += d; });
    child.on('error', (e) => finish(`\n${e.message}`));
    child.on('close', () => finish());
    // Office mode: the sandboxed code gets no network at all (fetch, net, http, https, tls, dgram all throw)
    child.stdin.end((process.env.OFFICE_MODE === '1' ? SANDBOX_NO_NET : '') + String(code));
  });
}

// ───────────────────────── Python runner (only if `python` is on PATH; off by default like JS) ─────────────────────────
// Isolated mode (-I: no user site/env), a fresh empty temp folder as cwd, 5 s limit, network calls blocked,
// 64 MB memory cap where the OS supports it (Linux/macOS; Windows has no per-process limit from Python).
const PY = (() => {
  for (const exe of ['python', 'python3', 'py']) {
    try {
      const r = spawnSync(exe, ['--version'], { encoding: 'utf8', timeout: 4000, windowsHide: true });
      if (r.status === 0 && /^Python 3/.test(`${r.stdout}${r.stderr}`.trim())) return exe;
    } catch {}
  }
  return null;
})();
export const HAS_PYTHON = !!PY;
const PY_PRELUDE = `import socket as _s
def _no_net(*a, **k): raise PermissionError("network is blocked in this sandbox")
_s.socket = _no_net; _s.create_connection = _no_net
try:
    import resource as _r; _r.setrlimit(_r.RLIMIT_AS, (64 * 1024 * 1024, 64 * 1024 * 1024))
except Exception: pass
del _s, _r
`;
export function runPython(code, { timeoutMs = 5000 } = {}) {
  return new Promise((resolve) => {
    if (!PY) return resolve({ ok: false, stdout: '', stderr: 'Python is not installed on this PC.' });
    const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'evx-py-'));
    const child = spawn(PY, ['-I', '-'], { cwd, env: { PYTHONIOENCODING: 'utf-8', SYSTEMROOT: process.env.SYSTEMROOT || '' }, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
    let out = '', err = '', done = false;
    const cap = (s) => (s.length > 8000 ? `${s.slice(0, 8000)}\n…[output trimmed]` : s);
    const finish = (extra) => {
      if (done) return; done = true; clearTimeout(t);
      try { fs.rmSync(cwd, { recursive: true, force: true }); } catch {}
      resolve({ ok: !extra && !err, stdout: cap(out), stderr: cap(err + (extra || '')) });
    };
    const t = setTimeout(() => { child.kill('SIGKILL'); finish(`\nStopped: took longer than ${timeoutMs / 1000} s`); }, timeoutMs);
    child.stdout.on('data', (d) => { out += d; if (out.length > 20000) child.kill('SIGKILL'); });
    child.stderr.on('data', (d) => { err += d; });
    child.on('error', (e) => finish(`\n${e.message}`));
    child.on('close', () => finish());
    child.stdin.end(PY_PRELUDE + String(code));
  });
}

// ───────────────────────── Safety: prompt-injection guard ─────────────────────────
// Web pages, documents and attached files are DATA. Text inside them that tries to give the AI orders
// ("ignore previous instructions", "you are now…") is removed before the model sees it.
const INJECTION = [
  /ignore (all |any )?(the )?(previous|prior|above|earlier) (instructions|prompts?|messages|rules)/i,
  /disregard (all |any )?(the )?(previous|prior|above|system) (instructions|prompts?|rules)/i,
  /forget (all |everything|your) (previous |prior )?(instructions|rules|training)/i,
  /you are now (a|an|in|the) /i,
  /(reveal|print|show|repeat|leak) (your|the) (system prompt|hidden instructions|instructions)/i,
  /new (system )?instructions?:/i,
  /\b(system|assistant)\s*:\s*you (must|will|should)/i,
  /<\/?(system|instructions?)>/i,
  /act as (an? )?(unfiltered|jailbroken|dan\b)/i,
  /do anything now/i,
];
export function guardInjection(text = '') {
  let found = 0;
  const cleaned = String(text).split(/(?<=[.!?\n])/).map((s) => {
    if (INJECTION.some((re) => re.test(s))) { found++; return ' [removed: text that tried to give the AI instructions] '; }
    return s;
  }).join('');
  return { cleaned, found };
}

// ───────────────────────── Reasoning modes ─────────────────────────
// Added to the LATEST user message (not the system prompt) so local models keep their prompt cache.
export const REASONING = {
  fast: 'Reply mode: FAST — answer directly and briefly. No long reasoning.',
  balanced: '',
  expert: 'Reply mode: EXPERT — first think inside <thinking>…</thinking>: restate the goal, break the problem into steps, '
    + 'solve each step, then double-check every fact, calculation and line of code. After </thinking>, give the final, complete answer.',
};

// Second pass for Expert mode: the model reviews its own draft.
export const verifyMessages = (question, answer) => [
  { role: 'system', content: 'You are a strict reviewer. You check answers for factual, logical, calculation and code errors. You never add new content.' },
  { role: 'user', content: `Question:\n${question.slice(0, 4000)}\n\nDraft answer:\n${answer.replace(/<thinking>[\s\S]*?<\/thinking>/gi, '').slice(0, 8000)}\n\n`
    + 'If the draft is correct and complete, reply with exactly: VERIFIED\n'
    + 'Otherwise reply "CORRECTION:" followed by a short list of the exact errors and their fixes. Be brief.' },
];

// ───────────────────────── Tool calling ─────────────────────────
// When does a message probably need a tool? (Normal chat skips the tool round = stays fast and streams.)
const NEED = [
  /\d\s*[-+*/^×÷%]\s*[\d(]/, /\b\d+\s*!/, /\b(sqrt|square root|cube root|factorial|log|sin|cos|tan)\b/i,
  /\b(calculate|calculation|compute|evaluate|solve|how much is|what is \d|percent(age)?|% of|emi|interest|average of|sum of|kanakku|convert \d)\b/i,
  /\b(run|execute|test|output of)\b[\s\S]{0,60}\b(code|program|script|function|snippet|javascript|js)\b/i,
  /\b(what('s| is)? (the )?(time|date|day) (now|today)|today'?s date|current (time|date)|days (between|until|left|since)|what day)\b/i,
  /\b(remember (that|this|my|i)|don'?t forget|keep in mind that|nyabagam)\b/i,
];
export const needsTools = (text = '') => NEED.some((re) => re.test(text));

export const TOOL_DEFS = {
  calculator: {
    type: 'function',
    function: {
      name: 'calculator',
      description: 'Exact maths. ALWAYS use this for any arithmetic instead of calculating yourself. Supports + - * / ^ mod % ! ( ), sqrt, cbrt, abs, ln, log(x[,base]), sin/cos/tan (radians; deg(x) converts degrees), round(x,d), floor, ceil, min, max, avg, sum, ncr, npr, pi, e. Example: "round(1200*(1+0.08)^5, 2)".',
      parameters: { type: 'object', properties: { expression: { type: 'string', description: 'The maths expression' } }, required: ['expression'] },
    },
  },
  get_datetime: {
    type: 'function',
    function: {
      name: 'get_datetime',
      description: 'Current date, time, weekday and timezone of the user. Use for anything about today, now, or counting days.',
      parameters: { type: 'object', properties: {} },
    },
  },
  date_diff: {
    type: 'function',
    function: {
      name: 'date_diff',
      description: 'Exact number of days (and weeks/months) between two dates. ALWAYS use this instead of counting days yourself. Dates as YYYY-MM-DD; leave "from" empty for today.',
      parameters: { type: 'object', properties: { from: { type: 'string', description: 'Start date YYYY-MM-DD (default today)' }, to: { type: 'string', description: 'End date YYYY-MM-DD' } }, required: ['to'] },
    },
  },
  run_javascript: {
    type: 'function',
    function: {
      name: 'run_javascript',
      description: 'Run JavaScript (Node.js) in a sandbox and get what it prints. Use console.log for output. No files, no network guarantees, 5 second limit. Use it to test code or compute things that need loops/data.',
      parameters: { type: 'object', properties: { code: { type: 'string', description: 'JavaScript source code' } }, required: ['code'] },
    },
  },
  // Coding tools for Learn (local only): look things up and check code instead of relying on memory
  docs_search: {
    type: 'function',
    function: {
      name: 'docs_search',
      description: 'Search the official React, MUI, Vite and Recharts docs for the exact API: component props, hook signatures, config options. Use it before using an API you are not 100% sure about.',
      parameters: { type: 'object', properties: { query: { type: 'string', description: 'What to look up, e.g. "MUI TextField helperText error props"' } }, required: ['query'] },
    },
  },
  mycode_search: {
    type: 'function',
    function: {
      name: 'mycode_search',
      description: "Search the user's own earlier projects for working code to reuse (their patterns, style and components).",
      parameters: { type: 'object', properties: { query: { type: 'string', description: 'What to look for, e.g. "sidebar drawer with menu groups"' } }, required: ['query'] },
    },
  },
  run_check: {
    type: 'function',
    function: {
      name: 'run_check',
      description: 'Check React/JS code before answering: syntax, missing imports, MUI component and icon names, keys in lists, hooks rules, TODO/"..." placeholders. Returns the exact problems or "OK".',
      parameters: { type: 'object', properties: { code: { type: 'string', description: 'The complete file (JSX/JS) to check' } }, required: ['code'] },
    },
  },
  run_python: {
    type: 'function',
    function: {
      name: 'run_python',
      description: 'Run Python 3 in a sandbox and get what it prints. Use print() for output. No network, 5 second limit. Use it for data analysis and exact calculations on data the user gave (e.g. an attached CSV pasted into the code).',
      parameters: { type: 'object', properties: { code: { type: 'string', description: 'Python source code' } }, required: ['code'] },
    },
  },
  web_search: {
    type: 'function',
    function: {
      name: 'web_search',
      description: 'Search the web for fresh or verifiable facts. Returns titles, snippets and URLs.',
      parameters: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] },
    },
  },
  save_memory: {
    type: 'function',
    function: {
      name: 'save_memory',
      description: 'Save a short fact or preference the user explicitly asked you to remember for future chats (e.g. "I prefer TypeScript").',
      parameters: { type: 'object', properties: { fact: { type: 'string', description: 'One short sentence, written about the user' } }, required: ['fact'] },
    },
  },
};

/**
 * Some local models (e.g. qwen2.5-coder) write a tool call as text instead of using the tool API:
 *   ```json {"name": "calculator", "arguments": {...}} ```   or   <tool_call>{...}</tool_call>
 * This turns such text back into real tool calls.
 */
export function parseTextToolCalls(content = '', names = []) {
  const calls = [];
  const blocks = [...String(content).matchAll(/<tool_call>\s*([\s\S]*?)\s*<\/tool_call>|```(?:json)?\s*(\{[\s\S]*?\})\s*```/g)].map((m) => m[1] || m[2]);
  if (!blocks.length && /^\s*\{[\s\S]*\}\s*$/.test(content)) blocks.push(content.trim());
  for (const b of blocks) {
    try {
      const j = JSON.parse(b);
      for (const o of Array.isArray(j) ? j : [j]) {
        if (o && names.includes(o.name)) calls.push({ id: `tx${calls.length}`, type: 'function', function: { name: o.name, arguments: o.arguments || o.parameters || {} } });
      }
    } catch {}
  }
  return calls;
}

/** Runs one tool call. ctx: { allowCode, search(query), onMemory(fact) } */
export async function runTool(name, args = {}, ctx = {}) {
  try {
    if (name === 'calculator') return { result: formatNumber(calculate(args.expression)) };
    if (name === 'get_datetime') {
      const d = new Date();
      return { result: d.toLocaleString('en-IN', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' }), iso: d.toISOString(), timezone: Intl.DateTimeFormat().resolvedOptions().timeZone };
    }
    if (name === 'date_diff') {
      const day = (s) => {
        if (!s) { const n = new Date(); return Date.UTC(n.getFullYear(), n.getMonth(), n.getDate()); }
        const m = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(String(s).trim());
        if (!m) throw new Error(`Use YYYY-MM-DD dates (got "${s}")`);
        return Date.UTC(+m[1], +m[2] - 1, +m[3]);
      };
      const a = day(args.from), b = day(args.to);
      const days = Math.round((b - a) / 864e5);
      const iso = (t) => new Date(t).toISOString().slice(0, 10);
      return { from: iso(a), to: iso(b), days, weeks: +(days / 7).toFixed(2), approx_months: +(days / 30.4375).toFixed(1),
        note: days >= 0 ? `${days} days from ${iso(a)} until ${iso(b)}` : `${iso(b)} was ${-days} days before ${iso(a)}` };
    }
    if (name === 'run_javascript') {
      if (!ctx.allowCode) return { error: 'Code execution is turned off. The user can enable it in the + menu → "Run code".' };
      const r = await runJavaScript(args.code);
      return r.ok ? { output: r.stdout || '(no output — use console.log)' } : { output: r.stdout, error: r.stderr.trim() };
    }
    if (name === 'docs_search' || name === 'mycode_search') {
      if (!ctx.kbSearch) return { error: 'Not available here.' };
      const hits = await ctx.kbSearch(name === 'docs_search' ? 'docs' : 'mycode', String(args.query || ''));
      return hits.length ? { results: hits.map((h) => ({ source: h.name, text: guardInjection(h.text).cleaned })) }
        : { results: [], note: name === 'docs_search' ? 'Nothing found. (The docs are loaded with: npm run load-docs)' : 'Nothing found. (Add projects with: npm run add-my-code <folder>)' };
    }
    if (name === 'run_check') {
      if (!ctx.check) return { error: 'Not available here.' };
      const errors = await ctx.check('```jsx\n' + String(args.code || '') + '\n```');
      return errors.length ? { problems: errors } : { result: 'OK — no problems found' };
    }
    if (name === 'run_python') {
      if (!ctx.allowCode) return { error: 'Code execution is turned off. The user can enable it in the + menu → "Run code".' };
      const r = await runPython(args.code);
      return r.ok ? { output: r.stdout || '(no output — use print)' } : { output: r.stdout, error: r.stderr.trim() };
    }
    if (name === 'web_search') {
      const found = await ctx.search(String(args.query || ''));
      return { results: (found.results || []).slice(0, 5).map((r) => ({ title: r.title, url: r.url, snippet: guardInjection((r.text || r.description || '').slice(0, 600)).cleaned })) };
    }
    if (name === 'save_memory') {
      const fact = String(args.fact || '').trim().slice(0, 300);
      if (!fact) return { error: 'Nothing to save' };
      ctx.onMemory?.(fact);
      return { result: 'Saved to long-term memory.' };
    }
    return { error: `Unknown tool ${name}` };
  } catch (e) {
    return { error: e.message };
  }
}
