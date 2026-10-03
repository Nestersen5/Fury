'use strict';
// Rule letters are read from the pinned detector header/reason strings. This is
// reporting only: callbacks/weights are kept exactly as emitted by the detector.
const fs = require('fs'), path = require('path'), assert = require('assert');
const { stats } = require('./overnight_analysis_modules');
const base = path.resolve(__dirname, '../../../output/anticheat-lab/mod-real/scaffold');
const result = JSON.parse(fs.readFileSync(path.join(base,'FULL_RESULTS.json')));
function rule(reason) {
    const mappings = [['A','silent placement'],['B','bridging looking ahead'],['C','blocks/2s'],
        ['D','randomized double-shift rhythm'],['E','double-shift corrections'],
        ['F','irregular straight cadence'],['G','placing '],['H','sneak lands with the click']];
    const match = mappings.find(([, text]) => reason.includes(text));
    assert(match, 'Unmapped Scaffold rule: ' + reason); return match[0];
}
const rows = result.trials.map(trial => {
    const flags = trial.new.flags.filter(f => f.family === 'Scaffold' && (!trial.effectExpected || f.at >= trial.startedAt));
    const first = flags.slice().sort((a,b)=>a.at-b.at)[0];
    return { id: trial.id, scenario: trial.scenario, effectExpected: trial.effectExpected,
        firstFlag: first ? { at: first.at, tier: first.tier, totalWeight: first.weight,
            rules: [...new Set(first.strikes.flatMap(s => s.parts.map(p => rule(p.reason))))],
            parts: first.strikes.flatMap(s => s.parts.map(p => ({ rule: rule(p.reason), strikeAt: s.t, ...p }))),
            acceptedBlocks: trial.acceptedPlacementTimes.filter(t => t <= first.at).length } : null,
        rulesAcrossFlags: [...new Set(flags.flatMap(f => f.strikes.flatMap(s => s.parts.map(p => rule(p.reason)))))],
        callbackCount: flags.length, peakWeight: trial.new.peakScaffold?.weight || 0 };
});
const scenarios = Object.fromEntries([...new Set(rows.map(r => r.scenario))].map(id => {
    const own = rows.filter(r => r.scenario === id), flagged = own.filter(r => r.firstFlag);
    return [id, { n: own.length, flagged: flagged.length,
        rulesOnFirstFlagTrials: Object.fromEntries('ABCDEFGH'.split('').map(letter => [letter,
            flagged.filter(r => r.firstFlag.rules.includes(letter)).length])),
        firstTiers: { possible: flagged.filter(r => r.firstFlag.tier === 'possible').length,
            confirmed: flagged.filter(r => r.firstFlag.tier === 'confirmed').length } }];
}));
const modes = Object.fromEntries([['Legit',['S1','S2']],['GodBridge',['S3','S4']],['TellyBridge',['S5']]].map(([mode, ids]) => {
    const trials = result.trials.filter(r => ids.includes(r.scenario));
    return [mode, stats.variantStats(trials, result.trials.map(r => r.new), 'Scaffold')];
}));
const report = { generatedAt: new Date().toISOString(), source: 'Pinned NEW Scaffold callbacks; identical Scaffold source in OLD',
    modes, scenarios, trials: rows };
fs.writeFileSync(path.join(base,'RULE_AND_MODE_RESULTS.json'), JSON.stringify(report,null,2)+'\n');
const text = ['', '## Aggregated modes and exact rules at flags', '',
    '| Mode | Any-tier detection | Confirmed | Time to first flag | Accepted blocks before flag |',
    '| --- | --- | --- | --- | --- |'];
for (const [mode,s] of Object.entries(modes)) text.push(`| ${mode} | ${stats.rateText(s.targetAny)} | ${stats.rateText(s.targetConfirmed)} | ${stats.timeText(s.timeToFlagSeconds)} | ${stats.timeText(s.blocksBeforeFlag,' blocks')} |`);
text.push('', '| Scenario | Flagged trials | Rules A/B/C/D/E/F/G/H at first flag | First tier possible / confirmed |',
    '| --- | ---: | --- | --- |');
for (const [id,s] of Object.entries(scenarios)) text.push(`| ${id} | ${s.flagged}/${s.n} | ${Object.values(s.rulesOnFirstFlagTrials).join(' / ')} | ${s.firstTiers.possible} / ${s.firstTiers.confirmed} |`);
text.push('', 'Rule key: A silent placement; B forward pitch; C placement rate; D randomized sneak rhythm; E double-shift corrections; F irregular straight cadence; G far placement; H sneak at the click.', '',
    'Rule counts count trials containing that rule at the first callback, so one trial can appear under several rules. The earlier tier table describes eventual tier; this table describes the first flag. Total weight, every contributing part and block count are retained per trial in [RULE_AND_MODE_RESULTS.json](RULE_AND_MODE_RESULTS.json).', '',
    'Blocks before flag include the flag-triggering accepted placement. The first-cheat-placement origin is independently checked against placements after the module toggle in [LAUNCH_QUALITY_AUDIT.json](LAUNCH_QUALITY_AUDIT.json).', '',
    'The earlier Mineflayer 0/50 held-out results per Legit/GodBridge mechanism used a different actor and workload. This Forge port has its own input handling, randomization and packet order; these measurements keep the same detector. A difference does not establish Vape equivalence or Hypixel performance.', '',
    'Protocol limits: GodBridge turns are changes between straight and diagonal movement using strafe input, not sweeping camera turns. Telly also has Space held by the script. Careful bridging includes explicit air clicks confirmed by observer pitch. Full details are retained in the frozen plan, input logs and protocol addenda.', '');
const file = path.join(base,'REPORT.md');
fs.writeFileSync(file, fs.readFileSync(file,'utf8').split('\n## Aggregated modes and exact rules at flags')[0] + text.join('\n'));
console.log(JSON.stringify({ modes: Object.fromEntries(Object.entries(modes).map(([name,s])=>[name,s.targetAny])),
    flagged: rows.filter(r=>r.firstFlag).length, rules: scenarios }));
