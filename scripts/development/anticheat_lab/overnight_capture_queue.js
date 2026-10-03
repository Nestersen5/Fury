'use strict';
// Sequential local captures only. Calibration gates require an actual frozen
// artifact from the analysis step; elapsed time never approves a candidate.
const fs = require('fs'), path = require('path'), assert = require('assert');
const { spawn, execFileSync } = require('child_process');
const root = path.resolve(__dirname, '../../..'), base = path.join(root, 'output/anticheat-lab/mod-real');
const after = Number(process.argv.find(a => a.startsWith('--after='))?.split('=')[1]);
assert(Number.isInteger(after) && after > 0);
const owner = JSON.parse(execFileSync('powershell', ['-NoProfile', '-Command',
    `Get-CimInstance Win32_Process -Filter "ProcessId = ${after}" | Select-Object ProcessId,Name,CommandLine | ConvertTo-Json -Compress`], { encoding: 'utf8' }));
assert(owner.ProcessId === after && owner.Name === 'node.exe' && owner.CommandLine.includes('mod_real_scaffold_defaults.js'), 'Queue must wait for the verified current lab runner');
const directory = path.join(base, 'overnight', `queue-${Date.now()}`);
fs.mkdirSync(directory, { recursive: true });
const logFile = path.join(directory, 'capture.log');
const state = { startedAt: new Date().toISOString(), pid: process.pid, after: owner, children: [], stage: 'waiting for Scaffold' };
const save = () => fs.writeFileSync(path.join(directory, 'state.json'), JSON.stringify(state, null, 2));
const stopped = () => fs.existsSync(path.join(base, 'overnight/STOP_AFTER_TRIAL'));
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
function log(message) { fs.appendFileSync(logFile, `${new Date().toISOString()} ${message}\n`); console.log(message); }
function captured(part, split) {
    const folder = part === 'jump-reset' ? path.join(base, part) : part === 'scaffold' ? path.join(base, part) : base;
    const plan = JSON.parse(fs.readFileSync(path.join(folder, part === 'jump-reset' ? 'FULL_PLAN.json' : `FULL_PLAN_${part}.json`)));
    const expected = plan.trials.filter(s => !split || s.split === split), found = new Set();
    for (const runName of fs.readdirSync(folder).filter(n => /^full-\d+$/.test(n))) for (const spec of expected) {
        const trial = path.join(folder, runName, spec.id); if (!fs.existsSync(trial)) continue;
        for (const attempt of fs.readdirSync(trial)) {
            const file = path.join(trial, attempt, 'ground-truth.json');
            if (fs.existsSync(file) && JSON.parse(fs.readFileSync(file)).automatedValid) found.add(spec.id);
        }
    }
    return { planned: expected.length, captured: found.size, missing: expected.filter(s => !found.has(s.id)).map(s => s.id) };
}
async function execute(file, args) {
    assert(!stopped(), 'Checkpoint requested; no further client launch');
    state.stage = `${file} ${args.join(' ')}`; save(); log(`Starting ${state.stage}`);
    const child = spawn(process.execPath, [path.join(__dirname, file), ...args], { cwd: root, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    const entry = { file, args, pid: child.pid, startedAt: Date.now() }; state.children.push(entry); save();
    let buffer = '';
    for (const stream of [child.stdout, child.stderr]) stream.on('data', bytes => {
        fs.appendFileSync(logFile, bytes);
        if (stream !== child.stdout) return;
        buffer += bytes.toString();
        while (buffer.includes('\n')) {
            const end = buffer.indexOf('\n'), line = buffer.slice(0, end).trim(); buffer = buffer.slice(end + 1);
            if (line.endsWith('starting') || line.startsWith('FULL_RUN=') || line.startsWith('JUMP_RESET_RUN=')) console.log(line);
            else if (line.includes('"invalidReasons"')) {
                try {
                    const row = JSON.parse(line.slice(line.indexOf('{')));
                    if (row.id) console.log(JSON.stringify({ id: row.id, captured: row.valid, invalidReasons: row.invalidReasons,
                        placements: row.evidence?.acceptedPlacements, hurts: row.evidence?.hurts }));
                } catch (_) { /* Full original line is retained in capture.log. */ }
            }
        }
    });
    const code = await new Promise((resolve, reject) => { child.once('error', reject); child.once('exit', resolve); });
    entry.endedAt = Date.now(); entry.exitCode = code; save();
    assert.strictEqual(code, 0, `Capture failed: ${file}`);
}
async function ensureJump(split) {
    for (let round = 0; round < 4; round++) {
        const status = captured('jump-reset', split); log(`${split} capture status ${JSON.stringify(status)}`);
        if (!status.missing.length) return;
        await execute('jump_reset_real_campaign.js', [`--split=${split}`]);
    }
    assert(!captured('jump-reset', split).missing.length, `Repeated invalid ${split} Jump Reset captures require investigation`);
}
async function main() {
    save(); log(`Waiting for owned Scaffold runner ${after}`);
    for (;;) {
        if (stopped()) { state.stage = 'stopped at checkpoint'; save(); return; }
        try { process.kill(after, 0); } catch (error) { if (error.code === 'ESRCH') break; throw error; }
        await delay(5000);
    }
    for (let round = 0; captured('scaffold').missing.length && round < 4; round++)
        await execute('mod_real_scaffold_defaults.js', ['scaffold']);
    assert(!captured('scaffold').missing.length, 'Scaffold captures incomplete');
    await ensureJump('calibration');
    state.stage = 'waiting for validated calibration and frozen Jump Reset candidate'; save(); log(state.stage);
    const frozenFile = path.join(base, 'jump-reset/FROZEN_CANDIDATE.json');
    while (!fs.existsSync(frozenFile)) {
        if (stopped()) { state.stage = 'stopped at checkpoint'; save(); return; }
        await delay(5000);
    }
    const frozen = JSON.parse(fs.readFileSync(frozenFile));
    assert(frozen.calibrationIds.length === 160 && frozen.tier === 'possible');
    await ensureJump('evaluation');
    await execute('mod_real_followup.js', ['autoblock', '--split=calibration']);
    await execute('mod_real_followup.js', ['scaffold', '--split=calibration']);
    state.stage = 'waiting for frozen follow-up candidate decision'; save(); log(state.stage);
    while (!fs.existsSync(path.join(base, 'improvements/fresh/FROZEN_DECISION.json'))) {
        if (stopped()) { state.stage = 'stopped at checkpoint'; save(); return; }
        await delay(5000);
    }
    await execute('mod_real_followup.js', ['autoblock', '--split=evaluation']);
    await execute('mod_real_followup.js', ['scaffold', '--split=evaluation']);
    state.stage = 'all queued captures ended; independent validation still required'; state.endedAt = new Date().toISOString(); save(); log(state.stage);
}
main().catch(error => { state.stage = 'capture queue error'; state.error = error.stack; save(); log(error.stack); process.exitCode = 1; });
