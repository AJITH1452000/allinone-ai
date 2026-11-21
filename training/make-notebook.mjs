// Builds the Kaggle notebook (training/kaggle/evolvix_coder.ipynb) from evolvix_coder.py + config.json.
//   npm run make-notebook
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const dir = path.dirname(fileURLToPath(import.meta.url));
const cfg = JSON.parse(fs.readFileSync(path.join(dir, 'config.json'), 'utf8'));
const src = fs.readFileSync(path.join(dir, 'kaggle', 'evolvix_coder.py'), 'utf8')
  .replace(/\r\n/g, '\n')
  .replace('__CONFIG__', JSON.stringify(cfg, null, 1).replace(/'''/g, "\\'\\'\\'"));

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
const out = path.join(dir, 'kaggle', 'evolvix_coder.ipynb');
fs.writeFileSync(out, JSON.stringify(nb, null, 1));
console.log(`✔ ${path.relative(process.cwd(), out)}  (${cells.length} cells) — upload it at kaggle.com → Create → New Notebook → File → Import Notebook`);
