// Pre-commit hook (simple-git-hooks): blocks committing secrets, data and model files.
import { spawnSync } from 'child_process';
import fs from 'fs';

const staged = spawnSync('git', ['diff', '--cached', '--name-only', '--diff-filter=ACMR'], { encoding: 'utf8' }).stdout.split('\n').filter(Boolean);
const BAD_NAME = /(^|\/)\.env($|\.(?!example$))|(^|\/)keys\.json$|^data\/|\.gguf$|\.safetensors$|(^|\/)tunnel\/\.(token|site-password)$|^backups\//i;
const BAD_TEXT = /BEGIN (RSA |EC |OPENSSH )?PRIVATE KEY|api_key\s*=\s*['"]?[A-Za-z0-9_\-]{12,}/;
const problems = [];
for (const f of staged) {
  if (BAD_NAME.test(f)) { problems.push(`${f}: secrets / data / model files must never be committed`); continue; }
  try {
    const text = spawnSync('git', ['show', `:${f}`], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }).stdout || '';
    if (BAD_TEXT.test(text)) problems.push(`${f}: contains a private key or an api_key=… value`);
  } catch {}
}
if (problems.length) {
  console.error('\n✘ Commit blocked:\n  ' + problems.join('\n  ') + '\n\nUnstage them (git restore --staged <file>) and keep secrets in .env (git-ignored).\n');
  process.exit(1);
}
void fs;
