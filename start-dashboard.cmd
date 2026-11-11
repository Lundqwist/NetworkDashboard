@echo off
rem Starts the dashboard in the background and opens it on the side monitor. No console window stays open:
rem the server runs headless (conhost --headless), logs go to %LOCALAPPDATA%\NetworkDashboard.
rem Arguments go to scripts\launch.ps1, e.g. start-dashboard.cmd -X 2560
rem Start at sign-in: powershell -File scripts\install-startup.ps1   Stop: powershell -File scripts\stop-dashboard.ps1 -Window
start "" conhost.exe --headless powershell.exe -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "%~dp0scripts\start-dashboard.ps1" %*
