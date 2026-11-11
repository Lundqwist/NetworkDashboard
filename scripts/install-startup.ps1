<#
.SYNOPSIS
  Starts the dashboard when you sign in to Windows: adds a "Network Dashboard" shortcut (with the Ndb icon)
  to your Startup folder (shell:startup). No admin rights; nothing in the registry or Task Scheduler.

.EXAMPLE
  .\scripts\install-startup.ps1                 # add the shortcut (side monitor found automatically)
  .\scripts\install-startup.ps1 -LaunchArgs '-X 2560'
  .\scripts\install-startup.ps1 -Remove
#>
param([switch]$Remove, [string]$LaunchArgs = '')

$root = Split-Path $PSScriptRoot -Parent
$lnk = Join-Path ([Environment]::GetFolderPath('Startup')) 'Network Dashboard.lnk'

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
