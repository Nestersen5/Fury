'use strict';
const assert = require('assert/strict');
const { EventEmitter } = require('events');
const fs = require('fs');
const { acquireLauncherInstance } = require('../../src/bootstrap/launcherInstance');
for (const granted of [false, true]) {
    const app = new EventEmitter(), calls = [];
    app.requestSingleInstanceLock = () => { calls.push('lock'); return granted; };
    app.exit = code => calls.push(`exit:${code}`);
    app.releaseSingleInstanceLock = () => { throw Error('Ownership released before exit'); };
    let quitting = false, minimized = true, destroyed = false;
    let window = { isDestroyed: () => destroyed, isMinimized: () => minimized,
        restore: () => calls.push('restore'), show: () => calls.push('show'), focus: () => calls.push('focus') };
    assert.equal(acquireLauncherInstance({ app, getWindow: () => window, isQuitting: () => quitting }), granted);
    if (!granted) {
        assert.deepEqual(calls, ['lock', 'exit:0']);
        assert.equal(app.listenerCount('second-instance'), 0);
        continue;
    }
    app.emit('second-instance');
    assert.deepEqual(calls.splice(0), ['lock', 'restore', 'show', 'focus']);
    minimized = false; app.emit('second-instance');
    assert.deepEqual(calls.splice(0), ['show', 'focus']);
    quitting = true; app.emit('second-instance'); assert.deepEqual(calls, []);
    quitting = false; destroyed = true; app.emit('second-instance'); assert.deepEqual(calls, []);
    window = null; app.emit('second-instance'); assert.deepEqual(calls, []);
}
const launcher = fs.readFileSync(require.resolve('../../launcher'), 'utf8');
const points = ['windowsMigrationBootstrap', 'initializeDataDir(defaultDataDir', "app.setPath('userData'", '.acquireLauncherInstance(', "require('axios')"];
let previous = -1;
for (const point of points) { const index = launcher.indexOf(point); assert(index > previous, `Initialization order: ${point}`); previous = index; }
assert(!launcher.includes('releaseSingleInstanceLock'));
const pkg = require('../../package.json');
const semver = require('semver');
for (const version of ['22.12.0', '22.23.2', '24.0.0', '24.21.0']) assert(semver.satisfies(version, pkg.engines.node));
for (const version of ['20.20.0', '22.11.0', '23.0.0', '25.0.0']) assert(!semver.satisfies(version, pkg.engines.node));
assert.deepEqual(require('../../package-lock.json').packages[''].engines, pkg.engines);
console.log('PASS launcher lock ownership, focus, shutdown retention, startup ordering and Node policy');
