'use strict';
const fs = require('fs'), path = require('path'), crypto = require('crypto'), assert = require('assert');
const { createJumpResetDetector, DEFAULTS } = require('./jump_reset_candidate');
const root = path.resolve(__dirname, '../../..'), base = path.join(root, 'output/anticheat-lab/mod-real/jump-reset');
const frozenFile = path.join(base, 'FROZEN_CANDIDATE.json'), frozen = fs.existsSync(frozenFile) ? JSON.parse(fs.readFileSync(frozenFile)) : null;
const thresholds = frozen?.thresholds || DEFAULTS, results = [];
if (frozen) for (const [name, expected] of Object.entries(frozen.sourceHashes))
    assert.strictEqual(crypto.createHash('sha256').update(fs.readFileSync(path.join(__dirname, name))).digest('hex'), expected);
for (const input of process.argv.slice(2)) {
    const evidence = JSON.parse(fs.readFileSync(input)); assert(evidence.complete);
    for (const trial of evidence.rows) {
        const bytes = fs.readFileSync(path.join(trial.directory, trial.recorderFile));
        assert.strictEqual(crypto.createHash('sha256').update(bytes).digest('hex'), trial.recorderSha256);
        const flags = [], detector = createJumpResetDetector({ thresholds, onFlag: flag => {
            if (Number(flag.entityId) === Number(trial.actorId)) flags.push(flag);
        } });
        for (const record of bytes.toString().trim().split(/\r?\n/).filter(Boolean).map(JSON.parse)) detector.observeRecord(record);
        results.push({ input: path.resolve(input), id: trial.id, scenario: trial.scenario, flags });
    }
}
const file = path.join(base, `crosscheck-${frozen ? 'frozen' : 'prototype'}-${Date.now()}.json`);
fs.writeFileSync(file, JSON.stringify({ generatedAt: new Date().toISOString(), frozen: !!frozen, thresholds,
    trials: results.length, unintendedActorFlags: results.filter(r => r.flags.length), rows: results }, null, 2), { flag: 'wx' });
console.log(JSON.stringify({ file, trials: results.length, unintendedFlags: results.filter(r => r.flags.length).map(r => r.id) }));
