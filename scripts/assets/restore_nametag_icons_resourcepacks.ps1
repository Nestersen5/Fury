param(
    [Parameter(Mandatory = $true)]
    [string]$BackupDirectory
)

$ErrorActionPreference = 'Stop'

Add-Type -AssemblyName System.IO.Compression
Add-Type -AssemblyName System.IO.Compression.FileSystem

$glyphEntryName = 'assets/minecraft/font/glyph_sizes.bin'
$pageEntryName = 'assets/minecraft/textures/font/unicode_page_e0.png'

function Full-Path([string]$Path) { [IO.Path]::GetFullPath($Path) }

function Find-ZipEntries([IO.Compression.ZipArchive]$Archive, [string]$Name) {
    @($Archive.Entries | Where-Object {
        $_.FullName.TrimStart('/').Equals($Name, [StringComparison]::OrdinalIgnoreCase)
    })
}

$backupRoot = Full-Path $BackupDirectory
$manifestPath = Join-Path $backupRoot 'manifest.json'
if (-not (Test-Path -LiteralPath $manifestPath -PathType Leaf)) {
    throw "Backup manifest not found: $manifestPath"
}
$sevenZipCommand = Get-Command 7z -ErrorAction SilentlyContinue
if (-not $sevenZipCommand) { throw '7z.exe is required for lossless ZIP restoration but was not found on PATH.' }
$sevenZip = $sevenZipCommand.Source

$manifest = Get-Content -Raw -LiteralPath $manifestPath | ConvertFrom-Json
$restored = 0
$failed = 0

foreach ($pack in @($manifest.packs | Where-Object { $_.status -eq 'installed' })) {
    try {
        $packPath = Full-Path $pack.path
        $packBackup = Join-Path $backupRoot ('pack-{0:D3}' -f [int]$pack.index)
        $originalGlyphPath = Join-Path $packBackup 'glyph_sizes.bin'
        $originalPagePath = Join-Path $packBackup 'unicode_page_e0.png'

        if ($pack.kind -eq 'folder') {
            $glyphPath = Join-Path $packPath ($glyphEntryName.Replace('/', '\'))
            $pagePath = Join-Path $packPath ($pageEntryName.Replace('/', '\'))
            if ($pack.hadGlyphSizes) {
                Copy-Item -LiteralPath $originalGlyphPath -Destination $glyphPath -Force
            } elseif (Test-Path -LiteralPath $glyphPath -PathType Leaf) {
                Remove-Item -LiteralPath $glyphPath -Force
            }
            if ($pack.hadUnicodePageE0) {
                Copy-Item -LiteralPath $originalPagePath -Destination $pagePath -Force
            } elseif (Test-Path -LiteralPath $pagePath -PathType Leaf) {
                Remove-Item -LiteralPath $pagePath -Force
            }
        } else {
            if (-not (Test-Path -LiteralPath $packPath -PathType Leaf)) { throw "Pack no longer exists: $packPath" }
            $resourcePackRoot = Split-Path -Parent $packPath
            $rootPrefix = (Full-Path $resourcePackRoot).TrimEnd('\') + '\'
            $temporary = Full-Path (Join-Path $resourcePackRoot ('.fury-restore-{0}.zip' -f [Guid]::NewGuid().ToString('N')))
            $replacementBackup = Full-Path (Join-Path $resourcePackRoot ('.fury-restore-original-{0}.zip' -f [Guid]::NewGuid().ToString('N')))
            if (-not $temporary.StartsWith($rootPrefix, [StringComparison]::OrdinalIgnoreCase)) { throw 'Unsafe temporary restore path.' }
            if (-not $replacementBackup.StartsWith($rootPrefix, [StringComparison]::OrdinalIgnoreCase)) { throw 'Unsafe replacement-backup path.' }

            try {
                Copy-Item -LiteralPath $packPath -Destination $temporary
                & $sevenZip d -bso0 -bsp0 -- $temporary $glyphEntryName $pageEntryName
                if ($LASTEXITCODE -ne 0) { throw "7-Zip delete failed with exit code $LASTEXITCODE" }

                if ($pack.hadGlyphSizes -or $pack.hadUnicodePageE0) {
                    $restoreStage = Join-Path $packBackup 'restore-assets'
                    if ($pack.hadGlyphSizes) {
                        $stageGlyph = Join-Path $restoreStage ($glyphEntryName.Replace('/', '\'))
                        New-Item -ItemType Directory -Path (Split-Path -Parent $stageGlyph) -Force | Out-Null
                        Copy-Item -LiteralPath $originalGlyphPath -Destination $stageGlyph -Force
                    }
                    if ($pack.hadUnicodePageE0) {
                        $stagePage = Join-Path $restoreStage ($pageEntryName.Replace('/', '\'))
                        New-Item -ItemType Directory -Path (Split-Path -Parent $stagePage) -Force | Out-Null
                        Copy-Item -LiteralPath $originalPagePath -Destination $stagePage -Force
                    }
                    Push-Location $restoreStage
                    try {
                        $restoreEntries = @()
                        if ($pack.hadGlyphSizes) { $restoreEntries += $glyphEntryName }
                        if ($pack.hadUnicodePageE0) { $restoreEntries += $pageEntryName }
                        & $sevenZip u -tzip -mx=5 -bso0 -bsp0 -- $temporary @restoreEntries
                        if ($LASTEXITCODE -ne 0) { throw "7-Zip restore update failed with exit code $LASTEXITCODE" }
                    } finally {
                        Pop-Location
                    }
                }
                & $sevenZip t -bso0 -bsp0 -- $temporary
                if ($LASTEXITCODE -ne 0) { throw "7-Zip restore integrity test failed with exit code $LASTEXITCODE" }

                $verify = [IO.Compression.ZipFile]::OpenRead($temporary)
                try {
                    if ((Find-ZipEntries $verify 'pack.mcmeta').Count -eq 0) { throw 'pack.mcmeta disappeared during restore.' }
                    $expectedGlyphCount = if ($pack.hadGlyphSizes) { 1 } else { 0 }
                    $expectedPageCount = if ($pack.hadUnicodePageE0) { 1 } else { 0 }
                    if ((Find-ZipEntries $verify $glyphEntryName).Count -ne $expectedGlyphCount) { throw 'glyph_sizes.bin restore verification failed.' }
                    if ((Find-ZipEntries $verify $pageEntryName).Count -ne $expectedPageCount) { throw 'unicode page restore verification failed.' }
                } finally {
                    $verify.Dispose()
                }

                $temporaryHash = (Get-FileHash -LiteralPath $temporary -Algorithm SHA256).Hash
                [IO.File]::Replace($temporary, $packPath, $replacementBackup, $true)
                if ((Get-FileHash -LiteralPath $packPath -Algorithm SHA256).Hash -ne $temporaryHash) { throw 'Restored pack hash mismatch.' }
                if (Test-Path -LiteralPath $replacementBackup -PathType Leaf) { Remove-Item -LiteralPath $replacementBackup -Force }
            } finally {
                if (Test-Path -LiteralPath $temporary -PathType Leaf) { Remove-Item -LiteralPath $temporary -Force }
            }
        }
        $restored++
    } catch {
        Write-Error "Could not restore $($pack.name): $($_.Exception.Message)" -ErrorAction Continue
        $failed++
    }
}

[pscustomobject]@{ restored = $restored; failed = $failed; backupDirectory = $backupRoot } | ConvertTo-Json
if ($failed -gt 0) { exit 1 }
