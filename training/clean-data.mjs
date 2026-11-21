// Merge every training source into ONE clean file for Kaggle: data/training/train.jsonl (+ train-pairs.jsonl).
//   npm run clean-data
// Sources: lessons (Learn's verified work + your 👍 / ✏️), mycode (your projects), mui / recharts / opencode (MIT etc.),
// fixes (bug-fix commits), commitpack (commitpackft). Never anything from online AIs.
// Steps: strip <think> + hidden app text → drop samples > 7,000 tokens → remove near-duplicates → ✏️ corrections count twice
// → enforce the mix: ≥ 70% React/MUI/Vite/Recharts, ≤ 15% general JS/CSS, ≤ 15% Tanglish/chat.
import fs from 'fs';
import path from 'path';
import { DATA, readJsonl, stripHidden, hash, mixOf } from './lib.mjs';

const SOURCES = ['lessons', 'mycode', 'mui', 'recharts', 'opencode', 'fixes', 'commitpack'];
const norm = (t) => String(t).toLowerCase().replace(/\s+/g, ' ').replace(/[^\w ]/g, '').slice(0, 2000);
const tokens = (t) => Math.ceil(t.length / 3.5);
let seed = 42;
const rand = () => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);
const shuffle = (a) => { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };

const seen = new Set();
const counts = {}, dropped = { long: 0, dup: 0, empty: 0 }, licences = {};
const rows = [];
for (const name of SOURCES) {
  for (const r of readJsonl(`${name}.jsonl`)) {
    const msgs = (r.messages || []).filter((m) => ['user', 'assistant'].includes(m.role)).map((m) => ({ role: m.role, content: stripHidden(m.content) }));
    if (msgs.length < 2 || msgs.some((m) => !m.content) || msgs[msgs.length - 1].role !== 'assistant') { dropped.empty++; continue; }
    if (tokens(msgs.map((m) => m.content).join('\n')) > 7000) { dropped.long++; continue; }
    const key = hash(norm(msgs.find((m) => m.role === 'user').content) + '|' + norm(msgs[msgs.length - 1].content));
    if (seen.has(key)) { dropped.dup++; continue; }
    seen.add(key);
    const src = r.source || name;
    const sample = { messages: msgs, verified: true, source: src, ...(r.repo ? { repo: r.repo, license: r.license } : {}), weight: r.weight || 1 };
    sample.mix = mixOf(sample);
    rows.push(sample);
    counts[src] = (counts[src] || 0) + 1;
    if (r.license && r.license !== 'own') licences[r.license] = (licences[r.license] || 0) + 1;
  }
}

// Mix: keep every stack sample; general and Tanglish may each be at most 15/70 of the stack count (→ stack ≥ 70%)
const by = { stack: [], general: [], tanglish: [] };
for (const r of rows) by[r.mix].push(r);
const cap = Math.floor((by.stack.length * 15) / 70);
const pick = (list) => {
  const mine = list.filter((r) => /^feedback/.test(r.source)); // your own 👍 / ✏️ always stay
  const rest = shuffle(list.filter((r) => !/^feedback/.test(r.source)));
  return [...mine, ...rest].slice(0, Math.max(cap, mine.length));
};
const kept = [...by.stack, ...pick(by.general), ...pick(by.tanglish)];
const out = shuffle(kept.flatMap((r) => (r.weight >= 2 ? [r, r] : [r]))); // ✏️ corrections count twice
fs.writeFileSync(path.join(DATA, 'train.jsonl'), out.map(({ mix, ...r }) => JSON.stringify(r)).join('\n') + (out.length ? '\n' : ''));

// Preference pairs (for DPO): clean + de-duplicate
const pairSeen = new Set();
const pairs = [];
for (const p of readJsonl('pairs.jsonl')) {
  const chosen = stripHidden(p.chosen), rejected = stripHidden(p.rejected), prompt = stripHidden(p.prompt);
  if (!chosen || !rejected || chosen === rejected || tokens(prompt + chosen + rejected) > 7000) continue;
  const k = hash(norm(prompt) + norm(chosen));
  if (pairSeen.has(k)) continue;
  pairSeen.add(k);
  for (let w = 0; w < (p.weight >= 2 ? 2 : 1); w++) pairs.push({ prompt, chosen, rejected, source: p.source || 'self' });
}
fs.writeFileSync(path.join(DATA, 'train-pairs.jsonl'), pairs.map((p) => JSON.stringify(p)).join('\n') + (pairs.length ? '\n' : ''));

const mixCount = (m) => kept.filter((r) => r.mix === m).length;
const pct = (n) => (kept.length ? `${Math.round((100 * n) / kept.length)}%` : '0%');
console.log('\n  Source                 Samples');
for (const [s, n] of Object.entries(counts).sort((a, b) => b[1] - a[1])) console.log(`  ${s.padEnd(22)} ${String(n).padStart(7)}`);
console.log(`\n  Mix: stack ${mixCount('stack')} (${pct(mixCount('stack'))}) · general ${mixCount('general')} (${pct(mixCount('general'))}) · Tanglish ${mixCount('tanglish')} (${pct(mixCount('tanglish'))})`);
console.log(`  Dropped: ${dropped.dup} near-duplicates · ${dropped.long} over 7,000 tokens · ${dropped.empty} empty`);
if (Object.keys(licences).length) console.log(`  Open-source licences: ${Object.entries(licences).map(([l, n]) => `${l} ${n}`).join(' · ')}`);
console.log(`\n  ✔ train.jsonl: ${out.length} rows (corrections counted twice) · train-pairs.jsonl: ${pairs.length} pairs${pairs.length < 50 ? ' (DPO needs 50+)' : ''}`);
console.log('  Upload both files as a Kaggle dataset, then: npm run make-notebook');
