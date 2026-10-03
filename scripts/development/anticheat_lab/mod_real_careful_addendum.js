'use strict';
const fs = require('fs'), path = require('path'), crypto = require('crypto');
const root = path.resolve(__dirname, '../../..');
const bases = ['output/anticheat-lab/mod-real/scaffold', 'output/anticheat-lab/mod-real/improvements/fresh/scaffold'];
for (const relative of bases) {
    const base = path.join(root, relative); fs.mkdirSync(base, { recursive: true });
    const file = path.join(base, 'CAREFUL_CONTROL_ADDENDUM.json');
    const hashes = Object.fromEntries(['adapt_scaffold_careful_input.js','adapt_scaffold_careful_validation.js','mod_real_scaffold_careful_controls.js'].map(name => [name,
        crypto.createHash('sha256').update(fs.readFileSync(path.join(__dirname, name))).digest('hex')]));
    if (fs.existsSync(file)) {
        const existing = JSON.parse(fs.readFileSync(file));
        if (JSON.stringify(existing.sourceHashes) !== JSON.stringify(hashes)) {
            (existing.provenanceRevisions ||= []).push({ at: new Date().toISOString(), previousSourceHashes: existing.sourceHashes,
                reason: 'The supplementary 400-pixel pilot failed the independent low-pitch observer gate: Windows cursor clipping truncated the motion. Before any corrected full capture, split 600 pixels into four 150-pixel steps, 35 ms apart, in each direction. All prior pilot evidence remains invalid and retained; the observer pitch gate and detectors are unchanged.' });
            existing.sourceHashes = hashes;
            existing.protocol.observerPitchDegrees = [-90,35];
            existing.protocol.raisePitchPixels = -600;
            existing.protocol.restorePitchPixels = 600;
            existing.protocol.motionSteps = 4;
            existing.protocol.motionStepWaitMs = 35;
            fs.writeFileSync(file, JSON.stringify(existing, null, 2) + '\n');
        }
        continue;
    }
    fs.writeFileSync(file, JSON.stringify({ createdAt: new Date().toISOString(), scenario: 'L10',
        reason: 'Pauses and small aim jitter did not establish the requested deliberate misplaced clicks.',
        selection: 'Replace every L10 trial lacking this protocol, irrespective of detector output; retain raw evidence.',
        decidedBeforeCorrectedCaptures: true, thresholdsChanged: false,
        protocol: { raisePitchPixels: -600, restorePitchPixels: 600, motionSteps: 4, motionStepWaitMs: 35, cooldownWaitMs: 270,
            minimumIntentionalClicks: 3, observerPitchDegrees: [-90,35], allModulesOff: true },
        validation: 'At least three distinct logged air-click intervals contain an observer actor look packet with low pitch; all injected inputs also pass focus and action checks.',
        sourceHashes: hashes }, null, 2) + '\n', { flag: 'wx' });
    console.log(file);
}
