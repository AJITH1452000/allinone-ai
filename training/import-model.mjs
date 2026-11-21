// Turns the .gguf downloaded from Kaggle into the Ollama model "learn-codeplus" (Learn Code+).
//   npm run import-model -- "C:\Users\you\Downloads\unsloth.Q4_K_M.gguf"
// 1. copies the file to your training storage (external disk) as an archive
// 2. writes models/Modelfile.codeplus (same instructions, parameters and examples as Learn + qwen3's chat/tool template)
// 3. builds it in Ollama, then 4. runs "my exam" on learn vs learn-codeplus → the winner becomes the default
import fs from 'fs';
import path from 'path';
import os from 'os';
import { spawnSync } from 'child_process';
import { fileURLToPath } from 'url';
import { storageRoot, freeGB } from './storage.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const src = process.argv[2];
// Safe model formats only: .gguf / .safetensors hold weights, nothing else. Pickle-based files (.bin .pt .pth .pkl .ckpt)
// can run code when loaded → always refused.
if (src && /\.(bin|pt|pth|pkl|pickle|ckpt|joblib|npy|npz)$/i.test(src)) {
  console.error(`✘ Refused: ${path.basename(src)} is a pickle-based format that can run code when it is loaded. Use a .gguf file (Kaggle notebook exports one).`); process.exit(1);
}
if (src && /\.safetensors$/i.test(src)) {
  console.error('✘ .safetensors is a safe format, but Learn Code+ needs ONE .gguf file. Convert it with llama.cpp (convert_hf_to_gguf.py) or use the .gguf the Kaggle notebook exports.'); process.exit(1);
}
if (!src || !fs.existsSync(src) || !/\.gguf$/i.test(src)) {
  console.error('Usage: npm run import-model -- "C:\\path\\to\\model.gguf"   (only .gguf / .safetensors are accepted)'); process.exit(1);
}
// GGUF files start with the magic bytes "GGUF" — a renamed file of another type is refused
{ const fd = fs.openSync(src, 'r'); const b = Buffer.alloc(4); fs.readSync(fd, b, 0, 4, 0); fs.closeSync(fd);
  if (b.toString('latin1') !== 'GGUF') { console.error('✘ Refused: this file is not a real GGUF file (wrong header).'); process.exit(1); } }
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
// SHA-256 of the model file → models/hashes.json (office mode re-checks it at every start and warns if it changed)
{
  const h = (await import('crypto')).createHash('sha256');
  await new Promise((res, rej) => fs.createReadStream(dest).on('data', (d) => h.update(d)).on('end', res).on('error', rej));
  const hf = path.join(root, 'models', 'hashes.json');
  const hashes = fs.existsSync(hf) ? JSON.parse(fs.readFileSync(hf, 'utf8')) : {};
  hashes[dest] = { sha256: h.digest('hex'), bytes: fs.statSync(dest).size, at: new Date().toISOString() };
  fs.writeFileSync(hf, JSON.stringify(hashes, null, 1));
  console.log(`SHA-256 recorded in models/hashes.json: ${hashes[dest].sha256.slice(0, 16)}…`);
}

// 2. Modelfile: the fine-tuned weights + qwen3's chat template + exactly Learn's parameters, instructions and examples
const tpl = ollama('show', 'qwen3:4b', '--template');
if (tpl.status !== 0 || !tpl.stdout.trim()) { console.error('✘ Could not read the chat template from qwen3:4b (is Ollama running? run: ollama pull qwen3:4b)'); process.exit(1); }
const learnFile = fs.readFileSync(path.join(root, 'models', 'Modelfile.learn'), 'utf8').replace(/\r\n/g, '\n');
fs.writeFileSync(path.join(root, 'models', 'Modelfile.codeplus'), learnFile
  .replace(/^# \{\{NAME\}\} — .*$/m, `# {{NAME}} Code+ — Learn fine-tuned on your own verified work (npm run self-train → Kaggle). Weights: ${path.basename(dest)}`)
  .replace(/^FROM .*$/m, () => `FROM ${dest}\n\nTEMPLATE """${tpl.stdout.trim()}"""`)
  .replace('You are {{NAME}}, made by {{COMPANY}}. Only when asked who you are, say you are {{NAME}} from {{COMPANY}}.',
           'You are {{NAME}} Code+, made by {{COMPANY}}. Only when asked who you are, say you are {{NAME}} Code+ from {{COMPANY}}.'));

// 3. Build it
const r = spawnSync(process.execPath, [path.join(root, 'models', 'build.js'), 'codeplus'], { stdio: 'inherit' });
// 4. Exam: Learn Code+ becomes the default ONLY if it beats Learn on "my exam" (needs the app running)
if (r.status === 0) {
  const up = await fetch('http://localhost:3001/api/auth', { signal: AbortSignal.timeout(4000) }).then(() => true).catch(() => false);
  if (up) spawnSync(process.execPath, [path.join(root, 'training', 'compare.mjs')], { stdio: 'inherit' });
  else console.log('\nLearn Code+ is built. Start the app (npm run dev) and run: npm run compare\n→ it becomes the default only if it scores higher than Learn on your exam.');
}
