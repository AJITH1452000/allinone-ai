# Temporarily lifts the OUTBOUND block (for npm ci, ollama pull, updates). Inbound rules stay.
# Re-locks automatically after 30 minutes (scheduled task "Evolvix-Relock"), or run firewall-lock.ps1 yourself when done.
#   powershell -ExecutionPolicy Bypass -File firewall-unlock.ps1 [-Minutes 30]
param([int]$Minutes = 30)
. (Join-Path $PSScriptRoot 'scripts\office\firewall-common.ps1')
Assert-Admin

$rules = Get-NetFirewallRule -Group $Group -ErrorAction SilentlyContinue | Where-Object { $_.Direction -eq 'Outbound' }
if (-not $rules) { Write-Host 'The lock is not installed (run firewall-lock.ps1 first).' -ForegroundColor Yellow; exit 0 }
$rules | Disable-NetFirewallRule

$lock = Join-Path $PSScriptRoot 'firewall-lock.ps1'
$action = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument "-NoProfile -ExecutionPolicy Bypass -File `"$lock`""
$trigger = New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes($Minutes)
$principal = New-ScheduledTaskPrincipal -UserId 'SYSTEM' -RunLevel Highest
Register-ScheduledTask -TaskName 'Evolvix-Relock' -Action $action -Trigger $trigger -Principal $principal -Force | Out-Null

Write-Host "UNLOCKED for $Minutes minutes - outbound internet is open for node.exe and Ollama." -ForegroundColor Yellow
Write-Host "Do your npm ci / ollama pull now. It re-locks automatically at $((Get-Date).AddMinutes($Minutes).ToString('HH:mm'))."
Write-Host 'Done earlier? Run firewall-lock.ps1 now.' -ForegroundColor Yellow
