// Start "Learn online" (auto mode) by itself every time you log in to Windows — no admin rights needed.
//   npm run learn-autostart            → install (and start it right now)
//   npm run learn-autostart -- --remove → uninstall
// It puts a small hidden launcher in your Startup folder. The log is tunnel/learn-online.log.
import fs from 'fs';
import path from 'path';
import { spawn } from 'child_process';
import { fileURLToPath } from 'url';

const dir = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(dir, '..');
const startup = path.join(process.env.APPDATA || '', 'Microsoft', 'Windows', 'Start Menu', 'Programs', 'Startup');
const launcher = path.join(startup, 'Evolvix Learn online.vbs');
const logFile = path.join(dir, 'learn-online.log');

if (process.argv.includes('--remove')) {
  fs.rmSync(launcher, { force: true });
  console.log('Removed — Learn online will no longer start with Windows.');
  process.exit(0);
}
if (!fs.existsSync(startup)) { console.error(`Startup folder not found: ${startup}`); process.exit(1); }
// VBScript runs the command with a hidden window (0) and doesn't wait
const cmd = `cmd /c cd /d ""${root}"" && node tunnel\\learn-online.mjs --auto >> ""${logFile}"" 2>&1`;
fs.writeFileSync(launcher, `' Evolvix: keeps your Learn models online for the live site (npm run learn-autostart -- --remove to stop)\r\nCreateObject("WScript.Shell").Run "${cmd}", 0, False\r\n`);
console.log(`Installed: ${launcher}`);
console.log('From now on Learn goes online by itself when you log in to Windows (Ollama starts with Windows too).');
// start it now as well
spawn('wscript.exe', [launcher], { detached: true, stdio: 'ignore', windowsHide: true }).unref();
console.log(`Started now. Log: ${logFile}`);
