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

$py = (Get-Command python -ErrorAction SilentlyContinue).Source
if (-not $py) { $py = "$env:LOCALAPPDATA\Programs\Python\Python311\python.exe" }
if (-not (Test-Path $py)) { throw "no python found" }

# pythonw, not python: a console window on every logon is how a helpful thing becomes an annoying one.
$pyw = $py -replace 'python\.exe$', 'pythonw.exe'
if (-not (Test-Path $pyw)) { $pyw = $py }

Start-Process -FilePath $pyw `
  -ArgumentList @("$Root\serve.py", "--port", "$Port") `
  -WorkingDirectory $Root `
  -WindowStyle Hidden

Start-Sleep -Seconds 2
if (Test-Serving) { Write-Output "igt-planner serving on 127.0.0.1:$Port" }
else { throw "started python but nothing is listening on $Port" }
