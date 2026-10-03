'use strict';
// Prepare a reviewable owning-path patch outside production. Applying it is a
// separate step after every pinned capture and the held-out promotion checks.
const fs = require('fs'), path = require('path'), crypto = require('crypto'), assert = require('assert');
const { execFileSync } = require('child_process');
const root = path.resolve(__dirname, '../../..'), base = path.join(root, 'output/anticheat-lab/mod-real');
const baseline = path.join(base, 'overnight/baseline-source');
const prepared = path.join(base, 'improvements/prepared-production');
const hash = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const read = file => JSON.parse(fs.readFileSync(file));
const frozenJump = read(path.join(base, 'jump-reset/FROZEN_CANDIDATE.json'));
const frozenDecision = read(path.join(base, 'improvements/fresh/FROZEN_DECISION.json'));
const gateFile = path.join(base, 'improvements/PRODUCTION_GATE.json');
const gate = fs.existsSync(gateFile) ? read(gateFile) : null;
const accepted = gate?.accepted || frozenDecision.accepted;
if (gate) assert(gate.accepted.jumpResetExperimental, 'Jump Reset did not earn the opt-in production gate; retain the measured prototype and prepare any accepted movement change separately');
assert(!accepted.movementClock || frozenDecision.accepted.movementClock, 'Cannot promote an unselected movement candidate');
assert(!accepted.scaffoldCorroboration || frozenDecision.accepted.scaffoldCorroboration, 'Cannot promote an unselected Scaffold candidate');
for (const [name, expected] of Object.entries(frozenJump.sourceHashes)) assert.strictEqual(hash(path.join(__dirname, name)), expected);
for (const [name, expected] of Object.entries(frozenDecision.sourceHashes)) assert.strictEqual(hash(path.join(frozenDecision.candidateDirectory, name)), expected);
fs.mkdirSync(baseline, { recursive: true });
const htmlBaseline = path.join(baseline, 'launcher.html');
if (!fs.existsSync(htmlBaseline)) fs.copyFileSync(path.join(root, 'launcher.html'), htmlBaseline, fs.constants.COPYFILE_EXCL);
const mainBaseline = path.join(baseline, 'launcher.js');
if (!fs.existsSync(mainBaseline)) fs.copyFileSync(path.join(root, 'launcher.js'), mainBaseline, fs.constants.COPYFILE_EXCL);
const files = new Map();
function edit(relative, transform) {
    const original = fs.readFileSync(path.join(baseline, relative), 'utf8');
    let text = original;
    const once = (before, after, expectedCount = 1) => {
        assert.strictEqual(text.split(before).length - 1, expectedCount, `${relative}: anchor ${before.slice(0, 90)}`);
        text = text.split(before).join(after);
    };
    transform(once); files.set(relative, text);
}
edit('app_config.js', once => {
    once('        anticheatStasisEnabled: true,', '        anticheatStasisEnabled: true,\n        anticheatJumpResetEnabled: false,');
    const anchor = '        anticheatStasisEnabled: next.anticheatStasisEnabled !== undefined ? Boolean(next.anticheatStasisEnabled) : defaults.features.anticheatStasisEnabled,';
    once(anchor, anchor + '\n        anticheatJumpResetEnabled: next.anticheatJumpResetEnabled !== undefined ? Boolean(next.anticheatJumpResetEnabled) : defaults.features.anticheatJumpResetEnabled,');
});
edit('src/bootstrap/config.js', once => {
    const anchor = "            anticheatStasisEnabled: bool('anticheatStasisEnabled', true),";
    once(anchor, anchor + "\n            anticheatJumpResetEnabled: bool('anticheatJumpResetEnabled', false),");
});
edit('launcher.js', once => {
    const label = "        ['Stasis', 'anticheatStasisEnabled'],";
    once(label, label + "\n        ['Jump Reset', 'anticheatJumpResetEnabled'],");
    const setting = '        anticheatStasisEnabled: settings?.features?.anticheatStasisEnabled ?? before.features?.anticheatStasisEnabled,';
    once(setting, setting + '\n        anticheatJumpResetEnabled: settings?.features?.anticheatJumpResetEnabled ?? before.features?.anticheatJumpResetEnabled,');
});
edit('launcher.html', once => {
    const row = '                        <div class="feature-card"><div><h3>Stasis</h3></div><div class="feature-toggle"><label class="switch"><input id="anticheat-stasis-enabled" type="checkbox" aria-label="Stasis detection"><span class="switch-track"></span><span class="switch-thumb"></span><span class="switch-label">ON</span></label></div></div>';
    once(row, row + '\n                        <div class="feature-card"><div><h3>Jump Reset <span class="anticheat-recommendation">(Experimental)</span></h3><small>Possible alerts only. Manual jumps can look the same.</small></div><div class="feature-toggle"><label class="switch"><input id="anticheat-jump-reset-enabled" type="checkbox" aria-label="Jump Reset detection"><span class="switch-track"></span><span class="switch-thumb"></span><span class="switch-label">OFF</span></label></div></div>');
    const entries = [
        ["            anticheatStasisEnabled: document.getElementById('anticheat-stasis-enabled'),", "            anticheatJumpResetEnabled: document.getElementById('anticheat-jump-reset-enabled'),", 1],
        ["            'anticheatStasisEnabled',", "            'anticheatJumpResetEnabled',", 1],
        ['                    anticheatStasisEnabled: ids.anticheatStasisEnabled.checked,', '                    anticheatJumpResetEnabled: ids.anticheatJumpResetEnabled.checked,', 2],
        ['            ids.anticheatStasisEnabled,', '            ids.anticheatJumpResetEnabled,', 1],
        ["            ids.anticheatStasisEnabled.checked = featureOn('anticheatStasisEnabled');", "            ids.anticheatJumpResetEnabled.checked = featureOn('anticheatJumpResetEnabled', false);", 1]
    ];
    for (const [anchor, next, count] of entries) once(anchor, anchor + '\n' + next, count);
    once("aliases: 'scaffold autoblock stasis blink flags teammates'", "aliases: 'scaffold autoblock stasis blink jump reset flags teammates'");
});
edit('proxy.js', once => {
    once('let anticheatStasisEnabled = true;', 'let anticheatStasisEnabled = true;\nlet anticheatJumpResetEnabled = false;');
    once('    anticheatStasisEnabled = features.anticheatStasisEnabled !== false;', '    anticheatStasisEnabled = features.anticheatStasisEnabled !== false;\n    anticheatJumpResetEnabled = features.anticheatJumpResetEnabled === true;');
    once('        anticheatStasisEnabled,', '        anticheatStasisEnabled,\n        anticheatJumpResetEnabled,');
    const recorder = "        const { createPacketRecorder } = require('./src/recorder/packetRecorder.js');\n        const packetRecorder = createPacketRecorder({";
    once(recorder, "        const { createObserverPacketClock } = require('./src/detect/observerPacketClock.js');\n        const observerPacketClock = createObserverPacketClock();\n" + recorder + '\n            now: observerPacketClock.now,');
    const factory = "        const { createStasisDetector } = require('./src/detect/stasisDetector.js');";
    once(factory, factory + "\n        const { createJumpResetDetector } = require('./src/detect/jumpResetDetector.js');\n        const { createDetectorPositionContext } = require('./src/detect/detectorPositionContext.js');");
    once('        const scaffoldDetector = createScaffoldDetector({', '        const scaffoldDetector = createScaffoldDetector({\n            now: observerPacketClock.now,');
    const clear = '        function clearAnticheatDetectors() {\n            scaffoldDetector.clear();\n            autoblockDetector.clear();\n            stasisDetector.clear();\n        }';
    once(clear, `        // Experimental and live only: manual jumps can match this motion.
        const jumpResetDetector = createJumpResetDetector({
            nameOf: entityId => scaffoldDetector.nameOf(entityId),
            isEnabled: () => anticheatEnabled && anticheatJumpResetEnabled && isAnticheatInGame() && !inReplayViewer,
            now: observerPacketClock.now,
            log: line => console.log(line),
            onFlag: announceAnticheatFlag
        });
        const positionContext = detector => createDetectorPositionContext({
            detector, forEachEntity: visit => entityTracker.forEachEntity(visit), now: observerPacketClock.now
        });
        const scaffoldPositionContext = positionContext(scaffoldDetector);
        const autoblockPositionContext = positionContext(autoblockDetector);
        const stasisPositionContext = positionContext(stasisDetector);
        const jumpResetPositionContext = positionContext(jumpResetDetector);
        function clearAnticheatDetectors() {
            scaffoldDetector.clear();
            autoblockDetector.clear();
            stasisDetector.clear();
            jumpResetDetector.clear();
        }`);
    const start = '            // /recordcheat tap: runs after the packet is already forwarded, so';
    const ending = '\n\n            const entityObservation = observePlayerEntityPacket(data, meta);';
    const original = fs.readFileSync(path.join(baseline, 'proxy.js'), 'utf8');
    const a = original.indexOf(start), b = original.indexOf(ending, a);
    assert(a > 0 && b > a);
    once(original.slice(a, b), `            // Recorder and detectors share one timestamp for this already
            // forwarded packet. Tracker positions are seeded once on activation.
            observerPacketClock.begin();
            try {
                const active = anticheatEnabled && (isAnticheatInGame() || inReplayViewer);
                scaffoldPositionContext.sync(active && anticheatScaffoldEnabled);
                autoblockPositionContext.sync(active && anticheatAutoblockEnabled);
                stasisPositionContext.sync(active && anticheatStasisEnabled && !inReplayViewer);
                jumpResetPositionContext.sync(active && anticheatJumpResetEnabled && !inReplayViewer);
                packetRecorder.observe(data, meta);
                // Keep Scaffold's existing name bookkeeping while disabled.
                scaffoldDetector.observePacket(data, meta);
                if (active && (anticheatAutoblockEnabled || anticheatStasisEnabled || anticheatJumpResetEnabled)) {
                    const anticheatRecord = packetToRecord(meta.name, data, observerPacketClock.now());
                    if (anticheatRecord) {
                        if (anticheatAutoblockEnabled) autoblockDetector.observeRecord(anticheatRecord);
                        if (anticheatStasisEnabled) stasisDetector.observeRecord(anticheatRecord);
                        if (anticheatJumpResetEnabled) jumpResetDetector.observeRecord(anticheatRecord);
                    }
                }
            } finally {
                observerPacketClock.end();
            }`);
    once('Anticheat (Scaffold, Autoblock, Stasis):', 'Anticheat (Scaffold, Autoblock, Stasis, Jump Reset):');
    once('const otherRows = [...autoblockDetector.getStatus(), ...stasisDetector.getStatus()];', 'const otherRows = [...autoblockDetector.getStatus(), ...stasisDetector.getStatus(), ...jumpResetDetector.getStatus()];');
});
for (const name of ['autoblockDetector.js','scaffoldDetector.js','detectorShared.js','stasisDetector.js']) {
    const selected = (name === 'autoblockDetector.js' && !accepted.movementClock) ||
        (name === 'scaffoldDetector.js' && !accepted.scaffoldCorroboration)
        ? path.join(baseline, 'src/detect') : frozenDecision.candidateDirectory;
    files.set('src/detect/' + name, fs.readFileSync(path.join(selected, name), 'utf8'));
}
let jump = fs.readFileSync(path.join(__dirname, 'jump_reset_candidate.js'), 'utf8');
jump = jump.replace("require('./jump_reset_observer_features')", "require('./jumpResetFeatures')");
const defaultsStart = jump.indexOf('const DEFAULTS = {'), defaultsEnd = jump.indexOf('\n};', defaultsStart);
assert(defaultsStart > 0 && defaultsEnd > defaultsStart);
jump = jump.slice(0, defaultsStart) + 'const DEFAULTS = ' + JSON.stringify(frozenJump.thresholds, null, 4) + ';' + jump.slice(defaultsEnd + 3);
files.set('src/detect/jumpResetDetector.js', jump);
files.set('src/detect/jumpResetFeatures.js', fs.readFileSync(path.join(__dirname, 'jump_reset_observer_features.js'), 'utf8').replace('Analysis-only trajectory extraction.', 'Observer trajectory extraction.'));
files.set('src/detect/detectorPositionContext.js', fs.readFileSync(path.join(__dirname, 'detector_position_context_candidate.js'), 'utf8').replace('Candidate owning-path support:', 'Observer position context:'));
files.set('src/detect/observerPacketClock.js', fs.readFileSync(path.join(__dirname, 'observer_packet_clock_candidate.js'), 'utf8').replace('Owning-path candidate:', 'Observer packet clock:'));
const manifest = { preparedAt: new Date().toISOString(), applied: false, accepted,
    heldOutPromotionGateRead: Boolean(gate),
    experimentalJumpReset: { defaultEnabled: false, tier: 'possible', thresholds: frozenJump.thresholds }, files: {} };
for (const [relative, text] of files) {
    const target = path.join(prepared, relative); fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, text);
    manifest.files[relative] = { beforeSha256: fs.existsSync(path.join(baseline, relative)) ? hash(path.join(baseline, relative)) : null,
        afterSha256: hash(target) };
    if (relative.endsWith('.js')) execFileSync(process.execPath, ['--check', target]);
}
fs.writeFileSync(path.join(prepared, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
console.log(JSON.stringify({ prepared, files: files.size, productionFilesChanged: false }));
