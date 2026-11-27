$ErrorActionPreference = "Stop"

Add-Type -AssemblyName System.Drawing

$assetsDir = $PSScriptRoot
$panelDir = Split-Path -Parent $assetsDir
$rootDir = Split-Path -Parent $panelDir
$publicDir = Join-Path $rootDir "web\public"

function Add-RoundedRectPath {
  param(
    [System.Drawing.Drawing2D.GraphicsPath]$Path,
    [float]$X, [float]$Y, [float]$W, [float]$H, [float]$R
  )
  $d = $R * 2
  $Path.AddArc($X, $Y, $d, $d, 180, 90)
  $Path.AddArc($X + $W - $d, $Y, $d, $d, 270, 90)
  $Path.AddArc($X + $W - $d, $Y + $H - $d, $d, $d, 0, 90)
  $Path.AddArc($X, $Y + $H - $d, $d, $d, 90, 90)
  $Path.CloseFigure()
}

function New-BridgeChipBitmap {
  param([int]$Size)

  $bmp = New-Object System.Drawing.Bitmap($Size, $Size, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
  $g.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
  $g.Clear([System.Drawing.Color]::Transparent)

  $s = $Size / 32.0

  # Outer graphite squircle
  $bgPath = New-Object System.Drawing.Drawing2D.GraphicsPath
  Add-RoundedRectPath -Path $bgPath -X (1.5 * $s) -Y (1.5 * $s) -W (29.0 * $s) -H (29.0 * $s) -R (7.0 * $s)
  $bgBrush = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(255, 24, 24, 27))
  $borderPen = New-Object System.Drawing.Pen([System.Drawing.Color]::FromArgb(255, 63, 63, 70), [Math]::Max(1.0, 1.3 * $s))
  $g.FillPath($bgBrush, $bgPath)
  $g.DrawPath($borderPen, $bgPath)

  # Top bridge bracket
  $topPen = New-Object System.Drawing.Pen([System.Drawing.Color]::FromArgb(255, 244, 244, 245), [Math]::Max(1.4, 1.9 * $s))
  $topPen.StartCap = [System.Drawing.Drawing2D.LineCap]::Round
  $topPen.EndCap = [System.Drawing.Drawing2D.LineCap]::Round
  $topPen.LineJoin = [System.Drawing.Drawing2D.LineJoin]::Round
  $topPath = New-Object System.Drawing.Drawing2D.GraphicsPath
  $topPath.AddLine(9.5 * $s, 13.0 * $s, 9.5 * $s, 8.5 * $s)
  $topPath.AddLine(9.5 * $s, 8.5 * $s, 22.5 * $s, 8.5 * $s)
  $topPath.AddLine(22.5 * $s, 8.5 * $s, 22.5 * $s, 13.0 * $s)
  $g.DrawPath($topPen, $topPath)

  # Bottom bridge bracket
  $botPen = New-Object System.Drawing.Pen([System.Drawing.Color]::FromArgb(255, 161, 161, 170), [Math]::Max(1.2, 1.8 * $s))
  $botPen.StartCap = [System.Drawing.Drawing2D.LineCap]::Round
  $botPen.EndCap = [System.Drawing.Drawing2D.LineCap]::Round
  $botPen.LineJoin = [System.Drawing.Drawing2D.LineJoin]::Round
  $botPath = New-Object System.Drawing.Drawing2D.GraphicsPath
  $botPath.AddLine(9.5 * $s, 19.0 * $s, 9.5 * $s, 23.5 * $s)
  $botPath.AddLine(9.5 * $s, 23.5 * $s, 22.5 * $s, 23.5 * $s)
  $botPath.AddLine(22.5 * $s, 23.5 * $s, 22.5 * $s, 19.0 * $s)
  $g.DrawPath($botPen, $botPath)

  # Center link bar
  $midPen = New-Object System.Drawing.Pen([System.Drawing.Color]::FromArgb(255, 244, 244, 245), [Math]::Max(1.2, 1.8 * $s))
  $midPen.StartCap = [System.Drawing.Drawing2D.LineCap]::Round
  $midPen.EndCap = [System.Drawing.Drawing2D.LineCap]::Round
  $g.DrawLine($midPen, 11.8 * $s, 16.0 * $s, 20.2 * $s, 16.0 * $s)

  # Left & right architectural square nodes
  $nodeBrush = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(255, 244, 244, 245))
  $leftNode = New-Object System.Drawing.Drawing2D.GraphicsPath
  Add-RoundedRectPath -Path $leftNode -X (7.5 * $s) -Y (14.0 * $s) -W (4.0 * $s) -H (4.0 * $s) -R (1.2 * $s)
  $g.FillPath($nodeBrush, $leftNode)

  $rightNode = New-Object System.Drawing.Drawing2D.GraphicsPath
  Add-RoundedRectPath -Path $rightNode -X (20.5 * $s) -Y (14.0 * $s) -W (4.0 * $s) -H (4.0 * $s) -R (1.2 * $s)
  $g.FillPath($nodeBrush, $rightNode)

  $rightNode.Dispose()
  $leftNode.Dispose()
  $nodeBrush.Dispose()
  $midPen.Dispose()
  $botPath.Dispose()
  $botPen.Dispose()
  $topPath.Dispose()
  $topPen.Dispose()
  $borderPen.Dispose()
  $bgBrush.Dispose()
  $bgPath.Dispose()
  $g.Dispose()

  return $bmp
}

function Write-MultiSizeIco {
  param(
    [string]$OutPath,
    [int[]]$Sizes = @(16, 24, 32, 48, 256)
  )
  $frames = New-Object System.Collections.Generic.List[byte[]]
  foreach ($sz in $Sizes) {
    $bmp = New-BridgeChipBitmap -Size $sz
    $ms = New-Object System.IO.MemoryStream
    $bmp.Save($ms, [System.Drawing.Imaging.ImageFormat]::Png)
    $frames.Add($ms.ToArray())
    $ms.Dispose()
    $bmp.Dispose()
  }

  $fs = New-Object System.IO.FileStream($OutPath, [System.IO.FileMode]::Create, [System.IO.FileAccess]::Write)
  $bw = New-Object System.IO.BinaryWriter($fs)
  $bw.Write([uint16]0)
  $bw.Write([uint16]1)
  $bw.Write([uint16]$Sizes.Count)

  $offset = 6 + (16 * $Sizes.Count)
  for ($i = 0; $i -lt $Sizes.Count; $i++) {
    $sz = $Sizes[$i]
    $png = $frames[$i]
    $dimByte = if ($sz -ge 256) { [byte]0 } else { [byte]$sz }
    $bw.Write($dimByte)
    $bw.Write($dimByte)
    $bw.Write([byte]0)
    $bw.Write([byte]0)
    $bw.Write([uint16]1)
    $bw.Write([uint16]32)
    $bw.Write([uint32]$png.Length)
    $bw.Write([uint32]$offset)
    $offset += $png.Length
  }

  foreach ($png in $frames) {
    $bw.Write($png)
  }

  $bw.Dispose()
  $fs.Dispose()
}

$bmp32 = New-BridgeChipBitmap -Size 32
$bmp32.Save((Join-Path $publicDir "icon-32.png"), [System.Drawing.Imaging.ImageFormat]::Png)
$bmp32.Dispose()

$bmp192 = New-BridgeChipBitmap -Size 192
$bmp192.Save((Join-Path $publicDir "icon-192.png"), [System.Drawing.Imaging.ImageFormat]::Png)
$bmp192.Dispose()

Write-MultiSizeIco -OutPath (Join-Path $assetsDir "pc-operator.ico")
Write-Output "Icons generated successfully."
