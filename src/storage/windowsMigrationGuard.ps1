param([Parameter(Mandatory=$true)][string]$RequestFile)
$ErrorActionPreference = 'Stop'
$heldFiles = [Collections.Generic.List[IDisposable]]::new()
$migrationLease = $null
$migrationBusy = $null
$migrationExit = 1
$migrationClock = [Diagnostics.Stopwatch]::StartNew()

function Assert-NoLink([string]$Location) {
    $cursor = [IO.Path]::GetFullPath($Location)
    while ($cursor) {
        if (Test-Path -LiteralPath $cursor) {
            $item = Get-Item -LiteralPath $cursor -Force
            if (($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) { throw 'UNSAFE_LINK' }
        }
        $parent = [IO.Path]::GetDirectoryName($cursor)
        if ($parent -eq $cursor) { break }
        $cursor = $parent
    }
}
function Assert-Owner([string]$Location) {
    Assert-NoLink $Location
    $owner = (Get-Acl -LiteralPath $Location).GetOwner([Security.Principal.SecurityIdentifier]).Value
    if ($owner -ne $script:migrationSid) { throw 'INVALID_OWNERSHIP' }
}
function New-PrivateDirectory([string]$Location) {
    Assert-NoLink $Location
    if (Test-Path -LiteralPath $Location) {
        Assert-Owner $Location
        foreach ($rule in (Get-Acl -LiteralPath $Location).Access) {
            $principal = $rule.IdentityReference.Translate([Security.Principal.SecurityIdentifier]).Value
            if ($rule.AccessControlType -eq 'Allow' -and $principal -notin @($script:migrationSid, 'S-1-5-18', 'S-1-5-32-544')) {
                throw 'INVALID_OWNERSHIP'
            }
        }
        return
    }
    $acl = [Security.AccessControl.DirectorySecurity]::new()
    $acl.SetOwner([Security.Principal.SecurityIdentifier]::new($script:migrationSid))
    $acl.SetAccessRuleProtection($true, $false)
    foreach ($sid in @($script:migrationSid, 'S-1-5-18')) {
        $acl.AddAccessRule([Security.AccessControl.FileSystemAccessRule]::new(
            [Security.Principal.SecurityIdentifier]::new($sid), 'FullControl',
            'ContainerInherit, ObjectInherit', 'None', 'Allow'))
    }
    [IO.Directory]::CreateDirectory($Location, $acl) | Out-Null
}
function Assert-InteractiveOwner {
    # An over-the-shoulder UAC administrator is not the owner of the launching
    # desktop. A shared or headless legacy installation is deliberately blocked.
    $session = [Diagnostics.Process]::GetCurrentProcess().SessionId
    $shells = @(Get-CimInstance Win32_Process -Filter "Name='explorer.exe'" | Where-Object { $_.SessionId -eq $session })
    if ($shells.Count -eq 0) { throw 'INVALID_OWNERSHIP' }
    foreach ($shellProcess in $shells) {
        $identity = Invoke-CimMethod -InputObject $shellProcess -MethodName GetOwnerSid
        if ($identity.ReturnValue -ne 0 -or $identity.Sid -ne $script:migrationSid) { throw 'INVALID_OWNERSHIP' }
    }
}
function Resolve-Installation([Microsoft.Win32.RegistryHive]$Hive, [string]$InstallKey, [string]$UninstallKey) {
    $base = [Microsoft.Win32.RegistryKey]::OpenBaseKey($Hive, [Microsoft.Win32.RegistryView]::Registry64)
    try {
        $install = $base.OpenSubKey($InstallKey)
        $uninstall = $base.OpenSubKey($UninstallKey)
        try {
            $location = if ($install) { [string]$install.GetValue('InstallLocation', '') } else { '' }
            $command = if ($uninstall) { [string]$uninstall.GetValue('UninstallString', '') } else { '' }
            if (-not $location -and $command) {
                # Matches the quoted executable accepted by the locked NSIS template.
                if ($command -notmatch '^"([^"]+)"(?:\s+/(?:currentuser|allusers))?\s*$') { throw 'INVALID_PREVIOUS_INSTALL' }
                $location = [IO.Path]::GetDirectoryName($Matches[1])
            }
            if ($command -and -not $location) { throw 'INVALID_PREVIOUS_INSTALL' }
            if ($location) { [IO.Path]::GetFullPath($location) }
        } finally { if ($install) { $install.Dispose() }; if ($uninstall) { $uninstall.Dispose() } }
    } finally { $base.Dispose() }
}
function Assert-NoWriters {
    foreach ($candidate in @(Get-CimInstance Win32_Process)) {
        if ($candidate.ProcessId -eq $script:request.launcherPid -or $candidate.ProcessId -eq $PID) { continue }
        if ($candidate.Name -ieq 'Fury.exe') { throw 'WRITERS_ACTIVE' }
        if ($candidate.Name -in @('node.exe', 'electron.exe')) {
            if (-not $candidate.CommandLine) { throw 'WRITERS_UNVERIFIABLE' }
            foreach ($installation in $script:installations) {
                if ($candidate.CommandLine.IndexOf($installation, [StringComparison]::OrdinalIgnoreCase) -ge 0) { throw 'WRITERS_ACTIVE' }
            }
        }
    }
}
function Assert-RemovalTree([string]$Location) {
    # An excluded cache or application subtree must not smuggle a junction into
    # the previous uninstaller's recursive removal. Never follow reparse points.
    if (-not (Test-Path -LiteralPath $Location)) { return }
    Assert-NoLink $Location
    $directories = [Collections.Generic.Stack[string]]::new()
    $directories.Push($Location)
    $visited = 0
    while ($directories.Count -gt 0) {
        foreach ($entry in [IO.Directory]::EnumerateFileSystemEntries($directories.Pop())) {
            if (++$visited -gt 250000) { throw 'PAYLOAD_LIMIT' }
            $attributes = [IO.File]::GetAttributes($entry)
            if (($attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) { throw 'UNSAFE_LINK' }
            if (($attributes -band [IO.FileAttributes]::Directory) -ne 0) { $directories.Push($entry) }
        }
    }
}
function Invoke-Worker([string]$Phase) {
    $start = [Diagnostics.ProcessStartInfo]::new()
    $start.FileName = $script:request.executable
    $start.Arguments = '"' + $script:request.worker + '" "' + $RequestFile + '" ' + $Phase
    $start.UseShellExecute = $false
    $start.CreateNoWindow = $true
    $start.RedirectStandardError = $true
    $start.RedirectStandardOutput = $true
    $start.EnvironmentVariables['ELECTRON_RUN_AS_NODE'] = '1'
    $child = [Diagnostics.Process]::Start($start)
    try {
        $remaining = [Math]::Max(1, 1800000 - $migrationClock.ElapsedMilliseconds)
        if (-not $child.WaitForExit([int]$remaining)) { $child.Kill(); $child.WaitForExit(); throw 'MIGRATION_TIMEOUT' }
        $code = $child.StandardError.ReadToEnd()
        if ($child.ExitCode -ne 0) {
            if ($code -match '^[A-Z_]{3,50}$') { throw $code }
            throw 'MIGRATION_FAILED'
        }
    } finally { $child.Dispose() }
}
try {
    $script:request = Get-Content -LiteralPath $RequestFile -Raw -Encoding UTF8 | ConvertFrom-Json
    $script:migrationSid = [Security.Principal.WindowsIdentity]::GetCurrent().User.Value
    if ($request.schema -ne 1 -or $request.options.destination -ne (Join-Path $request.appData 'Fury')) { throw 'INVALID_REQUEST' }
    if ($request.installerPid) {
        $hostProcess = Get-CimInstance Win32_Process -Filter "ProcessId=$($request.launcherPid)"
        if (-not $request.installer -or $hostProcess.ParentProcessId -ne $request.installerPid) { throw 'INVALID_REQUEST' }
    }
    Assert-NoLink $request.appData
    New-PrivateDirectory $request.options.control
    $migrationBusy = Join-Path $request.options.control 'busy'
    Assert-NoLink $migrationBusy
    # OpenOrCreate allows recovery after a crashed helper; an active helper holds
    # this handle with FileShare.None. This is a maintenance lease, not a product
    # single-instance policy.
    $migrationLease = [IO.File]::Open($migrationBusy, 'OpenOrCreate', 'ReadWrite', 'None')
    $script:installations = @($request.options.installations)
    if ($request.discoverRegistry) {
        $script:installations += @(Resolve-Installation CurrentUser $request.installKey $request.uninstallKey)
        $script:installations += @(Resolve-Installation LocalMachine $request.installKey $request.uninstallKey)
    }
    $script:installations = @($script:installations | Where-Object { $_ } | Sort-Object -Unique)
    if ($script:installations.Count -gt 8) { throw 'INVALID_PREVIOUS_INSTALL' }
    $request.options.installations = $script:installations
    $request.options | Add-Member -NotePropertyName owner -NotePropertyValue $script:migrationSid -Force
    $request.options | Add-Member -NotePropertyName quiescent -NotePropertyValue $true -Force
    # Node accepts UTF-8; Windows PowerShell's BOM is removed explicitly.
    [IO.File]::WriteAllText($RequestFile, ($request | ConvertTo-Json -Depth 12 -Compress), [Text.UTF8Encoding]::new($false))
    Assert-NoWriters
    if ($request.installer) { foreach ($installation in $script:installations) { Assert-RemovalTree $installation } }
    Invoke-Worker plan
    $planned = Get-Content -LiteralPath $request.planFile -Raw -Encoding UTF8 | ConvertFrom-Json
    $hasData = @($planned.sources | Where-Object { $_.entries.Count -gt 0 }).Count -gt 0
    if ($hasData) { Assert-InteractiveOwner }
    if (Test-Path -LiteralPath $request.options.destination) { Assert-Owner $request.options.destination }
    foreach ($source in $planned.sources) {
        foreach ($entry in $source.entries) {
            $file = Join-Path $source.source ($entry.path.Replace('/', '\'))
            Assert-Owner $file
            # Readers may copy the data. Existing writers and atomic replacements
            # are denied while the verified snapshot and publication are made.
            $heldFiles.Add([IO.File]::Open($file, 'Open', 'Read', 'Read'))
        }
        $oldExe = Join-Path $source.installation 'Fury.exe'
        $isCurrentExecutable = [string]::Equals([IO.Path]::GetFullPath($oldExe), [IO.Path]::GetFullPath($request.executable), [StringComparison]::OrdinalIgnoreCase)
        if (($request.installer -or -not $isCurrentExecutable) -and (Test-Path -LiteralPath $oldExe)) {
            Assert-NoLink $oldExe
            if ($request.installerPid) {
                # NSIS must already hold an executable lease that spans old
                # removal. Refuse if this executable can still be read/launched.
                $readable = $null
                try { $readable = [IO.File]::Open($oldExe, 'Open', 'Read', 'ReadWrite, Delete') }
                catch [IO.IOException] { }
                if ($readable) { $readable.Dispose(); throw 'WRITERS_UNVERIFIABLE' }
            } else { $heldFiles.Add([IO.File]::Open($oldExe, 'Open', 'Read', 'None')) }
        }
    }
    Assert-NoWriters
    Invoke-Worker preserve
    Assert-NoWriters
    Invoke-Worker activate
    $migrationExit = 0
} catch {
    $safe = @('UNSAFE_LINK','INVALID_OWNERSHIP','INVALID_PREVIOUS_INSTALL','WRITERS_ACTIVE','WRITERS_UNVERIFIABLE',
        'SOURCE_CHANGED','INSUFFICIENT_SPACE','STAGING_CHANGED','COPY_VERIFICATION_FAILED','PAYLOAD_LIMIT',
        'RECOVERY_LIMIT','INSTALL_DATA_OVERLAP','OVERLAPPING_ROOTS','INVALID_MANIFEST','DESTINATION_CHANGED','EACCES','EPERM','ENOSPC','EBUSY','MIGRATION_TIMEOUT')
    $message = $_.Exception.Message
    if ($safe -notcontains $message) { $message = 'MIGRATION_ACCESS_OR_SAFETY_FAILURE' }
    [Console]::Error.Write($message)
} finally {
    foreach ($handle in $heldFiles) { $handle.Dispose() }
    if ($migrationLease) {
        $migrationLease.Dispose()
        # Remove only our fixed, checked maintenance marker; never any user data.
        if ($migrationExit -eq 0) { Remove-Item -LiteralPath $migrationBusy }
    }
}
exit $migrationExit
