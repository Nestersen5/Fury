'use strict';
const assert = require('assert/strict'), fs = require('fs'), os = require('os'), path = require('path');
const { execFileSync } = require('child_process');
const { test } = require('node:test');
const { applicationRoot, applicationEntries, applicationFileExists } = require('../../scripts/packaged_application');
const { verifyApplicationFiles } = require('../../scripts/release_artifacts');
const { assertNoBrowserPayload } = require('../../scripts/verify_no_browser');

test('archive verification retains source parity, private-file gates and unpacked-file ownership', () => {
    const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'fury-archive-tests-'));
    try {
        const source = path.join(temporary, 'source'), resources = path.join(temporary, 'resources'), archive = path.join(resources, 'app.asar');
        fs.mkdirSync(source); fs.mkdirSync(resources);
        fs.writeFileSync(path.join(source, 'package.json'), JSON.stringify({ name: 'fixture', version: '1.0.0', main: 'runtime.js', dependencies: {},
            build: { files: ['runtime.js', 'external.ps1', 'package.json'] } }));
        fs.writeFileSync(path.join(source, 'runtime.js'), 'process.stdout.write("archive-runtime-ok")');
        fs.writeFileSync(path.join(source, 'external.ps1'), '# fixture');
        const pack = () => { execFileSync(process.execPath,
            [path.join(path.dirname(require.resolve('@electron/asar/package.json')), 'bin/asar.js'), 'pack', source, archive, '--unpack', '**/external.ps1'],
            { windowsHide: true }); require('@electron/asar').uncache(archive); };
        pack();
        assert.equal(applicationRoot(resources), archive);
        assert(applicationFileExists(archive, 'external.ps1'));
        assert(applicationEntries(archive).includes('runtime.js'));
        assert.equal(verifyApplicationFiles(source, archive).sourceSha256, verifyApplicationFiles(source, source).sourceSha256);
        const result = execFileSync(require('electron'), [path.join(archive, 'runtime.js')],
            { env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }, encoding: 'utf8', windowsHide: true });
        assert.equal(result, 'archive-runtime-ok');
        fs.writeFileSync(path.join(archive + '.unpacked', 'external.ps1'), '# changed');
        assert.throws(() => verifyApplicationFiles(source, archive), /differs/);
        pack();
        fs.writeFileSync(path.join(archive + '.unpacked', '.env'), 'synthetic-private-file');
        assert.throws(() => applicationEntries(archive), /not found|Unlisted/);
        fs.unlinkSync(path.join(archive + '.unpacked', '.env'));
        fs.writeFileSync(path.join(source, 'session_data.json'), '{}'); pack();
        assert.throws(() => verifyApplicationFiles(source, archive), /Unlisted/);
        fs.unlinkSync(path.join(source, 'session_data.json'));
        fs.mkdirSync(path.join(source, 'node_modules/puppeteer'), { recursive: true });
        fs.writeFileSync(path.join(source, 'node_modules/puppeteer/index.js'), '// forbidden'); pack();
        assert.throws(() => assertNoBrowserPayload(temporary), /Removed production dependency/);
    } finally {
        assert.equal(path.dirname(temporary), path.resolve(os.tmpdir()));
        assert(path.basename(temporary).startsWith('fury-archive-tests-'));
        fs.rmSync(temporary, { recursive: true, force: true });
    }
});
