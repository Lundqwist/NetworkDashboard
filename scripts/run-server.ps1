<#
.SYNOPSIS
  Keeps the dashboard server running in the background (no console window when started hidden).

.DESCRIPTION
  Started headless by scripts\start-dashboard.ps1. Runs `node server/index.js` and restarts it 5 s after a crash.
  Logs in %LOCALAPPDATA%\NetworkDashboard: server-out.log / server-err.log (current run),
  server.log (starts, crashes, restarts).
  Exits at once if the server is already running. Stop it with:  .\scripts\stop-dashboard.ps1
#>
$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot -Parent
$dataDir = Join-Path $env:LOCALAPPDATA 'NetworkDashboard'
New-Item -ItemType Directory -Force $dataDir | Out-Null
$log = Join-Path $dataDir 'server.log'
$pidFile = Join-Path $dataDir 'supervisor.pid'

# One supervisor only.
if (Test-Path $pidFile) {
  $old = Get-Content $pidFile -ErrorAction SilentlyContinue
  if ($old -and (Get-Process -Id $old -ErrorAction SilentlyContinue | Where-Object ProcessName -eq 'powershell')) { exit 0 }
}
$PID | Set-Content $pidFile

function Write-Log([string]$Text) { Add-Content -Path $log -Value "$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss') [supervisor] $Text" -Encoding UTF8 }

# Keep the log from growing forever: start a new one above 5 MB.
if ((Test-Path $log) -and (Get-Item $log).Length -gt 5MB) { Move-Item $log "$log.old" -Force }

$node = (Get-Command node -ErrorAction SilentlyContinue).Source
if (-not $node) { Write-Log 'node.exe not found on PATH'; exit 1 }
if (-not (Test-Path (Join-Path $root 'node_modules'))) {
  Write-Log 'installing dependencies'
  & npm.cmd install --omit=dev --prefix $root *>> $log
}

while ($true) {
  Write-Log "starting server"
  # Live output of the current run; the previous run's files are kept as *.prev.log.
  foreach ($n in 'server-out', 'server-err') {
    if (Test-Path "$dataDir\$n.log") { Move-Item "$dataDir\$n.log" "$dataDir\$n.prev.log" -Force }
  }
  $p = Start-Process -FilePath $node -ArgumentList 'server/index.js' -WorkingDirectory $root -WindowStyle Hidden -PassThru `
    -RedirectStandardOutput "$dataDir\server-out.log" -RedirectStandardError "$dataDir\server-err.log"
  $null = $p.Handle  # keeps the handle so ExitCode is available afterwards
  $p.WaitForExit()
  if (Test-Path "$dataDir\stop") { Remove-Item "$dataDir\stop" -Force; Write-Log 'stopped on request'; break }
  Write-Log "server exited with code $($p.ExitCode); restarting in 5 s"
  Start-Sleep 5
}
Remove-Item $pidFile -Force -ErrorAction SilentlyContinue
