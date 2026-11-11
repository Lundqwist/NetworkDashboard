@echo off
rem Starts the dashboard server (minimised) and opens it on the side monitor.
rem Put a shortcut to this file in shell:startup to launch at login.
cd /d "%~dp0"
if not exist node_modules (
  echo Installing dependencies...
  call npm install --omit=dev
)
start "Network Dashboard server" /min cmd /c "node server/index.js"
timeout /t 3 /nobreak >nul
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\launch.ps1" %*
