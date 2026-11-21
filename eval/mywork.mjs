// "My exam": 40 tasks from my real stack, scored automatically 0–100 per task:
//   builds ✓ (25) · renders ✓ (25) · code checks ✓ (25) · requested features present (25, one /no_think check by local Learn)
//   npm run eval -- learn --suite mywork            (all 40; needs npm run dev)
//   npm run eval -- learn --suite mywork --limit 5  --only component,bugfix
// History: eval/results/mywork-history.json (trend of the last 5 runs; warns if the score drops > 2 points).
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { checkProject } from '../buildcheck.js';
import { checkCode, codeBlocks } from '../codecheck.js';
import { parseFiles, repairProject } from '../src/lib/project.js';

const dir = path.dirname(fileURLToPath(import.meta.url));
const OLLAMA = (process.env.OLLAMA_URL || 'http://localhost:11434/v1').replace(/\/v1\/?$/, '');
const noThink = (t) => String(t || '').replace(/<think(?:ing)?>[\s\S]*?(?:<\/think(?:ing)?>|$)/gi, '').trim();

async function ask(API, provider, model, prompt) {
  const t0 = Date.now();
  const r = await fetch(`${API}/api/chat`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: AbortSignal.timeout(30 * 60_000),
    body: JSON.stringify({ provider, model, messages: [{ role: 'user', content: prompt }], webSearch: 'off', reasoning: 'balanced', tools: 'auto', regenerate: true }),
  });
  let text = '', verify = null, speed = null, buf = '';
  const dec = new TextDecoder();
  for await (const chunk of r.body) {
    buf += dec.decode(chunk, { stream: true });
    const lines = buf.split('\n'); buf = lines.pop();
    for (const l of lines) {
      let e; try { e = JSON.parse(l); } catch { continue; }
      if (e.t === 'text') text += e.v; else if (e.t === 'verify' && e.v?.status !== 'checking') verify = e.v; else if (e.t === 'speed') speed = e.v;
    }
  }
  return { text: noThink(text), verify, ttft: speed?.ttft ?? null, secs: (Date.now() - t0) / 1000 };
}

