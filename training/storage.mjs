// Where training files live (datasets, checkpoints, trained models, results). Meant for your external disk.
//   npm run storage                 → show the current location and free space
//   npm run storage -- E:           → use E:\EvolvixAI (creates the folders)
import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';
import { fileURLToPath } from 'url';

const dir = path.dirname(fileURLToPath(import.meta.url));
const FILE = path.join(dir, 'storage.json');
export const FOLDERS = ['datasets', 'checkpoints', 'models', 'eval', 'my-data'];

export function storageRoot() {
  try { return JSON.parse(fs.readFileSync(FILE, 'utf8')).root; } catch { return 'D:\\EvolvixAI'; }
}

export function freeGB(p) {
  try {
    const drive = path.parse(path.resolve(p)).root.replace(/\\$/, '');
    const out = execSync(`powershell -NoProfile -Command "(Get-PSDrive -Name '${drive.replace(':', '')}').Free"`, { encoding: 'utf8' });
    return Number(out.trim()) / 1e9;
  } catch { return null; }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const arg = process.argv[2];
  let root = storageRoot();
  if (arg) {
    const drive = /^[a-z]:?$/i.test(arg) ? `${arg[0].toUpperCase()}:\\` : arg;
    if (!fs.existsSync(drive)) { console.error(`✘ ${drive} not found — is the disk plugged in?`); process.exit(1); }
    root = /^[A-Z]:\\$/.test(drive) ? path.join(drive, 'EvolvixAI') : drive;
    fs.writeFileSync(FILE, JSON.stringify({ root }, null, 2));
  }
  for (const f of FOLDERS) fs.mkdirSync(path.join(root, f), { recursive: true });
  const gb = freeGB(root);
  console.log(`\nTraining storage: ${root}`);
  for (const f of FOLDERS) console.log(`  ${path.join(root, f)}`);
  console.log(gb == null ? '' : `\nFree space: ${gb.toFixed(1)} GB${gb < 20 ? '  ⚠ less than 20 GB — one trained model needs ~5 GB' : ''}\n`);
}
