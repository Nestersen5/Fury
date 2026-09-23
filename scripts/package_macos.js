const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { verifyPair } = require('./verify_release_pair');
const { writeReleaseMetadata } = require('./release_artifacts');

const root = path.resolve(__dirname, '..');

function parseArchitectures(args) {
    if (!args.length) return ['arm64'];
    if (args.length === 1 && args[0] === '--all') return ['arm64', 'x64'];
    if (args.length === 2 && args[0] === '--arch' && ['arm64', 'x64'].includes(args[1])) return [args[1]];
    throw new Error('Usage: npm run package:mac -- [--all | --arch arm64 | --arch x64]');
}

async function main(args = process.argv.slice(2)) {
    const architectures = parseArchitectures(args);
    if (process.platform !== 'darwin') {
        throw new Error('Build the Mac apps on macOS, or run the "Fury macOS distributions" GitHub Actions workflow. macOS is required to preserve executable permissions, framework links and DMG contents.');
    }
    const output = path.resolve(process.env.FURY_RELEASE_DIR || path.join(root, 'release', 'mac-portable'));
    fs.mkdirSync(output, { recursive: true });
    for (const arch of architectures) {
        const result = spawnSync(process.execPath, [
            require.resolve('electron-builder/out/cli/cli.js'),
            '--mac', 'zip', 'dmg', `--${arch}`, '--publish', 'never',
            `--config.directories.output=${output}`
        ], { cwd: root, env: process.env, stdio: 'inherit' });
        if (result.error) throw result.error;
        if (result.status !== 0) throw new Error(`macOS ${arch} build failed (${result.status}).`);
        await verifyPair({ directory: output, platform: 'mac', arch, sourceRoot: root,
            reportFile: path.join(output, `PAIR-mac-${arch}.json`) });
        await writeReleaseMetadata(output, require('../package.json').version);
    }
    console.log(`Mac ZIP and DMG downloads: ${output}`);
}

if (require.main === module) main().catch(error => { console.error(error.message); process.exitCode = 1; });
module.exports = { parseArchitectures, main };
