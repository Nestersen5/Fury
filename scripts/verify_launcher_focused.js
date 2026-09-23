'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const args = process.argv.slice(2), options = {};
for (let i = 0; i < args.length; i += 2) {
    assert(['--app', '--output'].includes(args[i]) && args[i + 1], 'Expected --app <Fury.app> or --output <directory>');
    options[args[i]] = args[i + 1];
}
const root = path.resolve(__dirname, '..');
const output = path.resolve(options['--output'] || path.join(root, 'output', 'launcher-focused'));
const tests = ['verify_launcher_onboarding', 'verify_dashboard_connection', 'verify_profiles_accordion', 'verify_settings_autosave', 'verify_settings_sidebar', 'verify_calendar_stats'];
for (const test of tests) {
    console.log(`Checking ${test} against ${options['--app'] || 'development Electron'}`);
    const result = spawnSync(process.execPath, [path.join(__dirname, test + '.js'),
        ...(options['--app'] ? ['--app', path.resolve(options['--app'])] : []), '--output', path.join(output, test)],
        { cwd: root, stdio: 'inherit', windowsHide: true, timeout: 180000 });
    if (result.error) throw result.error;
    assert.strictEqual(result.status, 0, `${test} failed`);
    const report = JSON.parse(fs.readFileSync(path.join(output, test, 'focused-verification.json')));
    assert(report.passed && report.packaged === Boolean(options['--app']));
}
console.log(`Focused launcher suites passed: ${tests.length}.`);
