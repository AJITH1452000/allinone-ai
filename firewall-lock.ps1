# Evolvix office lock (run as Administrator). Strongest layer: even a malicious npm package or model tool inside
# node.exe / ollama.exe cannot reach the internet. Allowed: this PC (loopback) and the office subnet (OFFICE_ALLOWED_IPS).
#   powershell -ExecutionPolicy Bypass -File firewall-lock.ps1
. (Join-Path $PSScriptRoot 'scripts\office\firewall-common.ps1')
Assert-Admin

$subnets = (Get-EnvValue 'OFFICE_ALLOWED_IPS' '') -split ',' | ForEach-Object { $_.Trim() } | Where-Object { $_ }
$port = Get-EnvValue 'PORT' '3001'
$outside = Get-Complement $subnets                       # every IPv4 address except the office subnet(s)
if (-not $subnets) { $outside = @('0.0.0.0-126.255.255.255', '128.0.0.0-255.255.255.255') } # no subnet → only this PC

Get-NetFirewallRule -Group $Group -ErrorAction SilentlyContinue | Remove-NetFirewallRule
Unregister-ScheduledTask -TaskName 'Evolvix-Relock' -Confirm:$false -ErrorAction SilentlyContinue

$programs = Get-Programs
if (-not $programs) { Write-Host 'No node.exe / ollama.exe found.' -ForegroundColor Red; exit 1 }
foreach ($exe in $programs) {
  $name = Split-Path $exe -Leaf
  New-NetFirewallRule -Group $Group -DisplayName "Evolvix-Lock: block $name outbound (v4) [$exe]" -Direction Outbound -Action Block -Program $exe -RemoteAddress $outside -Profile Any | Out-Null
  New-NetFirewallRule -Group $Group -DisplayName "Evolvix-Lock: block $name outbound (v6) [$exe]" -Direction Outbound -Action Block -Program $exe -RemoteAddress '::/0' -Profile Any | Out-Null
  Write-Host "  blocked outbound: $exe"
}
# Inbound: the Evolvix port only from the office subnet
if ($subnets) {
  New-NetFirewallRule -Group $Group -DisplayName "Evolvix-Lock: allow port $port from office" -Direction Inbound -Action Allow -Protocol TCP -LocalPort $port -RemoteAddress $subnets -Profile Any | Out-Null
}
New-NetFirewallRule -Group $Group -DisplayName "Evolvix-Lock: block port $port from outside (v4)" -Direction Inbound -Action Block -Protocol TCP -LocalPort $port -RemoteAddress $outside -Profile Any | Out-Null
New-NetFirewallRule -Group $Group -DisplayName "Evolvix-Lock: block port $port from outside (v6)" -Direction Inbound -Action Block -Protocol TCP -LocalPort $port -RemoteAddress '::/0' -Profile Any | Out-Null

Write-Host ''
Write-Host "LOCKED. node.exe and Ollama can reach only this PC$(if ($subnets) { ' and ' + ($subnets -join ', ') })." -ForegroundColor Green
Write-Host "Port $port is open only to $(if ($subnets) { $subnets -join ', ' } else { 'this PC' })."
Write-Host 'Test:  node -e "fetch(''https://example.com'').then(()=>console.log(''OPEN'')).catch(()=>console.log(''BLOCKED''))"'
