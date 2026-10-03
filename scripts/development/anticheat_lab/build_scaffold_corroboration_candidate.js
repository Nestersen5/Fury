'use strict';
// Isolated correctness hypothesis: the documented Rule F cannot flag alone.
// No numeric threshold change; keep the original measurement untouched.
const fs = require('fs'), path = require('path'), assert = require('assert'), crypto = require('crypto');
const root = path.resolve(__dirname, '../../..'), output = path.join(root, 'output/anticheat-lab/mod-real');
assert(fs.existsSync(path.join(output, 'overnight/measurement-scaffold/manifest.json')),
    'Freeze the original Scaffold measurement before generating an improvement candidate');
const base = path.resolve(process.argv.find(a => a.startsWith('--base='))?.slice(7) ||
    path.join(output, 'overnight/baseline-source/src/detect'));
const destination = path.join(output, 'improvements/scaffold-corroboration-candidate');
assert(!fs.existsSync(destination), 'Candidate already frozen');
let source = fs.readFileSync(path.join(base, 'scaffoldDetector.js'), 'utf8').replace(/\r\n/g, '\n');
const pattern = /(parts.push\(\{ family: 'speed', weight: 1, )(reason: `irregular straight cadence)/;
assert.strictEqual((source.match(new RegExp(pattern.source, 'g')) || []).length, 1);
source = source.replace(pattern, '$1corroborationOnly: true, $2');
const anchor = '        if (!possible) return null;'; assert.strictEqual(source.split(anchor).length, 2);
source = source.replace(anchor, anchor + `
        // Repeated cadence-only strikes still need another observed signal.
        if (!state.strikes.some(strike => (strike.parts || []).some(part => !part.corroborationOnly))) return null;`);
fs.mkdirSync(destination, { recursive: true });
const hashes = {}, baselineHashes = {};
const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
for (const file of ['autoblockDetector.js','scaffoldDetector.js','stasisDetector.js','detectorShared.js']) {
    const original = fs.readFileSync(path.join(base, file)), bytes = file === 'scaffoldDetector.js' ? Buffer.from(source) : original;
    fs.writeFileSync(path.join(destination, file), bytes, { flag: 'wx' });
    hashes[file] = hash(bytes); baselineHashes[file] = hash(original);
}
fs.writeFileSync(path.join(destination, 'manifest.json'), JSON.stringify({ createdAt: new Date().toISOString(),
    base, hypothesis: 'Repeated Rule F cadence strikes must not alone trigger a flag, as documented in the detector header.',
    numericThresholdsUnchanged: true, productionUnchanged: true, frozenBeforeFreshEvaluation: true,
    sourceHashes: hashes, baselineHashes }, null, 2), { flag: 'wx' });
console.log(destination);
