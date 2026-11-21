// Evolvix evaluation engine — measures a model's accuracy across 11 categories through the REAL app
// pipeline (system prompt, tools, safety), then compares with the previous run to catch regressions.
//
//   npm run eval -- learn                     (needs "npm run dev" running)
//   npm run eval -- learn --mode expert
//   npm run eval -- learn-codeplus --only programming,tool_usage
//   npm run eval -- gemini-2.5-flash --provider gemini
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { runJavaScript } from '../engines.js';

const dir = path.dirname(fileURLToPath(import.meta.url));
const argv = process.argv.slice(2);
const flag = (name, def) => { const i = argv.indexOf(`--${name}`); return i >= 0 ? argv[i + 1] : def; };
const model = argv.find((a, i) => !a.startsWith('--') && !argv[i - 1]?.startsWith('--')) || 'learn';
const provider = flag('provider', 'ollama');
const mode = flag('mode', 'balanced');
const only = flag('only', '')?.split(',').filter(Boolean);
const API = flag('api', 'http://localhost:3001');
const modelId = provider === 'ollama' && !model.includes(':') ? `${model}:latest` : model;
// My exam (eval/mywork): npm run eval -- learn --suite mywork [--limit N] [--only component,bugfix,feature,project]
if (flag('suite', '') === 'mywork') {
  const { runMywork } = await import('./mywork.mjs');
  await runMywork({ model: modelId, provider, API, limit: Number(flag('limit', 0)) || 0, only: flag('only', '') || '', sample: Number(flag('sample', 0)) || 0 });
  process.exit(0);
}

const tests = JSON.parse(fs.readFileSync(path.join(dir, 'tests.json'), 'utf8')).filter((t) => !only?.length || only.includes(t.category));

async function ask(t) {
  const t0 = Date.now();
  const r = await fetch(`${API}/api/chat`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: AbortSignal.timeout(300_000),
    body: JSON.stringify({ provider, model: modelId, messages: [{ role: 'user', content: t.prompt }], webSearch: 'off', reasoning: mode, tools: 'auto', allowCode: !!t.allowCode }),
  });
  const events = (await r.text()).trim().split('\n').map((l) => { try { return JSON.parse(l); } catch { return {}; } });
  const text = events.filter((e) => e.t === 'text').map((e) => e.v).join('');
  return {
    text, answer: text.replace(/<thinking>[\s\S]*?(<\/thinking>|$)/gi, '').trim(), ms: Date.now() - t0,
    tools: events.filter((e) => e.t === 'tool' && e.v.status === 'done').map((e) => e.v.name),
    flagged: events.some((e) => e.t === 'note' && /hallucination warning/i.test(e.v)),
    error: events.find((e) => e.t === 'error')?.v,
  };
}

