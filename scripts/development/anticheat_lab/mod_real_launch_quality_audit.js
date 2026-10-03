'use strict';
// Supplemental independent audit. No verdict, input rewriting or raw-file edits.
const fs = require('fs'), path = require('path'), crypto = require('crypto'), assert = require('assert');
const root = path.resolve(__dirname, '../../..'), output = path.join(root, 'output/anticheat-lab/mod-real');
const args = process.argv.slice(2), part = args[0]; assert(['autoblock','scaffold'].includes(part));
const parent = path.resolve(args.find(a => a.startsWith('--base='))?.slice(7) || output);
const base = part === 'scaffold' ? path.join(parent, part) : parent;
const read = file => JSON.parse(fs.readFileSync(file));
const lines = file => fs.readFileSync(file,'utf8').trim().split(/\r?\n/).filter(Boolean).map(JSON.parse);
const sha = value => crypto.createHash('sha256').update(value).digest('hex');
const plan = read(path.join(base, `FULL_PLAN_${part}.json`)), evidence = read(path.join(base,'FULL_EVIDENCE.json'));
const rows = evidence.rows.map(entry => {
    const truth = read(path.join(entry.trialDirectory, 'ground-truth.json')),
        launch = read(path.join(entry.trialDirectory, 'client-launch.json')),
        input = lines(path.join(entry.trialDirectory, 'input.jsonl')),
        packets = lines(path.join(entry.directory, truth.observerPacketFile));
    const spec = plan.trials.find(s => s.id === entry.id), args = launch.arguments;
    const arg = name => args[args.indexOf(name) + 1];
    const toggleAt = truth.toggles.at(-1)?.t;
    const modulePlacements = part === 'scaffold' && spec.effectExpected ? packets.filter(p =>
        p.t >= toggleAt && p.t <= truth.activeEndAt && p.name === 'block_change' && p.data.type === 16 && p.data.location.y === 79) : [];
    const checks = {
        isolatedGameDirectory: path.resolve(arg('--gameDir')).startsWith(path.join(output, 'client-game')),
        target: arg('--server') === '127.0.0.1' && Number(arg('--port')) === launch.target.port && arg('--username') === 'LabActor',
        noSelftest: !args.some(s => s.includes('vapetest.selftest')),
        fullSettings: JSON.stringify(launch.settings.config) === JSON.stringify(truth.fullModuleSettings) &&
            Object.entries(spec.settings || {}).every(([name, settings]) => Object.entries(settings).every(([k,v]) =>
                JSON.stringify(truth.fullModuleSettings[name]?.settings[k]) === JSON.stringify(v))),
        writtenConfigHash: launch.settings.configSha256 === sha(JSON.stringify(launch.settings.config, null, 2) + '\n'),
        noGuiKeys: !input.some(row => row.command === 'key' && row.down && [0xa1,0x7b,0x24].includes(row.vk)),
        togglesHaveInputs: truth.toggles.every(toggle => input.some(row => row.command === 'key' && row.down && row.t === toggle.t && row.vk === toggle.keyVk)),
        firstCheatPlacementLogged: part !== 'scaffold' || !spec.effectExpected || modulePlacements[0]?.t === truth.firstCheatAssistedPlacementAt
    };
    return { id: entry.id, checks, passed: Object.values(checks).every(Boolean),
        preActiveModulePlacements: modulePlacements.filter(p => p.t < truth.cheatStartAt).length,
        firstModulePlacementAt: modulePlacements[0]?.t ?? null,
        loggedFirstCheatPlacementAt: truth.firstCheatAssistedPlacementAt };
});
const result = { generatedAt: new Date().toISOString(), part, audited: rows.length,
    passed: rows.filter(r => r.passed).length, failures: rows.filter(r => !r.passed), rows };
fs.writeFileSync(path.join(base,'LAUNCH_QUALITY_AUDIT.json'), JSON.stringify(result,null,2) + '\n');
console.log(JSON.stringify({ part, audited: result.audited, passed: result.passed, failures: result.failures }));
