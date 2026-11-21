// Self-practice: local Learn works through practice tasks; only VERIFIED answers become training data.
//   npm run dev                          (keep the app running — it builds and checks the answers)
//   npm run self-train                   (everything; Ctrl+C any time — run again to continue where it stopped)
//   npm run self-train -- --limit 20 --only small      --only projects|small|bad, --generate 400, --model learn
// Tasks: training/tasks.json + generated variations (never the 40 "my exam" tasks) + every prompt you marked 👎 (bad.jsonl).
// 2 attempts per task: verified → lesson · one passes, one fails → preference pair · both pass → the shorter one is kept.
// Projects are checked by the build agent (real Vite build + render); code answers by the instant code checks;
// answers without code (explanations) by a placeholder/length check. Only your local model — never an online AI.
import fs from 'fs';
import path from 'path';
import { ROOT, readJsonl, appendJsonl, countLines, noThink, state } from './lib.mjs';

const argv = process.argv.slice(2);
const flag = (n, d) => { const i = argv.indexOf(`--${n}`); return i < 0 ? d : (argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : true); };
const API = flag('api', 'http://localhost:3001');
const MODEL = flag('model', 'learn');
const ONLY = flag('only', '');
const LIMIT = Number(flag('limit', 0)) || Infinity;
const GENERATE = Number(flag('generate', 400));
const ATTEMPTS = 2;

// ---------- tasks ----------
const norm = (t) => String(t).toLowerCase().replace(/\s+/g, ' ').trim();
const exam = JSON.parse(fs.readFileSync(path.join(ROOT, 'eval', 'mywork', 'tasks.json'), 'utf8')).tasks.map((t) => norm(t.prompt).slice(0, 70));
const isExam = (p) => exam.some((e) => norm(p).includes(e));
const base = JSON.parse(fs.readFileSync(path.join(ROOT, 'training', 'tasks.json'), 'utf8'));
// Generated variations: domain × layout × features (deterministic, so resume works)
const DOMAINS = ['gym members', 'library books', 'hotel rooms', 'school marks', 'pharmacy stock', 'bike rentals', 'food orders', 'job applicants', 'event tickets',
  'crop prices', 'bus routes', 'clinic patients', 'freelance invoices', 'plant care', 'movie reviews', 'warehouse parcels', 'tuition fees', 'car service history'];
const LAYOUTS = ['data table', 'card grid', 'dashboard page', 'form with validation', 'list with filters', 'settings page', 'detail page with tabs', 'multi-step wizard'];
const EXTRAS = ['search and sort', 'pagination', 'add / edit / delete with a dialog', 'a Recharts bar chart', 'a Recharts pie chart', 'a dark mode toggle',
  'saving to localStorage', 'status chips with a filter', 'a summary row of KPI cards', 'a loading state and an error Alert'];
const generated = [];
for (let i = 0; generated.length < GENERATE; i++) {
  const d = DOMAINS[i % DOMAINS.length], l = LAYOUTS[(i * 7) % LAYOUTS.length], a = EXTRAS[(i * 3) % EXTRAS.length], b = EXTRAS[(i * 5 + 1) % EXTRAS.length];
  if (a === b) continue;
  generated.push(i % 5 === 4
    ? { kind: 'project', prompt: `Build a complete React + Vite + MUI project: a ${d} app — a ${l} with ${a}, ${b} and realistic mock data.` }
    : { kind: 'small', prompt: `Write a React component (MUI) for ${d}: a ${l} with ${a} and ${b}. Use realistic mock data and one default export.` });
  if (i > GENERATE * 4) break;
}
const bad = readJsonl('bad.jsonl').map((b) => ({ kind: 'bad', prompt: b.prompt, context: b.context || [] }));
const { s, save } = state('selftrain');
s.done ||= {};
const todo = [
  ...(ONLY && ONLY !== 'bad' ? [] : bad),
  ...(ONLY && ONLY !== 'projects' ? [] : base.projects.map((t) => ({ kind: 'project', prompt: `Build a complete React + Vite + MUI project: ${t}` }))),
  ...(ONLY && ONLY !== 'small' ? [] : base.small.map((t) => ({ kind: 'small', prompt: t }))),
  ...generated.filter((g) => !ONLY || (ONLY === 'projects' ? g.kind === 'project' : ONLY === 'small' ? g.kind === 'small' : false)),
].filter((t) => !isExam(t.prompt) && !s.done[t.prompt]).slice(0, LIMIT);

