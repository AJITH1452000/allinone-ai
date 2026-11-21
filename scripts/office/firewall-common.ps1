# Shared helpers for firewall-lock / firewall-unlock / status (dot-sourced). Group name: Evolvix-Lock
$ErrorActionPreference = 'Stop'
$Group = 'Evolvix-Lock'
$Root = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path

function Assert-Admin {
  $p = New-Object Security.Principal.WindowsPrincipal([Security.Principal.WindowsIdentity]::GetCurrent())
  if (-not $p.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    Write-Host 'Run this as Administrator (right-click PowerShell -> Run as administrator).' -ForegroundColor Red
    exit 1
  }
}

# Values from .env (PORT, OFFICE_ALLOWED_IPS)
function Get-EnvValue([string]$Name, [string]$Default) {
  $f = Join-Path $Root '.env'
  if (Test-Path $f) {
    foreach ($line in Get-Content $f) {
      if ($line -match "^\s*$Name\s*=\s*(.*)\s*$") { return $Matches[1].Trim('"', "'", ' ') }
    }
  }
  return $Default
}

# Every node.exe (PATH + nvm) and Ollama
function Get-Programs {
  $list = @()
  try { $list += (& where.exe node 2>$null) } catch {}
  foreach ($d in @($env:NVM_HOME, (Join-Path $env:APPDATA 'nvm'), (Join-Path $env:ProgramFiles 'nodejs'))) {
    if ($d -and (Test-Path $d)) { $list += (Get-ChildItem -Path $d -Filter node.exe -Recurse -ErrorAction SilentlyContinue | ForEach-Object FullName) }
  }
  foreach ($d in @((Join-Path $env:LOCALAPPDATA 'Programs\Ollama'), (Join-Path $env:ProgramFiles 'Ollama'))) {
    foreach ($exe in @('ollama.exe', 'ollama app.exe')) { $p = Join-Path $d $exe; if (Test-Path $p) { $list += $p } }
  }
  return $list | Where-Object { $_ } | Sort-Object -Unique
}

# IPv4 helpers: "everything EXCEPT these subnets" as address ranges (block rules always win over allow rules,
# so the outbound block must simply not include the office subnet). Loopback is never filtered by Windows Firewall.
function ConvertTo-UInt([string]$ip) { $b = ([Net.IPAddress]::Parse($ip)).GetAddressBytes(); [Array]::Reverse($b); return [BitConverter]::ToUInt32($b, 0) }
function ConvertTo-Ip([uint32]$n) { $b = [BitConverter]::GetBytes($n); [Array]::Reverse($b); return ([Net.IPAddress]::new($b)).ToString() }
function Get-Complement([string[]]$Cidrs) {
  $ranges = @()
  foreach ($c in $Cidrs) {
    if (-not $c) { continue }
    $parts = $c.Split('/'); $bits = if ($parts.Count -gt 1) { [int]$parts[1] } else { 32 }
    [uint64]$size = [math]::Pow(2, 32 - $bits)                       # addresses in the subnet
    [uint64]$start = [math]::Floor([uint64](ConvertTo-UInt $parts[0]) / $size) * $size
    [uint64]$end = $start + $size - 1
    $ranges += [pscustomobject]@{ S = $start; E = $end }
  }
  $ranges = @($ranges | Sort-Object S)
  $out = @(); [uint64]$cur = 0
  foreach ($r in $ranges) {
    if ($r.S -gt $cur) { $out += "$(ConvertTo-Ip ([uint32]$cur))-$(ConvertTo-Ip ([uint32]($r.S - 1)))" }
    if ($r.E + 1 -gt $cur) { $cur = $r.E + 1 }
  }
  if ($cur -le [uint64]4294967295) { $out += "$(ConvertTo-Ip ([uint32]$cur))-255.255.255.255" }
  return $out
}
