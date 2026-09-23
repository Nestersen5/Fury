param(
    [string]$SourcePath = (Join-Path $PSScriptRoot '..\..\assets\fury_nametag_icons\aligned-acronym-source.png'),
    [string]$OutputDirectory = (Join-Path $PSScriptRoot '..\..\assets\fury_nametag_icons'),
    [string]$MinecraftJar = (Join-Path $env:APPDATA '.minecraft\versions\1.8.9\1.8.9.jar')
)

$ErrorActionPreference = 'Stop'

Add-Type -AssemblyName System.Drawing
Add-Type -AssemblyName System.IO.Compression.FileSystem

$sourceFile = [IO.Path]::GetFullPath($SourcePath)
$outputRoot = [IO.Path]::GetFullPath($OutputDirectory)
$minecraftJarFile = [IO.Path]::GetFullPath($MinecraftJar)

if (-not (Test-Path -LiteralPath $sourceFile -PathType Leaf)) {
    throw "Acronym source image not found: $sourceFile"
}
if (-not (Test-Path -LiteralPath $minecraftJarFile -PathType Leaf)) {
    throw "Minecraft 1.8.9 client JAR not found: $minecraftJarFile"
}

New-Item -ItemType Directory -Path $outputRoot -Force | Out-Null

# One native Minecraft Unicode cell per letter. Keeping the two letters as
# adjacent glyphs doubles the available on-screen detail compared with the old
# implementation, which squeezed an entire acronym into one 16x16 cell.
$icons = @(
    [pscustomobject]@{ Id = 'blatant_cheater';   Acronym = 'BC'; Column = 0; Row = 0; CodePoints = @(0xE000, 0xE001) },
    [pscustomobject]@{ Id = 'closet_cheater';    Acronym = 'CC'; Column = 1; Row = 0; CodePoints = @(0xE002, 0xE003) },
    [pscustomobject]@{ Id = 'confirmed_cheater'; Acronym = 'CF'; Column = 2; Row = 0; CodePoints = @(0xE004, 0xE005) },
    [pscustomobject]@{ Id = 'caution';           Acronym = 'CA'; Column = 0; Row = 1; CodePoints = @(0xE006, 0xE007) },
    [pscustomobject]@{ Id = 'sniper';            Acronym = 'SN'; Column = 1; Row = 1; CodePoints = @(0xE008, 0xE009) },
    [pscustomobject]@{ Id = 'legit_sniper';      Acronym = 'LS'; Column = 2; Row = 1; CodePoints = @(0xE00A, 0xE00B) },
    [pscustomobject]@{ Id = 'account';           Acronym = 'AC'; Column = 0; Row = 2; CodePoints = @(0xE00C, 0xE00D) },
    [pscustomobject]@{ Id = 'blacklisted';       Acronym = 'BL'; Column = 1; Row = 2; CodePoints = @(0xE00E, 0xE00F) },
    [pscustomobject]@{ Id = 'nicked';             Acronym = 'NK'; Column = 2; Row = 2; CodePoints = @(0xE010, 0xE011) }
)

function Test-ForegroundPixel {
    param([Drawing.Color]$Color)

    # ImageGen's black canvas contains a harmless 0-1 RGB noise floor. A low
    # threshold removes that canvas while retaining BL's near-black face.
    return $Color.A -ge 96 -and [Math]::Max($Color.R, [Math]::Max($Color.G, $Color.B)) -gt 4
}

function Find-VisibleBounds {
    param(
        [Drawing.Bitmap]$Bitmap,
        [Drawing.Rectangle]$Cell
    )

    $left = $Cell.Right
    $top = $Cell.Bottom
    $right = -1
    $bottom = -1

    for ($y = $Cell.Top; $y -lt $Cell.Bottom; $y++) {
        for ($x = $Cell.Left; $x -lt $Cell.Right; $x++) {
            if (-not (Test-ForegroundPixel $Bitmap.GetPixel($x, $y))) { continue }
            if ($x -lt $left) { $left = $x }
            if ($x -gt $right) { $right = $x }
            if ($y -lt $top) { $top = $y }
            if ($y -gt $bottom) { $bottom = $y }
        }
    }

    if ($right -lt $left -or $bottom -lt $top) {
        throw "No visible icon pixels found in source cell $Cell"
    }

    return [Drawing.Rectangle]::FromLTRB($left, $top, $right + 1, $bottom + 1)
}

function Find-LetterSplit {
    param(
        [Drawing.Bitmap]$Bitmap,
        [Drawing.Rectangle]$PairBounds
    )

    $searchLeft = $PairBounds.Left + [int][Math]::Floor($PairBounds.Width * 0.35)
    $searchRight = $PairBounds.Left + [int][Math]::Ceiling($PairBounds.Width * 0.65)
    $bestX = $PairBounds.Left + [int][Math]::Floor($PairBounds.Width / 2)
    $bestCount = [int]::MaxValue

    for ($x = $searchLeft; $x -lt $searchRight; $x++) {
        $count = 0
        for ($y = $PairBounds.Top; $y -lt $PairBounds.Bottom; $y++) {
            if (Test-ForegroundPixel $Bitmap.GetPixel($x, $y)) { $count++ }
        }
        if ($count -lt $bestCount) {
            $bestCount = $count
            $bestX = $x
        }
    }

    return $bestX
}

