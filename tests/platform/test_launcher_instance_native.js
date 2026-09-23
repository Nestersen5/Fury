'use strict';
// Native Electron lock test. No Fury credentials, services or default profile.
const assert = require('assert/strict'), fs = require('fs'), os = require('os'), path = require('path');
const { spawn } = require('child_process');
const { eventually } = require('../../scripts/smoke_packaged_app');
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'fury-instance-native-')), children = [];
const executable = require('electron');
async function main() {
    const helper = require.resolve('../../src/bootstrap/launcherInstance');
    for (const label of ['Installed App', 'Extracted Portable']) {
        const appDir = path.join(root, label); fs.mkdirSync(appDir);
        fs.writeFileSync(path.join(appDir, 'main.cjs'), `
const {app,BrowserWindow,shell}=require('electron'),fs=require('fs'),path=require('path');
shell.openExternal=()=>{throw Error('External navigation disabled in test');};
app.setName('Fury');
const profile=process.env.FURY_DATA_DIR;fs.mkdirSync(profile,{recursive:true});app.setPath('userData',profile);
let win,quitting=false;
if(!require(${JSON.stringify(helper)}).acquireLauncherInstance({app,getWindow:()=>win,isQuitting:()=>quitting}))return;
process.send({type:'owner'});
app.on('second-instance',()=>process.send({type:'focused',minimized:win?.isMinimized(),visible:win?.isVisible(),quitting}));
app.whenReady().then(()=>{win=new BrowserWindow({show:false});process.send({type:'ready'});});
process.on('message',m=>{if(m==='minimize'){win.once('minimize',()=>process.send({type:'minimized',value:win.isMinimized()}));win.show();win.minimize();}if(m==='state')process.send({type:'state',minimized:win?.isMinimized(),visible:win?.isVisible()});if(m==='quiesce'){quitting=true;process.send({type:'quiescing'});}if(m==='exit')app.exit(0);});
`);
    }
    const start = (label, profile = 'shared profile') => {
        const env = { ...process.env, FURY_DATA_DIR: path.join(root, profile) };
        delete env.ELECTRON_RUN_AS_NODE; delete env.NODE_OPTIONS;
        // Bare Electron on macOS can treat different entry scripts as different
        // apps. Packaged ZIP/DMG cross-path ownership is checked separately.
        const entry = process.platform === 'darwin' ? 'Installed App' : label;
        const child = spawn(executable, [path.join(root, entry, 'main.cjs')], { env, cwd: root, windowsHide: true, stdio: ['ignore','ignore','pipe','ipc'] });
        child.messages = []; child.output = ''; child.stderr.on('data', x => child.output += x);
        child.on('message', m => child.messages.push(m)); children.push(child); return child;
    };
    const has = (c, type) => c.messages.some(m => m.type === type);
    const exited = c => eventually(() => assert.notEqual(c.exitCode ?? c.signalCode, null), 'native process exit');
    const pair = [start('Installed App'), start('Extracted Portable')];
    await eventually(() => assert.equal(pair.filter(c => has(c,'owner')).length,1), 'one owner');
    const primary = pair.find(c => has(c,'owner')), secondary = pair.find(c => c !== primary);
    await exited(secondary); assert.equal(secondary.exitCode,0); assert(!has(secondary,'owner'));
    await eventually(() => assert(has(primary,'ready')), 'primary window');
    primary.messages = []; primary.send('minimize');
    await eventually(() => assert(has(primary,'minimized')), 'minimize');
    assert(primary.messages.find(m => m.type === 'minimized').value);
    const double = [start('Installed App'), start('Extracted Portable')];
    for(const c of double) { await exited(c); assert.equal(c.exitCode,0); assert(!has(c,'owner')); }
    // Cocoa restoration can complete after the second-instance callback. Query
    // the window rather than waiting for that event's frozen snapshot to change.
    await eventually(() => {
        primary.send('state');
        assert(has(primary, 'focused'));
        assert(primary.messages.some(m => m.type==='state' && !m.minimized && m.visible));
    }, 'restore/show');
    primary.send('quiesce'); await eventually(() => assert(has(primary,'quiescing')), 'quiescence');
    const during = start('Extracted Portable'); await exited(during); assert(!has(during,'owner'));
    const isolated = start('Installed App','explicit independent test profile');
    await eventually(() => assert(has(isolated,'owner')), 'explicit profile lock');
    isolated.send('exit'); await exited(isolated);
    primary.send('exit'); await exited(primary);
    const relaunched = start('Extracted Portable'); await eventually(() => assert(has(relaunched,'owner')), 'relaunch after exit');
    relaunched.kill('SIGKILL'); await exited(relaunched);
    const recovered = start('Installed App'); await eventually(() => assert(has(recovered,'owner')), 'stale lock recovery');
    recovered.send('exit'); await exited(recovered);
    console.log('PASS native Electron: simultaneous paired paths, rapid double launch, minimized restore, shutdown ownership, profile overrides, relaunch and hard-exit lock recovery');
}
main().catch(error => { console.error(error); process.exitCode=1; }).finally(async () => {
    for (const child of children) if(child.exitCode===null&&child.signalCode===null) child.kill('SIGKILL');
    for (const child of children) await eventually(()=>assert.notEqual(child.exitCode??child.signalCode,null),'owned test exit').catch(()=>{});
    fs.rmSync(root,{recursive:true,force:true,maxRetries:5,retryDelay:200});
});
