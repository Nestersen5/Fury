param([string]$Stage = 'capture')
$ErrorActionPreference = 'Stop'
if ($Stage -notmatch '^[a-z-]{1,40}$') { throw 'Invalid snapshot stage' }
$labWorkspace = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '../../..')).Path
$labOutput = Join-Path $labWorkspace 'output/anticheat-lab/mod-real/overnight'
$labJava = @(Get-CimInstance Win32_Process -Filter "Name = 'java.exe'" | Where-Object { $_.CommandLine -like '*anticheat-lab*mod-real*' })
$labConnections = @(foreach ($labOwner in $labJava) {
    Get-NetTCPConnection -OwningProcess $labOwner.ProcessId -ErrorAction SilentlyContinue |
        Where-Object State -eq 'Established' |
        Select-Object OwningProcess, LocalAddress, LocalPort, RemoteAddress, RemotePort
})
$labUnexpected = @($labConnections | Where-Object { $_.RemoteAddress -notin @('127.0.0.1', '::1', '::ffff:127.0.0.1') })
$labTime = [DateTimeOffset]::UtcNow
$labSnapshot = [ordered]@{
    capturedAt = $labTime.ToString('o')
    stage = $Stage
    ownedJava = @($labJava | Select-Object ProcessId, ParentProcessId, CreationDate, CommandLine)
    establishedConnections = $labConnections
    unexpectedNonLoopback = $labUnexpected
    limitation = 'A point-in-time TCP check; every client launch separately verifies its loopback game target.'
}
$labFile = Join-Path $labOutput ("network-{0}-{1}.json" -f $Stage, $labTime.ToUnixTimeMilliseconds())
[IO.File]::WriteAllText($labFile, ($labSnapshot | ConvertTo-Json -Depth 8), [Text.UTF8Encoding]::new($false))
[pscustomobject]@{ output = $labFile; javaProcesses = $labJava.Count; establishedConnections = $labConnections.Count; unexpectedNonLoopback = $labUnexpected.Count } | ConvertTo-Json -Compress
if ($labUnexpected.Count -gt 0) { throw 'Owned Java has a non-loopback TCP connection; stop the lab and investigate.' }
