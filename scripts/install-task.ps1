# Register the keepalive as a Scheduled Task. No elevation needed:
#
#     powershell -ExecutionPolicy Bypass -File V:\projects\igt-planner\scripts\install-task.ps1
#
# The "NEEDS AN ELEVATED SHELL" note that sat here from 2026-07-23 to 2026-08-25 was a
# misreading, and it cost a month of the planner being down. Register-ScheduledTask said
# "Access is denied" because a bare -AtLogOn trigger means "when ANY user logs on" -- a
# machine-wide trigger, which does need admin. Scoped with -User it installs from an
# ordinary session. The error names the operation, not the offending argument.
#
# Install the server task first:  install-serve-task.ps1
#
# Everything else is already in place and survives a reboot on its own: `tailscale serve` keeps its
# config in tailscaled's state. This task is only about serve.py itself coming back.

$ErrorActionPreference = "Stop"
$name = "IgtPlannerKeepalive"
$script = "V:\projects\igt-planner\scripts\serve-keepalive.ps1"

if (Get-ScheduledTask -TaskName $name -ErrorAction SilentlyContinue) {
  Unregister-ScheduledTask -TaskName $name -Confirm:$false
  Write-Output "removed the existing task first"
}

# runhidden, per house policy: powershell -WindowStyle Hidden still allocates the console
# first and flashes. The keepalive is short-lived, so the job object it brings is harmless
# here -- the SERVER is started via Start-ScheduledTask, outside this process tree.
$action = New-ScheduledTaskAction -Execute "V:\projects\tools\runhidden\runhidden.exe" `
  -Argument "/name:$name powershell.exe -NoProfile -ExecutionPolicy Bypass -File `"$script`""

# AtLogOn AND a repeat, which is the lesson WslKeepAlive paid for: a lone AtLogOn fired once, the
# process was killed 19 days later, and nothing ever noticed. The repeat is what makes it a keepalive
# rather than a starter.
$me = "$env:USERDOMAIN\$env:USERNAME"
$atLogon = New-ScheduledTaskTrigger -AtLogOn -User $me
# No -RepetitionDuration. [TimeSpan]::MaxValue serialises to P99999999DT23H59M59S and the Task
# Scheduler rejects it outright; omitting it is "forever", and it is exactly what WslKeepAlive on
# this machine already does (repeat=PT10M, duration empty). Copy what works here rather than invent.
$poll = New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(2) `
  -RepetitionInterval (New-TimeSpan -Minutes 10)

$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries `
  -StartWhenAvailable -MultipleInstances IgnoreNew -ExecutionTimeLimit (New-TimeSpan -Minutes 5)

Register-ScheduledTask -TaskName $name -Action $action -Trigger @($atLogon, $poll) `
  -Settings $settings -Description "Keep the IGT planner's static server on 127.0.0.1:8812 for tailscale serve. Idempotent: checks the loopback listener, starts serve.py only if absent." | Out-Null

Write-Output "registered: $name"
Get-ScheduledTask -TaskName $name | Select-Object TaskName, State | Format-Table -AutoSize
(Get-ScheduledTask -TaskName $name).Triggers | ForEach-Object { Write-Output ("  trigger: " + $_.CimClass.CimClassName) }
