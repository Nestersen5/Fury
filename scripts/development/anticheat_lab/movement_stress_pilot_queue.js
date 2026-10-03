'use strict';
// Use the corrected Jump Reset pilot review gate as an explicit idle boundary;
// never run two Minecraft input drivers at once.
const fs = require('fs'), path = require('path'), assert = require('assert');
const { spawn, execFileSync } = require('child_process');
const root = path.resolve(__dirname, '../../..'), base = path.join(root, 'output/anticheat-lab/mod-real');
const queue = path.join(base, 'overnight/queue-1790722173026');
const directory = path.join(base, 'improvements/movement-stress', `pilot-queue-${Date.now()}`);
fs.mkdirSync(directory, { recursive: true });
const state = { startedAt: new Date().toISOString(), pid: process.pid, stage: 'waiting for corrected Jump Reset pilot review gate', children: [] };
const save = () => fs.writeFileSync(path.join(directory, 'state.json'), JSON.stringify(state, null, 2) + '\n');
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const stop = () => fs.existsSync(path.join(base, 'overnight/STOP_AFTER_TRIAL'));
async function main() {
    save();
    for (;;) {
        if (stop()) { state.stage = 'stopped at checkpoint'; save(); return; }
        assert(!fs.existsSync(path.join(base, 'jump-reset/CONTROL_PROTOCOL_PILOTS_VALIDATED.json')), 'Pilot gate already released');
        const live = JSON.parse(fs.readFileSync(path.join(queue, 'state.json')));
        const output = fs.readFileSync(path.join(queue, 'capture.log'), 'utf8');
        if (live.stage === 'jump_reset_real_campaign.js --split=calibration' &&
            output.includes('Waiting for independent HUD/input/evidence review of corrected control pilots')) break;
        await delay(5000);
    }
    const ownedJava = execFileSync('powershell', ['-NoProfile', '-Command',
        "Get-CimInstance Win32_Process -Filter \"Name = 'java.exe'\" | Where-Object { $_.CommandLine -like '*anticheat-lab*mod-real*' } | Select-Object ProcessId,CommandLine | ConvertTo-Json -Compress"], { encoding: 'utf8' });
    assert(!ownedJava.trim(), 'An owned Java process is still running at the idle boundary');
    for (let number = 1; number <= 6; number++) {
        if (stop()) { state.stage = 'stopped at checkpoint'; save(); return; }
        const id = `l6_${String(number).padStart(3, '0')}`;
        assert(!fs.existsSync(path.join(base, 'jump-reset/CONTROL_PROTOCOL_PILOTS_VALIDATED.json')), 'Do not release Jump Reset gate during stress captures');
        state.stage = 'movement stress pilot ' + id; save(); console.log(state.stage);
        const child = spawn(process.execPath, [path.join(__dirname, 'mod_real_movement_stress.js'), 'autoblock', '--pilot', '--force=' + id],
            { cwd: root, windowsHide: true, stdio: ['ignore','pipe','pipe'] });
        const log = fs.createWriteStream(path.join(directory, id + '.log'));
        for (const stream of [child.stdout, child.stderr]) stream.pipe(log, { end: false });
        const entry = { id, pid: child.pid, startedAt: Date.now() }; state.children.push(entry); save();
        const code = await new Promise((resolve, reject) => { child.once('error', reject); child.once('exit', resolve); });
        await new Promise(resolve => log.end(resolve)); entry.endedAt = Date.now(); entry.exitCode = code; save();
        assert.strictEqual(code, 0, 'Stress pilot capture failed');
        console.log(id + ' capture ended; independent review still required');
    }
    state.stage = 'six condition pilots captured; independent review required'; state.endedAt = new Date().toISOString(); save();
}
main().catch(error => { state.stage = 'error'; state.error = error.stack; save(); console.error(error); process.exitCode = 1; });
