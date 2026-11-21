// Your own projects → Learn's style.
//   npm run add-my-code -- "E:\my-app" "E:\portfolio"
// For each project's src/: every .jsx/.js/.tsx/.ts/.css file goes into the "mycode" knowledge base (Learn looks it up for
// coding questions and projects), and every component file becomes a training sample: a one-line request written by local
// Learn → YOUR real file (data/training/mycode.jsonl). Skips node_modules/dist/build/.git, env files, files > 60 KB,
// binaries, and anything containing key / secret / token / password.
import fs from 'fs';
import path from 'path';
import * as kb from '../kb.js';
import { walk, looksBinary, requestFor, asFile, appendJsonl, readJsonl, hash, state } from './lib.mjs';

const folders = process.argv.slice(2).filter((a) => !a.startsWith('--'));
if (!folders.length) { console.error('Usage: npm run add-my-code -- "<project folder>" ["<another folder>" …]'); process.exit(1); }
// Office mode: only folders inside OFFICE_CODE_ALLOWLIST (separated by ;) may be read
if (process.env.OFFICE_MODE === '1') {
  const allow = (process.env.OFFICE_CODE_ALLOWLIST || '').split(';').map((p) => p.trim()).filter(Boolean).map((p) => path.resolve(p).toLowerCase());
  const bad = folders.filter((f) => !allow.some((a) => (path.resolve(f).toLowerCase() + path.sep).startsWith(a.replace(/[\\/]$/, '') + path.sep)));
  if (bad.length) { console.error(`Office mode: refused — not inside OFFICE_CODE_ALLOWLIST: ${bad.join(', ')}`); process.exit(1); }
}
const SENSITIVE = /\b(api[_-]?key|secret|token|password|passwd)\b/i;
const { s, save } = state('mycode');
s.done ||= {};
const seen = new Set(readJsonl('mycode.jsonl').map((r) => hash(r.messages[1].content)));
let kbAdded = 0, samples = 0, skipped = 0;

for (const folder of folders) {
  const root = path.resolve(folder);
  const src = fs.existsSync(path.join(root, 'src')) ? path.join(root, 'src') : root;
  const project = path.basename(root);
  const files = walk(src, /\.(jsx|js|tsx|ts|css)$/i, 60_000);
  console.log(`▶ ${project}: ${files.length} files in ${src}`);
  for (const f of files) {
    const rel = path.relative(root, f).replace(/\\/g, '/');
    const key = `${root}|${rel}|${fs.statSync(f).mtimeMs}`;
    if (s.done[key]) continue;
    const code = fs.readFileSync(f, 'utf8');
    s.done[key] = 1;
    if (looksBinary(code) || SENSITIVE.test(code) || /(^|\/)\.env/.test(rel)) { skipped++; save(); continue; }
    await kb.addDoc('mycode', `${project}/${rel}`, `${project} — ${rel}\n\n${code}`).catch(() => {});
    kbAdded++;
    // A component file (JSX that returns markup + a default export) → a training sample
    if (/\.(jsx|tsx)$/.test(f) && /export\s+default/.test(code) && /return\s*\(?\s*</.test(code) && code.length > 300) {
      const answer = asFile(rel, code);
      if (!seen.has(hash(answer))) {
        try {
          const request = await requestFor(code, rel);
          if (request) {
            appendJsonl('mycode.jsonl', { messages: [{ role: 'user', content: request }, { role: 'assistant', content: answer }], source: 'my-code', project, path: rel, license: 'own', at: new Date().toISOString() });
            seen.add(hash(answer)); samples++;
          }
        } catch (e) { console.log(`   ! Learn did not answer for ${rel} (${e.message}) — the file is in the knowledge base; run again later for the sample.`); delete s.done[key]; }
      }
    }
    save();
    if (kbAdded % 20 === 0) console.log(`   ${kbAdded} files indexed · ${samples} samples`);
  }
}
console.log(`\nDone: ${kbAdded} files in the "mycode" knowledge base · ${samples} new training samples (mycode.jsonl) · ${skipped} skipped (secrets/binary).`);
