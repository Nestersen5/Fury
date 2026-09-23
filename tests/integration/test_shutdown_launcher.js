'use strict';
const REPOSITORY_ROOT = require('path').resolve(__dirname, '../..');
// Executes current launcher Main and renderer in Electron. Test-only exports
// expose its existing owners; no production IPC endpoints or auth bypasses.
const assert = require('assert/strict');
const fs = require('fs'), os = require('os'), path = require('path');
const puppeteer = require('puppeteer');
const mc = require('minecraft-protocol');
const { cleanEnvironment, unusedPorts, startChild, assertRunning, eventually } = require('../../scripts/smoke_packaged_app');
const root = REPOSITORY_ROOT;
const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'fury-shutdown-launcher-'));
const results = [], children = [];
async function run(mode) {
    const data = path.join(directory, mode); fs.mkdirSync(data);
    const [debug, cosmetic, blocked, direct, failover, health, upstreamPort] = await unusedPorts(7);
    let upstream, player;
    fs.writeFileSync(path.join(data, 'server_config.json'), JSON.stringify({ proxyDirectPort: direct, proxyFailoverPort: failover, healthPort: health }));
    fs.writeFileSync(path.join(data, 'features_config.json'), JSON.stringify({ apiKillSwitchEnabled: true }));
    const bootstrap = path.join(data, 'main.cjs'), authWorker = path.join(data, 'auth.cjs');
    const fromRoot = require('module').createRequire(path.join(REPOSITORY_ROOT, 'package.json'));
    const resolve = name => JSON.stringify(fromRoot.resolve(name));
    fs.writeFileSync(authWorker, `process.on('message',m=>{require('fs').writeFileSync(require('path').join(m.cachePath,'synthetic.json'),'{}');process.send({type:'code',data:{message:'Synthetic shutdown test'}});setInterval(()=>{},1000);});`);
    const preload = path.join(data, 'proxy-fixture.cjs');
    fs.writeFileSync(preload, `const stores=require(${resolve('./src/session/sessionStore')});const create=stores.createSessionStore;stores.createSessionStore=options=>{const store=create(options);process.on('message',m=>{if(m?.type!=='fixture:session')return;const session=store.startSession({at:Date.now(),uuid:'aaaaaaaaaaaa4aaaaaaaaaaaaaaaaaaa',name:'Fixture',stats:{Bedwars:{wins_bedwars:1}},achievements:{}});store.appendGame(session.id,{at:Date.now(),mode:'BEDWARS',result:'win',verificationStatus:'pending',delta:null});process.send({type:'fixture:ready'});});return store;};`);
    if (mode === 'recording-quit') {
        fs.appendFileSync(preload, `
const mc=require(${resolve('minecraft-protocol')});const server=mc.createServer,client=mc.createClient;
mc.createServer=o=>server({...o,host:'127.0.0.1','online-mode':false});
mc.createClient=o=>{o.host='127.0.0.1';o.port=${upstreamPort};o.auth='offline';return client(o);};
require(${resolve('./src/accounts/connectionAuth')}).hasSavedLogin=()=>true;
`);
        upstream = mc.createServer({ host:'127.0.0.1',port:upstreamPort,'online-mode':false,version:'1.8.9',keepAlive:false });
        upstream.on('login', client => { client.on('error',()=>{}); client.write('login',{entityId:1,gameMode:0,dimension:0,difficulty:1,maxPlayers:8,levelType:'default',reducedDebugInfo:false}); client.write('position',{x:0,y:80,z:0,yaw:0,pitch:0,flags:0}); });
    }
    if (mode === 'forced-quit') fs.appendFileSync(preload, `const shutdown=require(${resolve('./src/bootstrap/shutdown')});const install=shutdown.installServiceShutdown;shutdown.installServiceShutdown=actions=>install({...actions,drain:()=>new Promise(()=>{})});`);
    fs.writeFileSync(bootstrap, `
const fs=require('fs'),Module=require('module'),path=require('path'),cp=require('child_process');
const {app,ipcMain,shell}=require('electron');
// Synthetic device-code messages still reach the production openExternal path.
// Keep this fixture isolated from the user's browser and real authentication.
shell.openExternal=async()=>{throw new Error('External browser disabled in shutdown fixture');};
const fork=cp.fork,spawn=cp.spawn;const ownedPids=[];
const remember=child=>{if(child.pid){ownedPids.push(child.pid);fs.writeFileSync(${JSON.stringify(path.join(data,'owned-pids.json'))},JSON.stringify(ownedPids));}return child;};
cp.fork=(file,args,options)=>remember(fork(file.endsWith('launcher_auth_worker.js')?${JSON.stringify(authWorker)}:file,args,options));
cp.spawn=(file,args,options)=>remember(spawn(file,args?.[0]?.endsWith('proxy.js')?['--require',${JSON.stringify(preload)},...args]:args,options));
const file=${JSON.stringify(path.join(root, 'launcher.js'))};
const main=new Module(file,module);main.filename=file;main.paths=Module._nodeModulePaths(path.dirname(file));
main._compile(fs.readFileSync(file,'utf8')+'\\nmodule.exports={startService,stopService,requestQuit,services,refreshMicrosoftLogin,getLogin:()=>microsoftLogin};',file);
const api=main.exports;let previousChild;
ipcMain.handle('fixture:restart-quit',()=>{const stop=api.stopService('proxy');const start=api.startService('proxy').then(()=>false,()=>true);void api.requestQuit('quit');return start;});
ipcMain.handle('fixture:quit',()=>{void api.requestQuit('quit');return true;});
ipcMain.handle('fixture:seed',()=>new Promise(resolve=>{const child=api.services.proxy.child;previousChild=child;const ready=m=>{if(m?.type==='fixture:ready'){child.removeListener('message',ready);resolve(true);}};child.on('message',ready);child.send({type:'fixture:session'});}));
ipcMain.handle('fixture:auth',()=>{void api.refreshMicrosoftLogin('Fixture').catch(()=>{});return true;});
ipcMain.handle('fixture:auth-state',()=>{const op=api.getLogin();return op?{pid:op.worker.pid,staged:fs.existsSync(path.join(op.directory,'synthetic.json'))}:null;});
ipcMain.handle('fixture:stale-exit',()=>{const current=api.services.proxy.child;previousChild.emit('exit',0,null);return api.services.proxy.child===current;});
`);
    console.log('START launcher ' + mode);
    const env = cleanEnvironment(data, root, cosmetic, blocked); env.NODE_BINARY = process.execPath;
    const child = startChild(require('electron'), [bootstrap, `--remote-debugging-port=${debug}`, '--remote-debugging-address=127.0.0.1', `--proxy-server=${env.HTTPS_PROXY}`], env, 'F7 launcher fixture'); children.push(child);
    let browser;
    try {
        browser = await eventually(async () => { assertRunning(child); try { return await puppeteer.connect({ browserURL: `http://127.0.0.1:${debug}`, defaultViewport: null }); } catch (error) { throw new Error(error.message + '\n' + child.output); } }, 'Electron debugging');
        const page = await eventually(async () => { assertRunning(child); const page = (await browser.pages()).find(page => page.url().endsWith('/launcher.html')); assert(page); return page; }, 'launcher renderer');
        await page.waitForFunction('typeof furyDesign !== "undefined" && !!furyDesign');
        const invoke = (channel, ...args) => page.evaluate((channel, args) => require('electron').ipcRenderer.invoke(channel, ...args), channel, args);
        if (['restart','pending-quit','recording-quit','forced-quit','quit-during-restart'].includes(mode)) {
            await invoke('service:start', 'proxy');
            await eventually(async () => assert((await require('../../scripts/smoke_packaged_app').getJson(`http://127.0.0.1:${health}/health`)).ok), 'proxy ready');
            await invoke('fixture:seed');
        }
        if (mode === 'restart') {
            const timings = await page.evaluate(async () => {
                const ipc = require('electron').ipcRenderer, start = performance.now();
                const stopping = ipc.invoke('service:stop', 'proxy');
                const starting = ipc.invoke('service:start', 'proxy');
                const [stopped, started] = await Promise.all([stopping, starting]);
                return { stopped, started, ms: performance.now() - start };
            });
            assert(timings.stopped.clean); assert(timings.stopped.exited); assert(timings.started.running);
            results.push({ mode: 'Stop -> immediate Start', milliseconds: Math.round(timings.ms) });
            // Exercise the exact old child's exit callback against another slot.
            assert(await invoke('fixture:stale-exit'));
        }
        if (upstream) {
            player = mc.createClient({host:'127.0.0.1',port:direct,username:'Fixture',auth:'offline',version:'1.8.9',keepAlive:false});
            let loggedIn = false; player.on('error',()=>{}); player.on('login',()=>{loggedIn=true;});
            await eventually(()=>assert(loggedIn),'Minecraft login');
            player.write('chat',{message:'/rc Fixture synthetic'});
            await eventually(()=>assert(fs.existsSync(path.join(data,'recordings'))),'busy operation');
        }
        let authPid;
        if (mode === 'auth') {
            await invoke('fixture:auth');
            authPid = await eventually(async () => { const state = await invoke('fixture:auth-state'); assert(state?.staged); return state.pid; }, 'staged synthetic sign-in');
        }
        if (mode === 'window-close') await page.evaluate(() => window.dispatchEvent(new CustomEvent('fury:accent-change', { detail: { color: '#123456' } })));
        const exitObserved = new Promise(resolve => child.once('exit', () => resolve(performance.now())));
        const start = performance.now();
        await invoke(mode === 'window-close' ? 'window:control' : mode === 'quit-during-restart' ? 'fixture:restart-quit' : 'fixture:quit', 'close').catch(() => {});
        const end = await require('../../src/bootstrap/shutdown').within(exitObserved, Date.now() + 7000, 'fixture');
        assert.equal(child.exitCode, mode === 'forced-quit' ? 1 : 0, child.output);
        if (mode !== 'forced-quit') assert(!child.output.includes('Shutdown did not'), child.output);
        results.push({ mode, milliseconds: Math.round(end - start) });
        const pidFile=path.join(data,'owned-pids.json');
        if(fs.existsSync(pidFile))for(const pid of JSON.parse(fs.readFileSync(pidFile)))assert.throws(()=>process.kill(pid,0), 'Owned service/worker still alive: '+pid);
        if (['restart','pending-quit','recording-quit'].includes(mode)) {
            const saved = JSON.parse(fs.readFileSync(path.join(data, 'session_data.json')));
            assert(saved.sessions.some(session => session.name === 'Fixture' && session.games.length));
        }
        if (mode === 'recording-quit') {
            const recordings=fs.readdirSync(path.join(data,'recordings')).filter(file=>file.endsWith('.jsonl'));assert(recordings.length);
            for(const file of recordings) assert.equal(JSON.parse(fs.readFileSync(path.join(data,'recordings',file),'utf8').trim().split('\n').at(-1)).k,'footer');
        }
        if (mode === 'window-close') assert.equal(JSON.parse(fs.readFileSync(path.join(data, 'features_config.json'))).chatPrefixAccentHex, '#123456');
        if (mode === 'auth') {
            assert.throws(() => process.kill(authPid, 0));
            assert.deepEqual(fs.readdirSync(path.join(data, 'launcher_data', 'auth-staging')), []);
            assert(!fs.existsSync(path.join(data, 'auth_tokens', 'Fixture')));
        }
    } finally {
        browser?.disconnect(); player?.socket?.destroy(); if(player)clearTimeout(player.closeTimer);
        if(upstream){for(const client of Object.values(upstream.clients)){client.socket?.destroy();clearTimeout(client.closeTimer);}upstream.socketServer.close();}
    }
}
(async () => { for (const mode of ['idle', 'window-close', 'restart', 'pending-quit', 'auth', 'recording-quit', 'forced-quit', 'quit-during-restart']) await run(mode); console.log(JSON.stringify({ passed: true, results }, null, 2)); })()
    .catch(error => { console.error(error); process.exitCode = 1; })
    .finally(async () => {
        for (const child of children) if (child.exitCode === null && child.signalCode === null) {
            if (process.platform === 'win32') await new Promise(resolve => require('child_process').execFile('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true }, resolve));
            else child.kill('SIGKILL');
        }
        await new Promise(resolve => setTimeout(resolve, 100));
        fs.rmSync(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    });
