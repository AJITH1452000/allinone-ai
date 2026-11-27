// Builds your own model family in Ollama, auto-tuned for ANY device (low-end laptop → ultra GPU server):
//   npm run build-models                       (auto-detects RAM / GPU / CPU cores)
//   npm run build-models -- learn code         (build specific models only)
//   npm run build-models -- --tier low|mid|high|ultra   (override detected hardware tier)
import { spawnSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { fileURLToPath } from 'url';
import { detectHardware } from '../hardware.js';

const dir = path.dirname(fileURLToPath(import.meta.url));
const family = JSON.parse(fs.readFileSync(path.join(dir, 'family.json'), 'utf8'));
const winExe = path.join(process.env.LOCALAPPDATA || '', 'Programs', 'Ollama', 'ollama.exe');
const OLLAMA = os.platform() === 'win32' && fs.existsSync(winExe) ? winExe : 'ollama';

const rawArgs = process.argv.slice(2);
const tierIdx = rawArgs.indexOf('--tier');
const forcedTier = tierIdx >= 0 ? rawArgs[tierIdx + 1] : undefined;
const pick = rawArgs.filter((a, i) => a !== '--tier' && (tierIdx < 0 || i !== tierIdx + 1));
const hw = detectHardware(forcedTier);

console.log(`\n⚙ Device detected: ${hw.label} (${hw.cpuModel}, ${hw.physicalCores}c/${hw.logicalCores}t${hw.gpuName ? `, ${hw.gpuName}` : ''})`);
console.log(`  Auto-selected tier "${hw.tier}" → context ${hw.numCtx}${hw.numThread ? `, CPU threads ${hw.numThread}` : ', GPU offload'}`);

// codeplus = your fine-tuned Learn Code+ (created by: npm run import-model -- file.gguf). Old Modelfiles are in models/old/.
const TIERS = ['learn', 'code', 'vision', '32k', 'max', 'codeplus'].filter((t) => fs.existsSync(path.join(dir, `Modelfile.${t}`)));
const todo = pick.length ? pick : TIERS;
const run = (...args) => spawnSync(OLLAMA, args, { stdio: 'inherit' }).status === 0;

function tuneModelfile(srcText, modelKey) {
  let out = srcText;
  const origFrom = out.match(/^FROM\s+(.+?)\s*$/m)?.[1] || '';
  const isLocalGguf = /\.gguf$/i.test(origFrom) || /^[a-z]:[\\/]|^[./\\]/i.test(origFrom);
  // Swap base model to match this device's RAM/VRAM tier (never touch local .gguf files like codeplus)
  if (!isLocalGguf && hw.models[modelKey]) {
    out = out.replace(/^FROM\s+.+$/m, `FROM ${hw.models[modelKey]}`);
  }
  // Tune context window (keep 32768 for the dedicated 32k Claude Code model)
  if (modelKey !== '32k') {
    out = /^PARAMETER\s+num_ctx\b/m.test(out)
      ? out.replace(/^PARAMETER\s+num_ctx\s+\d+/m, `PARAMETER num_ctx ${hw.numCtx}`)
      : out.replace(/^(FROM\s+.+)$/m, `$1\nPARAMETER num_ctx ${hw.numCtx}`);
  }
  // Tune output token budget per tier
  const pred = hw.numPredict[modelKey];
  if (pred) {
    out = /^PARAMETER\s+num_predict\b/m.test(out)
      ? out.replace(/^PARAMETER\s+num_predict\s+\d+/m, `PARAMETER num_predict ${pred}`)
      : out.replace(/^(FROM\s+.+)$/m, `$1\nPARAMETER num_predict ${pred}`);
  }
  // On CPU-only machines, pin physical core count to avoid Hyper-Threading slowdown; on GPU machines, remove num_thread
  out = out.replace(/^PARAMETER\s+num_thread\s+\d+\r?\n?/gm, '');
  if (hw.numThread) {
    out = out.replace(/^(FROM\s+.+)$/m, `$1\nPARAMETER num_thread ${hw.numThread}`);
  }
  return out;
}

for (const tier of todo) {
  const src = path.join(dir, `Modelfile.${tier}`);
  if (!TIERS.includes(tier) || !fs.existsSync(src)) { console.error(`Unknown model "${tier}". Use: ${TIERS.join(', ')}`); continue; }
  const core = fs.readFileSync(path.join(dir, 'system.md'), 'utf8').trim().replaceAll('"""', "'''");
  const raw = fs.readFileSync(src, 'utf8').replaceAll('{{CORE}}', core)
    .replaceAll('{{EXAMPLES}}', fs.existsSync(path.join(dir, 'fewshot.txt')) ? fs.readFileSync(path.join(dir, 'fewshot.txt'), 'utf8').trim() : '')
    .replaceAll('{{NAME}}', family.name).replaceAll('{{COMPANY}}', family.company);
  const text = tuneModelfile(raw, tier);
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
