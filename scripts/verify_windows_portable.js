'use strict';
const assert = require('assert/strict');
const fs = require('fs'), path = require('path'), os = require('os');
const { command } = require('./verify_release_pair');
const { verifyApplication, sha256 } = require('./release_artifacts');

async function main(archive, reportFile) {
    assert.equal(process.platform, 'win32', 'Windows runtime verification requires Windows');
    const fixture = fs.mkdtempSync(path.join(os.tmpdir(), 'fury-portable-runtime-'));
    const application = path.join(fixture, 'Fury Extracted With Spaces');
    try {
        const sevenZip = await require('app-builder-lib/out/toolsets/7zip').getPath7za();
        command(sevenZip, ['x', '-y', '-bd', '-bso0', '-bsp0', '-o' + application, archive]);
        await verifyApplication(path.resolve(__dirname, '..'), application, 'win', 'x64');
        const result = path.join(fixture, 'runtime.json');
        command(path.join(process.env.SystemRoot, 'System32/WindowsPowerShell/v1.0/powershell.exe'), [
            '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', path.join(__dirname, 'test_packaged_readonly.ps1'),
            '-Fixture', fixture, '-TemporaryParent', os.tmpdir(), '-Application', application,
            '-Node', process.execPath, '-Verifier', path.join(__dirname, 'verify_packaged_runtime.js'), '-Report', result
        ], { timeout: 360000, stdio: 'inherit' });
        const report = { ...JSON.parse(fs.readFileSync(result)), archive: path.basename(archive),
            archiveSha256: await sha256(archive), resourceWriteDenied: true };
        if (reportFile) fs.writeFileSync(reportFile, JSON.stringify(report, null, 2) + '\n');
        console.log('Windows portable ZIP native runtime and immutable-resource checks passed.');
        return report;
    } finally {
        assert.equal(path.dirname(fixture), path.resolve(os.tmpdir()));
        assert(path.basename(fixture).startsWith('fury-portable-runtime-'));
        fs.rmSync(fixture, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
    }
}
if (require.main === module) {
    if (!process.argv[2]) throw new Error('Usage: node scripts/verify_windows_portable.js <portable.zip> [report.json]');
    main(path.resolve(process.argv[2]), process.argv[3] && path.resolve(process.argv[3])).catch(error => { console.error(error.stack); process.exitCode = 1; });
}
module.exports = { main };
