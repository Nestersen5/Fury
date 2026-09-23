'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { packagePaths } = require('./smoke_packaged_app');

// Run focused UI checks against either development Electron or the extracted
// download. Keep all settings and synthetic account fixtures in each test's temp dir.
function verificationTarget(name) {
    const options = {}, args = process.argv.slice(2);
    for (let i = 0; i < args.length; i += 2) {
        assert(['--app', '--output'].includes(args[i]) && args[i + 1], 'Expected --app <Fury.app> or --output <directory>');
        options[args[i]] = args[i + 1];
    }
    const root = path.resolve(__dirname, '..');
    const packaged = options['--app'] ? packagePaths(options['--app']) : null;
    if (packaged) require('./verify_packaged_sources').verifySources(root, packaged.appRoot);
    const output = path.resolve(options['--output'] || path.join(root, 'output', name));
    fs.mkdirSync(output, { recursive: true });
    return {
        packaged, output, resources: packaged?.resources || root,
        executable: packaged?.executable || require('electron'),
        args: packaged ? [] : [root],
        record() {
            fs.writeFileSync(path.join(output, 'focused-verification.json'), JSON.stringify({
                test: name, passed: true, platform: process.platform, architecture: process.arch,
                packaged: Boolean(packaged), version: require('../package.json').version,
                sourceCommit: process.env.GITHUB_SHA || null,
                conditions: 'Actual launcher with isolated synthetic accounts and offline responses; real Microsoft authorization and live Hypixel gameplay are not exercised.'
            }, null, 2) + '\n');
        }
    };
}

module.exports = { verificationTarget };
