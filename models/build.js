// Builds your own model family in Ollama:  npm run build-models   (or: node models/build.js pro)
// To rename the family: edit models/family.json ("name" shown to users, "id" used in Ollama), then run this again.
// To change the instructions for ALL models: edit models/system.md, then run this again.
// To change the base model / settings: edit Modelfile.learn (Modelfile.32k = same with a 32K window, only for claude-local.cmd; Modelfile.vision = image model) ({{NAME}}, {{COMPANY}}, {{CORE}} are filled in for you).
import { spawnSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { fileURLToPath } from 'url';

const dir = path.dirname(fileURLToPath(import.meta.url));
const family = JSON.parse(fs.readFileSync(path.join(dir, 'family.json'), 'utf8'));
const winExe = path.join(process.env.LOCALAPPDATA || '', 'Programs', 'Ollama', 'ollama.exe');
const OLLAMA = os.platform() === 'win32' && fs.existsSync(winExe) ? winExe : 'ollama';

// codeplus = your fine-tuned Learn Code+ (created by: npm run import-model -- file.gguf). Old Modelfiles are in models/old/.
const TIERS = ['learn', 'code', 'vision', '32k', 'max', 'codeplus'].filter((t) => fs.existsSync(path.join(dir, `Modelfile.${t}`)));
const pick = process.argv.slice(2);
const todo = pick.length ? pick : TIERS;
const run = (...args) => spawnSync(OLLAMA, args, { stdio: 'inherit' }).status === 0;

for (const tier of todo) {
  const src = path.join(dir, `Modelfile.${tier}`);
  if (!TIERS.includes(tier) || !fs.existsSync(src)) { console.error(`Unknown model "${tier}". Use: ${TIERS.join(', ')}`); continue; }
  const core = fs.readFileSync(path.join(dir, 'system.md'), 'utf8').trim().replaceAll('"""', "'''");
  const text = fs.readFileSync(src, 'utf8').replaceAll('{{CORE}}', core)
    .replaceAll('{{EXAMPLES}}', fs.existsSync(path.join(dir, 'fewshot.txt')) ? fs.readFileSync(path.join(dir, 'fewshot.txt'), 'utf8').trim() : '')
    .replaceAll('{{NAME}}', family.name).replaceAll('{{COMPANY}}', family.company);
  const base = text.match(/^FROM\s+(.+?)\s*$/m)[1];
  const name = tier === 'learn' ? family.id : `${family.id}-${tier}`; // learn → "learn", vision → "learn-vision", 32k → "learn-32k", codeplus → "learn-codeplus"
  console.log(`\n=== ${name}  (base: ${base}) ===`);
  const localFile = /\.gguf$/i.test(base) || /^[a-z]:[\\/]|^[./\\]/i.test(base);
  // Safe formats only: pickle-based files (.bin .pt .pth .pkl .ckpt) can run code when loaded
  if (localFile && /\.(bin|pt|pth|pkl|pickle|ckpt)$/i.test(base)) { console.error(`Refused: ${base} is a pickle-based model file (it can run code). Use .gguf or .safetensors.`); continue; }
  if (localFile && !fs.existsSync(base)) { console.error(`Model file not found: ${base} (is the external disk plugged in?)`); continue; }
  if (!localFile && !run('pull', base)) { console.error(`Could not download ${base}. Is Ollama running?`); continue; }
  const tmp = path.join(os.tmpdir(), `Modelfile.${name}`);
  fs.writeFileSync(tmp, text);
  if (run('create', name, '-f', tmp)) console.log(`✔ ${name} ready`);
  fs.rmSync(tmp, { force: true });
}
console.log(`\nDone. In the app, press reload in the model picker → "${family.name}" models appear at the top.`);
