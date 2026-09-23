'use strict';
const assert = require('assert/strict');
const fs = require('fs'), os = require('os'), path = require('path');
const { releaseMatrix, payloadInventory, assertPayloadParity, verifyApplicationFiles, writeReleaseMetadata } = require('../../scripts/release_artifacts');
const { windowsBuildPlan } = require('../../scripts/package_windows');
const { parseArchitectures } = require('../../scripts/package_macos');
const pkg = require('../../package.json');
const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'fury-artifact-tests-'));
(async () => {
    const names = releaseMatrix('1.2.3').map(item => item.filename);
    assert.deepEqual(names, ['Fury-Setup-1.2.3-win-x64.exe', 'Fury-Portable-1.2.3-win-x64.zip',
        'Fury-1.2.3-mac-x64.dmg', 'Fury-Portable-1.2.3-mac-x64.zip', 'Fury-1.2.3-mac-arm64.dmg', 'Fury-Portable-1.2.3-mac-arm64.zip']);
    assert.throws(() => releaseMatrix('../bad'));
    assert.deepEqual(pkg.build.win.target, ['nsis', 'zip']); assert(!pkg.build.portable);
    assert.deepEqual(pkg.build.mac.target, ['zip', 'dmg']);
    assert.equal(pkg.build.nsis.artifactName, 'Fury-Setup-${version}-win-${arch}.${ext}');
    assert.equal(pkg.build.win.artifactName, 'Fury-Portable-${version}-win-${arch}.${ext}');
    assert.equal(pkg.build.mac.artifactName, 'Fury-Portable-${version}-mac-${arch}.${ext}');
    assert.equal(pkg.build.dmg.artifactName, 'Fury-${version}-mac-${arch}.${ext}');
    assert(pkg.build.dmg.contents.some(entry => entry.type === 'link' && entry.path === '/Applications'));
    assert.equal(pkg.build.nsis.include, 'build/installer.nsh');
    assert.equal(pkg.build.win.requestedExecutionLevel, 'asInvoker');
    const plan = windowsBuildPlan(directory);
    assert.deepEqual(plan[0].slice(0, 2), ['--win', 'nsis']);
    assert.deepEqual(plan[1].slice(0, 4), ['--win', 'zip', '--prepackaged', path.join(directory, 'win-unpacked')]);
    for (const args of plan) { assert(args.includes('--x64')); assert.equal(args[args.indexOf('--publish') + 1], 'never'); }
    assert.deepEqual(parseArchitectures(['--all']), ['arm64', 'x64']);
    for (const arch of ['x64', 'arm64']) assert.deepEqual(parseArchitectures(['--arch', arch]), [arch]);

    const a = path.join(directory, 'A'), b = path.join(directory, 'B'); fs.mkdirSync(a); fs.mkdirSync(b);
    for (const root of [a, b]) fs.writeFileSync(path.join(root, 'runtime.js'), 'same');
    const inventory = await payloadInventory(a);
    assertPayloadParity(inventory, await payloadInventory(b));
    fs.writeFileSync(path.join(b, 'runtime.js'), 'drift');
    const changed = await payloadInventory(b);
    assert.throws(() => assertPayloadParity(inventory, changed), /payloads differ/);
    assert.throws(() => assertPayloadParity(inventory, { entries: [] }));
    assert.throws(() => assertPayloadParity(inventory, { entries: [{ path: 'runtime.js', sha256: 'bad' }] }));
    assert.notEqual(inventory.sha256, (await payloadInventory(b)).sha256);
    fs.writeFileSync(path.join(b, 'runtime.js'), 'same'); fs.writeFileSync(path.join(b, '.env'), 'fixture');
    const extra = await payloadInventory(b);
    assert.throws(() => assertPayloadParity(inventory, extra), /payloads differ/);
    assert.throws(() => assertPayloadParity(inventory, { entries: [...inventory.entries, { path: '.env' }] }));
    fs.unlinkSync(path.join(b, '.env'));
    // Model macOS /var's aliased parent without requiring that OS on every CI
    // host. The payload itself is not a link; its trusted parent is an alias.
    const alias = path.join(directory, 'parent-alias');
    fs.symlinkSync(directory, alias, process.platform === 'win32' ? 'junction' : 'dir');
    assertPayloadParity(await payloadInventory(a), await payloadInventory(path.join(alias, 'A')));
    await assert.rejects(payloadInventory(alias), /Redirected payload root/);
    if (process.platform === 'win32') {
        fs.symlinkSync(directory, path.join(a, 'escape'), 'junction');
        await assert.rejects(payloadInventory(path.join(alias, 'A')), /Absolute|Escaping/);
        await assert.rejects(payloadInventory(a), /Absolute|Escaping/); fs.unlinkSync(path.join(a, 'escape'));
    } else {
        fs.chmodSync(path.join(b, 'runtime.js'), 0o755);
        assert.notEqual((await payloadInventory(a)).sha256, (await payloadInventory(b)).sha256);
        fs.symlinkSync('runtime.js', path.join(a, 'valid'));
        assert((await payloadInventory(a)).entries.some(e => e.type === 'link'));
        assertPayloadParity(await payloadInventory(a), await payloadInventory(path.join(alias, 'A')));
        fs.symlinkSync('../B/runtime.js', path.join(a, 'escape'));
        await assert.rejects(payloadInventory(path.join(alias, 'A')), /Escaping/);
        await assert.rejects(payloadInventory(a), /Escaping/); fs.unlinkSync(path.join(a, 'escape'));
    }
    fs.unlinkSync(alias);
    const source = path.join(directory, 'source'), app = path.join(directory, 'app');
    for (const root of [source, app]) {
        fs.mkdirSync(root); fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ name: 'fixture', version: '1.2.3', main: 'runtime.js', dependencies: {}, build: { files: ['runtime.js', 'package.json'] } }));
        fs.writeFileSync(path.join(root, 'runtime.js'), 'same');
    }
    verifyApplicationFiles(source, app);
    fs.writeFileSync(path.join(app, 'session_data.json'), '{}'); assert.throws(() => verifyApplicationFiles(source, app), /Unlisted/);
    fs.unlinkSync(path.join(app, 'session_data.json')); fs.writeFileSync(path.join(app, 'runtime.js'), 'old');
    assert.throws(() => verifyApplicationFiles(source, app), /differs/);

    let metadata = await writeReleaseMetadata(directory, '1.2.3');
    assert.equal(metadata.artifacts.length, 6); assert(metadata.artifacts.every(a => !a.available && a.size === null && a.sha256 === null));
    fs.writeFileSync(path.join(directory, names[1]), 'synthetic ZIP');
    metadata = await writeReleaseMetadata(directory, '1.2.3');
    assert.equal(metadata.artifacts[1].size, 13); assert.match(metadata.artifacts[1].sha256, /^[a-f0-9]{64}$/);
    assert(!JSON.stringify(metadata).includes('http')); assert(!Object.hasOwn(metadata.artifacts[1], 'publicUrl'));
    require('app-builder-lib/out/util/config/config').validateConfiguration(pkg.build, { add() {} });
    const workflow = fs.readFileSync('.github/workflows/portable-macos.yml', 'utf8');
    assert(workflow.includes('runner: macos-15-intel') && workflow.includes('runner: macos-15'));
    console.log('Release matrix, sequential shared stage, names, payload drift, links, hygiene and metadata checks passed.');
})().catch(error => { console.error(error); process.exitCode = 1; }).finally(() => {
    assert.equal(path.dirname(directory), path.resolve(os.tmpdir())); assert(path.basename(directory).startsWith('fury-artifact-tests-'));
    fs.rmSync(directory, { recursive: true, force: true });
});
