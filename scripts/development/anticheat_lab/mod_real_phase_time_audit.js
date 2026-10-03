'use strict';
// Post-hoc timing/phase labels only. Immutable observer callbacks are unchanged.
const fs = require('fs'), path = require('path'), assert = require('assert');
const { stats } = require('./overnight_analysis_modules');
const output = path.resolve(__dirname, '../../../output/anticheat-lab/mod-real');
const part = process.argv[2]; assert(['autoblock','scaffold'].includes(part));
const base = part === 'scaffold' ? path.join(output, part) : output;
const result = JSON.parse(fs.readFileSync(path.join(output, `overnight/measurement-${part}/FULL_RESULTS.json`)));
const target = part === 'scaffold' ? 'Scaffold' : 'Autoblock';
const rows = result.trials.map(trial => {
    const truth = JSON.parse(fs.readFileSync(path.join(trial.trialDirectory, 'ground-truth.json')));
    const firstToggle = truth.toggles[0]?.t ?? null, lastToggle = truth.toggles.at(-1)?.t ?? null;
    const activeAt = truth.cheatStartAt || truth.controlStartAt;
    const variants = Object.fromEntries(['OLD','NEW'].map(variant => {
        const flags = trial[variant.toLowerCase()].flags;
        const firstFlag = flags.filter(flag => flag.family === target && trial.effectExpected && flag.at >= trial.startedAt)
            .slice().sort((a,b) => a.at-b.at)[0];
        return [variant, {
            allOffCallbacks: flags.filter(flag => !trial.effectExpected || flag.at < firstToggle),
            beforeActiveCallbacks: flags.filter(flag => trial.effectExpected && flag.at >= firstToggle && flag.at < activeAt),
            firstFlagAt: firstFlag?.at ?? null,
            secondsFromFirstEnablingInput: firstFlag ? (firstFlag.at-firstToggle)/1000 : null,
            secondsFromLastEnablingInput: firstFlag ? (firstFlag.at-lastToggle)/1000 : null
        }];
    }));
    return { id: trial.id, scenario: trial.scenario, effectExpected: trial.effectExpected,
        firstToggle, lastToggle, activeAt, primaryTimingOriginAt: trial.startedAt, variants };
});
const variants = Object.fromEntries(['OLD','NEW'].map(variant => [variant, {
    allOffCallbacks: rows.flatMap(row => row.variants[variant].allOffCallbacks.map(flag => ({ id: row.id, flag }))),
    beforeActiveCallbacks: rows.flatMap(row => row.variants[variant].beforeActiveCallbacks.map(flag => ({ id: row.id, flag }))),
    timeFromFirstEnablingInput: stats.distribution(rows.map(row => row.variants[variant].secondsFromFirstEnablingInput).filter(Number.isFinite)),
    timeFromLastEnablingInput: stats.distribution(rows.map(row => row.variants[variant].secondsFromLastEnablingInput).filter(Number.isFinite))
}]));
const audit = { generatedAt: new Date().toISOString(), part, primaryOrigin:
    part === 'scaffold' ? 'First logged cheat-assisted accepted placement' : 'Logged active-input start after HUD confirmation',
    enablingInputIsNotExactInternalModuleEventTime: true, variants, rows };
fs.writeFileSync(path.join(base, 'PHASE_AND_TOGGLE_TIME_AUDIT.json'), JSON.stringify(audit, null, 2) + '\n');
const text = ['', '## Module phase and timing origins', '',
    `Primary time-to-flag origin: ${audit.primaryOrigin}. The module-enabling inputs are earlier; exact internal Forge enable-event time is not logged. Both input times and HUD confirmation are retained.`, '',
    '| Version | Actor callbacks while all modules off | Callbacks after enabling but before active play | Time from first enabling input | Time from last enabling input |',
    '| --- | ---: | ---: | --- | --- |',
    ...Object.entries(variants).map(([variant, value]) => `| ${variant} | ${value.allOffCallbacks.length} | ${value.beforeActiveCallbacks.length} | ${stats.timeText(value.timeFromFirstEnablingInput)} | ${stats.timeText(value.timeFromLastEnablingInput)} |`), '',
    'Toggle-relative time uses the same detected cheat trials as the primary time table. These are alternate descriptive origins, not extra trials or a new accuracy estimate. Raw callbacks before enabling / active play are listed in [PHASE_AND_TOGGLE_TIME_AUDIT.json](PHASE_AND_TOGGLE_TIME_AUDIT.json).', ''];
const file = path.join(base, 'REPORT.md');
fs.writeFileSync(file, fs.readFileSync(file, 'utf8').split('\n## Module phase and timing origins')[0] + text.join('\n'));
console.log(JSON.stringify({ part, variants }));
