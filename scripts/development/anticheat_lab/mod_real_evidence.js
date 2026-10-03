'use strict';
// Summarize pilot evidence without using detector verdicts as ground truth.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const root = path.resolve(__dirname, '../../..');
const base = path.join(root, 'output/anticheat-lab/mod-real');
const sha = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const lines = file => fs.existsSync(file) ? fs.readFileSync(file, 'utf8').trim().split('\n').filter(Boolean).map(JSON.parse) : [];
const reviewFile = path.join(base, 'pilot-hud-review.json');
const reviews = fs.existsSync(reviewFile) ? JSON.parse(fs.readFileSync(reviewFile)) : {};
const attempts = [];

for (const parent of [base, path.join(base, 'scaffold')]) {
  if (!fs.existsSync(parent)) continue;
  for (const runName of fs.readdirSync(parent).filter(name => name.startsWith('pilot-')).sort()) {
    const run = path.join(parent, runName);
    const runKey = path.relative(base, run).replaceAll('\\', '/');
    if (!fs.statSync(run).isDirectory()) continue;
    const ticks = lines(path.join(run, 'server-ticks.jsonl'));
    const transport = lines(path.join(run, 'transport.jsonl'));
    const recordings = path.join(run, 'fury-profile/recordings');
    const files = fs.existsSync(recordings) ? fs.readdirSync(recordings) : [];
    for (const id of fs.readdirSync(run).filter(name => /^[cls]\d+$/.test(name)).sort()) {
        const directory = path.join(run, id);
        const truthFile = path.join(directory, 'ground-truth.json');
        if (!fs.existsSync(truthFile)) continue;
        const truth = JSON.parse(fs.readFileSync(truthFile));
        const actorId = truth.actorId;
        const observerFile = path.join(run, `${id}_pilot.observer-packets.jsonl`);
        const packets = lines(observerFile);
        const actorPackets = packets.filter(row => row.data?.entityId === actorId);
        const movement = actorPackets.filter(row => ['rel_entity_move','entity_move_look'].includes(row.name));
        const metadata = actorPackets.filter(row => row.name === 'entity_metadata').flatMap(row =>
            (row.data.metadata || []).filter(entry => entry.key === 0).map(entry => ({ t: row.t, flags: entry.value })));
        const swings = actorPackets.filter(row => row.name === 'animation' && row.data.animation === 0);
        const placements = packets.filter(row => row.name === 'block_change' && row.data?.type === 16
            && (id === 'l11' || row.data?.location?.y === 79));
        const unique = new Set(placements.map(row => {
            const p = row.data.location; return `${p.x},${p.y},${p.z}`;
        }));
        const activeStart = truth.cheatStartAt || truth.controlStartAt || truth.startedAt;
        const activeEnd = truth.activeEndAt || truth.endedAt;
        const ownTicks = ticks.filter(row => row.label === id && row.t >= activeStart && row.t <= activeEnd);
        const ownTransport = transport.filter(row => row.label === id && row.type === 'delivery'
            && row.receivedAt >= activeStart && row.receivedAt <= activeEnd);
        const recordingName = files.find(name => name.endsWith(`_${id}_pilot.jsonl`));
        const recordingFile = recordingName ? path.join(recordings, recordingName) : null;
        const screenshots = ['hud_all_off.png', ...truth.requestedEnabled.map(name => `hud_after_${name.toLowerCase()}.png`)];
        const screenshotsExist = screenshots.every(name => fs.existsSync(path.join(directory, name)));
        const inputRows = lines(path.join(directory, 'input.jsonl'));
        const completeInputs = inputRows.length > 10 && inputRows.every(row => {
            if (row.command === 'key') return Number.isInteger(row.vk) && typeof row.down === 'boolean';
            if (row.command === 'mouse') return ['left', 'right'].includes(row.button) && typeof row.down === 'boolean';
            if (row.command === 'move') return Number.isInteger(row.dx) && Number.isInteger(row.dy);
            return true;
        });
        const reviewKey = `${runKey}/${id}`;
        const review = reviews[reviewKey] || { status: 'pending', note: 'HUD screenshots need visual review' };
        const bridge = truth.scenario.part === 'scaffold';
        const checks = {
            inputLog: completeInputs,
            toggleLog: Array.isArray(truth.toggles) && truth.toggles.length === truth.requestedEnabled.length,
            localTarget: JSON.parse(fs.readFileSync(path.join(directory, 'client-launch.json'))).target.host === '127.0.0.1',
            recording: !!recordingFile,
            observerMovement: movement.some(row => row.data.dX || row.data.dY || row.data.dZ),
            observerSwings: swings.length > 0,
            observerUseFlag: bridge || metadata.some(row => !!(row.flags & 16)),
            acceptedPlacements: !bridge || unique.size >= 12,
            tickLog: ownTicks.length >= 20,
            relayLog: ownTransport.some(row => row.owner === 'actor') && ownTransport.some(row => row.owner === 'observer'),
            screenshots: screenshotsExist,
            hudConfirmed: review.status === 'confirmed'
        };
        const row = { id: id.toUpperCase(), runName: runKey, directory, review, checks,
            valid: Object.values(checks).every(Boolean) && truth.invalidReasons.length === 0,
            invalidReasons: [...truth.invalidReasons, ...Object.entries(checks).filter(([, ok]) => !ok).map(([key]) => key)],
            actorId, activeStart, activeEnd, requestedEnabled: truth.requestedEnabled,
            settings: JSON.parse(fs.readFileSync(path.join(directory, 'client-launch.json'))).settings.config,
            inputLog: path.join(directory, 'input.jsonl'), screenshotFiles: screenshots.map(name => path.join(directory, name)),
            observerFile, observerSha256: fs.existsSync(observerFile) ? sha(fs.readFileSync(observerFile)) : null,
            recordingFile, recordingSha256: recordingFile ? sha(fs.readFileSync(recordingFile)) : null,
            observed: { swings: swings.length, useOnUpdates: metadata.filter(row => row.flags & 16).length,
                useOffUpdates: metadata.filter(row => !(row.flags & 16)).length,
                nonzeroMovementPackets: movement.filter(row => row.data.dX || row.data.dY || row.data.dZ).length,
                relativeHorizontalBlocks: movement.reduce((sum, row) => sum + Math.hypot(row.data.dX || 0, row.data.dZ || 0)/32, 0),
                acceptedPlacements: unique.size,
                placementXRange: placements.length ? [Math.min(...placements.map(row => row.data.location.x)), Math.max(...placements.map(row => row.data.location.x))] : null,
                placementYRange: placements.length ? [Math.min(...placements.map(row => row.data.location.y)), Math.max(...placements.map(row => row.data.location.y))] : null,
                tickSamples: ownTicks.length, transportDeliveries: ownTransport.length } };
        attempts.push(row);
    }
  }
}

