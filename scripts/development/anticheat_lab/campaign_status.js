'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const assert = require('assert');
const sha = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
function campaignStatus(directory) {
    const normal = path.join(directory, 'campaign-result.json');
    if (fs.existsSync(normal)) return JSON.parse(fs.readFileSync(normal));
    const interruption = JSON.parse(fs.readFileSync(path.join(directory, 'campaign-interruption.json')));
    assert(interruption.diagnosis && interruption.failedTrialId && interruption.recordedAfterExit);
    for (const [file, hash] of Object.entries(interruption.artifactHashes)) {
        assert.strictEqual(sha(fs.readFileSync(path.join(directory, file))), hash, `Interrupted artifact remains immutable: ${file}`);
    }
    const rows = fs.readFileSync(path.join(directory, 'outcomes.jsonl'), 'utf8').trim().split('\n').filter(Boolean).map(JSON.parse);
    assert(rows.every(row => row.valid), 'Completed outcomes before interruption must independently be valid');
    assert(!rows.some(row => row.id === interruption.failedTrialId), 'Interrupted trial cannot be counted');
    return { complete: false, interrupted: true, performed: rows.length, valid: rows.length,
        errors: [], interruption, limitation: 'Errors array describes completed trials only; process failure and incomplete trial remain explicitly recorded.' };
}
module.exports = { campaignStatus };