// The final code of a single-file answer (after a quick fix, the fixed version) wrapped in a tiny Vite app
function wrapAsProject(text) {
  const part = text.includes('**🔧 Quick fix**') ? text.slice(text.lastIndexOf('**🔧 Quick fix**')) : text;
  const blocks = codeBlocks(part).filter((b) => /^(jsx?|tsx?|javascript|react|)$/.test(b.lang) && /return\s*\(?\s*</.test(b.code));
  if (!blocks.length) return null;
  let code = (blocks.find((b) => /export\s+default/.test(b.code)) || blocks.sort((a, b) => b.code.length - a.code.length)[0]).code;
  if (!/export\s+default/.test(code)) {
    const comp = [...code.matchAll(/(?:function|const)\s+([A-Z]\w*)/g)].map((m) => m[1]).pop();
    if (!comp) return null;
    code += `\nexport default ${comp};\n`;
  }
  if (!/from\s+['"]react['"]/.test(code) && /\buse[A-Z]\w*\(/.test(code)) code = `import { useState, useEffect, useMemo, useRef } from 'react';\n${code}`;
  return [
    { path: 'package.json', content: JSON.stringify({ name: 'exam', private: true, type: 'module', scripts: { dev: 'vite' } }) },
    { path: 'index.html', content: '<!doctype html><html><body><div id="root"></div><script type="module" src="/src/main.jsx"></script></body></html>' },
    { path: 'src/main.jsx', content: "import React from 'react';\nimport ReactDOM from 'react-dom/client';\nimport App from './App';\nReactDOM.createRoot(document.getElementById('root')).render(<App />);\n" },
    { path: 'src/App.jsx', content: code },
  ];
}

async function featureScore(features, text) {
  try {
    const r = await fetch(`${OLLAMA}/api/chat`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: AbortSignal.timeout(120_000),
      body: JSON.stringify({ model: 'learn', stream: false, think: false, options: { temperature: 0, num_predict: 40 }, messages: [{ role: 'user', content:
        `Requested features:\n${features.map((f, i) => `${i + 1}. ${f}`).join('\n')}\n\nThe answer:\n${text.slice(0, 14000)}\n\nWhich feature numbers are MISSING or clearly not implemented in the code? Reply ONLY with the numbers separated by commas, or NONE. /no_think` }] }),
    });
    const out = noThink((await r.json()).message?.content);
    if (/\bnone\b/i.test(out)) return 1;
    const missing = new Set((out.match(/\d+/g) || []).map(Number).filter((n) => n >= 1 && n <= features.length));
    return (features.length - missing.size) / features.length;
  } catch { return 0; }
}

export async function runMywork({ model, provider = 'ollama', API = 'http://localhost:3001', limit = 0, only = '', sample = 0 }) {
  const all = JSON.parse(fs.readFileSync(path.join(dir, 'mywork', 'tasks.json'), 'utf8')).tasks;
  const cats = only ? only.split(',') : null;
  let tasks = all.filter((t) => !cats || cats.includes(t.cat));
  if (sample) tasks = [...new Set(tasks.map((t) => t.cat))].flatMap((c) => tasks.filter((t) => t.cat === c).slice(0, sample)); // N per category (quick check)
  tasks = tasks.slice(0, limit || undefined);
  console.log(`\nMy exam · ${model} · ${tasks.length} task(s)\n`);
  const results = [];
  for (const t of tasks) {
    let r;
    try { r = await ask(API, provider, model, t.prompt); } catch (e) { r = { text: '', verify: null, ttft: null, secs: 0, err: e.message }; }
    let build = 0, render = 0, checks = 0;
    if (t.cat === 'project') {
      const files = parseFiles(r.text);
      if (r.verify?.status === 'ok') { build = 25; render = 25; }
      else if (files.length) {
        const errs = await checkProject(repairProject(files)).catch((e) => [`Build error: ${e.message}`]);
        build = errs.some((e) => /^Build error/.test(e)) ? 0 : 25;
        render = errs.length ? 0 : 25;
      }
      const errs = files.length ? await checkCode(files.map((f) => `<file path="${f.path}">${f.content}</file>`).join('\n')).catch(() => ['x']) : ['no files'];
      checks = errs.length ? 0 : 25;
    } else {
      const proj = wrapAsProject(r.text);
      if (proj) {
        const errs = await checkProject(proj).catch((e) => [`Build error: ${e.message}`]);
        build = errs.some((e) => /^Build error/.test(e)) ? 0 : 25;
        render = errs.length ? 0 : 25;
        checks = (await checkCode('```jsx\n' + proj[3].content + '\n```').catch(() => ['x'])).length ? 0 : 25;
      }
    }
    const feat = r.text ? Math.round(25 * await featureScore(t.features, r.text)) : 0;
    const score = build + render + checks + feat;
    results.push({ id: t.id, cat: t.cat, score, build, render, checks, features: feat, ttft: r.ttft, secs: Math.round(r.secs), err: r.err });
    console.log(`  ${t.id.padEnd(4)} ${t.cat.padEnd(9)} ${String(score).padStart(3)}/100  build ${build ? '✓' : '✗'} render ${render ? '✓' : '✗'} checks ${checks ? '✓' : '✗'} features ${feat}/25  ${r.ttft ?? '-'}s first token · ${Math.round(r.secs)}s${r.err ? `  (${r.err})` : ''}`);
  }
  const avg = (xs) => (xs.length ? Math.round(xs.reduce((a, b) => a + b, 0) / xs.length) : 0);
  const byCat = Object.fromEntries([...new Set(results.map((x) => x.cat))].map((c) => [c, avg(results.filter((x) => x.cat === c).map((x) => x.score))]));
  const total = avg(results.map((x) => x.score));
  const ttfts = results.map((x) => x.ttft).filter((x) => x != null);
  const run = { at: new Date().toISOString(), model, tasks: results.length, only: `${only || 'all'}${sample ? ` sample ${sample}` : ''}`, score: total, byCat,
    avgTtft: ttfts.length ? +(ttfts.reduce((a, b) => a + b, 0) / ttfts.length).toFixed(1) : null, avgSecs: avg(results.map((x) => x.secs)), results };
  console.log('\n  Category      Score');
  for (const [c, s] of Object.entries(byCat)) console.log(`  ${c.padEnd(12)}  ${String(s).padStart(3)}  ${'█'.repeat(Math.round(s / 10))}`);
  console.log(`\n  MY EXAM SCORE  ${total}/100   avg first token ${run.avgTtft ?? '-'} s · avg ${run.avgSecs} s per task`);

  const histFile = path.join(dir, 'results', 'mywork-history.json');
  fs.mkdirSync(path.dirname(histFile), { recursive: true });
  const hist = fs.existsSync(histFile) ? JSON.parse(fs.readFileSync(histFile, 'utf8')) : [];
  const same = hist.filter((h) => h.model === model && h.only === run.only && h.tasks === run.tasks);
  const prev = same[same.length - 1];
  hist.push(run);
  fs.writeFileSync(histFile, JSON.stringify(hist, null, 1));
  const trend = [...same.slice(-4), run].map((h) => `${h.at.slice(5, 16).replace('T', ' ')} ${h.score}`).join('  →  ');
  console.log(`  Trend (last ${Math.min(5, same.length + 1)}): ${trend}`);
  if (prev && run.score < prev.score - 2) console.log(`\n  ⚠️  The score dropped ${prev.score - run.score} points since the last run (${prev.score} → ${run.score}). Consider reverting your last change.`);
  return run;
}
