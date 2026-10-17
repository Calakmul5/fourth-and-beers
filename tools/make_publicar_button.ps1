# Draws assets/publicar.png, the Publicar button of the Tribune tab. Newsprint look, colors from the :root tokens of
# index.html (--paper, --ink, --red). Run: powershell -ExecutionPolicy Bypass -File tools\make_publicar_button.ps1
Add-Type -AssemblyName System.Drawing
$W = 200; $H = 48
$paper = [System.Drawing.ColorTranslator]::FromHtml('#F3EEE3')
$ink = [System.Drawing.ColorTranslator]::FromHtml('#161514')
$red = [System.Drawing.ColorTranslator]::FromHtml('#A3191F')
$bmp = New-Object System.Drawing.Bitmap $W, $H
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.SmoothingMode = 'AntiAlias'
$g.TextRenderingHint = 'AntiAliasGridFit'
$g.Clear($paper)
# double rule frame: thick outside, hairline inside
$thick = New-Object System.Drawing.Pen $ink, 3
$thin = New-Object System.Drawing.Pen $ink, 1
$g.DrawRectangle($thick, 1, 1, $W - 3, $H - 3)
$g.DrawRectangle($thin, 5, 5, $W - 11, $H - 11)
$center = New-Object System.Drawing.StringFormat
$center.Alignment = 'Center'; $center.LineAlignment = 'Center'
# kicker in red sans, headline in bold serif
$kicker = New-Object System.Drawing.Font 'Arial', 7, ([System.Drawing.FontStyle]::Bold)
$head = New-Object System.Drawing.Font 'Georgia', 17, ([System.Drawing.FontStyle]::Bold)
$g.DrawString('FOURTH AND BEERS TRIBUNE', $kicker, (New-Object System.Drawing.SolidBrush $red), (New-Object System.Drawing.RectangleF 0, 8, $W, 12), $center)
$g.DrawString('PUBLICAR', $head, (New-Object System.Drawing.SolidBrush $ink), (New-Object System.Drawing.RectangleF 0, 19, $W, 24), $center)
$out = Join-Path (Join-Path $PSScriptRoot '..') 'assets\publicar.png'
$bmp.Save($out, [System.Drawing.Imaging.ImageFormat]::Png)
$g.Dispose(); $bmp.Dispose()
Write-Output "wrote $out"
