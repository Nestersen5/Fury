param([string]$Fixture, [string]$TemporaryParent, [string]$Application, [string]$Node, [string]$Verifier, [string]$Report)
$ErrorActionPreference = 'Stop'
$Fixture = [IO.Path]::GetFullPath($Fixture)
$Application = [IO.Path]::GetFullPath($Application)
if ([IO.Path]::GetDirectoryName($Fixture) -ne [IO.Path]::GetFullPath($TemporaryParent).TrimEnd('\')) { throw 'Invalid fixture parent' }
if (-not ([IO.Path]::GetFileName($Fixture)).StartsWith('fury-portable-runtime-')) { throw 'Invalid fixture' }
if (-not $Application.StartsWith($Fixture+'\', [StringComparison]::OrdinalIgnoreCase)) { throw 'Application is outside fixture' }
if ((Get-Item -LiteralPath $Application).Attributes -band [IO.FileAttributes]::ReparsePoint) { throw 'Redirected application' }
$original = Get-Acl -LiteralPath $Application
$acl = Get-Acl -LiteralPath $Application
$sid = [Security.Principal.WindowsIdentity]::GetCurrent().User
$acl.AddAccessRule([Security.AccessControl.FileSystemAccessRule]::new($sid, 'Write', 'ContainerInherit, ObjectInherit', 'None', 'Deny'))
try {
    Set-Acl -LiteralPath $Application -AclObject $acl
    $denied = $false
    try { [IO.File]::WriteAllText((Join-Path $Application 'write-probe'), 'synthetic') } catch [UnauthorizedAccessException] { $denied = $true }
    if (-not $denied) { throw 'Read-only ACL did not take effect' }
    & $Node $Verifier (Join-Path $Application 'Fury.exe') $Report
    if ($LASTEXITCODE -ne 0) { throw 'Packaged runtime verification failed' }
} finally {
    Set-Acl -LiteralPath $Application -AclObject $original
}
