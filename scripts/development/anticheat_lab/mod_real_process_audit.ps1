param([switch]$Stop, [string]$Label = 'audit')
$ErrorActionPreference = 'Stop'
$repoPath = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../../..'))
$outputPath = Join-Path $repoPath 'output/anticheat-lab/mod-real/overnight'
$start = Get-Content -LiteralPath (Join-Path $outputPath 'start-manifest.json') -Raw | ConvertFrom-Json
$startedAt = [DateTimeOffset]::Parse($start.capturedAt).UtcDateTime
$labDirectory = [regex]::Escape((Join-Path $repoPath 'scripts/development/anticheat_lab').Replace('\','/'))
$ownedOutput = [regex]::Escape((Join-Path $repoPath 'output/anticheat-lab/mod-real').Replace('\','/'))
$runner = '(overnight_capture_queue_v2|jump_reset_real_campaign|mod_real_followup|mod_real_movement_stress|mod_real_scaffold_full_context|integrated_real_probes|verify_jump_reset_launcher)\.js'
function Get-OwnedProcesses {
    $allProcesses = @(Get-CimInstance Win32_Process)
    $selected = @{}
    foreach ($entry in $allProcesses) {
        if (!$entry.CommandLine -or $entry.CreationDate.ToUniversalTime() -lt $startedAt) { continue }
        $command = $entry.CommandLine.Replace('\','/')
        $isRunner = $entry.Name -eq 'node.exe' -and $command -match $runner -and
            ($command -match $labDirectory -or $command -match 'scripts/development/anticheat_lab/')
        $isJava = $entry.Name -eq 'java.exe' -and $command -match $ownedOutput
        $isSeam = $entry.Name -eq 'node.exe' -and $command -match $labDirectory -and
            $command -match '--require.+offline_preload(_integrated)?\.js'
        if ($isRunner -or $isJava -or $isSeam) { $selected[[int]$entry.ProcessId] = $entry }
    }
    do {
        $added = $false
        foreach ($entry in $allProcesses) {
            if (!$selected.ContainsKey([int]$entry.ProcessId) -and $selected.ContainsKey([int]$entry.ParentProcessId)) {
                $selected[[int]$entry.ProcessId] = $entry
                $added = $true
            }
        }
    } while ($added)
    return @($selected.Values)
}
$before = @(Get-OwnedProcesses)
if ($Stop) {
    Set-Content -LiteralPath (Join-Path $outputPath 'STOP_AFTER_TRIAL') -Value 'Owned process cleanup requested.'
    # Stop controllers first so no new actor can launch during cleanup.
    foreach ($entry in $before | Where-Object { $_.Name -eq 'node.exe' -and $_.CommandLine -match $runner }) {
        Stop-Process -Id $entry.ProcessId -ErrorAction SilentlyContinue
    }
    foreach ($entry in $before | Where-Object { $_.Name -eq 'python.exe' }) {
        Stop-Process -Id $entry.ProcessId -ErrorAction SilentlyContinue
    }
    # Release injected controls only while the owned Minecraft window is focused.
    foreach ($entry in $before | Where-Object { $_.Name -eq 'java.exe' -and $_.CommandLine -match 'devlaunchinjector.Main' }) {
        $requests = @('{"id":1,"command":"check"}')
        $index = 1
        foreach ($keyCode in @(0x57,0x41,0x53,0x44,0x20,0x10,0x11)) {
            $index++
            $requests += (@{id=$index;command='key';vk=$keyCode;down=$false} | ConvertTo-Json -Compress)
        }
        foreach ($button in @('left','right')) {
            $index++
            $requests += (@{id=$index;command='mouse';button=$button;down=$false} | ConvertTo-Json -Compress)
        }
        $releaseLog = $requests | & python (Join-Path $PSScriptRoot 'mod_real_input.py') --pid $entry.ProcessId
        $releaseLog | Set-Content -LiteralPath (Join-Path $outputPath ("released-controls-" + $entry.ProcessId + '.jsonl'))
    }
    foreach ($entry in $before) { Stop-Process -Id $entry.ProcessId -ErrorAction SilentlyContinue }
    Start-Sleep -Milliseconds 400
}
$after = @(Get-OwnedProcesses)
function Project-Process($entry) {
    $command = $entry.CommandLine -replace '-cp .+ net.fabricmc.devlaunchinjector.Main', '-cp <local classpath> net.fabricmc.devlaunchinjector.Main'
    return @{pid=$entry.ProcessId;parentPid=$entry.ParentProcessId;name=$entry.Name;createdAt=$entry.CreationDate.ToUniversalTime().ToString('o');command=$command}
}
$result = @{capturedAt=[DateTime]::UtcNow.ToString('o');stopRequested=[bool]$Stop;label=$Label;
    before=@($before | ForEach-Object { Project-Process $_ });after=@($after | ForEach-Object { Project-Process $_ });
    scope='Dedicated lab runners, loopback preload seams and mod-real Java, with their descendants; normal Fury and unrelated processes excluded.'}
$file = Join-Path $outputPath ('process-' + ($Label -replace '[^a-zA-Z0-9_-]','_') + '-' + [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds() + '.json')
$result | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath $file
@{file=$file;stopRequested=[bool]$Stop;ownedBefore=$before.Count;ownedAfter=$after.Count;remaining=@($after | Select-Object ProcessId,Name)} | ConvertTo-Json -Compress
if ($Stop -and $after.Count) { throw 'Owned lab processes remain; inspect the saved process audit.' }