// ---------- one attempt through the real app ----------
async function attempt(t) {
  const project = t.kind === 'project' || /^Build a complete React \+ Vite/.test(t.prompt);
  const r = await fetch(`${API}/api/chat`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: AbortSignal.timeout(30 * 60_000),
    body: JSON.stringify({ provider: 'ollama', model: MODEL.includes(':') ? MODEL : `${MODEL}:latest`, reasoning: 'balanced', webSearch: 'off', tools: 'auto',
      regenerate: true, noSave: !project, messages: [...(t.context || []), { role: 'user', content: t.prompt }] }),
  });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  let text = '', verify = null, buf = '';
  const dec = new TextDecoder();
  for await (const chunk of r.body) {
    buf += dec.decode(chunk, { stream: true });
    const lines = buf.split('\n'); buf = lines.pop();
    for (const l of lines) {
      let e; try { e = JSON.parse(l); } catch { continue; }
      if (e.t === 'text') text += e.v; else if (e.t === 'verify' && e.v?.status !== 'checking') verify = e.v; else if (e.t === 'error') throw new Error(e.v);
    }
  }
  text = noThink(text);
  let ok, why = '';
  if (project) { ok = verify?.status === 'ok'; why = ok ? '' : verify?.status === 'issues' ? 'still broken after the fixes' : 'no project was built'; }
  else if (verify) { ok = verify.status === 'ok' && verify.label === 'Checked ✓'; why = ok ? '' : verify.status === 'ok' ? 'needed a quick fix' : 'code check failed'; } // a clean first try only
  else { ok = !(/\bTODO\b|^\s*\.\.\.\s*$|rest of (the )?code|your code here/im.test(text)) && text.length >= 120; why = ok ? '' : 'too short or has placeholders'; }
  return { ok, why, text, project };
}

// ---------- run ----------
try { await fetch(`${API}/api/auth`, { signal: AbortSignal.timeout(5000) }); } catch { console.error('The app is not running. Start it first: npm run dev'); process.exit(1); }
const start = { lessons: countLines('lessons.jsonl'), pairs: countLines('pairs.jsonl') };
let verified = 0, tried = 0;
console.log(`Self-practice for ${MODEL}: ${todo.length} task(s) (${todo.filter((t) => t.kind === 'bad').length} from 👎). Ctrl+C to stop; run again to continue.\n`);
for (const [i, t] of todo.entries()) {
  const t0 = Date.now();
  const name = t.prompt.replace(/^Build a complete React \+ Vite \+ MUI project: /, '').split('\n')[0].slice(0, 60);
  tried++;
  const results = [];
  for (let a = 0; a < ATTEMPTS; a++) {
    const before = countLines('lessons.jsonl');
    try {
      const r = await attempt(t);
      if (r.project && r.ok) r.lesson = readJsonl('lessons.jsonl').slice(before).pop()?.messages?.at(-1)?.content; // the server saved the verified files
      results.push(r);
      if (r.project && r.ok) break; // projects: one verified version is enough (each try costs minutes)
    } catch (e) {
      if (/fetch failed|ECONNREFUSED/.test(e.message)) { console.error('\nThe app stopped. Start it again (npm run dev) and re-run self-train.'); process.exit(1); }
      results.push({ ok: false, why: e.message, text: '' });
    }
  }
  const pass = results.filter((r) => r.ok), fail = results.filter((r) => !r.ok && r.text);
  if (pass.length) {
    verified++;
    const best = pass.sort((x, y) => (x.lesson || x.text).length - (y.lesson || y.text).length)[0]; // both pass → the shorter one
    if (!best.project) appendJsonl('lessons.jsonl', { messages: [...(t.context || []), { role: 'user', content: t.prompt }, { role: 'assistant', content: best.text }], verified: true, source: t.kind === 'bad' ? 'self-train-bad' : 'self-train', model: MODEL, at: new Date().toISOString() });
    if (fail.length) appendJsonl('pairs.jsonl', { prompt: t.prompt, context: t.context || [], chosen: best.lesson || best.text, rejected: fail[0].text, source: 'self-train', model: MODEL, at: new Date().toISOString() });
  }
  s.done[t.prompt] = { ok: !!pass.length, tries: results.length, at: new Date().toISOString() };
  save();
  const kind = t.kind === 'bad' ? '👎 retry' : t.kind === 'project' ? 'project' : 'small  ';
  console.log(`[${i + 1}/${todo.length}] ${kind} ${pass.length ? '✔' : '✘'} ${String(Math.round((Date.now() - t0) / 1000)).padStart(4)}s  ${pass.length}/${results.length} passed  ${name}${pass.length ? '' : `  — ${results.map((r) => r.why).filter(Boolean)[0] || ''}`}`);
}
const now = { lessons: countLines('lessons.jsonl'), pairs: countLines('pairs.jsonl') };
console.log(`\nTried ${tried} · verified ${verified} · new lessons ${now.lessons - start.lessons} · new pairs ${now.pairs - start.pairs}`);
console.log(`Total: ${now.lessons} lessons, ${now.pairs} pairs (target before training: 1,000+ lessons, 300+ pairs). Next: npm run clean-data`);
