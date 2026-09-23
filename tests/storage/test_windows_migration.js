'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { performance } = require('perf_hooks');
const { spawnSync } = require('child_process');
const migration = require('../../src/storage/windowsMigration');
const { defaultDataDir } = require('../../src/storage/runtimePaths');
const sandbox = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'fury-migration-tests-')));
let count = 0;
function fixture(name) {
    const root = path.join(sandbox, name.replace(/[^a-zA-Z0-9 -]/g, '_'));
    return { owner: 'synthetic-owner', installations: [path.join(root, 'Old Fury')],
        destination: path.join(root, 'Roaming', 'Fury'), control: path.join(root, 'Roaming', '.Fury-migration-v1'),
        newInstallation: path.join(root, 'New Fury'), quiescent: true };
}
function put(root, relative, value) {
    const file = path.join(root, relative);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, value);
}
const source = options => path.join(options.installations[0], 'resources', 'app');
function seed(options) {
    put(source(options), 'launcher_data/profiles.json', '{"profiles":[{"id":"synthetic"}]}');
    put(source(options), 'launcher_data/removed-accounts.json', '["deleted-synthetic-account"]');
    put(source(options), 'auth_tokens/test-account/token.json', '{"fixture":"NOT-A-REAL-TOKEN"}');
    put(source(options), 'launcher_data/Local Storage/leveldb/000003.log', Buffer.from([0, 1, 255, 13, 10]));
    put(source(options), 'launcher_data/auth_backup_fixture_1/cache.json', '{"fixture":true}');
    put(source(options), 'session_data.json', '{"sessions":[]}');
}
function run(options) { return migration.activate(options, migration.preserve(options, migration.plan(options))); }
function test(name, body) {
    body(fixture(name)); count++; console.log('PASS ' + name);
}
try {
    test('canonical Windows root is independent of install path and artifact', () => {
        for (const projectRoot of ['C:\\Program Files\\Fury\\resources\\app', 'D:\\Portable Fury\\resources\\app']) {
            assert.strictEqual(defaultDataDir({ platform: 'win32', isPackaged: true, appData: 'C:\\Users\\Fixture\\AppData\\Roaming', projectRoot }), 'C:\\Users\\Fixture\\AppData\\Roaming\\Fury');
        }
        assert.throws(() => defaultDataDir({ platform: 'win32', isPackaged: true, appData: '' }), /absolute/);
    });
    test('Mac Intel ARM ZIP and future DMG keep Application Support', () => {
        for (const arch of ['x64', 'arm64']) for (const format of ['zip', 'dmg']) {
            assert.strictEqual(defaultDataDir({ platform: 'darwin', isPackaged: true, arch, format,
                appData: '/Users/fixture/Library/Application Support', projectRoot: '/Applications/Fury.app/Contents/Resources/app' }),
            '/Users/fixture/Library/Application Support/Fury');
        }
    });
    test('development keeps the project root', () => {
        assert.strictEqual(defaultDataDir({ platform: 'win32', isPackaged: false, projectRoot: sandbox }), sandbox);
        assert.strictEqual(defaultDataDir({ platform: 'darwin', isPackaged: false, projectRoot: sandbox }), sandbox);
    });
    test('first migration preserves exact selected bytes and exclusions', options => {
        seed(options);
        for (const file of ['launcher.js', 'launcher_data/auth-staging/attempt/token.json', 'auth_tokens/incomplete.tmp',
            'launcher_data/SingletonLock', 'launcher_data/Local Storage/leveldb/LOCK', 'launcher_data/Cache/data', 'launcher_data/skins/cache.json']) put(source(options), file, 'EXCLUDED');
        const expected = migration.inventory(source(options), true);
        assert.strictEqual(run(options)[0].outcome, 'migrated');
        assert.deepStrictEqual(migration.inventory(options.destination), expected);
        assert.strictEqual(migration.needsMaintenance(options.control), false);
        assert.ok(fs.existsSync(path.join(source(options), 'auth_tokens/test-account/token.json')));
    });
    test('retry reinstall upgrade and account removal never replay a receipt', options => {
        seed(options); run(options);
        fs.unlinkSync(path.join(options.destination, 'auth_tokens/test-account/token.json'));
        put(options.destination, 'launcher_data/removed-accounts.json', '["deleted-synthetic-account","test-account"]');
        const afterRemoval = migration.inventory(options.destination);
        run(options); run(options);
        assert.deepStrictEqual(migration.inventory(options.destination), afterRemoval);
    });
    test('auth-cache recency timestamps survive both copies', options => {
        seed(options);
        const relative = 'auth_tokens/test-account/token.json';
        const when = new Date('2020-01-02T03:04:05.000Z');
        fs.utimesSync(path.join(source(options), relative), when, when);
        run(options);
        assert.ok(Math.abs(fs.statSync(path.join(options.destination, relative)).mtimeMs - when.getTime()) < 1);
    });
    test('identical destination', options => {
        seed(options); fs.cpSync(source(options), options.destination, { recursive: true });
        assert.strictEqual(run(options)[0].outcome, 'already-identical');
    });
    for (const name of ['conflicting destination', 'partial destination', 'portable first then installed']) {
        test(name, options => {
            seed(options); put(options.destination, 'launcher_data/removed-accounts.json', '["canonical-removal"]');
            const before = migration.inventory(options.destination);
            const result = run(options)[0];
            assert.strictEqual(result.outcome, 'preserved-conflict');
            assert.deepStrictEqual(migration.inventory(options.destination), before);
            assert.deepStrictEqual(migration.inventory(path.join(options.control, result.id, 'payload')), migration.inventory(source(options), true));
        });
    }
    for (const point of ['copied:auth_tokens/test-account/token.json', 'before-verify', 'before-ready', 'ready', 'before-publish', 'published', 'receipt']) {
        test('interruption ' + point, options => {
            seed(options);
            assert.throws(() => run({ ...options, checkpoint: reached => { if (reached === point) throw Error('SIMULATED_INTERRUPTION'); } }), /SIMULATED_INTERRUPTION/);
            run(options);
            assert.deepStrictEqual(migration.inventory(options.destination), migration.inventory(source(options), true));
        });
    }
    test('source mutation aborts before readiness', options => {
        seed(options);
        assert.throws(() => run({ ...options, checkpoint: point => {
            if (point === 'before-verify') put(source(options), 'session_data.json', '{"changed":true}');
        } }), /SOURCE_CHANGED/);
        assert.ok(!fs.existsSync(options.destination));
    });
    test('empty partial canonical directory is retained as a conflict', options => {
        seed(options); fs.mkdirSync(path.join(options.destination, 'launcher_data'), { recursive: true });
        assert.strictEqual(run(options)[0].outcome, 'preserved-conflict');
        assert.deepStrictEqual(fs.readdirSync(options.destination), ['launcher_data']);
    });
    test('actual worker crash after publication recovers without replay', options => {
        seed(options);
        const file = path.join(sandbox, 'crash-worker.js');
        fs.writeFileSync(file, `const m=require(${JSON.stringify(require.resolve('../../src/storage/windowsMigration'))});
            const options=${JSON.stringify(options)};
            options.checkpoint=point=>{if(point==='published')process.exit(77)};
            m.activate(options,m.preserve(options,m.plan(options)));`);
        const child = spawnSync(process.execPath, [file], { windowsHide: true, encoding: 'utf8' });
        assert.strictEqual(child.status, 77);
        run(options);
        assert.deepStrictEqual(migration.inventory(options.destination), migration.inventory(source(options), true));
    });
    test('tampered snapshot is rejected', options => {
        seed(options); const ids = migration.preserve(options, migration.plan(options));
        put(path.join(options.control, ids[0], 'payload'), 'session_data.json', 'TAMPERED');
        assert.throws(() => migration.activate(options, ids), /STAGING_CHANGED/);
        assert.ok(!fs.existsSync(options.destination));
    });
    test('tampered manifest traversal is rejected', options => {
        seed(options); const ids = migration.preserve(options, migration.plan(options));
        const file = path.join(options.control, ids[0], 'ready.json');
        const ready = migration.readJson(file); ready.entries[0].path = '../escape'; migration.writeJson(file, ready);
        assert.throws(() => migration.activate(options, ids), /INVALID_MANIFEST/);
    });
    test('insufficient disk space', options => {
        seed(options);
        assert.throws(() => run({ ...options, availableBytes: 1 }), /INSUFFICIENT_SPACE/);
        assert.ok(!fs.existsSync(options.control));
    });
    test('missing required file between planning and preservation', options => {
        seed(options); const planned = migration.plan(options); fs.unlinkSync(path.join(source(options), 'session_data.json'));
        assert.throws(() => migration.preserve(options, planned), /SOURCE_CHANGED/);
    });
    test('source junction rejection', options => {
        const other = path.join(sandbox, 'junction-target'); fs.mkdirSync(other);
        fs.mkdirSync(source(options), { recursive: true });
        fs.symlinkSync(other, path.join(source(options), 'auth_tokens'), 'junction');
        assert.throws(() => migration.plan(options), /UNSAFE_LINK/);
    });
    test('hardlink rejection', options => {
        seed(options); fs.linkSync(path.join(source(options), 'session_data.json'), path.join(source(options), 'presets.json'));
        assert.throws(() => migration.plan(options), /UNSAFE_LINK/);
    });
    test('active writers and ownership mismatch', options => {
        seed(options); const planned = migration.plan(options);
        assert.throws(() => migration.preserve({ ...options, quiescent: false }, planned), /OWNERSHIP_OR_WRITERS/);
        assert.throws(() => migration.preserve({ ...options, owner: 'other-user' }, planned), /OWNERSHIP_OR_WRITERS/);
    });
    test('data root cannot be removed with either installation', options => {
        seed(options);
        assert.throws(() => migration.plan({ ...options, destination: path.join(options.installations[0], 'data') }), /INSTALL_DATA_OVERLAP/);
        assert.throws(() => migration.plan({ ...options, control: path.join(options.newInstallation, 'recovery') }), /INSTALL_DATA_OVERLAP/);
    });
    test('changed install directory and simulated old removal preserve canonical', options => {
        seed(options); run(options); const expected = migration.inventory(options.destination);
        // Both paths derive exclusively from fixture(), beneath mkdtempSync.
        fs.rmSync(options.installations[0], { recursive: true });
        fs.mkdirSync(options.newInstallation, { recursive: true });
        put(options.newInstallation, 'application-file.txt', 'NEW APPLICATION');
        fs.rmSync(options.newInstallation, { recursive: true });
        assert.deepStrictEqual(migration.inventory(options.destination), expected);
        assert.strictEqual(migration.needsMaintenance(options.control), false);
    });
    test('no legacy found completes discovery but installer pending takes precedence', options => {
        run(options);
        assert.strictEqual(migration.needsMaintenance(options.control), false);
        seed(options); migration.preserve(options, migration.plan(options));
        assert.strictEqual(migration.needsMaintenance(options.control), true);
        migration.activate(options, migration.pending(options));
        assert.strictEqual(migration.needsMaintenance(options.control), false);
    });
    test('multiple differing profiles are preserved without arbitrary activation', options => {
        seed(options); const second = path.join(path.dirname(options.newInstallation), 'Other Old Fury');
        put(path.join(second, 'resources/app'), 'session_data.json', '{"other":true}');
        options.installations.push(second);
        assert.ok(run(options).every(result => result.outcome === 'preserved-conflict'));
        assert.ok(!fs.existsSync(options.destination));
    });
    test('first migration and completed startup overhead', options => {
        for (let index = 0; index < 128; index++) put(source(options), `recordings/${index}.bin`, Buffer.alloc(64 * 1024, index));
        const start = performance.now(); run(options); const elapsed = performance.now() - start;
        const samples = [];
        for (let index = 0; index < 200; index++) {
            const before = performance.now(); assert.strictEqual(migration.needsMaintenance(options.control), false); samples.push(performance.now() - before);
        }
        samples.sort((a, b) => a - b);
        console.log(JSON.stringify({ benchmark: 'synthetic 8 MiB, 128 files', migrationMs: elapsed,
            completedCheckMedianMs: samples[100], completedCheckP95Ms: samples[190],
            temporaryFreeBytesRequired: migration.requiredSpace(migration.inventory(options.destination)) }));
    });
    console.log(`${count} Windows migration tests passed.`);
} finally {
    fs.rmSync(sandbox, { recursive: true, force: true });
}
