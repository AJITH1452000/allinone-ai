// Downloads the preview's CDN files ONCE into public/vendor/ (exact pinned versions) and records their SHA-256.
//   npm run vendor            (needs internet — in the office: firewall-unlock first, then firewall-lock)
// Office mode serves the preview only from these local files. Running it again verifies the hashes and only fetches missing files.
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';
import { VENDOR } from '../src/lib/vendor.js';

const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'public', 'vendor');
fs.mkdirSync(dir, { recursive: true });
const manifestFile = path.join(dir, 'manifest.json');
const manifest = fs.existsSync(manifestFile) ? JSON.parse(fs.readFileSync(manifestFile, 'utf8')) : {};
const sha = (b) => crypto.createHash('sha256').update(b).digest('hex');
let bad = 0;
for (const [url, file] of Object.entries(VENDOR)) {
  const p = path.join(dir, file);
  if (fs.existsSync(p) && manifest[file]) {
    const ok = sha(fs.readFileSync(p)) === manifest[file].sha256;
    console.log(`${ok ? '✔' : '✘ CHANGED'} ${file}`);
    if (!ok) bad++;
    continue;
  }
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(60_000) });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const buf = Buffer.from(await r.arrayBuffer());
    fs.writeFileSync(p, buf);
    manifest[file] = { url, sha256: sha(buf), bytes: buf.length, at: new Date().toISOString() };
    console.log(`⬇ ${file}  (${(buf.length / 1024).toFixed(0)} KB)`);
  } catch (e) { console.log(`✘ ${file}: ${e.message}`); bad++; }
}
fs.writeFileSync(manifestFile, JSON.stringify(manifest, null, 1));
console.log(bad ? `\n${bad} problem(s) — see above.` : `\nAll ${Object.keys(VENDOR).length} preview files are local in public/vendor/ (hashes in manifest.json).`);
process.exit(bad ? 1 : 0);
