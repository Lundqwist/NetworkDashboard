<#
.SYNOPSIS
  Starts the dashboard server in the background (if it isn't running) and opens the app window.
  start-dashboard.cmd and the sign-in shortcut run this headless (no console window). Arguments go to launch.ps1.
#>
param([Parameter(ValueFromRemainingArguments)] $LaunchArgs)

$url = 'http://127.0.0.1:3000/api/config'
function Test-Up { try { Invoke-WebRequest $url -UseBasicParsing -TimeoutSec 2 | Out-Null; $true } catch { $false } }

if (-not (Test-Up)) {
  Start-Process conhost.exe -ArgumentList '--headless', 'powershell.exe', '-NoProfile', '-ExecutionPolicy', 'Bypass',
    '-WindowStyle', 'Hidden', '-File', "`"$PSScriptRoot\run-server.ps1`""
  # At sign-in the network and the server can take a while; wait up to 60 s.
  for ($i = 0; $i -lt 60 -and -not (Test-Up); $i++) { Start-Sleep 1 }
}

# Don't open a second window if the dashboard window is already open.
$open = Get-CimInstance Win32_Process -Filter "Name='msedge.exe' OR Name='chrome.exe'" |
  Where-Object { $_.CommandLine -match '--app=' -and $_.CommandLine -match 'NetworkDashboard' }
if (-not $open) { & "$PSScriptRoot\launch.ps1" @LaunchArgs }
