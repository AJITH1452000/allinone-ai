// Learn from permissively licensed open-source React / MUI / Recharts / Vite code (training/sources.json).
//   npm run fetch-open-code                 (all sources; resumable — run again to continue)
//   npm run fetch-open-code -- --limit 20   (at most 20 new files per repo)
//   npm run fetch-open-code -- --only recharts/recharts
// → data/training/{mui,recharts,opencode}.jsonl (request by Learn → real file), fixes.jsonl (bug-fix commits),
//   and the "docs" knowledge base (reference code). Repos without an MIT / Apache-2.0 / BSD / ISC licence are skipped.
import { hasGit } from './lib.mjs';
import { loadSources, processRepo, fixesFromHistory } from './opencode.mjs';

const argv = process.argv.slice(2);
const flag = (n, d) => { const i = argv.indexOf(`--${n}`); return i >= 0 ? argv[i + 1] : d; };
const limit = Number(flag('limit', 0)) || 0;
const only = flag('only', '');
if (!hasGit()) { console.error('git is needed (https://git-scm.com/download/win).'); process.exit(1); }

const rows = [];
for (const src of loadSources().filter((x) => !only || x.repo === only)) {
  const r = await processRepo(src, { limit });
  const f = src.fixes && r.license && r.saved >= 0 && !r.skipped ? fixesFromHistory(src) : { fixes: 0 };
  rows.push({ ...r, fixes: f.fixes });
}
console.log('\n  Repo                                         Licence      Samples  Fix pairs');
for (const r of rows) console.log(`  ${r.repo.padEnd(44)} ${String(r.license).padEnd(12)} ${String(r.saved).padStart(7)}  ${String(r.fixes).padStart(9)}${r.skipped ? `   (skipped: ${r.skipped})` : ''}`);
console.log(`\n  Total: ${rows.reduce((a, r) => a + r.saved, 0)} samples, ${rows.reduce((a, r) => a + r.fixes, 0)} bug-fix pairs. Next: npm run clean-data`);