function Draw-NativeLetter {
    param(
        [Drawing.Bitmap]$Source,
        [Drawing.Rectangle]$SourceBounds,
        [Drawing.Bitmap]$Destination,
        [int]$CodePoint
    )

    $maxWidth = 14.0
    $maxHeight = 15.0
    $scale = [Math]::Min($maxWidth / $SourceBounds.Width, $maxHeight / $SourceBounds.Height)
    $width = [Math]::Max(1, [int][Math]::Round($SourceBounds.Width * $scale))
    $height = [Math]::Max(1, [int][Math]::Round($SourceBounds.Height * $scale))

    # The approved sheet already uses a common cap height. Every letter is
    # nevertheless normalized to the full 15-pixel height so no pair can drift
    # after reduction. All current glyphs fit the 14-pixel width at this scale.
    if ($height -lt 15 -and ($SourceBounds.Width * (15.0 / $SourceBounds.Height)) -le $maxWidth) {
        $height = 15
        $width = [Math]::Max(1, [int][Math]::Round($SourceBounds.Width * (15.0 / $SourceBounds.Height)))
    }

    $lowByte = $CodePoint -band 0xFF
    $cellLeft = ($lowByte -band 0x0F) * 16
    $cellTop = (($lowByte -shr 4) -band 0x0F) * 16
    $x = $cellLeft + [int][Math]::Floor((16 - $width) / 2)
    $y = $cellTop + [int][Math]::Floor((16 - $height) / 2)
    $destinationBounds = [Drawing.Rectangle]::new($x, $y, $width, $height)

    $graphics = [Drawing.Graphics]::FromImage($Destination)
    try {
        $graphics.CompositingMode = [Drawing.Drawing2D.CompositingMode]::SourceCopy
        $graphics.CompositingQuality = [Drawing.Drawing2D.CompositingQuality]::HighSpeed
        $graphics.InterpolationMode = [Drawing.Drawing2D.InterpolationMode]::NearestNeighbor
        $graphics.PixelOffsetMode = [Drawing.Drawing2D.PixelOffsetMode]::Half
        $graphics.SmoothingMode = [Drawing.Drawing2D.SmoothingMode]::None
        $graphics.DrawImage($Source, $destinationBounds, $SourceBounds, [Drawing.GraphicsUnit]::Pixel)
    } finally {
        $graphics.Dispose()
    }

    return [pscustomobject]@{
        CodePoint = $CodePoint
        Left = $x - $cellLeft
        Right = ($x - $cellLeft) + $width - 1
    }
}

function Clear-BlackCanvas {
    param([Drawing.Bitmap]$Bitmap)

    for ($y = 0; $y -lt $Bitmap.Height; $y++) {
        for ($x = 0; $x -lt $Bitmap.Width; $x++) {
            $color = $Bitmap.GetPixel($x, $y)
            if ($color.A -eq 0) { continue }
            if (-not (Test-ForegroundPixel $color)) {
                $Bitmap.SetPixel($x, $y, [Drawing.Color]::Transparent)
            }
        }
    }
}

function Get-NativeGlyphBounds {
    param(
        [Drawing.Bitmap]$Bitmap,
        [int]$CodePoint
    )

    $lowByte = $CodePoint -band 0xFF
    $cellLeft = ($lowByte -band 0x0F) * 16
    $cellTop = (($lowByte -shr 4) -band 0x0F) * 16
    $cell = [Drawing.Rectangle]::new($cellLeft, $cellTop, 16, 16)
    $bounds = Find-VisibleBounds -Bitmap $Bitmap -Cell $cell
    return [pscustomobject]@{
        CodePoint = $CodePoint
        Left = $bounds.Left - $cellLeft
        Right = $bounds.Right - $cellLeft - 1
    }
}

$source = [Drawing.Bitmap]::FromFile($sourceFile)
$page = New-Object Drawing.Bitmap 256, 256, ([Drawing.Imaging.PixelFormat]::Format32bppArgb)
$preview = New-Object Drawing.Bitmap 768, 768, ([Drawing.Imaging.PixelFormat]::Format32bppArgb)
$glyphBounds = New-Object System.Collections.Generic.List[object]

