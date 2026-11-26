$ErrorActionPreference = "Stop"

Add-Type -AssemblyName System.Drawing

$assetsDir = $PSScriptRoot
$panelDir = Split-Path -Parent $assetsDir
$rootDir = Split-Path -Parent $panelDir
$publicDir = Join-Path $rootDir "src\public"

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

  # Outer squircle
  $bgPath = New-Object System.Drawing.Drawing2D.GraphicsPath
  Add-RoundedRectPath -Path $bgPath -X (1.5 * $s) -Y (1.5 * $s) -W (29.0 * $s) -H (29.0 * $s) -R (7.5 * $s)
  $bgBrush = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(255, 13, 16, 23))
  $borderPen = New-Object System.Drawing.Pen([System.Drawing.Color]::FromArgb(255, 42, 50, 68), [Math]::Max(1.0, 1.3 * $s))
  $g.FillPath($bgBrush, $bgPath)
  $g.DrawPath($borderPen, $bgPath)

  # Top bridge bracket
  $topPen = New-Object System.Drawing.Pen([System.Drawing.Color]::FromArgb(255, 244, 244, 245), [Math]::Max(1.4, 2.0 * $s))
  $topPen.StartCap = [System.Drawing.Drawing2D.LineCap]::Round
  $topPen.EndCap = [System.Drawing.Drawing2D.LineCap]::Round
  $topPen.LineJoin = [System.Drawing.Drawing2D.LineJoin]::Round
  $topPath = New-Object System.Drawing.Drawing2D.GraphicsPath
  $topPath.AddLine(8.5 * $s, 13.5 * $s, 8.5 * $s, 8.5 * $s)
  $topPath.AddLine(8.5 * $s, 8.5 * $s, 23.5 * $s, 8.5 * $s)
  $topPath.AddLine(23.5 * $s, 8.5 * $s, 23.5 * $s, 13.5 * $s)
  $g.DrawPath($topPen, $topPath)

  # Bottom bridge bracket
  $botPen = New-Object System.Drawing.Pen([System.Drawing.Color]::FromArgb(255, 100, 116, 139), [Math]::Max(1.2, 1.8 * $s))
  $botPen.StartCap = [System.Drawing.Drawing2D.LineCap]::Round
  $botPen.EndCap = [System.Drawing.Drawing2D.LineCap]::Round
  $botPen.LineJoin = [System.Drawing.Drawing2D.LineJoin]::Round
  $botPath = New-Object System.Drawing.Drawing2D.GraphicsPath
  $botPath.AddLine(8.5 * $s, 18.5 * $s, 8.5 * $s, 23.5 * $s)
  $botPath.AddLine(8.5 * $s, 23.5 * $s, 23.5 * $s, 23.5 * $s)
  $botPath.AddLine(23.5 * $s, 23.5 * $s, 23.5 * $s, 18.5 * $s)
  $g.DrawPath($botPen, $botPath)

  # Center link line
  $midPen = New-Object System.Drawing.Pen([System.Drawing.Color]::FromArgb(255, 148, 163, 184), [Math]::Max(1.1, 1.7 * $s))
  $midPen.StartCap = [System.Drawing.Drawing2D.LineCap]::Round
  $midPen.EndCap = [System.Drawing.Drawing2D.LineCap]::Round
  $g.DrawLine($midPen, 10.8 * $s, 16.0 * $s, 21.2 * $s, 16.0 * $s)

  # Left & right node rings
  $nodeFill = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(255, 24, 28, 36))
  $nodePen = New-Object System.Drawing.Pen([System.Drawing.Color]::FromArgb(255, 244, 244, 245), [Math]::Max(1.2, 1.7 * $s))
  $rNode = 2.3 * $s
  $g.FillEllipse($nodeFill, (8.5 * $s - $rNode), (16.0 * $s - $rNode), ($rNode * 2), ($rNode * 2))
  $g.DrawEllipse($nodePen, (8.5 * $s - $rNode), (16.0 * $s - $rNode), ($rNode * 2), ($rNode * 2))
  $g.FillEllipse($nodeFill, (23.5 * $s - $rNode), (16.0 * $s - $rNode), ($rNode * 2), ($rNode * 2))
  $g.DrawEllipse($nodePen, (23.5 * $s - $rNode), (16.0 * $s - $rNode), ($rNode * 2), ($rNode * 2))

  # Center emerald core with dark cutout ring
  $cutBrush = $bgBrush
  $rCut = 3.5 * $s
  $g.FillEllipse($cutBrush, (16.0 * $s - $rCut), (16.0 * $s - $rCut), ($rCut * 2), ($rCut * 2))
  $coreBrush = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(255, 34, 197, 94))
  $rCore = 2.6 * $s
  $g.FillEllipse($coreBrush, (16.0 * $s - $rCore), (16.0 * $s - $rCore), ($rCore * 2), ($rCore * 2))

  $coreBrush.Dispose()
  $nodePen.Dispose()
  $nodeFill.Dispose()
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
  # ICONDIR header
  $bw.Write([uint16]0)
  $bw.Write([uint16]1)
  $bw.Write([uint16]$Sizes.Count)

  $offset = 6 + (16 * $Sizes.Count)
  for ($i = 0; $i -lt $Sizes.Count; $i++) {
    $sz = $Sizes[$i]
    $png = $frames[$i]
    $dimByte = if ($sz -ge 256) { [byte]0 } else { [byte]$sz }
    $bw.Write($dimByte) # width
    $bw.Write($dimByte) # height
    $bw.Write([byte]0)  # color count
    $bw.Write([byte]0)  # reserved
    $bw.Write([uint16]1) # planes
    $bw.Write([uint16]32) # bpp
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