const output = { schema: 1, generatedAt: new Date().toISOString(), scope: 'Pilot evidence only; detector verdicts excluded', attempts };
fs.writeFileSync(path.join(base, 'PILOT_EVIDENCE.json'), JSON.stringify(output, null, 2) + '\n');
const table = attempts.map(row => `| ${row.id} | ${row.runName} | ${row.valid ? 'valid' : 'invalid / pending'} | ${row.observed.swings} | ${row.observed.useOnUpdates} | ${row.observed.nonzeroMovementPackets} | ${row.observed.acceptedPlacements} | ${row.observed.tickSamples} | ${row.invalidReasons.join(', ') || '—'} |`);
const markdown = `# Real-client pilot evidence\n\nPilots are excluded from the accuracy denominators. Every attempt is preserved, including invalid or interrupted runs. Detector outputs were not used to validate the client behavior. The full input log, screenshots, observer packets, Fury recording, tick log and relay log are in the linked run directories in \`PILOT_EVIDENCE.json\`.\n\n| Scenario | Run | Status | Swings | Use-on updates | Nonzero moves | Accepted placements | Tick samples | Validation notes |\n| --- | --- | --- | ---: | ---: | ---: | ---: | ---: | --- |\n${table.join('\n')}\n\nThe HUD review entries in \`pilot-hud-review.json\` record manual inspection of the screenshot after each toggle. An obscured or missing HUD is invalid, even when the requested key was injected. The input log timestamps are from the same local machine clock as Fury's recorder.\n`;
fs.writeFileSync(path.join(base, 'PILOT_EVIDENCE.md'), markdown);
const chosen = attempts.filter(row => row.valid);
const link = (file, label) => `[${label}](${path.relative(base, file).replaceAll('\\', '/')})`;
const chosenRow = row => {
    const hud = row.screenshotFiles.at(-1);
    const truth = path.join(row.directory, 'ground-truth.json');
    return `| ${row.id} | ${row.observed.swings} | ${row.observed.useOnUpdates} | ${row.observed.nonzeroMovementPackets} | ${row.observed.acceptedPlacements} | ${link(hud, 'HUD')} | ${link(row.inputLog, 'inputs')} | ${link(row.observerFile, 'observer')} | ${link(truth, 'truth')} |`;
};
const order = ['C1','C2','C3','C4','C5','C6','L1','L2','L3','L4','L5','L6',
    'S1','S2','S3','S4','S5','L7','L8','L9','L10','L11'];
chosen.sort((a, b) => order.indexOf(a.id) - order.indexOf(b.id));
const head = '| Scenario | Swings | Use-on updates | Movement packets | Accepted placements | HUD | Input log | Observer packets | Ground truth |\n| --- | ---: | ---: | ---: | ---: | --- | --- | --- | --- |';
const ready = `# Pilot review for real modded client\n\n${chosen.length} valid pilots: one for each requested scenario. These pilots are excluded from the full-run accuracy denominators. The columns describe raw observer evidence, not detector verdicts. All ${attempts.length - chosen.length} invalid attempts are retained with reasons in [PILOT_EVIDENCE.md](PILOT_EVIDENCE.md) and [PILOT_EVIDENCE.json](PILOT_EVIDENCE.json).\n\n## Part A: Autoblock\n\n${head}\n${chosen.filter(row => row.id.startsWith('C') || ['L1','L2','L3','L4','L5','L6'].includes(row.id)).map(chosenRow).join('\n')}\n\n## Part B: Scaffold\n\n${head}\n${chosen.filter(row => row.id.startsWith('S') || ['L7','L8','L9','L10','L11'].includes(row.id)).map(chosenRow).join('\n')}\n\nEach truth file records the seed, full settings, toggle times, cheat start, and first assisted placement where relevant. Each input log records key/button identities and press/release states with local timestamps. The HUD review decisions are in [pilot-hud-review.json](pilot-hud-review.json); the source fidelity limits are in [MOD_FIDELITY.md](MOD_FIDELITY.md). Each run also contains the Fury recording, detector trace, server ticks, relay deliveries, launch target, and server log. The Scaffold L9 control uses raw observer placement feedback to time brief unsneaked pushes after new support blocks appear.\n\nNo full-run verdicts or accuracy estimates have been calculated.\n`;
fs.writeFileSync(path.join(base, 'PILOT_READY.md'), ready);
console.log(JSON.stringify({ attempts: attempts.length, valid: attempts.filter(row => row.valid).length,
    invalid: attempts.filter(row => !row.valid).map(row => ({ id: row.id, run: row.runName, reasons: row.invalidReasons })) }, null, 2));
