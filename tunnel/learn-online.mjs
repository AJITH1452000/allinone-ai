// Use your Learn models on the LIVE (Vercel) site while this PC is on.
//   npm run learn-online
// 1. Starts a GUARD on 127.0.0.1:11435 in front of Ollama: only requests with your secret key get through, and only
//    chat/model-info endpoints (no downloading/deleting models). Ollama itself has no password — never expose it directly.
// 2. Starts a free Cloudflare quick tunnel to the guard and prints the two values to paste into Vercel.
import http from 'http';
import fs from 'fs';
import path from 'path';
import os from 'os';
import crypto from 'crypto';
import { spawn } from 'child_process';
import { fileURLToPath } from 'url';

const dir = path.dirname(fileURLToPath(import.meta.url));
const TOKEN_FILE = path.join(dir, '.token');
const GUARD_PORT = 11435;
const OLLAMA = { host: '127.0.0.1', port: 11434 };

// Secret key: created once, reused (so Vercel's OLLAMA_API_KEY stays valid). Delete tunnel/.token to make a new one.
let token = fs.existsSync(TOKEN_FILE) ? fs.readFileSync(TOKEN_FILE, 'utf8').trim() : '';
if (!/^[a-f0-9]{48}$/.test(token)) { token = crypto.randomBytes(24).toString('hex'); fs.writeFileSync(TOKEN_FILE, token); }
const expected = Buffer.from(`Bearer ${token}`);

// Only what the Evolvix server needs: OpenAI-style chat + model list, and Ollama's chat/show/tags/ps
const ALLOWED = [/^\/v1\/(chat\/completions|models)\/?$/, /^\/api\/(chat|show|tags|ps|version)\/?$/];

const guard = http.createServer((req, res) => {
  const given = Buffer.from(String(req.headers.authorization || ''));
  const okKey = given.length === expected.length && crypto.timingSafeEqual(given, expected);
  const pathOnly = (req.url || '').split('?')[0];
  if (!okKey) { res.writeHead(401, { 'Content-Type': 'text/plain' }); return res.end('Unauthorized'); }
  if (!ALLOWED.some((re) => re.test(pathOnly))) { res.writeHead(403, { 'Content-Type': 'text/plain' }); return res.end('Not allowed through the Learn tunnel'); }
  const headers = { ...req.headers, host: `${OLLAMA.host}:${OLLAMA.port}` };
  delete headers.authorization; delete headers.origin; delete headers['cf-connecting-ip'];
  const up = http.request({ ...OLLAMA, method: req.method, path: req.url, headers }, (r) => {
    res.writeHead(r.statusCode || 502, r.headers);
    r.pipe(res); // streams answers word by word
  });
  up.on('error', (e) => { if (!res.headersSent) res.writeHead(502, { 'Content-Type': 'text/plain' }); res.end(`Ollama is not reachable on this PC: ${e.message}`); });
  req.pipe(up);
  res.on('close', () => up.destroy());
});

function findCloudflared() {
  const candidates = [
    path.join(process.env.LOCALAPPDATA || '', 'Microsoft', 'WinGet', 'Links', 'cloudflared.exe'),
    'C:\\Program Files (x86)\\cloudflared\\cloudflared.exe',
    'C:\\Program Files\\cloudflared\\cloudflared.exe',
  ];
  return candidates.find((p) => fs.existsSync(p)) || 'cloudflared';
}

guard.listen(GUARD_PORT, '127.0.0.1', () => {
  console.log(`\n🛡️  Guard running on http://127.0.0.1:${GUARD_PORT} → Ollama (key required)`);
  const cf = spawn(findCloudflared(), ['tunnel', '--no-autoupdate', '--url', `http://127.0.0.1:${GUARD_PORT}`], { windowsHide: true });
  let shown = false;
  const onLine = (d) => {
    const url = /https:\/\/[a-z0-9-]+\.trycloudflare\.com/.exec(String(d))?.[0];
    if (url && !shown) {
      shown = true;
      console.log(`\n✅ Learn is online at ${url}\n`);
      console.log('In Vercel → your project → Settings → Environment Variables, set (then Redeploy):');
      console.log(`   OLLAMA_URL      = ${url}/v1`);
      console.log(`   OLLAMA_API_KEY  = ${token}`);
      console.log('\nKeep this window open — Learn works on the live site only while it runs and this PC is on.');
      console.log('Note: a free quick tunnel gets a NEW address every time it starts → update OLLAMA_URL in Vercel after each restart.');
      console.log('(The key stays the same. For a fixed address, use a named Cloudflare tunnel or an ngrok static domain to port 11435.)\n');
    }
  };
  cf.stdout.on('data', onLine);
  cf.stderr.on('data', onLine);
  cf.on('error', () => {
    console.log('\n⚠️  cloudflared is not installed. Install it once (then run npm run learn-online again):');
    console.log('     winget install --id Cloudflare.cloudflared');
    console.log(`\n   The guard keeps running on port ${GUARD_PORT}; any tunnel (ngrok, Cloudflare) pointing at it works.`);
    console.log(`   Vercel needs: OLLAMA_URL = <your tunnel address>/v1   and   OLLAMA_API_KEY = ${token}\n`);
  });
  cf.on('exit', (code) => { if (shown) { console.log(`Tunnel stopped (code ${code}).`); process.exit(code || 0); } });
  const stop = () => { cf.kill(); guard.close(); process.exit(0); };
  process.on('SIGINT', stop); process.on('SIGTERM', stop);
});
guard.on('error', (e) => { console.error(`Could not start the guard on port ${GUARD_PORT}: ${e.message}`); process.exit(1); });
