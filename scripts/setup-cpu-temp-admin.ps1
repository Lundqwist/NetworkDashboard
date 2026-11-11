<#
.SYNOPSIS
  Optional: CPU temperature for the "This PC" panel. Run this yourself in an elevated PowerShell.

.DESCRIPTION
  The dashboard itself never needs admin rights. Only the CPU temperature does: on Windows it can only be
  read through a kernel driver. This script sets up LibreHardwareMonitor (LHM) to do that, elevated, and
  the dashboard reads the value from LHM's local web server (http://127.0.0.1:8085/data.json).

  Steps (each one asks first):
    1. Installs LibreHardwareMonitor with winget (portable package, no service).
    2. Adds a scheduled task that starts LHM elevated, minimized, when you sign in.
       Only LHM runs elevated. The task runs as you, not as SYSTEM.

  Then, once, in the LHM window:
    - Accept the PawnIO driver install it offers (a signed driver LHM 0.9.5+ uses instead of WinRing0).
    - Options → Remote Web Server → Run (port 8085). Options → Start Minimized / Minimize To Tray.
    - If Windows Firewall asks about LibreHardwareMonitor, click Cancel. The dashboard reads it
      locally, so no inbound rule is needed.

  Undo: .\setup-cpu-temp-admin.ps1 -Remove   (deletes the task; then `winget uninstall` LHM, and
  remove the PawnIO driver from Apps if you want).

.EXAMPLE
  # In PowerShell started with "Run as administrator":
  powershell -NoProfile -ExecutionPolicy Bypass -File E:\ProjectsCoding\NetworkDashboard\scripts\setup-cpu-temp-admin.ps1
#>
param([switch]$Remove)

$ErrorActionPreference = 'Stop'
$TaskName = 'NetworkDashboard - LibreHardwareMonitor'
$PackageId = 'LibreHardwareMonitor.LibreHardwareMonitor'

$principal = [Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()
if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
  Write-Error 'Run this in an elevated PowerShell (Run as administrator).'
}

function Confirm-Step([string]$Text) {
  $a = Read-Host "$Text [y/N]"
  return $a -match '^(y|yes|j|ja)$'
}

if ($Remove) {
  if (Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue) {
    if (Confirm-Step "Delete scheduled task '$TaskName'?") {
      Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
      Write-Host 'Task deleted.'
    }
  } else { Write-Host 'No task to delete.' }
  Write-Host "To uninstall LHM too: winget uninstall --id $PackageId --exact"
  return
}

function Find-Lhm {
  $roots = @("$env:LOCALAPPDATA\Microsoft\WinGet\Packages", "$env:ProgramFiles\WinGet\Packages", "$env:ProgramFiles\LibreHardwareMonitor")
  foreach ($r in $roots) {
    if (Test-Path $r) {
      $exe = Get-ChildItem $r -Recurse -Filter 'LibreHardwareMonitor.exe' -ErrorAction SilentlyContinue | Select-Object -First 1
      if ($exe) { return $exe.FullName }
    }
  }
  return $null
}

# 1. Install
$exe = Find-Lhm
if ($exe) {
  Write-Host "LibreHardwareMonitor found: $exe"
} elseif (Confirm-Step "Step 1: install $PackageId with winget?") {
  winget install --id $PackageId --exact --accept-package-agreements --accept-source-agreements
  $exe = Find-Lhm
  if (-not $exe) { Write-Error 'Installed, but LibreHardwareMonitor.exe was not found. Pass its path manually.' }
  Write-Host "Installed: $exe"
} else {
  Write-Host 'Skipped. Nothing changed.'
  return
}

# 1b. LHM settings: web server on 8085, start minimized to the tray (same keys as Options in its menu)
$cfgFile = Join-Path (Split-Path $exe) 'LibreHardwareMonitor.config'
if (Confirm-Step "Turn on LHM's web server (port 8085) and start-minimized in $cfgFile?") {
  Get-Process LibreHardwareMonitor -ErrorAction SilentlyContinue | Stop-Process -Force  # it rewrites the file on exit
  if (Test-Path $cfgFile) { [xml]$x = Get-Content $cfgFile -Raw }
  else { [xml]$x = '<?xml version="1.0" encoding="utf-8"?><configuration><appSettings /></configuration>' }
  $app = $x.configuration.SelectSingleNode('appSettings')
  if (-not $app) { $app = $x.configuration.AppendChild($x.CreateElement('appSettings')) }
  $want = @{ runWebServerMenuItem = 'true'; listenerPort = '8085'; startMinMenuItem = 'true'; minTrayMenuItem = 'true' }
  foreach ($k in $want.Keys) {
    $n = $app.SelectSingleNode("add[@key='$k']")
    if (-not $n) { $n = $app.AppendChild($x.CreateElement('add')); $n.SetAttribute('key', $k) }
    $n.SetAttribute('value', $want[$k])
  }
  $x.Save($cfgFile)
  Write-Host 'Settings written.'
}

# 2. Elevated start at sign-in (a Startup-folder shortcut can't start an app elevated without a UAC prompt)
if (Confirm-Step "Step 2: add scheduled task '$TaskName' (start LHM elevated at sign-in, as $env:USERNAME)?") {
  $user = "$env:USERDOMAIN\$env:USERNAME"
  $action = New-ScheduledTaskAction -Execute $exe -WorkingDirectory (Split-Path $exe)
  $trigger = New-ScheduledTaskTrigger -AtLogOn -User $user
  $taskPrincipal = New-ScheduledTaskPrincipal -UserId $user -LogonType Interactive -RunLevel Highest
  $settings = New-ScheduledTaskSettingsSet -ExecutionTimeLimit ([TimeSpan]::Zero) -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries
  Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger -Principal $taskPrincipal -Settings $settings `
    -Description 'Starts LibreHardwareMonitor elevated so the Network Dashboard can show the CPU temperature.' -Force | Out-Null
  Write-Host 'Task added. Starting LHM now...'
  Start-ScheduledTask -TaskName $TaskName
}

Write-Host ''
Write-Host 'Now in the LibreHardwareMonitor window:'
Write-Host '  - accept the PawnIO driver install if it asks'
Write-Host '  - Options -> Remote Web Server -> Run (port 8085)'
Write-Host '  - Options -> Start Minimized and Minimize To Tray'
Write-Host '  - if Windows Firewall asks about LibreHardwareMonitor, click Cancel (only local access is needed)'
Write-Host ''
Write-Host 'Check: (Invoke-WebRequest http://127.0.0.1:8085/data.json -UseBasicParsing).StatusCode  should print 200.'
