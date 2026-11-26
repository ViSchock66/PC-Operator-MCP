param([switch]$NoBrowser)

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
  $edge = "C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe"
  $edge64 = "C:\Program Files\Microsoft\Edge\Application\msedge.exe"
  $chrome = "C:\Program Files\Google\Chrome\Application\chrome.exe"
  $url = "http://127.0.0.1:$port/admin"
  if (Test-Path $edge) { Start-Process $edge -ArgumentList "--app=$url" }
  elseif (Test-Path $edge64) { Start-Process $edge64 -ArgumentList "--app=$url" }
  elseif (Test-Path $chrome) { Start-Process $chrome -ArgumentList "--app=$url" }
  else { Start-Process $url }
}
