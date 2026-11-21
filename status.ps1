# Shows whether the Evolvix firewall lock is ON, and lists its rules.
#   powershell -ExecutionPolicy Bypass -File status.ps1
. (Join-Path $PSScriptRoot 'scripts\office\firewall-common.ps1')
$rules = Get-NetFirewallRule -Group $Group -ErrorAction SilentlyContinue
if (-not $rules) { Write-Host 'Evolvix lock: NOT INSTALLED (run firewall-lock.ps1 as Administrator)' -ForegroundColor Red; exit 1 }
$out = $rules | Where-Object { $_.Direction -eq 'Outbound' }
$on = ($out | Where-Object { $_.Enabled -eq 'True' }).Count
if ($on -eq $out.Count) { Write-Host "Evolvix lock: ON ($on outbound block rules active)" -ForegroundColor Green }
elseif ($on -eq 0) { Write-Host 'Evolvix lock: OFF (unlocked - outbound internet open)' -ForegroundColor Red }
else { Write-Host "Evolvix lock: PARTIAL ($on of $($out.Count) outbound rules active)" -ForegroundColor Yellow }
$task = Get-ScheduledTask -TaskName 'Evolvix-Relock' -ErrorAction SilentlyContinue
if ($task) { Write-Host "Auto re-lock scheduled: $(($task.Triggers | Select-Object -First 1).StartBoundary)" }
$rules | Sort-Object Direction, DisplayName | Format-Table -AutoSize @{ n = 'On'; e = { $_.Enabled } }, Direction, Action, DisplayName