try {
    foreach ($icon in $icons) {
        $cellLeft = [int][Math]::Floor($icon.Column * $source.Width / 3.0)
        $cellTop = [int][Math]::Floor($icon.Row * $source.Height / 3.0)
        $cellRight = [int][Math]::Floor(($icon.Column + 1) * $source.Width / 3.0)
        $cellBottom = [int][Math]::Floor(($icon.Row + 1) * $source.Height / 3.0)
        $sourceCell = [Drawing.Rectangle]::FromLTRB($cellLeft, $cellTop, $cellRight, $cellBottom)
        $pairBounds = Find-VisibleBounds -Bitmap $source -Cell $sourceCell
        $splitX = Find-LetterSplit -Bitmap $source -PairBounds $pairBounds

        # Exclude a few source pixels on both sides of the inter-letter valley.
        # This prevents a bevel highlight from the neighbouring letter becoming
        # a detached one-pixel speck after nearest-neighbour reduction.
        $splitInset = [Math]::Max(2, [int][Math]::Round($pairBounds.Width * 0.015))
        $leftSearch = [Drawing.Rectangle]::FromLTRB($pairBounds.Left, $pairBounds.Top, $splitX - $splitInset, $pairBounds.Bottom)
        $rightSearch = [Drawing.Rectangle]::FromLTRB($splitX + $splitInset, $pairBounds.Top, $pairBounds.Right, $pairBounds.Bottom)
        $letterBounds = @(
            (Find-VisibleBounds -Bitmap $source -Cell $leftSearch),
            (Find-VisibleBounds -Bitmap $source -Cell $rightSearch)
        )

        for ($letterIndex = 0; $letterIndex -lt 2; $letterIndex++) {
            $drawn = Draw-NativeLetter -Source $source -SourceBounds $letterBounds[$letterIndex] -Destination $page -CodePoint $icon.CodePoints[$letterIndex]
            $glyphBounds.Add($drawn)
        }
    }

    Clear-BlackCanvas -Bitmap $page
    $glyphBounds.Clear()
    foreach ($codePoint in ($icons | ForEach-Object { $_.CodePoints })) {
        $glyphBounds.Add((Get-NativeGlyphBounds -Bitmap $page -CodePoint $codePoint))
    }

    # A nearest-neighbour preview of the exact native cells. This is the same
    # data Minecraft consumes, simply enlarged for visual QA.
    $previewGraphics = [Drawing.Graphics]::FromImage($preview)
    try {
        $previewGraphics.Clear([Drawing.Color]::Black)
        $previewGraphics.CompositingMode = [Drawing.Drawing2D.CompositingMode]::SourceOver
        $previewGraphics.InterpolationMode = [Drawing.Drawing2D.InterpolationMode]::NearestNeighbor
        $previewGraphics.PixelOffsetMode = [Drawing.Drawing2D.PixelOffsetMode]::Half
        foreach ($icon in $icons) {
            $previewCellLeft = $icon.Column * 256
            $previewCellTop = $icon.Row * 256
            for ($letterIndex = 0; $letterIndex -lt 2; $letterIndex++) {
                $lowByte = $icon.CodePoints[$letterIndex] -band 0xFF
                $sourceGlyphCell = [Drawing.Rectangle]::new(($lowByte -band 0x0F) * 16, (($lowByte -shr 4) -band 0x0F) * 16, 16, 16)
                $destGlyphCell = [Drawing.Rectangle]::new($previewCellLeft + 16 + ($letterIndex * 112), $previewCellTop + 72, 112, 112)
                $previewGraphics.DrawImage($page, $destGlyphCell, $sourceGlyphCell, [Drawing.GraphicsUnit]::Pixel)
            }
        }
    } finally {
        $previewGraphics.Dispose()
    }

    $pagePath = Join-Path $outputRoot 'unicode_page_e0.png'
    $previewPath = Join-Path $outputRoot 'glyph-preview.png'
    $page.Save($pagePath, [Drawing.Imaging.ImageFormat]::Png)
    $preview.Save($previewPath, [Drawing.Imaging.ImageFormat]::Png)
} finally {
    $preview.Dispose()
    $page.Dispose()
    $source.Dispose()
}

$zip = [IO.Compression.ZipFile]::OpenRead($minecraftJarFile)
try {
    $glyphEntry = $zip.GetEntry('assets/minecraft/font/glyph_sizes.bin')
    if (-not $glyphEntry) { throw 'Vanilla glyph_sizes.bin was not found in the Minecraft 1.8.9 client JAR.' }
    $memory = New-Object IO.MemoryStream
    try {
        $entryStream = $glyphEntry.Open()
        try { $entryStream.CopyTo($memory) } finally { $entryStream.Dispose() }
        $glyphSizes = $memory.ToArray()
    } finally {
        $memory.Dispose()
    }
} finally {
    $zip.Dispose()
}

if ($glyphSizes.Length -ne 65536) {
    throw "Unexpected vanilla glyph_sizes.bin length: $($glyphSizes.Length)"
}

foreach ($glyph in $glyphBounds) {
    $glyphSizes[$glyph.CodePoint] = (($glyph.Left -band 0x0F) -shl 4) -bor ($glyph.Right -band 0x0F)
}
[IO.File]::WriteAllBytes((Join-Path $outputRoot 'glyph_sizes.bin'), $glyphSizes)

$map = [ordered]@{}
foreach ($icon in $icons) {
    $characters = @($icon.CodePoints | ForEach-Object { [char]$_ })
    $map[$icon.Id] = [ordered]@{
        acronym = $icon.Acronym
        codePoints = @($icon.CodePoints | ForEach-Object { 'U+{0:X4}' -f $_ })
        characters = $characters
        character = -join $characters
    }
}
$map | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath (Join-Path $outputRoot 'glyph-map.json') -Encoding UTF8

Write-Output "Built 18 crisp Minecraft 1.8.9 letter glyphs from $sourceFile"
