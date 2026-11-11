<#
.SYNOPSIS
  Opens the dashboard as a chrome-less app window on your side monitor.

.EXAMPLE
  .\scripts\launch.ps1                       # first 1920x1080 side monitor (leftmost), found automatically
  .\scripts\launch.ps1 -X 2560               # a specific monitor: its top-left corner in Windows display coordinates
  .\scripts\launch.ps1 -Kiosk                # true full screen (F11-style)
#>
param(
  [string]$Url = "http://localhost:3000",
  [int]$X = 1920,
  [int]$Y = 0,
  [int]$Width = 1920,
  [int]$Height = 1080,
  [switch]$Kiosk
)

# Without -X/-Y: use the first non-primary screen of the requested size (falls back to any
# non-primary screen, then to 1920,0).
if (-not $PSBoundParameters.ContainsKey('X') -and -not $PSBoundParameters.ContainsKey('Y')) {
  Add-Type -AssemblyName System.Windows.Forms
  $others = [System.Windows.Forms.Screen]::AllScreens | Where-Object { -not $_.Primary } | Sort-Object { $_.Bounds.X }
  $screen = @($others | Where-Object { $_.Bounds.Width -eq $Width -and $_.Bounds.Height -eq $Height }) + @($others) | Select-Object -First 1
  if ($screen) { $X = $screen.Bounds.X; $Y = $screen.Bounds.Y }
}

if (-not $Url) { $Url = "http://localhost:3000" }  # never open the browser without an address

$candidates = @(
  "${env:ProgramFiles(x86)}\Microsoft\Edge\Application\msedge.exe",
  "$env:ProgramFiles\Microsoft\Edge\Application\msedge.exe",
  "$env:ProgramFiles\Google\Chrome\Application\chrome.exe",
  "${env:ProgramFiles(x86)}\Google\Chrome\Application\chrome.exe",
  "$env:LOCALAPPDATA\Google\Chrome\Application\chrome.exe"
)
$browser = $candidates | Where-Object { $_ -and (Test-Path $_) } | Select-Object -First 1
if (-not $browser) {
  Write-Warning "Edge/Chrome not found - opening in the default browser instead."
  Start-Process $Url
  exit
}

# A separate profile makes the browser honour the window position/size every time.
$profileDir = Join-Path $env:LOCALAPPDATA "NetworkDashboard\browser-profile"
$browserArgs = @(
  "--app=$Url",
  "--user-data-dir=`"$profileDir`"",
  "--window-position=$X,$Y",
  "--window-size=$Width,$Height",
  "--no-first-run",
  "--disable-features=Translate"
)
if ($Kiosk) { $browserArgs += "--start-fullscreen" } else { $browserArgs += "--start-maximized" }

Start-Process -FilePath $browser -ArgumentList $browserArgs
