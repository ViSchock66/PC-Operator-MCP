param(
  [switch]$NoBrowser,
  [switch]$ForceBrowser
)

$rootDir = Split-Path -Parent $PSScriptRoot
$configFile = Join-Path $rootDir "data\config.json"
$port = 3333
if (Test-Path $configFile) {
  try {
    $cfg = Get-Content $configFile -Raw -Encoding UTF8 | ConvertFrom-Json
    if ($cfg.port -and [int]$cfg.port -gt 0) {
      $port = [int]$cfg.port
    }
  } catch {}
}

function Test-LocalPort([int]$p) {
  try {
    $c = New-Object Net.Sockets.TcpClient('127.0.0.1', $p)
    $c.Close()
    return $true
  } catch {
    return $false
  }
}

if (-not (Test-LocalPort $port)) {
  $vbs = Join-Path $PSScriptRoot "start-daemon-hidden.vbs"
  Start-Process "wscript.exe" -ArgumentList "`"$vbs`"" -WindowStyle Hidden
  for ($i = 0; $i -lt 32; $i++) {
    Start-Sleep -Milliseconds 250
    if (Test-LocalPort $port) { break }
  }
}

if (-not $NoBrowser) {
  $url = "http://127.0.0.1:$port/admin"
  $nativeExe = Join-Path $PSScriptRoot "host\dist\pc-operator-panel.exe"

  if (-not $ForceBrowser -and (Test-Path $nativeExe)) {
    Start-Process -FilePath $nativeExe -ArgumentList @("--host", "127.0.0.1", "--port", "$port", "--url", $url)
    return
  }

  # Fallback web portátil (sin .NET 8 SDK o si se solicita navegador): Chrome --app= -> Edge --app= -> navegador por defecto.
  $candidates = @(
    "C:\Program Files\Google\Chrome\Application\chrome.exe",
    "C:\Program Files (x86)\Google\Chrome\Application\chrome.exe",
    (Join-Path $env:LOCALAPPDATA "Google\Chrome\Application\chrome.exe"),
    "C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe",
    "C:\Program Files\Microsoft\Edge\Application\msedge.exe"
  )
  $browser = $candidates | Where-Object { $_ -and (Test-Path $_) } | Select-Object -First 1
  if ($browser) { Start-Process $browser -ArgumentList "--app=$url" }
  else { Start-Process $url }
}
