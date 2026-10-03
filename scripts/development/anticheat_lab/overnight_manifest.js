'use strict';
const fs = require('fs'), path = require('path'), crypto = require('crypto');
const { execFileSync } = require('child_process');
const root = path.resolve(__dirname, '../../..');
const base = path.join(root, 'output/anticheat-lab/mod-real/overnight');
const mod = 'C:/Users/Admin/Desktop/vape-test-mod-codex';
const hash = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
function tree(directory, prefix = '') {
    const result = {};
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
        const relative = prefix + entry.name, file = path.join(directory, entry.name);
        if (entry.isDirectory()) Object.assign(result, tree(file, relative + '/'));
        else result[relative] = hash(file);
    }
    return result;
}
fs.mkdirSync(base, { recursive: true });
const stage = process.argv[2] || 'start';
const modFiles = tree(path.join(mod, 'build/classes/java/main'));
const expected = JSON.parse(fs.readFileSync(path.join(root, 'output/anticheat-lab/mod-real/mod-build-before.json')));
require('assert').deepStrictEqual(modFiles, expected.classFiles, 'Mod class tree changed');
const jar = hash(path.join(mod, 'build/libs/ClientEnhancer-1.0.0.jar'));
require('assert').strictEqual(jar, expected.jarSha256, 'Mod JAR changed');
const status = execFileSync('git', ['status', '--short'], { cwd: root, encoding: 'utf8' });
const source = {};
for (const file of ['proxy.js','app_config.js','src/bootstrap/config.js','src/launcher/renderer/launcher_redesign_pages.js',
    ...fs.readdirSync(path.join(root, 'src/detect')).filter(name => name.endsWith('.js')).map(name => 'src/detect/' + name)]) {
    source[file] = hash(path.join(root, file));
    if (stage === 'start') {
        const snapshot = path.join(base, 'baseline-source', file);
        fs.mkdirSync(path.dirname(snapshot), { recursive: true });
        if (!fs.existsSync(snapshot)) fs.copyFileSync(path.join(root, file), snapshot, fs.constants.COPYFILE_EXCL);
    }
}
const manifest = { stage, capturedAt: new Date().toISOString(), modFiles, jarSha256: jar, sourceHashes: source, gitStatus: status };
fs.writeFileSync(path.join(base, stage + '-manifest.json'), JSON.stringify(manifest, null, 2) + '\n', { flag: 'wx' });
fs.writeFileSync(path.join(base, stage + '-git-status.txt'), status, { flag: 'wx' });
console.log(JSON.stringify({ stage, modFiles: Object.keys(modFiles).length, jarMatches: true, output: base }));
