'use strict';
// Technical probes, never added to calibration or held-out accuracy totals.
const fs = require('fs'), path = require('path'), assert = require('assert'), Module = require('module');
const h = require('./integrated_real_helpers');
const { eventually } = require('../../smoke_packaged_app');
const base = path.join(h.root, 'output/anticheat-lab/mod-real');
const read = file => JSON.parse(fs.readFileSync(file));
const kind = process.argv[2];
async function main() {
    h.checkHashes();
    if (kind === 'jump-reset') {
        const file = path.join(__dirname, 'jump_reset_real_campaign.js');
        let source = fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n');
        assert.strictEqual(source.split("require('./mod_real_night_helpers')").length, 2);
        source = source.replace("require('./mod_real_night_helpers')", "require('./integrated_real_helpers')");
        source = source.replace("'output/anticheat-lab/mod-real/jump-reset'", "'output/anticheat-lab/mod-real/integration/jump-reset'");
        source += '\nmodule.exports.main = main;\n';
        const compiled = new Module(file, module);
        compiled.filename = file; compiled.paths = Module._nodeModulePaths(__dirname); compiled._compile(source, file);
        process.argv = [process.execPath, __filename, '--pilot'];
        await compiled.exports.main();
        return;
    }
    assert.strictEqual(kind, 'checks', 'Usage: integrated_real_probes.js checks|jump-reset');
    const plans = ['FULL_PLAN_autoblock.json', 'scaffold/FULL_PLAN_scaffold.json'].map(p => read(path.join(base, p)));
    const trials = ['C2', 'L1', 'S4', 'L9'].map(id => {
        const original = plans.flatMap(p => p.trials).find(s => s.scenarioId === id);
        assert(original); return { ...original, integrationProbe: true };
    });
    const run = path.join(base, 'integration', 'checks', `full-${Date.now()}`);
    fs.mkdirSync(path.dirname(run), { recursive: true });
    const planFile = path.join(path.dirname(run), 'FULL_PLAN_autoblock.json');
    const probePlan = { trials, accuracyTrials: false, purpose: 'Owning-path integration and exact replay' };
    if (fs.existsSync(planFile)) assert.deepStrictEqual(read(planFile), probePlan);
    else fs.writeFileSync(planFile, JSON.stringify(probePlan, null, 2) + '\n', { flag: 'wx' });
    const lab = new h.Lab(run, { traceDetectors: true });
    const results = [];
    try {
        await lab.start();
        await lab.commands(['tp LabOpponent 0.5 64 8.5', ...Array.from({ length: 8 }, (_, n) =>
            'fill 4 ' + (n * 8) + ' -16 63 ' + (n * 8 + 7) + ' 48 air')]);
        const offset = lab.server.outputTotal;
        lab.actor.quit(); lab.actor._client?.socket?.destroy();
        lab.bots = lab.bots.filter(bot => bot !== lab.actor);
        await eventually(() => assert(lab.serverOutputSince(offset).includes('LabActor left the game')), 'Remove setup actor');
        lab.actor = null;
        for (const spec of trials) {
            console.log('Integration probe ' + spec.id);
            const truth = await h.fullTrial(lab, spec, 1, run);
            results.push({ id: spec.id, part: spec.part, valid: truth.automatedValid, invalidReasons: truth.invalidReasons });
            fs.writeFileSync(path.join(run, 'summary.json'), JSON.stringify(results, null, 2) + '\n');
            assert(truth.automatedValid, 'Integration probe has invalid observer evidence: ' + spec.id);
        }
    } finally { await lab.close(); h.checkHashes(); }
    console.log(JSON.stringify({ run, results, excludedFromAccuracy: true }));
}
main().catch(error => { console.error(error); process.exitCode = 1; });
