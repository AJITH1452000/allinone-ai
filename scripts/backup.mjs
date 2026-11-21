// Encrypted backup of data/ (users, sessions, chats, knowledge bases, training, audit log …).
//   npm run backup                          → backups/evolvix-backup-<date>.zip.enc   (password asked now)
//   npm run restore -- backups/<file>.zip.enc   (password asked; files are re-encrypted with THIS machine's key)
// The backup is a ZIP of the decrypted files, encrypted with AES-256-GCM using a key derived (scrypt) from your password.
// Without the password it cannot be read — keep the password somewhere safe (not next to the backup).
import '../office/boot.js';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import readline from 'readline';
import { DATA_DIR, ROOT } from '../paths.js';
import { makeZip } from '../src/lib/zip.js';
import { audit } from '../office/core.js';

const mode = process.argv[2] === 'restore' ? 'restore' : 'backup';
const file = process.argv[3];
const ask = (q) => new Promise((res) => { const rl = readline.createInterface({ input: process.stdin, output: process.stdout }); rl.question(q, (a) => { rl.close(); res(a); }); });
const SKIP = /^(builds|open-code)([\\/]|$)|^\.master\./;
const MAGIC = Buffer.from('EVXBAK1');

function walk(dir, base = '') {
  const out = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const rel = path.join(base, e.name);
    if (SKIP.test(rel)) continue;
    if (e.isDirectory()) out.push(...walk(path.join(dir, e.name), rel));
    else out.push({ path: rel.replace(/\\/g, '/'), content: fs.readFileSync(path.join(dir, e.name), 'utf8') }); // decrypted by the office layer
  }
  return out;
}
// Reader for the app's own ZIP format (stored, no compression)
function unzip(buf) {
  const files = [];
  let i = 0;
  while (i + 30 <= buf.length && buf.readUInt32LE(i) === 0x04034b50) {
    const size = buf.readUInt32LE(i + 18), nameLen = buf.readUInt16LE(i + 26), extra = buf.readUInt16LE(i + 28);
    const name = buf.subarray(i + 30, i + 30 + nameLen).toString('utf8');
    const start = i + 30 + nameLen + extra;
    files.push({ path: name.replace(/^data\//, ''), content: buf.subarray(start, start + size).toString('utf8') });
    i = start + size;
  }
  return files;
}

const password = await ask(mode === 'backup' ? 'Backup password (min 12 characters, needed to restore): ' : 'Backup password: ');
if (password.length < 12) { console.error('The password must be at least 12 characters.'); process.exit(1); }

if (mode === 'backup') {
  const files = walk(DATA_DIR);
  const zip = Buffer.from(await makeZip(files, 'data').arrayBuffer());
  const salt = crypto.randomBytes(16), iv = crypto.randomBytes(12);
  const key = crypto.scryptSync(password, salt, 32, { N: 2 ** 15, r: 8, p: 1, maxmem: 64 * 1024 * 1024 });
  const c = crypto.createCipheriv('aes-256-gcm', key, iv);
  const ct = Buffer.concat([c.update(zip), c.final()]);
  const out = path.join(ROOT, 'backups', `evolvix-backup-${new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-')}.zip.enc`);
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, Buffer.concat([MAGIC, salt, iv, c.getAuthTag(), ct]));
  audit('backup', { files: files.length, file: path.basename(out) });
  console.log(`✔ ${files.length} files → ${out} (${(fs.statSync(out).size / 1e6).toFixed(1)} MB, encrypted)`);
} else {
  if (!file || !fs.existsSync(file)) { console.error('Usage: npm run restore -- <backup.zip.enc>'); process.exit(1); }
  const b = fs.readFileSync(file);
  if (!b.subarray(0, 7).equals(MAGIC)) { console.error('Not an Evolvix backup file.'); process.exit(1); }
  const salt = b.subarray(7, 23), iv = b.subarray(23, 35), tag = b.subarray(35, 51);
  const key = crypto.scryptSync(password, salt, 32, { N: 2 ** 15, r: 8, p: 1, maxmem: 64 * 1024 * 1024 });
  let zip;
  try { const d = crypto.createDecipheriv('aes-256-gcm', key, iv); d.setAuthTag(tag); zip = Buffer.concat([d.update(b.subarray(51)), d.final()]); } catch { console.error('Wrong password (or the file was changed).'); process.exit(1); }
  const files = unzip(zip);
  if ((await ask(`Restore ${files.length} files into ${DATA_DIR}? Existing files with the same name are replaced. Type YES: `)) !== 'YES') process.exit(0);
  for (const f of files) {
    if (f.path.includes('..') || path.isAbsolute(f.path)) continue;
    const p = path.join(DATA_DIR, f.path);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, f.content); // re-encrypted with this machine's key in office mode
  }
  audit('restore', { files: files.length, file: path.basename(file) });
  console.log(`✔ Restored ${files.length} files.`);
}
