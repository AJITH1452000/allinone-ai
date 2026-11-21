// npm run deps-report — every installed package with version, licence and whether it has an install script.
// New packages since the last report are flagged (deps-report.json keeps the previous list). Run after every install.
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const lock = JSON.parse(fs.readFileSync(path.join(root, 'package-lock.json'), 'utf8'));
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const direct = new Set([...Object.keys(pkg.dependencies || {}), ...Object.keys(pkg.devDependencies || {})]);
const reportFile = path.join(root, 'deps-report.json');
const before = fs.existsSync(reportFile) ? new Set(JSON.parse(fs.readFileSync(reportFile, 'utf8')).packages.map((p) => `${p.name}@${p.version}`)) : null;

const rows = [];
for (const [key, v] of Object.entries(lock.packages || {})) {
  if (!key) continue;
  const name = key.replace(/^.*node_modules\//, '');
  let license = v.license || '';
  if (!license) { try { license = JSON.parse(fs.readFileSync(path.join(root, key, 'package.json'), 'utf8')).license || ''; } catch {} }
  rows.push({ name, version: v.version, license: typeof license === 'object' ? license.type : license || 'UNKNOWN', installScript: !!v.hasInstallScript,
    direct: direct.has(name) && !key.includes('/node_modules/', 'node_modules/'.length), dev: !!v.dev, optional: !!v.optional });
}
rows.sort((a, b) => a.name.localeCompare(b.name));
const isNew = (r) => before && !before.has(`${r.name}@${r.version}`);
const licenses = {};
for (const r of rows) licenses[r.license] = (licenses[r.license] || 0) + 1;
const flagged = rows.filter((r) => r.installScript || isNew(r) || /UNKNOWN|GPL|AGPL|SSPL|BUSL/i.test(r.license));

console.log(`\n${rows.length} packages (${rows.filter((r) => r.direct).length} direct). Licences: ${Object.entries(licenses).sort((a, b) => b[1] - a[1]).map(([l, n]) => `${l} ${n}`).join(' · ')}`);
console.log('\nNeeds attention:');
for (const r of flagged) console.log(`  ${r.name}@${r.version}  ${r.license}${r.installScript ? '  ⚙ install script' : ''}${isNew(r) ? '  ★ NEW since last report' : ''}${r.optional ? '  (optional)' : ''}`);
if (!flagged.length) console.log('  nothing');
if (!before) console.log('\n(First report — the next run flags packages that are new since now.)');
fs.writeFileSync(reportFile, JSON.stringify({ at: new Date().toISOString(), packages: rows }, null, 1));
console.log(`\nSaved: deps-report.json`);
