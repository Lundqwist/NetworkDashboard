<#
.SYNOPSIS
  Stops the background dashboard server started by start-dashboard.vbs (and its app window with -Window).
#>
param([switch]$Window)
$dataDir = Join-Path $env:LOCALAPPDATA 'NetworkDashboard'
New-Item -ItemType Directory -Force $dataDir | Out-Null
Set-Content "$dataDir\stop" 'stop'   # tells the supervisor not to restart it

Get-CimInstance Win32_Process -Filter "Name='node.exe'" |
  Where-Object { $_.CommandLine -match 'server[\\/]index\.js' } |
  ForEach-Object {
    Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue
    Write-Host "Stopped server (PID $($_.ProcessId))"
  }
if ($Window) {
  Get-CimInstance Win32_Process -Filter "Name='msedge.exe' OR Name='chrome.exe'" |
    Where-Object { $_.CommandLine -match '--app=' -and $_.CommandLine -match 'NetworkDashboard' } |
    ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
}
Start-Sleep 2
Remove-Item "$dataDir\stop" -Force -ErrorAction SilentlyContinue
