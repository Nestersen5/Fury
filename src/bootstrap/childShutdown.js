'use strict';
const { randomUUID } = require('crypto');
const { execFile } = require('child_process');
const path = require('path');
const system32 = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32');
const { VERSION, GRACE_MS, FORCE_MS, PHASES, within } = require('./shutdown');

function superviseChild(child, instanceId, { log = () => {}, force = forceTree } = {}) {
    let operation, ack = false, failure = false, phase = 'quiesce', exited = false, requestId;
    let onAck;
    const acknowledgement = new Promise(resolve => { onAck = resolve; });
    const exit = new Promise(resolve => {
        child.once('exit', (code, signal) => { exited = true; resolve({ code, signal }); });
        child.once('error', () => { if (!child.pid) { exited = true; resolve({ code: 1 }); } });
    });
    child.on('message', message => {
        if (!message || message.version !== VERSION || message.instanceId !== instanceId) return;
        if (!requestId || message.requestId !== requestId) return;
        if (message.type === 'shutdown-progress' && PHASES.has(message.phase)) phase = message.phase;
        if (message.type === 'shutdown-failed') {
            failure = true;
            if (PHASES.has(message.phase)) phase = message.phase;
            onAck();
        }
        if (message.type === 'shutdown-complete' && message.persisted === true && message.resourcesClosed === true) { ack = true; onAck(); }
    });
    function stop({ deadline = Date.now() + GRACE_MS, reason = 'stop' } = {}) {
        if (operation) return operation;
        requestId = randomUUID();
        operation = (async () => {
            try {
                if (!exited) child.send({ type: 'shutdown-request', version: VERSION, instanceId, requestId, deadline, reason }, error => {
                    if (error) { failure = true; onAck(); }
                });
                const [status] = await within(Promise.all([exit, acknowledgement]), deadline, phase);
                if (ack && !failure && status.code === 0 && !status.signal) return { clean: true, exited: true, outcome: 'EXITED' };
            } catch {}
            log(`Shutdown did not complete cleanly (${phase}); forcing owned resources.`);
            const forceDeadline = Math.min(deadline, Date.now()) + FORCE_MS;
            try {
                await within(force(child, () => exited, forceDeadline), forceDeadline, 'resources');
                if (!exited) await within(exit, forceDeadline, 'resources');
            } catch { log('Forced cleanup did not finish within the shutdown budget.'); }
            return { clean: false, exited, outcome: 'FORCED', phase };
        })();
        return operation;
    }
    return { stop, exit, get exited() { return exited; } };
}

function run(file, args, deadline) {
    return new Promise((resolve, reject) => execFile(file, args, { windowsHide: true, timeout: Math.max(1, deadline - Date.now()) }, (error, stdout) => error ? reject(error) : resolve(stdout)));
}
async function forceTree(child, exited, deadline) {
    if (process.platform === 'win32') {
        // Only the owned live root. Never kill by executable name.
        if (!exited() && child.pid) await run(path.join(system32, 'taskkill.exe'), ['/PID', String(child.pid), '/T', '/F'], deadline);
    } else if (!exited()) child.kill('SIGKILL');
}
module.exports = { superviseChild };
