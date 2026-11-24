// Free, legal, HUMAN-WRITTEN code datasets → training format (no AI-generated datasets).
//   npm run get-datasets                    (all sources; resumable)
//   npm run get-datasets -- --limit 50      (at most 50 new rows per source — a quick test)
//   npm run get-datasets -- --only commitpackft|mui|recharts
// 1) bigcode/commitpackft (javascript + typescript): real GitHub commits whose message says fix/bug/error… on React/MUI/JSX code
//    → data/training/commitpack.jsonl (max 3,000 rows). Streamed straight from Hugging Face over HTTP — no Python needed.
// 2) mui/material-ui templates + component demos (MIT) → data/training/mui.jsonl
// 3) recharts/recharts demo + storybook examples (MIT) → data/training/recharts.jsonl
// Every row keeps repo + license (+ path). Rows/files containing api_key / secret / password / token are skipped.
import { appendJsonl, readJsonl, hash, state, PERMISSIVE_IDS, hasGit } from './lib.mjs';
import { loadSources, processRepo } from './opencode.mjs';

const argv = process.argv.slice(2);
const flag = (n, d) => { const i = argv.indexOf(`--${n}`); return i >= 0 ? argv[i + 1] : d; };
const LIMIT = Number(flag('limit', 0)) || 0;
const ONLY = flag('only', '');
const SECRET_WORDS = /api_key|secret|password|token/i;
const AI_MADE = /generated (by|with|using) (gpt|chatgpt|claude|gemini|openai|an? (ai|llm|large language model|language model))|synthetic(ally)? (generated )?by (gpt|an? llm)|distilled from (gpt|claude|gemini)/i;
const table = [];

// ---------- 1) commitpackft ----------
async function commitpack() {
  const DS = 'bigcode/commitpackft';
  const card = await (await fetch(`https://huggingface.co/datasets/${DS}/raw/main/README.md`, { signal: AbortSignal.timeout(30_000) })).text().catch(() => '');
  if (!card) return table.push(['commitpackft', 0, '?', 'could not read the dataset card']);
  if (AI_MADE.test(card)) return table.push(['commitpackft', 0, '-', 'dataset card says it was AI-generated → skipped']);
  const MAX = 8000;
  const out = 'commitpack.jsonl';
  const seen = new Set(readJsonl(out).map((r) => hash(r.messages[1].content)));
  let total = seen.size, saved = 0;
  const { s, save } = state('commitpackft');
  for (const lang of ['javascript', 'typescript', 'python']) {
    const fence = lang === 'python' ? 'python' : lang === 'typescript' ? 'tsx' : 'jsx';
    const url = `https://huggingface.co/datasets/${DS}/resolve/main/data/${lang}/data.jsonl`;
    let offset = s[lang] || 0;
    if (s[`${lang}_done`]) continue;
    process.stdout.write(`▶ commitpackft/${lang} from byte ${offset}\n`);
    const r = await fetch(url, { headers: offset ? { Range: `bytes=${offset}-` } : {}, signal: AbortSignal.timeout(30 * 60_000) });
    if (!r.ok && r.status !== 206) { table.push([`commitpackft/${lang}`, 0, '?', `HTTP ${r.status}`]); continue; }
    const dec = new TextDecoder();
    let buf = '', scanned = 0, stop = false;
    for await (const chunk of r.body) {
      buf += dec.decode(chunk, { stream: true });
      let nl;
      while ((nl = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, nl); buf = buf.slice(nl + 1);
        offset += Buffer.byteLength(line, 'utf8') + 1; scanned++;
        let row; try { row = JSON.parse(line); } catch { continue; }
        const oldC = row.old_contents || '', newC = row.new_contents || '';
        if (!/fix|bug|error|crash|broken|wrong|issue|refactor|handle|validate|check/i.test(row.subject || '')) continue;
        if (!oldC.trim() || !newC.trim() || oldC.length < 40 || oldC.length > 6000 || newC.length > 6000 || oldC === newC) continue;
        if (!PERMISSIVE_IDS.test(String(row.license || ''))) continue;
        if (SECRET_WORDS.test(oldC + newC)) continue;
        const assistant = `${row.subject} — fixed:\n\n\`\`\`${fence}\n${newC.trimEnd()}\n\`\`\``;
        const h = hash(assistant);
        if (seen.has(h)) continue;
        seen.add(h);
        appendJsonl(out, { messages: [{ role: 'user', content: `Fix this bug: ${row.subject}\n\n\`\`\`${fence}\n${oldC.trimEnd()}\n\`\`\`` }, { role: 'assistant', content: assistant }],
          source: 'commitpackft', repo: row.repos, license: row.license, path: row.new_file, commit: row.commit });
        saved++; total++;
        if (saved % 25 === 0) process.stdout.write(`   ${lang}: scanned ${scanned} · saved ${saved}\n`);
        if (total >= MAX || (LIMIT && saved >= LIMIT)) { stop = true; break; }
      }
      if (stop) break;
      if (scanned % 5000 === 0) { s[lang] = offset; save(); }
    }
    s[lang] = offset; if (!stop) s[`${lang}_done`] = true; save();
    try { r.body.cancel?.(); } catch {}
    if (total >= MAX || (LIMIT && saved >= LIMIT)) break;
  }
  table.push(['commitpackft', saved, 'per row: MIT/Apache/BSD/ISC', `${total} in commitpack.jsonl`]);
}

// ---------- 2) + 3) MUI and Recharts (same licence-checked repo pipeline as fetch-open-code) ----------
async function repo(name, repoId) {
  if (!hasGit()) return table.push([name, 0, '?', 'git is not installed']);
  const src = loadSources().find((x) => x.repo === repoId);
  const r = await processRepo(src, { limit: LIMIT });
  table.push([name, r.saved, r.license, r.skipped ? `skipped: ${r.skipped}` : `→ ${src.out}`]);
}

if (!ONLY || ONLY === 'commitpackft') await commitpack();
if (!ONLY || ONLY === 'mui') await repo('mui', 'mui/material-ui');
if (!ONLY || ONLY === 'recharts') await repo('recharts', 'recharts/recharts');
console.log('\n  Source          Rows saved  Licence                        Note');
for (const [n, c, l, note] of table) console.log(`  ${n.padEnd(15)} ${String(c).padStart(10)}  ${String(l).padEnd(30)} ${note || ''}`);
console.log('\n  Next: npm run clean-data');
