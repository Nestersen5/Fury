'use strict';
const assert = require('assert/strict');
const fs = require('fs'), os = require('os'), path = require('path');
const { fork } = require('child_process');
const { randomUUID } = require('crypto');
const { superviseChild } = require('../../src/bootstrap/childShutdown');
const { eventually } = require('../../scripts/smoke_packaged_app');
const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'fury-shutdown-force-'));
const file = path.join(directory, 'hung.cjs');
const children = [];
fs.writeFileSync(file, `
const fs=require('fs'),os=require('os'),path=require('path');
const {installServiceShutdown}=require(${JSON.stringify(require.resolve('../../src/bootstrap/shutdown'))});
installServiceShutdown({drain:()=>new Promise(()=>{})});
process.send({type:'fixture:ready'});
`);
(async () => {
    const env = { ...process.env, FURY_SERVICE_INSTANCE: randomUUID() };
    delete env.ELECTRON_RUN_AS_NODE;
    const child = fork(file, [], { env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe', 'ipc'] }); children.push(child);
    let ready, logs = '';
    for (const stream of [child.stdout, child.stderr]) stream.on('data', chunk => { logs += chunk; });
    child.on('message', message => { if (message.type === 'fixture:ready') ready = message; });
    const owner = superviseChild(child, env.FURY_SERVICE_INSTANCE, { log: message => { logs += message; } });
    await eventually(() => { assert.equal(child.exitCode, null, logs); assert(ready); }, 'hung fixture ready');
    const start = performance.now();
    const result = await owner.stop({ deadline: Date.now() + 300 });
    const milliseconds = Math.round(performance.now() - start);
    assert.equal(result.clean, false); assert.equal(result.exited, true); assert.equal(result.phase, 'persistence');
    assert(milliseconds < 1500, String(milliseconds));
    console.log(JSON.stringify({ passed: true, milliseconds, result }, null, 2));
})().catch(error => { console.error(error); process.exitCode = 1; }).finally(() => {
    for (const child of children) if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
    fs.rmSync(directory, { recursive: true, force: true });
});
