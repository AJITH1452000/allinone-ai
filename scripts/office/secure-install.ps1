# npm run secure-install  (as Administrator) — the ONLY way to install packages on the office PC:
# unlock outbound → npm ci (exact lockfile, no install scripts) → rebuild the one package that needs its script →
# npm audit (fail on high) → lockfile-lint (only registry.npmjs.org over https) → deps report → lock again.
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'firewall-common.ps1')
Assert-Admin
Set-Location $Root
$failed = $false
try {
  & powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $Root 'firewall-unlock.ps1') -Minutes 20
  Write-Host "`n[1/5] npm ci (exact package-lock.json, ignore-scripts from .npmrc)" -ForegroundColor Cyan
  npm ci; if ($LASTEXITCODE) { throw 'npm ci failed' }
  Write-Host "`n[2/5] npm rebuild esbuild (its install script picks the right binary; nothing else runs scripts)" -ForegroundColor Cyan
  npm rebuild esbuild --ignore-scripts=false; if ($LASTEXITCODE) { throw 'npm rebuild esbuild failed' }
  Write-Host "`n[3/5] npm audit --audit-level=high" -ForegroundColor Cyan
  npm audit --audit-level=high; if ($LASTEXITCODE) { throw 'npm audit found high/critical vulnerabilities - fix them before using this install' }
  Write-Host "`n[4/5] lockfile-lint (registry.npmjs.org over https only)" -ForegroundColor Cyan
  npx --yes lockfile-lint@4.14.0 --path package-lock.json --type npm --allowed-hosts npm --validate-https; if ($LASTEXITCODE) { throw 'lockfile-lint failed' }
  Write-Host "`n[5/5] dependency report" -ForegroundColor Cyan
  node scripts/deps-report.mjs
} catch {
  Write-Host "`nSECURE INSTALL FAILED: $_" -ForegroundColor Red
  $failed = $true
} finally {
  & powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $Root 'firewall-lock.ps1')
}
if ($failed) { exit 1 }
Write-Host "`nSecure install done - firewall locked again." -ForegroundColor Green
