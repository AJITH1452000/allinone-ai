// Open-source code → training samples (shared by fetch-open-code.mjs and get-datasets.mjs).
// Only repos whose LICENSE is MIT / Apache-2.0 / BSD / ISC. Every row keeps repo + license + path (credit).
// The answer is always the REAL human-written file; local Learn only writes the one-line request.
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import * as kb from '../kb.js';
import { sparseClone, readLicense, licenseOf, walk, looksBinary, SECRET, requestFor, asFile, appendJsonl, readJsonl, hash, state, gitIn } from './lib.mjs';
const HERE_DIR = path.dirname(fileURLToPath(import.meta.url)); // decodes spaces ("MY WORKS")

export const loadSources = () => JSON.parse(fs.readFileSync(path.join(HERE_DIR, 'sources.json'), 'utf8')).sources;

/** Clone → licence check → each demo/template file becomes { request (by Learn) → real file } and a "docs" reference. */
export async function processRepo(src, { limit = 0, toKb = true, log = console.log } = {}) {
  const { repo, branch, paths, exts = '\\.(jsx?|tsx?)$', skip, out = 'opencode.jsonl' } = src;
  let dir;
  try { dir = sparseClone(repo, paths, { branch, depth: src.fixes ? 300 : 1 }); } catch (e) { log(`✘ ${repo}: ${e.message}`); return { repo, saved: 0, license: '?', skipped: e.message }; }
  const license = licenseOf(readLicense(dir));
  if (!license) { log(`⛔ ${repo}: skipped — its LICENSE is not MIT / Apache-2.0 / BSD / ISC`); return { repo, saved: 0, license: 'not permissive', skipped: 'license' }; }
  const { s, save } = state(`repo-${repo.replace('/', '__')}`);
  s.done ||= {};
  const seen = new Set(readJsonl(out).map((r) => hash(r.messages?.[1]?.content || '')));
  const extRe = new RegExp(exts, 'i');
  const skipRe = skip ? new RegExp(skip, 'i') : null;
  let files = paths.flatMap((p) => walk(path.join(dir, p), extRe));
  files = files.filter((f) => {
    const rel = path.relative(dir, f).replace(/\\/g, '/');
    if (skipRe?.test(rel)) return false;
    if (/\.tsx$/.test(f) && fs.existsSync(f.replace(/\.tsx$/, '.js'))) return false; // MUI ships every demo as .js AND .tsx → keep one
    return true;
  });
  let saved = 0, todo = files.filter((f) => !s.done[path.relative(dir, f)]);
  if (limit) todo = todo.slice(0, limit);
  log(`▶ ${repo} (${license}) — ${files.length} files, ${todo.length} to process`);
  for (const [i, f] of todo.entries()) {
    const rel = path.relative(dir, f).replace(/\\/g, '/');
    const code = fs.readFileSync(f, 'utf8');
    s.done[rel] = 1;
    if (looksBinary(code) || SECRET.test(code) || code.trim().length < 200) { save(); continue; }
    const answer = asFile(`src/${path.basename(rel)}`, code);
    const h = hash(answer);
    if (seen.has(h)) { save(); continue; }
    let request = '';
    try { request = await requestFor(code, rel); } catch (e) { log(`   ! Learn did not answer (${e.message}) — is Ollama running with "learn"?`); delete s.done[rel]; save(); break; }
    if (!request) { save(); continue; }
    appendJsonl(out, { messages: [{ role: 'user', content: request }, { role: 'assistant', content: answer }], source: src.source || 'open-code', repo, license, path: rel, at: new Date().toISOString() });
    seen.add(h); saved++;
    if (toKb) await kb.addDoc('docs', `${repo}/${rel}`, `${repo} (${license}) — ${rel}\n\n${code}`).catch(() => {});
    save();
    if ((i + 1) % 10 === 0 || i === todo.length - 1) log(`   ${i + 1}/${todo.length} · saved ${saved}`);
  }
  return { repo, saved, license, out };
}

/** Bug-fix pairs from history: last 300 commits touching one .jsx/.tsx file, message like fix/bug/crash/error/broken, ≤ 60 changed lines */
export function fixesFromHistory(src, { log = console.log, max = 300 } = {}) {
  const dir = path.join(HERE_DIR, '..', 'data', 'open-code', src.repo.replace('/', '__'));
  if (!fs.existsSync(dir)) return { repo: src.repo, fixes: 0 };
  const license = licenseOf(readLicense(dir));
  if (!license) return { repo: src.repo, fixes: 0 };
  const logOut = gitIn(['log', `-${max}`, '--format=@@%H%x09%s', '--numstat', '--', '*.jsx', '*.tsx'], dir).stdout || '';
  const seen = new Set(readJsonl('fixes.jsonl').map((r) => `${r.repo}@${r.commit}`));
  let n = 0;
  for (const block of logOut.split('@@').slice(1)) {
    const [head, ...stat] = block.trim().split('\n');
    const [sha, subject = ''] = head.split('\t');
    if (!/fix|bug|crash|error|broken/i.test(subject) || seen.has(`${src.repo}@${sha}`)) continue;
    const files = stat.filter(Boolean).map((l) => l.split('\t')).filter((x) => /\.(jsx|tsx)$/.test(x[2] || ''));
    if (files.length !== 1) continue;
    const [add, del, file] = files[0];
    if (Number(add) + Number(del) > 60) continue;
    const before = gitIn(['show', `${sha}^:${file}`], dir), after = gitIn(['show', `${sha}:${file}`], dir);
    if (before.status !== 0 || after.status !== 0 || SECRET.test(after.stdout) || before.stdout.length > 20_000) continue;
    const lang = file.endsWith('.tsx') ? 'tsx' : 'jsx';
    appendJsonl('fixes.jsonl', { messages: [
      { role: 'user', content: `Fix this bug: ${subject}\n\n\`\`\`${lang}\n${before.stdout.trimEnd()}\n\`\`\`` },
      { role: 'assistant', content: `${subject.replace(/^\[[^\]]+\]\s*/, '')} — fixed:\n\n\`\`\`${lang}\n${after.stdout.trimEnd()}\n\`\`\`` },
    ], source: 'git-fix', repo: src.repo, license, path: file, commit: sha, at: new Date().toISOString() });
    n++;
  }
  log(`   ${src.repo}: ${n} bug-fix pairs from history`);
  return { repo: src.repo, fixes: n };
}
