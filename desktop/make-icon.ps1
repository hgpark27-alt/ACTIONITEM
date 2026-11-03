# 아이콘 생성: 웹(파비콘·폰 홈화면) PNG + 윈도우 exe용 ICO
Add-Type -AssemblyName System.Drawing
$root = Split-Path $PSScriptRoot -Parent
New-Item -ItemType Directory -Force "$root\icons" | Out-Null

function Draw([int]$s) {
  $bmp = New-Object System.Drawing.Bitmap $s, $s
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.SmoothingMode = 'AntiAlias'
  $g.Clear([System.Drawing.Color]::Transparent)
  $r = [single]($s * 0.22); $d = $r * 2; $m = [single]($s * 0.04); $w = $s - 2 * $m
  $path = New-Object System.Drawing.Drawing2D.GraphicsPath
  $path.AddArc($m, $m, $d, $d, 180, 90)
  $path.AddArc($m + $w - $d, $m, $d, $d, 270, 90)
  $path.AddArc($m + $w - $d, $m + $w - $d, $d, $d, 0, 90)
  $path.AddArc($m, $m + $w - $d, $d, $d, 90, 90)
  $path.CloseFigure()
  $g.FillPath((New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(29, 28, 26))), $path)
  $pen = New-Object System.Drawing.Pen ([System.Drawing.Color]::White), ([single]($s * 0.11))
  $pen.StartCap = 'Round'; $pen.EndCap = 'Round'; $pen.LineJoin = 'Round'
  $pts = [System.Drawing.PointF[]]@(
    (New-Object System.Drawing.PointF ($s * 0.28), ($s * 0.52)),
    (New-Object System.Drawing.PointF ($s * 0.44), ($s * 0.68)),
    (New-Object System.Drawing.PointF ($s * 0.73), ($s * 0.36)))
  $g.DrawLines($pen, $pts)
  $g.Dispose()
  return $bmp
}
function PngBytes([int]$s) {
  $b = Draw $s; $ms = New-Object System.IO.MemoryStream
  $b.Save($ms, [System.Drawing.Imaging.ImageFormat]::Png); $b.Dispose()
  return ,$ms.ToArray()
}

[IO.File]::WriteAllBytes("$root\icons\icon-512.png", (PngBytes 512))
[IO.File]::WriteAllBytes("$root\icons\apple-touch-icon.png", (PngBytes 180))
[IO.File]::WriteAllBytes("$root\icons\favicon-32.png", (PngBytes 32))

# ICO (PNG 내장 방식, 16~256)
$sizes = 16, 24, 32, 48, 64, 128, 256
$imgs = $sizes | ForEach-Object { ,(PngBytes $_) }
$ms = New-Object System.IO.MemoryStream
$bw = New-Object System.IO.BinaryWriter $ms
$bw.Write([uint16]0); $bw.Write([uint16]1); $bw.Write([uint16]$sizes.Count)
$off = 6 + 16 * $sizes.Count
for ($i = 0; $i -lt $sizes.Count; $i++) {
  $sz = $sizes[$i]; $len = $imgs[$i].Length
  $bw.Write([byte]($sz % 256)); $bw.Write([byte]($sz % 256)); $bw.Write([byte]0); $bw.Write([byte]0)
  $bw.Write([uint16]1); $bw.Write([uint16]32); $bw.Write([uint32]$len); $bw.Write([uint32]$off)
  $off += $len
}
foreach ($im in $imgs) { $bw.Write($im) }
[IO.File]::WriteAllBytes("$PSScriptRoot\app.ico", $ms.ToArray())
"icons done"
