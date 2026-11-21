// Imported FIRST by server.js (and the training scripts): in office mode, refuse unsafe places and turn on
// encryption at rest BEFORE any other module touches data/.
import 'dotenv/config';
import path from 'path';
import { IS_VERCEL, ROOT, DATA_DIR } from '../paths.js';
import { installDataEncryption, migrateExistingData } from './crypto.js';

if (process.env.OFFICE_MODE === '1') {
  if (IS_VERCEL) { console.error('\n  ✘ OFFICE_MODE refuses to run on Vercel: office mode is for the office machine only (company data must stay on it).\n'); process.exit(1); }
  const CLOUD_SYNC = /[\\/](OneDrive|Google Drive|GoogleDrive|My Drive|Dropbox|iCloudDrive)([\\/]|$)/i;
  for (const p of [ROOT, DATA_DIR, path.join(ROOT, '.env'), path.join(ROOT, 'keys.json')]) {
    if (CLOUD_SYNC.test(path.resolve(p))) {
      console.error(`\n  ✘ Office mode refuses to start: ${p} is inside a cloud-synced folder (OneDrive / Google Drive / Dropbox),\n    so company data would be uploaded. Move the project to a local folder such as C:\\Evolvix.\n`);
      process.exit(1);
    }
  }
  installDataEncryption();
  const n = migrateExistingData();
  if (n) console.log(`  🔐 Encrypted ${n} existing file(s) under data/`);
}
