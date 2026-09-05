# Mechanical atlas packing only. Seam painting is performed with imagegen.
param([string]$OutputName = 'terrain-layout.png')
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing
$atlasRoot = Join-Path $PSScriptRoot '../assets/textures/biomes'
$regionNames = @(
  'r1c1-snow', 'r1c2-frost', 'r1c3-amethyst',
  'r2c1-swamp', 'r2c2-original', 'r2c3-crystal',
  'r3c1-root-marsh', 'r3c2-lake', 'r3c3-limestone'
)
$tilePixels = 1024
$atlasBitmap = [System.Drawing.Bitmap]::new(3072, 3072)
$atlasGraphics = [System.Drawing.Graphics]::FromImage($atlasBitmap)
$atlasGraphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
try {
  for ($regionIndex = 0; $regionIndex -lt 9; $regionIndex++) {
    $regionPath = Join-Path $atlasRoot ('regions/' + $regionNames[$regionIndex] + '.png')
    $regionImage = [System.Drawing.Image]::FromFile($regionPath)
    try {
      $atlasGraphics.DrawImage($regionImage, ($regionIndex % 3) * $tilePixels, [Math]::Floor($regionIndex / 3) * $tilePixels, $tilePixels, $tilePixels)
    } finally { $regionImage.Dispose() }
  }
  $atlasBitmap.Save((Join-Path $atlasRoot $OutputName), [System.Drawing.Imaging.ImageFormat]::Png)
} finally {
  $atlasGraphics.Dispose()
  $atlasBitmap.Dispose()
}
Write-Output ('Packed 9 regions into ' + $OutputName + ' (3072 x 3072). This layout still needs seam healing.')
