'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const root = path.resolve(__dirname, '..');
const scripts = require('../package.json').scripts;
const covered = new Set(['test', 'test:compatibility', 'test:portable', 'test:integration', 'test:packaging']
    .map(name => scripts[name]).join(' ')
    .match(/tests\/[\w/-]+\/test_[\w]+\.js/g) || []);
const testsRoot = path.join(root, 'tests');
const tests = fs.readdirSync(testsRoot, { withFileTypes: true })
    .filter(entry => entry.isDirectory())
    .flatMap(entry => fs.readdirSync(path.join(testsRoot, entry.name))
        .filter(file => /^test_.*\.js$/.test(file))
        .map(file => `tests/${entry.name}/${file}`))
    .filter(file => !covered.has(file)).sort();
for (const test of tests) {
    console.log(`Running additional feature check: ${test}`);
    const result = spawnSync(process.execPath, [path.join(root, test)], { cwd: root, stdio: 'inherit', windowsHide: true, timeout: 180000 });
    if (result.error) throw result.error;
    assert.strictEqual(result.status, 0, `${test} failed`);
}
console.log(`Additional feature checks passed: ${tests.length} test files.`);
