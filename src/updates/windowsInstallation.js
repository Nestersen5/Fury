'use strict';
const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');
const { INSTALL_GUID } = require('../storage/windowsMigrationBootstrap');

async function readLocation(key) {
    const executable = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'reg.exe');
    return new Promise(resolve => execFile(executable, ['query', key, '/v', 'InstallLocation', '/reg:64'],
        { windowsHide: true, timeout: 3000, maxBuffer: 16384, encoding: 'utf8' }, (error, stdout) => {
            if (error) return resolve(null);
            resolve(/^\s*InstallLocation\s+REG_SZ\s+(.+?)\s*$/mi.exec(stdout)?.[1] || null);
        }));
}
async function detectWindowsInstallation({ isPackaged, platform = process.platform, arch = process.arch,
    executable = process.execPath, dataDirectory, registry = readLocation, realpath = fs.promises.realpath } = {}) {
    if (!isPackaged || platform !== 'win32' || arch !== 'x64') return null;
    try {
        const locations = await Promise.all(['HKCU', 'HKLM'].map(hive => registry(`${hive}\\Software\\${INSTALL_GUID}`)));
        const current = await realpath(executable);
        for (const location of locations) {
            if (!location || !path.win32.isAbsolute(location)) continue;
            try {
                const registered = await realpath(path.win32.join(location, 'Fury.exe'));
                if (registered.toLowerCase() === current.toLowerCase()) {
                    const directory = path.win32.dirname(current);
                    if (dataDirectory) {
                        const relative = path.win32.relative(directory.toLowerCase(), (await realpath(dataDirectory)).toLowerCase());
                        // A nonstandard override inside the installation would
                        // be removed by NSIS. Preserve the path; decline in-app
                        // installation rather than moving or deleting its data.
                        if (!path.win32.isAbsolute(relative) && relative !== '..' && !relative.startsWith('..\\')) return null;
                    }
                    return { directory };
                }
            } catch { /* Stale registrations and missing installations are not eligible. */ }
        }
    } catch { /* Uncertain installation identity keeps manual downloads. */ }
    return null;
}
async function canInstallWithCurrentProcesses({ pid = process.pid, execute = execFile } = {}) {
    if (!Number.isSafeInteger(pid) || pid < 1) return false;
    const powershell = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
    const script = `$ErrorActionPreference='Stop'; $items=@(Get-CimInstance Win32_Process); $parents=@{};
foreach($item in $items){$parents[[int]$item.ProcessId]=[int]$item.ParentProcessId};
function Is-Owned([int]$candidateId){for($step=0;$step -lt 64;$step++){if($candidateId -eq ${pid}){return $true};if(-not $parents.ContainsKey($candidateId)){return $false};$candidateId=$parents[$candidateId]};return $false};
$other=@($items | Where-Object {$_.Name -ieq 'Fury.exe' -and -not (Is-Owned ([int]$_.ProcessId))});
if($other.Count -eq 0){[Console]::Write('clear')}else{[Console]::Write('blocked')}`;
    return new Promise(resolve => execute(powershell, ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', script],
        { windowsHide: true, timeout: 5000, maxBuffer: 16384, encoding: 'utf8' }, (error, stdout) => resolve(!error && stdout.trim() === 'clear')));
}
module.exports = { detectWindowsInstallation, readLocation, canInstallWithCurrentProcesses };
