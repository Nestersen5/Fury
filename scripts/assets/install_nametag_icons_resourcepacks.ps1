param(
    [string]$ResourcePackDirectory = (Join-Path $env:APPDATA '.minecraft\resourcepacks'),
    [string]$AssetDirectory = (Join-Path $PSScriptRoot '..\..\assets\fury_nametag_icons'),
    [string]$BackupDirectory = '',
    [switch]$WhatIf
)

$ErrorActionPreference = 'Stop'

Add-Type -AssemblyName System.IO.Compression
Add-Type -AssemblyName System.IO.Compression.FileSystem
Add-Type -AssemblyName System.Drawing

$glyphEntryName = 'assets/minecraft/font/glyph_sizes.bin'
$pageEntryName = 'assets/minecraft/textures/font/unicode_page_e0.png'
$iconCodePoints = 0xE000..0xE011

function Full-Path([string]$Path) {
    return [IO.Path]::GetFullPath($Path)
}

function Read-StreamBytes([IO.Stream]$Stream) {
    $memory = New-Object IO.MemoryStream
    try {
        $Stream.CopyTo($memory)
        return $memory.ToArray()
    } finally {
        $memory.Dispose()
    }
}

function Read-ZipEntryBytes([IO.Compression.ZipArchiveEntry]$Entry) {
    $stream = $Entry.Open()
    try { return Read-StreamBytes $stream } finally { $stream.Dispose() }
}

function Bytes-Sha256([byte[]]$Bytes) {
    $sha = [Security.Cryptography.SHA256]::Create()
    try {
        return ([BitConverter]::ToString($sha.ComputeHash($Bytes))).Replace('-', '').ToLowerInvariant()
    } finally {
        $sha.Dispose()
    }
}

function Find-ZipEntries([IO.Compression.ZipArchive]$Archive, [string]$Name) {
    return @($Archive.Entries | Where-Object {
        $_.FullName.TrimStart('/').Equals($Name, [StringComparison]::OrdinalIgnoreCase)
    })
}

function Patched-GlyphSizes([byte[]]$Original, [byte[]]$Expected) {
    if ($Original.Length -ne 65536) {
        throw "glyph_sizes.bin must contain 65,536 bytes; got $($Original.Length)."
    }
    $patched = New-Object byte[] $Original.Length
    [Array]::Copy($Original, $patched, $Original.Length)
    foreach ($codePoint in $iconCodePoints) { $patched[$codePoint] = $Expected[$codePoint] }
    return $patched
}

function Verify-GlyphBytes([byte[]]$Bytes, [byte[]]$Expected) {
    if ($Bytes.Length -ne 65536 -or $Expected.Length -ne 65536) { return $false }
    foreach ($codePoint in $iconCodePoints) {
        if ($Expected[$codePoint] -eq 0 -or $Bytes[$codePoint] -ne $Expected[$codePoint]) { return $false }
    }
    return $true
}

function Bitmap-FromPngBytes([byte[]]$Bytes) {
    $memory = New-Object IO.MemoryStream(,$Bytes)
    try {
        $image = [Drawing.Image]::FromStream($memory)
        try { return New-Object Drawing.Bitmap $image } finally { $image.Dispose() }
    } finally {
        $memory.Dispose()
    }
}

function Bitmap-ToPngBytes([Drawing.Bitmap]$Bitmap) {
    $memory = New-Object IO.MemoryStream
    try {
        $Bitmap.Save($memory, [Drawing.Imaging.ImageFormat]::Png)
        return $memory.ToArray()
    } finally {
        $memory.Dispose()
    }
}

function Merge-IconPageBytes([byte[]]$Original) {
    $source = Bitmap-FromPngBytes $pageBytes
    $destination = if ($Original -and $Original.Length -gt 0) {
        Bitmap-FromPngBytes $Original
    } else {
        New-Object Drawing.Bitmap 256, 256, ([Drawing.Imaging.PixelFormat]::Format32bppArgb)
    }

    try {
        if ($source.Width -ne 256 -or $source.Height -ne 256) {
            throw "Fury Unicode page must be 256x256; got $($source.Width)x$($source.Height)."
        }
        if ($destination.Width -ne 256 -or $destination.Height -ne 256) {
            throw "Existing Unicode page must be 256x256; got $($destination.Width)x$($destination.Height)."
        }

        $graphics = [Drawing.Graphics]::FromImage($destination)
        try {
            $graphics.CompositingMode = [Drawing.Drawing2D.CompositingMode]::SourceCopy
            $graphics.InterpolationMode = [Drawing.Drawing2D.InterpolationMode]::NearestNeighbor
            $graphics.PixelOffsetMode = [Drawing.Drawing2D.PixelOffsetMode]::Half
            foreach ($codePoint in $iconCodePoints) {
                $lowByte = $codePoint -band 0xFF
                $cell = [Drawing.Rectangle]::new(($lowByte -band 0x0F) * 16, (($lowByte -shr 4) -band 0x0F) * 16, 16, 16)
                $graphics.DrawImage($source, $cell, $cell, [Drawing.GraphicsUnit]::Pixel)
            }
        } finally {
            $graphics.Dispose()
        }

        return Bitmap-ToPngBytes $destination
    } finally {
        $destination.Dispose()
        $source.Dispose()
    }
}

