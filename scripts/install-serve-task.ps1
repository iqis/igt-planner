# Register serve.py as its OWN scheduled task, so the keepalive can start it
# without owning it.
#
#   powershell -ExecutionPolicy Bypass -File install-serve-task.ps1
#   powershell -ExecutionPolicy Bypass -File install-serve-task.ps1 -Remove
#
# No elevation needed, unlike the note that has been on install-task.ps1 since
# 2026-07-23. That "Access is denied" was never about permissions in general: a bare
# `New-ScheduledTaskTrigger -AtLogOn` means "when ANY user logs on", which is a
# machine-wide trigger and does require admin. Scoped with -User it installs from an
# ordinary session, which is why this task went a month uninstalled for no good reason.
#
# WHY THE SERVER IS ITS OWN TASK
#
# serve-keepalive.ps1 used to Start-Process the server itself. Every task here runs
# under runhidden.exe, which since 2026-08-24 puts everything it spawns into a Job
# Object with JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE -- so a server started that way dies
# the instant the keepalive exits, while the keepalive still reports success. That is
# what killed the Lone Pine UI on :8796 for a day. The job object stays (orphaned batch
# work is what corrupted the WSL ext4 root three times); it just cannot be the parent of
# something meant to outlive it. Start-ScheduledTask hands the spawn to the scheduler
# service instead, in its own process tree.
[CmdletBinding()]
param([switch]$Remove)

$ErrorActionPreference = 'Stop'
$name = 'IgtPlannerServe'
$root = 'V:\projects\igt-planner'
$port = 8812
$script = Join-Path $root 'serve.py'

if ($Remove) {
  Stop-ScheduledTask   -TaskName $name -ErrorAction SilentlyContinue
  Unregister-ScheduledTask -TaskName $name -Confirm:$false -ErrorAction SilentlyContinue
  "removed $name"
  return
}

if (-not (Test-Path $script)) { throw "server not found: $script" }

$py = (Get-Command python -ErrorAction SilentlyContinue).Source
if (-not $py) { $py = "$env:LOCALAPPDATA\Programs\Python\Python311\python.exe" }
if (-not (Test-Path $py)) { throw 'no python found' }
# pythonw, not python: a console window on every logon is how a helpful thing becomes annoying.
$pyw = $py -replace 'python\.exe$', 'pythonw.exe'
if (-not (Test-Path $pyw)) { $pyw = $py }

$action = New-ScheduledTaskAction -Execute $pyw `
  -Argument "`"$script`" --port $port" -WorkingDirectory $root

$me = "$env:USERDOMAIN\$env:USERNAME"
$trigger = New-ScheduledTaskTrigger -AtLogOn -User $me

# ExecutionTimeLimit 0 = no limit, the opposite of the policy for every batch task here,
# and deliberate: this is a SERVER. "Running forever" is its true state, not a hung job,
# and it is one known process rather than the accumulating orphans the limit exists to stop.
$settings = New-ScheduledTaskSettingsSet `
  -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries `
  -StartWhenAvailable `
  -MultipleInstances IgnoreNew `
  -ExecutionTimeLimit ([TimeSpan]::Zero) `
  -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1)

Register-ScheduledTask -TaskName $name -Action $action -Trigger $trigger -Settings $settings `
  -Description "IGT planner static server (serve.py on 127.0.0.1:$port). Owned by the scheduler so it survives the keepalive that starts it." `
  -Force | Out-Null

"registered $name"
Get-ScheduledTask -TaskName $name | Select-Object TaskName, State | Format-Table -AutoSize
