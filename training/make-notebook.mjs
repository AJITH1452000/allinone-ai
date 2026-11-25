// Builds the Kaggle notebook (kaggle/learn_selftrain.ipynb) from kaggle/learn_selftrain.py + config.json:
// Qwen3-4B fine-tuned on YOUR verified data (npm run clean-data → train.jsonl) → learn-codeplus.
//   npm run make-notebook
// (The older public-dataset notebook is archived in training/old/.)
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const dir = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(dir, '..');
const which = 'learn_selftrain';
const cfg = JSON.parse(fs.readFileSync(path.join(dir, 'config.json'), 'utf8')).learn_selftrain;
// A value as JSON text that is safe inside Python's r'''…''' (json.loads reads ' back as ')
const py = (v, indent) => JSON.stringify(v, null, indent).replace(/'/g, '\\u0027');

// The exported model gets exactly Learn's system prompt and parameters (models/Modelfile.learn + system.md)
const family = JSON.parse(fs.readFileSync(path.join(root, 'models', 'family.json'), 'utf8'));
const modelfile = fs.readFileSync(path.join(root, 'models', 'Modelfile.learn'), 'utf8').replace(/\r\n/g, '\n')
  .replaceAll('{{CORE}}', fs.readFileSync(path.join(root, 'models', 'system.md'), 'utf8').trim().replaceAll('"""', "'''"))
  .replaceAll('{{NAME}}', family.name).replaceAll('{{COMPANY}}', family.company)
  .replace(/^FROM .*$/m, 'FROM ./learn-codeplus.Q4_K_M.gguf');
const system = /SYSTEM """\n?([\s\S]*?)\n?"""/.exec(modelfile)[1];

const src = fs.readFileSync(path.join(dir, 'kaggle', `${which}.py`), 'utf8')
  .replace(/\r\n/g, '\n')
  .replace('__CONFIG__', () => py(cfg, 1))
  .replace('__SYSTEM__', () => py(system))
  .replace('__MODELFILE__', () => py(modelfile));

const cells = src.split(/^# %%/m).slice(1).map((chunk) => {
  const markdown = chunk.startsWith(' [markdown]');
  let body = chunk.replace(/^ \[markdown\]/, '').replace(/^\n/, '').replace(/\n+$/, '');
  if (markdown) body = body.split('\n').map((l) => l.replace(/^# ?/, '')).join('\n');
  // A %%cell magic must be the first line of its cell
  if (!markdown) body = body.replace(/^(#[^\n]*\n)(%%\w+)/, '$2\n$1');
  const lines = body.split('\n').map((l, i, a) => (i < a.length - 1 ? `${l}\n` : l));
  return markdown
    ? { cell_type: 'markdown', metadata: {}, source: lines }
    : { cell_type: 'code', metadata: {}, execution_count: null, outputs: [], source: lines };
});

const nb = {
  cells,
  metadata: {
    kernelspec: { display_name: 'Python 3', language: 'python', name: 'python3' },
    language_info: { name: 'python' },
    kaggle: { accelerator: 'nvidiaTeslaT4', isInternetEnabled: true, isGpuEnabled: true },
  },
  nbformat: 4,
  nbformat_minor: 5,
};
const out = path.join(dir, 'kaggle', `${which}.ipynb`);
fs.writeFileSync(out, JSON.stringify(nb, null, 1));
const colabDir = path.join(dir, 'colab');
fs.mkdirSync(colabDir, { recursive: true });
const colabOut = path.join(colabDir, `${which}_colab.ipynb`);
const colabNb = { ...nb, metadata: { ...nb.metadata, colab: { provenance: [], gpuType: 'T4' }, accelerator: 'GPU' } };
fs.writeFileSync(colabOut, JSON.stringify(colabNb, null, 1));
console.log(`✔ ${path.relative(process.cwd(), out)} & ${path.relative(process.cwd(), colabOut)} (${cells.length} cells)`);
