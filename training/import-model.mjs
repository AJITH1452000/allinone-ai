// Turns the .gguf downloaded from Kaggle into the Ollama model "learn-codeplus" (Learn Code+).
//   npm run import-model -- "C:\Users\you\Downloads\unsloth.Q4_K_M.gguf"
// 1. copies the file to your training storage (external disk) as an archive
// 2. writes models/Modelfile.codeplus (same instructions + chat/tool template as Learn Code)
// 3. builds it in Ollama → it appears in the app's model picker as "Learn Code+"
import fs from 'fs';
import path from 'path';
import os from 'os';
import { spawnSync } from 'child_process';
import { fileURLToPath } from 'url';
import { storageRoot, freeGB } from './storage.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const src = process.argv[2];
if (!src || !fs.existsSync(src) || !/\.gguf$/i.test(src)) {
  console.error('Usage: npm run import-model -- "C:\\path\\to\\model.gguf"'); process.exit(1);
}
const winExe = path.join(process.env.LOCALAPPDATA || '', 'Programs', 'Ollama', 'ollama.exe');
const OLLAMA = os.platform() === 'win32' && fs.existsSync(winExe) ? winExe : 'ollama';
const ollama = (...a) => spawnSync(OLLAMA, a, { encoding: 'utf8' });

// 1. Archive copy on the training disk
const size = fs.statSync(src).size / 1e9;
const store = path.join(storageRoot(), 'models');
fs.mkdirSync(store, { recursive: true });
const free = freeGB(store);
if (free != null && free < size + 1) { console.error(`✘ Not enough space in ${store}: ${free.toFixed(1)} GB free, need ${size.toFixed(1)} GB`); process.exit(1); }
const dest = path.join(store, `learn-codeplus-${new Date().toISOString().slice(0, 10)}.gguf`);
if (path.resolve(src) !== path.resolve(dest)) {
  console.log(`Copying ${size.toFixed(1)} GB → ${dest} …`);
  fs.copyFileSync(src, dest);
}

// 2. Modelfile: the fine-tuned weights + Learn Code's chat/tool template, settings and instructions
const tpl = ollama('show', 'qwen2.5-coder:7b', '--template');
if (tpl.status !== 0 || !tpl.stdout.trim()) { console.error('✘ Could not read the chat template from qwen2.5-coder:7b (is Ollama running? run: ollama pull qwen2.5-coder:7b)'); process.exit(1); }
const codeFile = fs.readFileSync(path.join(root, 'models', 'Modelfile.code'), 'utf8');
const params = codeFile.split('\n').filter((l) => l.startsWith('PARAMETER ')).join('\n');
const system = /SYSTEM """[\s\S]*?"""/.exec(codeFile)[0]
  .replace('You are {{NAME}} Code,', 'You are {{NAME}} Code+ (fine-tuned),')
  .replace('say you are {{NAME}} Code from', 'say you are {{NAME}} Code+ from');
fs.writeFileSync(path.join(root, 'models', 'Modelfile.codeplus'),
  `# {{NAME}} Code+ — Learn Code fine-tuned on licence-checked coding data (training/). Weights: ${path.basename(dest)}
FROM ${dest}

TEMPLATE """${tpl.stdout.trim()}"""

${params}

${system}
`);

// 3. Build it
const r = spawnSync(process.execPath, [path.join(root, 'models', 'build.js'), 'codeplus'], { stdio: 'inherit' });
if (r.status === 0) {
  console.log('\nNext: compare it with the current Learn Code —');
  console.log('  npm run eval -- learn-code --only programming,tool_usage,instruction_following');
  console.log('  npm run eval -- learn-codeplus --only programming,tool_usage,instruction_following');
}
