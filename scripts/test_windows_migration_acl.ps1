param([string]$Sandbox, [string]$Repository, [string]$NodeExecutable, [string]$WorkerExecutable, [int]$LauncherPid)
$ErrorActionPreference = 'Stop'
$Sandbox = [IO.Path]::GetFullPath($Sandbox)
$temporaryRoot = [IO.Path]::GetFullPath([IO.Path]::GetTempPath())
if (-not $Sandbox.StartsWith($temporaryRoot, [StringComparison]::OrdinalIgnoreCase) -or
    -not ([IO.Path]::GetFileName($Sandbox)).StartsWith('fury-migration-native-tests-')) { throw 'Invalid test sandbox' }
$sid = [Security.Principal.WindowsIdentity]::GetCurrent().User
foreach ($case in @('current-user','unicode-path','read-only-source','unreadable-source','unwritable-destination','unwritable-control','unsafe-control-acl','wrong-owner','active-writer','junction-in-excluded-cache','registry-currentuser-fallback','registry-allusers-fallback','credential-acl','reinstall')) {
    $root = Join-Path $Sandbox $case
    if ($case -eq 'unicode-path') { $root = Join-Path $root (([string][char]0x7528) + [char]0x6237 + [char]0x017c) }
    $old = Join-Path $root 'Custom Old Fury With Spaces'
    $source = Join-Path $old 'resources/app'
    $appData = Join-Path $root 'Roaming'
    $canonical = Join-Path $appData 'Fury'
    $control = Join-Path $appData '.Fury-migration-v1'
    [IO.Directory]::CreateDirectory((Join-Path $source 'auth_tokens/test-account')) | Out-Null
    [IO.Directory]::CreateDirectory($appData) | Out-Null
    [IO.File]::WriteAllText((Join-Path $source 'session_data.json'), '{"fixture":"durable"}')
    [IO.File]::WriteAllText((Join-Path $source 'auth_tokens/test-account/token.json'), '{"fixture":"NOT-A-REAL-TOKEN"}')
    $requestFile = Join-Path $root 'request.json'
    $request = @{
        schema=1; installer=$true; launcherPid=$LauncherPid; appData=$appData; executable=$WorkerExecutable
        worker=(Join-Path $Repository 'src/storage/windowsMigrationWorker.js'); discoverRegistry=$false
        options=@{destination=$canonical;control=$control;installations=@($old);newInstallation=(Join-Path $root 'New Fury')}
        planFile=(Join-Path $root 'plan.json');preservedFile=(Join-Path $root 'preserved.json');resultFile=(Join-Path $root 'result.json')
    }
    $registryFixture = $null
    if ($case -in @('registry-currentuser-fallback','registry-allusers-fallback')) {
        $registryFixture = 'Software\FuryStorageVerification-' + [guid]::NewGuid().ToString('N')
        $base = [Microsoft.Win32.RegistryKey]::OpenBaseKey('CurrentUser','Registry64')
        try {
            $key = $base.CreateSubKey($registryFixture + '\uninstall')
            try { $key.SetValue('UninstallString', '"' + (Join-Path $old 'Uninstall Fury.exe') + '" /' + $(if($case -eq 'registry-currentuser-fallback'){'currentuser'}else{'allusers'})) }
            finally { $key.Dispose() }
        } finally { $base.Dispose() }
        $request.discoverRegistry = $true
        $request.installKey = $registryFixture + '\install'
        $request.uninstallKey = $registryFixture + '\uninstall'
        $request.options.installations = @()
    }
    [IO.File]::WriteAllText($requestFile, ($request | ConvertTo-Json -Depth 12), [Text.UTF8Encoding]::new($false))
    $target = $null; $original = $null; $writer = $null
    try {
        if ($case -eq 'read-only-source') { $target=$source; $rights='Write' }
        if ($case -eq 'unreadable-source') { $target=Join-Path $source 'session_data.json'; $rights='ReadData' }
        if ($case -eq 'unwritable-destination') { [IO.Directory]::CreateDirectory($canonical) | Out-Null; $target=$canonical; $rights='Write' }
        if ($case -eq 'unwritable-control') { $target=$appData; $rights='Write' }
        if ($case -eq 'wrong-owner') { $target=Join-Path $source 'session_data.json' }
        if ($case -eq 'credential-acl') {
            $file = Join-Path $source 'auth_tokens/test-account/token.json'
            $acl = Get-Acl -LiteralPath $file
            $acl.AddAccessRule([Security.AccessControl.FileSystemAccessRule]::new([Security.Principal.SecurityIdentifier]::new('S-1-1-0'),'Read','Allow'))
            Set-Acl -LiteralPath $file -AclObject $acl
        }
        if ($case -eq 'unsafe-control-acl') {
            [IO.Directory]::CreateDirectory($control) | Out-Null
            $acl = Get-Acl -LiteralPath $control
            $acl.AddAccessRule([Security.AccessControl.FileSystemAccessRule]::new([Security.Principal.SecurityIdentifier]::new('S-1-1-0'),'Read','ContainerInherit, ObjectInherit','None','Allow'))
            Set-Acl -LiteralPath $control -AclObject $acl
        }
        if ($target) {
            if (-not ([IO.Path]::GetFullPath($target)).StartsWith($Sandbox + '\', [StringComparison]::OrdinalIgnoreCase)) { throw 'ACL target escapes sandbox' }
            $original=Get-Acl -LiteralPath $target; $acl=Get-Acl -LiteralPath $target
            if ($case -eq 'wrong-owner') {
                # Ownership mutation may need SeRestorePrivilege; if unavailable,
                # model the wrong SID at the transaction layer instead (unit test).
                $acl.SetOwner([Security.Principal.SecurityIdentifier]::new('S-1-5-32-544'))
            } elseif (Test-Path -LiteralPath $target -PathType Container) {
                $acl.AddAccessRule([Security.AccessControl.FileSystemAccessRule]::new($sid,$rights,'ContainerInherit, ObjectInherit','None','Deny'))
            } else { $acl.AddAccessRule([Security.AccessControl.FileSystemAccessRule]::new($sid,$rights,'Deny')) }
            try { Set-Acl -LiteralPath $target -AclObject $acl }
            catch { if ($case -eq 'wrong-owner') { Write-Output 'SKIP actual alternate-owner ACL (privilege unavailable)'; continue }; throw }
        }
        if ($case -eq 'active-writer') {
            $start=[Diagnostics.ProcessStartInfo]::new();$start.FileName=$NodeExecutable
            $start.Arguments='-e "setInterval(()=>{},1000)" "' + $old + '"'
            $start.UseShellExecute=$false;$start.CreateNoWindow=$true
            $writer=[Diagnostics.Process]::Start($start)
        }
        if ($case -eq 'junction-in-excluded-cache') {
            $other=Join-Path $root 'junction-target';[IO.Directory]::CreateDirectory($other) | Out-Null
            [IO.Directory]::CreateDirectory((Join-Path $source 'launcher_data')) | Out-Null
            New-Item -ItemType Junction -Path (Join-Path $source 'launcher_data/Cache') -Target $other | Out-Null
        }
        $start=[Diagnostics.ProcessStartInfo]::new()
        $start.FileName=Join-Path $env:SystemRoot 'System32/WindowsPowerShell/v1.0/powershell.exe'
        $start.Arguments='-NoProfile -NonInteractive -ExecutionPolicy Bypass -File "' + (Join-Path $Repository 'src/storage/windowsMigrationGuard.ps1') + '" -RequestFile "' + $requestFile + '"'
        $start.UseShellExecute=$false;$start.CreateNoWindow=$true;$start.RedirectStandardError=$true
        $guard=[Diagnostics.Process]::Start($start);$guard.WaitForExit();$safeCode=$guard.StandardError.ReadToEnd();$exitCode=$guard.ExitCode;$guard.Dispose()
        $expectSuccess=$case -in @('current-user','unicode-path','read-only-source','registry-currentuser-fallback','registry-allusers-fallback','credential-acl','reinstall')
        if ($expectSuccess -and $exitCode -ne 0) { throw "Guard failed $case ($safeCode)" }
        if (-not $expectSuccess -and $exitCode -eq 0) { throw "Unsafe guard success $case" }
        if ($expectSuccess) {
            foreach ($relative in @('session_data.json','auth_tokens/test-account/token.json')) {
                $before=[IO.File]::ReadAllBytes((Join-Path $source $relative));$after=[IO.File]::ReadAllBytes((Join-Path $canonical $relative))
                if ([Convert]::ToBase64String($before) -ne [Convert]::ToBase64String($after)) { throw 'Byte mismatch' }
            }
            if ($case -eq 'reinstall') {
                $guard=[Diagnostics.Process]::Start($start);$guard.WaitForExit();if($guard.ExitCode -ne 0){throw 'Reinstall failed'};$guard.Dispose()
            }
            if ($case -eq 'credential-acl') {
                $copied = Get-Acl -LiteralPath (Join-Path $canonical 'auth_tokens/test-account/token.json')
                if (@($copied.Access | Where-Object { $_.IdentityReference.Translate([Security.Principal.SecurityIdentifier]).Value -in @('S-1-1-0','S-1-5-32-545') }).Count -gt 0) { throw 'Broad source ACL was copied into the private profile' }
            }
        } elseif (-not (Test-Path -LiteralPath (Join-Path $source 'session_data.json'))) { throw 'Source lost on failure' }
        Write-Output "PASS Windows guard $case"
    } finally {
        if ($writer) { if (-not $writer.HasExited) { $writer.Kill();$writer.WaitForExit() };$writer.Dispose() }
        if ($target -and $original) { Set-Acl -LiteralPath $target -AclObject $original }
        if ($registryFixture) {
            if (-not $registryFixture.StartsWith('Software\FuryStorageVerification-')) { throw 'Unsafe registry cleanup' }
            $base = [Microsoft.Win32.RegistryKey]::OpenBaseKey('CurrentUser','Registry64')
            try { $base.DeleteSubKeyTree($registryFixture, $false) } finally { $base.Dispose() }
        }
    }
}
