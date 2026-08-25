# Keep the planner's static server up, for the tailnet.
#
# Not "start it at logon". That was tried on WslKeepAlive and it died 19 days in: something killed
# the process, AtLogOn had already fired, and nothing ever noticed. So this is the pattern that
# actually held -- CHECK, then start only if it is not there -- fired at logon AND on a repeat, so a
# process that dies at 3am is back within the interval instead of at the next reboot.
#
# Idempotent on purpose: it is safe to run by hand, and safe for the task to fire while the server is
# already up. It looks at the PORT, not at a PID file, because the port is the thing that has to be
# true -- a stale PID file that says "running" is worse than no PID file at all.

param(
  [int]$Port = 8812,
  [string]$Root = "V:\projects\igt-planner"
)

$ErrorActionPreference = "Stop"

function Test-Serving {
  # LOOPBACK ONLY, and the address filter is the whole point -- I wrote this check without it first
  # and it was worse than no check at all. `tailscale serve` makes TAILSCALED listen on the same port
  # at the tailnet address (100.x:8812), so "is anything listening on 8812" is true forever, even
  # with serve.py stone dead. The keepalive would have sat there reporting health at a corpse.
  try {
    $c = Get-NetTCPConnection -State Listen -LocalPort $Port -LocalAddress 127.0.0.1 -ErrorAction Stop
    return [bool]$c
  } catch { return $false }
}

if (Test-Serving) { exit 0 }

$serveTask = 'IgtPlannerServe'
$task = Get-ScheduledTask -TaskName $serveTask -ErrorAction SilentlyContinue
if (-not $task) {
  throw "$serveTask is not registered. Run: powershell -File $PSScriptRoot\install-serve-task.ps1"
}

# Ask the SCHEDULER to start it, do not start it here. Every task on this box runs under
# runhidden.exe, which since 2026-08-24 puts everything it spawns into a Job Object with
# JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE -- a Start-Process here would die the moment this
# script exits, while this task still returned 0. That silence killed :8796 for a day.
#
# MultipleInstances IgnoreNew means a stale Running instance makes Start a silent no-op,
# so clear it first: we already know it is not serving.
if ((Get-ScheduledTask -TaskName $serveTask).State -eq 'Running') {
  Stop-ScheduledTask -TaskName $serveTask -ErrorAction SilentlyContinue
  Start-Sleep -Milliseconds 700
}
Start-ScheduledTask -TaskName $serveTask

$up = $false
foreach ($i in 1..10) {
  Start-Sleep -Milliseconds 800
  if (Test-Serving) { $up = $true; break }
}
if ($up) { Write-Output "igt-planner serving on 127.0.0.1:$Port" }
else { throw "started $serveTask but nothing is listening on $Port" }