function Verify-IconPageBytes([byte[]]$Bytes) {
    $candidate = Bitmap-FromPngBytes $Bytes
    $expected = Bitmap-FromPngBytes $pageBytes
    try {
        if ($candidate.Width -ne 256 -or $candidate.Height -ne 256) { return $false }
        foreach ($codePoint in $iconCodePoints) {
            $lowByte = $codePoint -band 0xFF
            $left = ($lowByte -band 0x0F) * 16
            $top = (($lowByte -shr 4) -band 0x0F) * 16
            for ($y = 0; $y -lt 16; $y++) {
                for ($x = 0; $x -lt 16; $x++) {
                    if ($candidate.GetPixel($left + $x, $top + $y).ToArgb() -ne $expected.GetPixel($left + $x, $top + $y).ToArgb()) {
                        return $false
                    }
                }
            }
        }
        return $true
    } finally {
        $expected.Dispose()
        $candidate.Dispose()
    }
}

function Save-Manifest([string]$Path, $Manifest) {
    $Manifest | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $Path -Encoding UTF8
}

function Update-ZipEntriesDotNet([string]$ZipPath, [string]$StageRoot) {
    $archive = [IO.Compression.ZipFile]::Open($ZipPath, [IO.Compression.ZipArchiveMode]::Update)
    try {
        foreach ($entryName in @($glyphEntryName, $pageEntryName)) {
            @(Find-ZipEntries $archive $entryName) | ForEach-Object { $_.Delete() }
            $entry = $archive.CreateEntry($entryName, [IO.Compression.CompressionLevel]::Optimal)
            $sourcePath = Join-Path $StageRoot ($entryName.Replace('/', '\'))
            [byte[]]$bytes = [IO.File]::ReadAllBytes($sourcePath)
            $stream = $entry.Open()
            try { $stream.Write($bytes, 0, $bytes.Length) } finally { $stream.Dispose() }
        }
    } finally {
        $archive.Dispose()
    }
}

$resourcePackRoot = Full-Path $ResourcePackDirectory
$assetRoot = Full-Path $AssetDirectory
$pagePath = Join-Path $assetRoot 'unicode_page_e0.png'
$fallbackGlyphPath = Join-Path $assetRoot 'glyph_sizes.bin'
$sevenZipCommand = Get-Command 7z -ErrorAction SilentlyContinue

if (-not (Test-Path -LiteralPath $resourcePackRoot -PathType Container)) {
    throw "Resource-pack directory not found: $resourcePackRoot"
}
if (-not (Test-Path -LiteralPath $pagePath -PathType Leaf)) {
    throw "Icon glyph page not found: $pagePath"
}
if (-not (Test-Path -LiteralPath $fallbackGlyphPath -PathType Leaf)) {
    throw "Fallback glyph_sizes.bin not found: $fallbackGlyphPath"
}
if (-not $sevenZipCommand) {
    throw '7z.exe is required for lossless ZIP updates but was not found on PATH.'
}
$sevenZip = $sevenZipCommand.Source

[byte[]]$pageBytes = [IO.File]::ReadAllBytes($pagePath)
[byte[]]$fallbackGlyphBytes = [IO.File]::ReadAllBytes($fallbackGlyphPath)
if (-not (Verify-GlyphBytes $fallbackGlyphBytes $fallbackGlyphBytes)) {
    throw "Fallback glyph_sizes.bin does not contain the expected Fury icon widths: $fallbackGlyphPath"
}
$pageHash = Bytes-Sha256 $pageBytes

$items = @(Get-ChildItem -LiteralPath $resourcePackRoot -Force | Sort-Object Name)
$validPacks = New-Object System.Collections.Generic.List[object]
$skipped = New-Object System.Collections.Generic.List[object]

foreach ($item in $items) {
    if ($item.PSIsContainer) {
        if (Test-Path -LiteralPath (Join-Path $item.FullName 'pack.mcmeta') -PathType Leaf) {
            $validPacks.Add([pscustomobject]@{ Item = $item; Kind = 'folder' })
        } else {
            $skipped.Add([pscustomobject]@{ Name = $item.Name; Reason = 'folder has no root pack.mcmeta' })
        }
        continue
    }
    if ($item.Extension -ine '.zip') {
        $skipped.Add([pscustomobject]@{ Name = $item.Name; Reason = 'not a ZIP resource pack' })
        continue
    }
    try {
        $archive = [IO.Compression.ZipFile]::OpenRead($item.FullName)
        try {
            $hasPackMeta = (Find-ZipEntries $archive 'pack.mcmeta').Count -gt 0
        } finally {
            $archive.Dispose()
        }
        if ($hasPackMeta) {
            $validPacks.Add([pscustomobject]@{ Item = $item; Kind = 'zip' })
        } else {
            $skipped.Add([pscustomobject]@{ Name = $item.Name; Reason = 'ZIP has no root pack.mcmeta' })
        }
    } catch {
        $skipped.Add([pscustomobject]@{ Name = $item.Name; Reason = "invalid ZIP: $($_.Exception.Message)" })
    }
}

if ($WhatIf) {
    [pscustomobject]@{
        Mode = 'WhatIf'
        ValidPacks = $validPacks.Count
        SkippedItems = $skipped.Count
        ResourcePackDirectory = $resourcePackRoot
    } | ConvertTo-Json
    exit 0
}

if (-not $BackupDirectory) {
    $backupBase = Full-Path (Join-Path $PSScriptRoot '..\backups\resourcepacks_nametag_icons')
    $BackupDirectory = Join-Path $backupBase (Get-Date -Format 'yyyyMMdd-HHmmss')
}
$backupRoot = Full-Path $BackupDirectory
New-Item -ItemType Directory -Path $backupRoot -Force | Out-Null
$manifestPath = Join-Path $backupRoot 'manifest.json'

# Keep a copy of the exact generated assets alongside the restore metadata.
$assetBackup = Join-Path $backupRoot 'installed-assets'
New-Item -ItemType Directory -Path $assetBackup -Force | Out-Null
Copy-Item -LiteralPath $pagePath -Destination (Join-Path $assetBackup 'unicode_page_e0.png')
Copy-Item -LiteralPath $fallbackGlyphPath -Destination (Join-Path $assetBackup 'glyph_sizes.bin')
$mapPath = Join-Path $assetRoot 'glyph-map.json'
if (Test-Path -LiteralPath $mapPath) {
    Copy-Item -LiteralPath $mapPath -Destination (Join-Path $assetBackup 'glyph-map.json')
}

$manifest = [ordered]@{
    version = 1
    createdAt = (Get-Date).ToString('o')
    resourcePackDirectory = $resourcePackRoot
    pageSha256 = $pageHash
    glyphCodePoints = @($iconCodePoints | ForEach-Object { 'U+{0:X4}' -f $_ })
    packs = New-Object System.Collections.Generic.List[object]
    skipped = $skipped
}
Save-Manifest $manifestPath $manifest

$successCount = 0
$failureCount = 0
$packIndex = 0

foreach ($pack in $validPacks) {
    $packIndex++
    $item = $pack.Item
    $record = [ordered]@{
        index = $packIndex
        name = $item.Name
        kind = $pack.Kind
        path = $item.FullName
        status = 'pending'
        hadGlyphSizes = $false
        hadUnicodePageE0 = $false
        originalSha256 = if ($pack.Kind -eq 'zip') { (Get-FileHash -LiteralPath $item.FullName -Algorithm SHA256).Hash.ToLowerInvariant() } else { $null }
        installedSha256 = $null
        error = $null
    }
    $manifest.packs.Add([pscustomobject]$record)
    $recordIndex = $manifest.packs.Count - 1

    try {
        $packBackup = Join-Path $backupRoot ('pack-{0:D3}' -f $packIndex)
        New-Item -ItemType Directory -Path $packBackup -Force | Out-Null

        if ($pack.Kind -eq 'folder') {
            $glyphPath = Join-Path $item.FullName ($glyphEntryName.Replace('/', '\'))
            $packPagePath = Join-Path $item.FullName ($pageEntryName.Replace('/', '\'))
            $hadGlyph = Test-Path -LiteralPath $glyphPath -PathType Leaf
            $hadPage = Test-Path -LiteralPath $packPagePath -PathType Leaf
            $manifest.packs[$recordIndex].hadGlyphSizes = $hadGlyph
            $manifest.packs[$recordIndex].hadUnicodePageE0 = $hadPage

            [byte[]]$baseGlyph = if ($hadGlyph) { [IO.File]::ReadAllBytes($glyphPath) } else { $fallbackGlyphBytes }
            [byte[]]$basePage = if ($hadPage) { [IO.File]::ReadAllBytes($packPagePath) } else { @() }
            if ($hadGlyph) { [IO.File]::WriteAllBytes((Join-Path $packBackup 'glyph_sizes.bin'), $baseGlyph) }
            if ($hadPage) { Copy-Item -LiteralPath $packPagePath -Destination (Join-Path $packBackup 'unicode_page_e0.png') }

            New-Item -ItemType Directory -Path (Split-Path -Parent $glyphPath) -Force | Out-Null
            New-Item -ItemType Directory -Path (Split-Path -Parent $packPagePath) -Force | Out-Null
            [IO.File]::WriteAllBytes($glyphPath, (Patched-GlyphSizes $baseGlyph $fallbackGlyphBytes))
            [IO.File]::WriteAllBytes($packPagePath, (Merge-IconPageBytes $basePage))

            if (-not (Verify-GlyphBytes ([IO.File]::ReadAllBytes($glyphPath)) $fallbackGlyphBytes)) { throw 'folder glyph verification failed' }
            if (-not (Verify-IconPageBytes ([IO.File]::ReadAllBytes($packPagePath)))) { throw 'folder page verification failed' }
        } else {
            $originalEntryCount = 0
            $archive = [IO.Compression.ZipFile]::OpenRead($item.FullName)
            try {
                $originalEntryCount = $archive.Entries.Count
                $glyphEntries = Find-ZipEntries $archive $glyphEntryName
                $pageEntries = Find-ZipEntries $archive $pageEntryName
                $manifest.packs[$recordIndex].hadGlyphSizes = $glyphEntries.Count -gt 0
                $manifest.packs[$recordIndex].hadUnicodePageE0 = $pageEntries.Count -gt 0

                [byte[]]$baseGlyph = if ($glyphEntries.Count -gt 0) { Read-ZipEntryBytes $glyphEntries[0] } else { $fallbackGlyphBytes }
                [byte[]]$basePage = if ($pageEntries.Count -gt 0) { Read-ZipEntryBytes $pageEntries[0] } else { @() }
                if ($glyphEntries.Count -gt 0) { [IO.File]::WriteAllBytes((Join-Path $packBackup 'glyph_sizes.bin'), $baseGlyph) }
                if ($pageEntries.Count -gt 0) { [IO.File]::WriteAllBytes((Join-Path $packBackup 'unicode_page_e0.png'), (Read-ZipEntryBytes $pageEntries[0])) }
            } finally {
                $archive.Dispose()
            }

            [byte[]]$patchedGlyph = Patched-GlyphSizes $baseGlyph $fallbackGlyphBytes
            [byte[]]$patchedPage = Merge-IconPageBytes $basePage
            $installStage = Join-Path $packBackup 'installed-assets'
            $stageGlyphPath = Join-Path $installStage ($glyphEntryName.Replace('/', '\'))
            $stagePagePath = Join-Path $installStage ($pageEntryName.Replace('/', '\'))
            New-Item -ItemType Directory -Path (Split-Path -Parent $stageGlyphPath) -Force | Out-Null
            New-Item -ItemType Directory -Path (Split-Path -Parent $stagePagePath) -Force | Out-Null
            [IO.File]::WriteAllBytes($stageGlyphPath, $patchedGlyph)
            [IO.File]::WriteAllBytes($stagePagePath, $patchedPage)

            $temporaryZip = Join-Path $resourcePackRoot ('.fury-icons-{0}.zip' -f [Guid]::NewGuid().ToString('N'))
            $temporaryFull = Full-Path $temporaryZip
            $replacementBackup = Full-Path (Join-Path $resourcePackRoot ('.fury-original-{0}.zip' -f [Guid]::NewGuid().ToString('N')))
            $rootPrefix = $resourcePackRoot.TrimEnd('\') + '\'
            if (-not $temporaryFull.StartsWith($rootPrefix, [StringComparison]::OrdinalIgnoreCase)) {
                throw "Refusing to create temporary ZIP outside resource-pack directory: $temporaryFull"
            }
            if (-not $replacementBackup.StartsWith($rootPrefix, [StringComparison]::OrdinalIgnoreCase)) {
                throw "Refusing to create replacement backup outside resource-pack directory: $replacementBackup"
            }

            try {
                Copy-Item -LiteralPath $item.FullName -Destination $temporaryFull
                Push-Location $installStage
                try {
                    & $sevenZip u -tzip -mx=5 -bso0 -bse0 -bsp0 -- $temporaryFull $glyphEntryName $pageEntryName
                    if ($LASTEXITCODE -ne 0) {
                        # A handful of otherwise-valid sound packs use ZIP
                        # metadata that 7-Zip 24 can read/test but refuses to
                        # update ("System ERROR: Not implemented"). Recopy the
                        # untouched original, then replace only our two entries
                        # through .NET's ZipArchive update path.
                        Copy-Item -LiteralPath $item.FullName -Destination $temporaryFull -Force
                        Update-ZipEntriesDotNet -ZipPath $temporaryFull -StageRoot $installStage
                    }
                } finally {
                    Pop-Location
                }
                & $sevenZip t -bso0 -bsp0 -- $temporaryFull
                if ($LASTEXITCODE -ne 0) { throw "7-Zip integrity test failed with exit code $LASTEXITCODE" }

                $verify = [IO.Compression.ZipFile]::OpenRead($temporaryFull)
                try {
                    if ((Find-ZipEntries $verify 'pack.mcmeta').Count -eq 0) { throw 'pack.mcmeta disappeared during update' }
                    $verifiedGlyphEntries = Find-ZipEntries $verify $glyphEntryName
                    $verifiedPageEntries = Find-ZipEntries $verify $pageEntryName
                    if ($verifiedGlyphEntries.Count -ne 1) { throw "expected one glyph_sizes.bin entry; got $($verifiedGlyphEntries.Count)" }
                    if ($verifiedPageEntries.Count -ne 1) { throw "expected one unicode_page_e0.png entry; got $($verifiedPageEntries.Count)" }
                    if (-not (Verify-GlyphBytes (Read-ZipEntryBytes $verifiedGlyphEntries[0]) $fallbackGlyphBytes)) { throw 'glyph verification failed' }
                    if (-not (Verify-IconPageBytes (Read-ZipEntryBytes $verifiedPageEntries[0]))) { throw 'page verification failed' }
                    $removedTargetCount = [int]([bool]$manifest.packs[$recordIndex].hadGlyphSizes) + [int]([bool]$manifest.packs[$recordIndex].hadUnicodePageE0)
                    $expectedEntryCount = $originalEntryCount - $removedTargetCount + 2
                    if ($verify.Entries.Count -ne $expectedEntryCount) {
                        throw "archive entry count changed unexpectedly: expected $expectedEntryCount, got $($verify.Entries.Count)"
                    }
                } finally {
                    $verify.Dispose()
                }

                $verifiedTemporaryHash = (Get-FileHash -LiteralPath $temporaryFull -Algorithm SHA256).Hash.ToLowerInvariant()
                [IO.File]::Replace($temporaryFull, $item.FullName, $replacementBackup, $true)
                $manifest.packs[$recordIndex].installedSha256 = (Get-FileHash -LiteralPath $item.FullName -Algorithm SHA256).Hash.ToLowerInvariant()
                if ($manifest.packs[$recordIndex].installedSha256 -ne $verifiedTemporaryHash) {
                    throw 'installed ZIP hash did not match the verified temporary archive'
                }
                if (Test-Path -LiteralPath $replacementBackup -PathType Leaf) {
                    Remove-Item -LiteralPath $replacementBackup -Force
                }
            } finally {
                if (Test-Path -LiteralPath $temporaryFull -PathType Leaf) {
                    Remove-Item -LiteralPath $temporaryFull -Force
                }
            }
        }

        $manifest.packs[$recordIndex].status = 'installed'
        $successCount++
    } catch {
        $manifest.packs[$recordIndex].status = 'failed'
        $manifest.packs[$recordIndex].error = $_.Exception.Message
        $failureCount++
    }

    Save-Manifest $manifestPath $manifest
    if (($packIndex % 10) -eq 0 -or $packIndex -eq $validPacks.Count) {
        Write-Output ("Processed {0}/{1}: {2} installed, {3} failed" -f $packIndex, $validPacks.Count, $successCount, $failureCount)
    }
}

$result = [ordered]@{
    installed = $successCount
    failed = $failureCount
    skipped = $skipped.Count
    backupDirectory = $backupRoot
    manifest = $manifestPath
}
$result | ConvertTo-Json

if ($failureCount -gt 0) { exit 1 }
