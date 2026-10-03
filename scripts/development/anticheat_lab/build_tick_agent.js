'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const assert = require('assert');
const { spawnSync } = require('child_process');

function buildTickAgent(java) {
    const output = path.resolve(__dirname, '../../../output/anticheat-lab/trusted-tick-agent');
    const source = path.join(__dirname, 'reference/LabTickAgent.java');
    const digest = crypto.createHash('sha256').update(fs.readFileSync(source)).digest('hex');
    const jar = path.join(output, 'lab-tick-agent.jar');
    const manifest = path.join(output, 'build.json');
    if (fs.existsSync(jar) && fs.existsSync(manifest) && JSON.parse(fs.readFileSync(manifest)).sourceSha256 === digest) return jar;
    fs.mkdirSync(output, { recursive: true });
    const executable = name => path.join(path.dirname(java), name + (process.platform === 'win32' ? '.exe' : ''));
    const compile = spawnSync(executable('javac'), ['-XDignore.symbol.file', '-d', output, source], { encoding: 'utf8', windowsHide: true });
    assert.strictEqual(compile.status, 0, compile.stderr || compile.error?.message);
    const metadata = path.join(output, 'MANIFEST.MF');
    fs.writeFileSync(metadata, 'Manifest-Version: 1.0\nPremain-Class: LabTickAgent\n\n');
    const classes = fs.readdirSync(output).filter(name => /^LabTickAgent.*\.class$/.test(name));
    const pack = spawnSync(executable('jar'), ['cfm', jar, metadata, ...classes], { cwd: output, encoding: 'utf8', windowsHide: true });
    assert.strictEqual(pack.status, 0, pack.stderr || pack.error?.message);
    fs.writeFileSync(manifest, JSON.stringify({ source, sourceSha256: digest, java,
        jarSha256: crypto.createHash('sha256').update(fs.readFileSync(jar)).digest('hex'),
        scope: 'Own server-only instrumentation; no original client input' }, null, 2));
    return jar;
}
module.exports = { buildTickAgent };
