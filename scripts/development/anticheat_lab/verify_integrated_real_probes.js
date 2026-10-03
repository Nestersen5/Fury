'use strict';
// Independent observer-evidence validation and all-four-detector replay audit.
const fs = require('fs'), path = require('path'), assert = require('assert'), crypto = require('crypto');
const { resolveTarget } = require('../../../src/recorder/recordingAnalysis');
const h = require('./integrated_real_helpers');
const base = path.join(h.root, 'output/anticheat-lab/mod-real/integration');
const read = file => JSON.parse(fs.readFileSync(file));
const rows = file => fs.readFileSync(file, 'utf8').trim().split(/\r?\n/).filter(Boolean).map(JSON.parse);
const sha = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
function stable(value) {
    if (Array.isArray(value)) return value.map(stable);
    if (!value || typeof value !== 'object') return value;
    return Object.fromEntries(Object.keys(value).sort().map(k => [k, stable(value[k])]));
}
const normalized = flags => flags.map(flag => JSON.stringify(stable(flag))).sort();
function replay(records) {
    const directory = path.join(h.root, 'src/detect'), flags = [];
    const cb = family => flag => flags.push({ family, ...flag });
    const scaffold = require(path.join(directory, 'scaffoldDetector')).createScaffoldDetector({ onFlag: cb('Scaffold'), requireCleanPlayback: () => false });
    const autoblock = require(path.join(directory, 'autoblockDetector')).createAutoblockDetector({ onFlag: cb('Autoblock') });
    const stasis = require(path.join(directory, 'stasisDetector')).createStasisDetector({ onFlag: cb('Stasis') });
    const jump = require(path.join(directory, 'jumpResetDetector')).createJumpResetDetector({ onFlag: cb('JumpReset'), nameOf: id => scaffold.nameOf(id) });
    for (const record of records) for (const detector of [scaffold, autoblock, stasis, jump]) detector.observeRecord(record);
    return flags;
}
h.checkHashes();
const results = [];
for (const group of ['checks', 'jump-reset']) {
    const folder = path.join(base, group);
    const reviews = read(path.join(folder, group === 'jump-reset' ? 'PILOT_HUD_REVIEW.json' : 'FULL_HUD_REVIEW.json'));
    const runs = fs.readdirSync(folder).filter(n => /^(full|pilot)-\d+$/.test(n));
    for (const runName of runs) {
        const run = path.join(folder, runName), trace = rows(path.join(run, 'fury-profile/lab-detector-trace.jsonl'));
        const ticks = rows(path.join(run, 'server-ticks.jsonl')), transport = rows(path.join(run, 'transport.jsonl'));
        for (const id of fs.readdirSync(run).filter(n => /^[a-z]\d+_\d+$/.test(n))) {
            for (const attempt of fs.readdirSync(path.join(run, id)).filter(n => /^attempt-\d+$/.test(n))) {
                const directory = path.join(run, id, attempt), file = path.join(directory, 'ground-truth.json');
                if (!fs.existsSync(file)) continue;
                const truth = read(file), launch = read(path.join(directory, 'client-launch.json'));
                const input = rows(path.join(directory, 'input.jsonl')), packets = rows(path.join(run, truth.observerPacketFile));
                const records = rows(path.join(run, truth.recorderFile)), target = resolveTarget(records, { player: 'LabActor' });
                const actor = packets.filter(r => Number(r.data?.entityId) === Number(truth.actorId) &&
                    r.t >= truth.controlStartAt && r.t <= truth.activeEndAt);
                const enabled = truth.requestedEnabled || [], key = [runName, id, attempt].join('/');
                const checks = {
                    completed: truth.automatedValid && !truth.invalidReasons.length,
                    local: launch.target.host === '127.0.0.1' && launch.target.port > 0,
                    isolated: path.resolve(launch.cwd).startsWith(path.join(h.root, 'output/anticheat-lab/mod-real/client-game') + path.sep),
                    identity: target.ids.has(Number(truth.actorId)),
                    inputFocus: input.length > 10 && input.every(r => r.ok),
                    hud: reviews[key]?.status === 'confirmed' && ['hud_all_off.png', ...enabled.map(n => `hud_after_${n.toLowerCase()}.png`)].every(n => fs.existsSync(path.join(directory, n))),
                    movements: actor.some(r => ['entity_teleport', 'rel_entity_move', 'entity_move_look'].includes(r.name)),
                    swings: actor.some(r => r.name === 'animation' && r.data.animation === 0),
                    ticks: ticks.some(r => r.t >= truth.controlStartAt && r.t <= truth.activeEndAt),
                    actorRelay: transport.some(r => r.owner === 'actor' && r.type === 'delivery'),
                    observerRelay: transport.some(r => r.owner === 'observer' && r.type === 'delivery'),
                    specificEvidence: group === 'jump-reset' ? actor.filter(r => r.name === 'entity_status' && r.data.entityStatus === 2).length >= 12
                        : truth.scenario.part === 'scaffold' ? truth.observerEvidence.acceptedPlacements >= 12
                        : actor.some(r => r.name === 'entity_metadata' && r.data.metadata?.some(e => e.key === 0 && (e.value & 16)))
                };
                const offline = replay(records).filter(f => Number(f.entityId) === Number(truth.actorId));
                const live = trace.filter(r => r.kind === 'flag' && Number(r.flag.entityId) === Number(truth.actorId) &&
                    r.observedAt >= records[0].t && r.observedAt <= records.at(-1).t).map(r => ({ family: r.family, ...r.flag }));
                results.push({ id, group, directory, checks, valid: Object.values(checks).every(Boolean),
                    exact: JSON.stringify(normalized(live)) === JSON.stringify(normalized(offline)), live, offline,
                    recordingSha256: sha(path.join(run, truth.recorderFile)), truthSha256: sha(file) });
            }
        }
    }
}
const result = { generatedAt: new Date().toISOString(), technicalProbesOnly: true, checked: results.length,
    independentlyValid: results.filter(r => r.valid).length, exactLiveReplay: results.filter(r => r.exact).length, results };
fs.writeFileSync(path.join(base, 'PROBE_VALIDATION.json'), JSON.stringify(result, null, 2) + '\n');
console.log(JSON.stringify({ checked: result.checked, valid: result.independentlyValid, exact: result.exactLiveReplay }));
assert.strictEqual(result.checked, 12, 'All 12 owning-path probes required');
assert(results.every(r => r.valid && r.exact), 'Inspect preserved integration divergences');
