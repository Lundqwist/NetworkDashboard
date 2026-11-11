<#
.SYNOPSIS
  Adds "Network Dashboard" shortcuts (with the Ndb icon) that start the server in the background and open the window.
  No admin rights; nothing in the registry or Task Scheduler.

.DESCRIPTION
  By default the shortcut goes in your Startup folder (shell:startup), so the dashboard starts when you sign in.
  -StartMenu puts it in your Start menu (All apps) instead, so you can open the dashboard by hand.
  Opening it while the dashboard runs just brings up the window again if it was closed.

.EXAMPLE
  .\scripts\install-startup.ps1                      # start at sign-in (side monitor found automatically)
  .\scripts\install-startup.ps1 -StartMenu           # Start menu entry
  .\scripts\install-startup.ps1 -LaunchArgs '-X 2560'
  .\scripts\install-startup.ps1 -Remove              # or: -StartMenu -Remove
#>
param([switch]$StartMenu, [switch]$Remove, [string]$LaunchArgs = '')

$root = Split-Path $PSScriptRoot -Parent
$folder = if ($StartMenu) { [Environment]::GetFolderPath('Programs') } else { [Environment]::GetFolderPath('Startup') }
$lnk = Join-Path $folder 'Network Dashboard.lnk'

if ($Remove) {
  if (Test-Path $lnk) { Remove-Item $lnk; Write-Host "Removed $lnk" } else { Write-Host 'No shortcut to remove.' }
  return
}

$sh = New-Object -ComObject WScript.Shell
$s = $sh.CreateShortcut($lnk)
$s.TargetPath = Join-Path $env:SystemRoot 'System32\conhost.exe'
$s.Arguments = "--headless powershell.exe -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$root\scripts\start-dashboard.ps1`" $LaunchArgs".Trim()
$s.WorkingDirectory = $root
$s.IconLocation = "$root\public\favicon.ico,0"
$s.Description = 'Starts the Network Dashboard server in the background and opens it on the side monitor'
$s.WindowStyle = 7  # minimized, in case anything shows
$s.Save()
Write-Host "Added $lnk"