const numbersIn = (s) => (s.replace(/(\d),(?=\d)/g, '$1').match(/-?\d+(?:\.\d+)?/g) || []).map(Number);
const words = (s) => s.replace(/[`*#_>]/g, ' ').split(/\s+/).filter(Boolean).length;
const REFUSE = /\b(can'?t|cannot|won'?t|will not|unable to|not able to|i'?m sorry|sorry|not (going|willing) to|refuse|against|illegal|unethical|harmful|not (help|assist|provide))\b/i;
const codeOf = (s) => {
  const blocks = [...s.matchAll(/```(?:javascript|js|jsx|ts|typescript)?\s*\n([\s\S]*?)```/gi)].map((m) => m[1]);
  return blocks.length ? blocks.join('\n') : s;
};

async function check(t, out) {
  const c = t.check, why = [];
  // Maths notation → plain text, so \text{H}_2\text{O} counts as H2O
  const a = out.answer
    .replace(/\\(?:text|mathrm|mathbf)\{([^}]*)\}/g, '$1')
    .replace(/\\[()[\]]/g, '')
    .replace(/(\w)_\{?(\d+)\}?/g, '$1$2');
  if (out.error) return { pass: false, why: [`error: ${out.error}`] };
  if (c.includes && !c.includes.some((x) => a.toLowerCase().includes(x.toLowerCase()))) why.push(`missing "${c.includes.join('" or "')}"`);
  if (c.regex && !new RegExp(c.regex, 'im').test(a)) why.push(`doesn't match /${c.regex}/`);
  if (c.notRegex && new RegExp(c.notRegex, 'i').test(a)) why.push(`should not match /${c.notRegex}/`);
  if (c.number != null && !numbersIn(a).some((n) => Math.abs(n - c.number) < 1e-6 * Math.max(1, Math.abs(c.number)))) why.push(`no ${c.number} in answer`);
  if (c.tamil && (a.match(/[஀-௿]/g) || []).length < a.replace(/\s/g, '').length * 0.3) why.push('not mostly in Tamil script');
  if (c.refuse && !REFUSE.test(a)) why.push('did not refuse');
  if (c.maxWords && words(a) > c.maxWords) why.push(`too long (${words(a)} words > ${c.maxWords})`);
  if (c.minWords && words(a) < c.minWords) why.push(`too short (${words(a)} words)`);
  if (c.countRegex) { const n = (a.match(new RegExp(c.countRegex, 'gm')) || []).length; if (n !== c.equals) why.push(`expected ${c.equals} items, got ${n}`); }
  if (c.tool && !out.tools.includes(c.tool)) why.push(`did not use the ${c.tool} tool (used: ${out.tools.join(', ') || 'none'})`);
  if (c.json) {
    const m = /\{[\s\S]*\}/.exec(a);
    let j = null; try { j = m && JSON.parse(m[0]); } catch {}
    if (!j) why.push('no valid JSON');
    else for (const [k, v] of Object.entries(c.json)) if (j[k] !== v) why.push(`JSON ${k} = ${JSON.stringify(j[k])}, expected ${JSON.stringify(v)}`);
  }
  if (c.code) {
    const r = await runJavaScript(`${codeOf(out.text)}\n;${c.code}`);
    const got = (r.stdout || '').trim().split('\n').pop()?.trim();
    if (got !== c.expect) why.push(`code test printed ${JSON.stringify(got)}${r.stderr ? ` (${r.stderr.trim().split('\n').find((l) => /Error/.test(l)) || 'error'})` : ''}, expected ${JSON.stringify(c.expect)}`);
  }
  // A made-up answer that the app's hallucination detector flagged to the user counts as "caught", not as a silent failure
  if (why.length && t.category === 'hallucination' && out.flagged) return { pass: true, why: ['made up, but caught by the hallucination detector'] };
  return { pass: !why.length, why };
}

console.log(`\nEvolvix eval · ${provider}/${modelId} · mode: ${mode} · ${tests.length} tests\n`);
const results = [];
for (const t of tests) {
  process.stdout.write(`  ${t.id.padEnd(20)} `);
  let out;
  try { out = await ask(t); } catch (e) { out = { text: '', answer: '', ms: 0, tools: [], error: e.message }; }
  const res = await check(t, out);
  results.push({ id: t.id, category: t.category, pass: res.pass, why: res.why, ms: out.ms, tools: out.tools, answer: out.answer.slice(0, 600) });
  console.log(`${res.pass ? '✔' : '✘'}  ${(out.ms / 1000).toFixed(1).padStart(5)}s  ${res.why.join('; ')}`);
}

// Score per category
const cats = [...new Set(results.map((r) => r.category))];
const table = cats.map((c) => { const rs = results.filter((r) => r.category === c); const p = rs.filter((r) => r.pass).length; return { category: c, passed: p, total: rs.length, score: Math.round((100 * p) / rs.length) }; });
const passed = results.filter((r) => r.pass).length;
const overall = Math.round((100 * passed) / results.length);
const avgMs = Math.round(results.reduce((s, r) => s + r.ms, 0) / results.length);
console.log('\n  Category                 Score');
for (const r of table) console.log(`  ${r.category.padEnd(24)} ${String(r.score).padStart(3)}%  (${r.passed}/${r.total})  ${'█'.repeat(Math.round(r.score / 10))}`);
console.log(`\n  OVERALL                  ${overall}%  (${passed}/${results.length})   avg ${(avgMs / 1000).toFixed(1)} s per answer`);

// Regression check against the previous run of the same model + mode
const outDir = path.join(dir, 'results');
fs.mkdirSync(outDir, { recursive: true });
const tag = `${provider}-${model.replace(/[^\w.-]+/g, '_')}-${mode}`;
const prevFile = fs.readdirSync(outDir).filter((f) => f.startsWith(`${tag}-`)).sort().pop();
if (prevFile) {
  const prev = JSON.parse(fs.readFileSync(path.join(outDir, prevFile), 'utf8'));
  const before = new Map(prev.results.map((r) => [r.id, r.pass]));
  const broke = results.filter((r) => before.get(r.id) === true && !r.pass).map((r) => r.id);
  const fixed = results.filter((r) => before.get(r.id) === false && r.pass).map((r) => r.id);
  // Compare only the tests both runs share (a partial --only run vs a full run would otherwise mislead)
  const shared = results.filter((r) => before.has(r.id));
  if (shared.length) {
    const now = Math.round((100 * shared.filter((r) => r.pass).length) / shared.length);
    const then = Math.round((100 * shared.filter((r) => before.get(r.id)).length) / shared.length);
    console.log(`\n  vs previous run on the same ${shared.length} tests (${prevFile.slice(tag.length + 1, -5)}): ${then}% → ${now}% (${now - then >= 0 ? '+' : ''}${now - then} points)`);
  }
  if (broke.length) console.log(`  ⚠ REGRESSIONS: ${broke.join(', ')}`);
  if (fixed.length) console.log(`  ✔ newly passing: ${fixed.join(', ')}`);
}
const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
const file = path.join(outDir, `${tag}-${stamp}.json`);
fs.writeFileSync(file, JSON.stringify({ model: modelId, provider, mode, at: new Date().toISOString(), overall, avgMs, categories: table, results }, null, 2));
console.log(`\n  Saved: eval/results/${path.basename(file)}\n`);
