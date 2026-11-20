// Where the server stores its files.
// On your PC: next to server.js (keys.json + data/). On Vercel (read-only disk): /tmp, which is temporary —
// so on Vercel, API keys must be set as Environment Variables in the Vercel dashboard.
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

export const IS_VERCEL = !!process.env.VERCEL;
export const ROOT = path.dirname(fileURLToPath(import.meta.url));
export const DATA_DIR = IS_VERCEL ? '/tmp/aio-data' : path.join(ROOT, 'data');
export const KEYS_FILE = IS_VERCEL ? '/tmp/aio-keys.json' : path.join(ROOT, 'keys.json');
try { fs.mkdirSync(DATA_DIR, { recursive: true }); } catch {}
