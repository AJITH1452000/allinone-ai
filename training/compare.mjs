// Exam both models on "my exam" and make learn-codeplus the default ONLY if it scores higher than learn.
//   npm run compare                 (all 40 tasks — takes a while; needs npm run dev)
//   npm run compare -- --limit 10   (a quicker check on the first 10 tasks)
// Writes data/default-model.json → the app picks that model by default (Learn Code+ or Learn).
import fs from 'fs';
import path from 'path';
import { ROOT } from './lib.mjs';
import { runMywork } from '../eval/mywork.mjs';

const argv = process.argv.slice(2);
const flag = (n, d) => { const i = argv.indexOf(`--${n}`); return i >= 0 ? argv[i + 1] : d; };
const limit = Number(flag('limit', 0)) || 0;
const API = flag('api', 'http://localhost:3001');
const family = JSON.parse(fs.readFileSync(path.join(ROOT, 'models', 'family.json'), 'utf8')).id;
try { await fetch(`${API}/api/auth`, { signal: AbortSignal.timeout(5000) }); } catch { console.error('Start the app first (npm run dev), then: npm run compare'); process.exit(1); }

const base = await runMywork({ model: `${family}:latest`, API, limit });
const plus = await runMywork({ model: `${family}-codeplus:latest`, API, limit });
const winner = plus.score > base.score ? `${family}-codeplus` : family;
fs.mkdirSync(path.join(ROOT, 'data'), { recursive: true });
fs.writeFileSync(path.join(ROOT, 'data', 'default-model.json'), JSON.stringify({ model: winner, scores: { [family]: base.score, [`${family}-codeplus`]: plus.score }, at: new Date().toISOString() }, null, 1));
console.log(`\n  ${family}: ${base.score}/100 · ${family}-codeplus: ${plus.score}/100`);
console.log(winner === family
  ? `  → ${family} stays the default (Learn Code+ did not score higher). Train on more data and try again.`
  : `  → ${family}-codeplus is now the default model. Press reload ↻ in the model picker.`);
