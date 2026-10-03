'use strict';
// Freeze only after complete evidence and calibration-only review. Never reads
// held-out verdicts. The snapshot, not the mutable working tree, is evaluated.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const assert = require('assert');
const sha = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const [destinationArg, ...evidenceFiles] = process.argv.slice(2);
assert(destinationArg && evidenceFiles.length, 'freeze_candidate.js NEW_DIRECTORY EVIDENCE...');
const destination = path.resolve(destinationArg);
assert(!fs.existsSync(destination), 'Use a fresh destination');
const detectorDir = path.resolve(__dirname, '../../../src/detect');
const bytes = Object.fromEntries(fs.readdirSync(detectorDir).filter(f => f.endsWith('.js')).sort()
    .map(f => [f, fs.readFileSync(path.join(detectorDir, f))]));
const sourceHashes = Object.fromEntries(Object.entries(bytes).map(([file, data]) => [file, sha(data)]));
const calibration = evidenceFiles.map(file => {
    const raw = fs.readFileSync(file), evidence = JSON.parse(raw);
    assert(evidence.complete && evidence.errors.length === 0);
    const calibrationFile = file.replace(/-evidence\.json$/, '-current-calibration.json');
    assert.notStrictEqual(file, calibrationFile);
    const scoredBytes = fs.readFileSync(calibrationFile), scored = JSON.parse(scoredBytes);
    assert.strictEqual(scored.split, 'calibration');
    assert.strictEqual(scored.evidenceSha256, sha(raw));
    assert.deepStrictEqual(scored.sourceHashes, sourceHashes, 'Review calibration using the final candidate first');
    return { evidence: path.resolve(file), evidenceSha256: sha(raw),
        calibration: path.resolve(calibrationFile), calibrationSha256: sha(scoredBytes),
        trials: evidence.rows.length, scenarios: Object.keys(evidence.counts).length };
});
fs.mkdirSync(path.join(destination, 'detectors'), { recursive: true });
for (const [file, data] of Object.entries(bytes)) fs.writeFileSync(path.join(destination, 'detectors', file), data, { flag: 'wx' });
const manifest = { schema: 1, createdAt: new Date().toISOString(), node: process.version,
    purpose: 'Final candidate frozen before opening held-out detector verdicts. No evaluation-based tuning.',
    sourceHashes, calibration };
fs.writeFileSync(path.join(destination, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n', { flag: 'wx' });
console.log(JSON.stringify({ destination, sourceHashes, trials: calibration.reduce((n, c) => n + c.trials, 0) }, null, 2));
