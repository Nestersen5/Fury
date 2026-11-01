'use strict';

// Current Electron Main + production proxy, native child IPC and isolated data.
// Both HTTP transports are mocked; no Hypixel traffic or user settings are used.
const assert = require('assert/strict');
const fs = require('fs'), os = require('os'), path = require('path');
const { execFile } = require('child_process');
const { cleanEnvironment, unusedPorts, startChild, assertRunning, eventually } = require('../../scripts/smoke_packaged_app');
const root = path.resolve(__dirname, '../..');
const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'fury-hypixel-ipc-'));
let child;

async function run() {
    const [direct, failover, health, cosmetic, blocked] = await unusedPorts(5);
    fs.writeFileSync(path.join(directory, 'server_config.json'), JSON.stringify({ proxyCustomPort: 0, proxyDirectPort: direct, proxyFailoverPort: failover, healthPort: health }));
    fs.writeFileSync(path.join(directory, 'statmod_key.txt'), 'synthetic-shared-key\n\n\n');
    fs.writeFileSync(path.join(directory, 'features_config.json'), JSON.stringify({ hypixelRequestDelayMs: 350, hypixelRequestConcurrency: 3 }));
    const preload = path.join(directory, 'proxy-fixture.cjs');
    const bootstrap = path.join(directory, 'main.cjs');
    const report = path.join(directory, 'result.json');
    const fromRoot = require('module').createRequire(path.join(root, 'package.json'));
    const resolve = name => JSON.stringify(fromRoot.resolve(name));
    fs.writeFileSync(preload, `
const axios=require(${resolve('axios')});
let recoveryAttempts=0,uuidLookups=0;
axios.get=async(url,options)=>{
 if(url.startsWith('https://api.mojang.com/')||url.startsWith('https://api.minecraftservices.com/')){uuidLookups++;return {data:{id:'abcdefabcdefabcdefabcdefabcdefab',name:url.split('/').pop()}};}
 if(!url.startsWith('https://api.hypixel.net/')) throw new Error('External networking blocked');
 if(options.headers['API-Key']!=='synthetic-shared-key') throw new Error('Wrong shared credential');
 if(url.includes('limited')) {const error=new Error('Synthetic 429');error.response={status:429,headers:{'retry-after':'60'},data:{success:false,cause:'Rate limited'}};throw error;}
 if(url.includes('abcdefabcdefabcdefabcdefabcdefab')&&++recoveryAttempts===1){const error=new Error('Synthetic 500');error.response={status:500,headers:{},data:{success:false,cause:'Temporary server error'}};throw error;}
 return {status:200,headers:{'ratelimit-limit':'300','ratelimit-remaining':'299','ratelimit-reset':'300'},data:{player:{uuid:'abcdefabcdefabcdefabcdefabcdefab',payload:'x'.repeat(1000000)}}};
};
const fetch=require(${resolve('./src/stats/fetch')});const createFetch=fetch.createStatsFetch;
fetch.createStatsFetch=options=>{
 const stats=createFetch(options);
 process.on('message',async message=>{
  if(message?.type!=='fixture:stats')return;
  const profile=await stats.getPlayerData('RecoveryPlayer',{includeErrors:message.includeErrors});
  process.send({type:'fixture:result',id:message.id,length:profile?.data?.player?.payload?.length,error:Boolean(profile?.error),uuidLookups,recoveryAttempts});
 });
 return stats;
};
const coordinator=require(${resolve('./src/net/hypixelApiCoordinator')});
const create=coordinator.createHypixelApiCoordinatorClient;
coordinator.createHypixelApiCoordinatorClient=options=>{
 const client=create(options);
 process.on('message',async message=>{
  if(message?.type==='fixture:pacing'){
   const settings=client.configureHypixelRequests(message.settings);
   process.send({type:'fixture:result',id:message.id,settings});return;
  }
  if(message?.type!=='fixture:lookup')return;
  try {const response=await client.hypixelApiGet('https://api.hypixel.net/v2/player?uuid='+message.id,{apiPriority:'game',timeout:5000});process.send({type:'fixture:result',id:message.id,length:response.data.player.payload.length});}
  catch(error){process.send({type:'fixture:result',id:message.id,status:error.response?.status,code:error.code});}
 });
 process.send({type:'fixture:ready'});
 return client;
};
`);
    fs.writeFileSync(bootstrap, `
const fs=require('fs'),Module=require('module'),path=require('path'),cp=require('child_process');
const {app,BrowserWindow,ipcMain}=require('electron');
BrowserWindow.prototype.loadFile=async function(){
 this.hide();
 const send=this.webContents.send.bind(this.webContents);
 this.webContents.send=(channel,message,...args)=>{
  if(channel==='shutdown:prepare-renderer')ipcMain.emit('shutdown:renderer-complete',{sender:this.webContents},{...message,clean:true});
  else send(channel,message,...args);
 };
};
BrowserWindow.prototype.show=()=>{};
const axios=require(${resolve('axios')});let launcherCalls=0;
axios.get=async(url,options)=>{
 if(url.startsWith('https://api.mojang.com/'))return {status:200,data:{id:'abcdefabcdefabcdefabcdefabcdefab',name:url.split('/').pop()}};
 if(!url.startsWith('https://api.hypixel.net/'))throw new Error('External networking blocked');
 launcherCalls++;
 return {status:url.includes('uuid=')?200:400,headers:{'ratelimit-limit':'300','ratelimit-remaining':'299','ratelimit-reset':'300'},data:{success:true}};
};
const ready=new WeakMap(),pids=[];const spawn=cp.spawn;
cp.spawn=(file,args,options)=>{
 const proxy=args?.[0]?.endsWith('proxy.js');
 const child=spawn(file,proxy?['--require',${JSON.stringify(preload)},...args]:args,options);
 if(child.pid){pids.push(child.pid);fs.writeFileSync(${JSON.stringify(path.join(directory, 'pids.json'))},JSON.stringify(pids));}
 if(proxy)ready.set(child,new Promise(resolve=>{child.on('message',message=>{if(message?.type==='fixture:ready')resolve();});}));
 return child;
};
const file=${JSON.stringify(path.join(root, 'launcher.js'))};
const main=new Module(file,module);main.filename=file;main.paths=Module._nodeModulePaths(path.dirname(file));
main._compile(fs.readFileSync(file,'utf8')+String.fromCharCode(10)+'module.exports={startService,stopService,requestQuit,services,reminderApi,getApiStatus,clearApiStatus:()=>{apiStatusCache={at:0,data:null}},testApiKey};',file);
const api=main.exports,assert=require('assert/strict');
function lookup(id,type='fixture:lookup',includeErrors=true,settings){const child=api.services.proxy.child;return new Promise((resolve,reject)=>{
 const timer=setTimeout(()=>reject(new Error('Lookup timed out: '+id)),10000);
 const listener=message=>{if(message?.type==='fixture:result'&&message.id===id){clearTimeout(timer);child.removeListener('message',listener);resolve(message);}};
 child.on('message',listener);child.send({type,id,includeErrors,settings});
});}
app.whenReady().then(async()=>{
 assert.equal(api.reminderApi.getHypixelRequestSettings().hypixelRequestDelayMs,350);
 assert.equal(api.reminderApi.getHypixelRequestSettings().hypixelRequestConcurrency,3);
 await api.startService('proxy');await ready.get(api.services.proxy.child);
 const baseline=api.reminderApi.getHypixelApiUsageSnapshot().lastFiveMinutes;
 const scan=lookup('scan1'),scan2=lookup('scan2');
 await api.reminderApi.hypixelApiGet('https://api.hypixel.net/v2/player?uuid=launcher',{apiPriority:'background'});
 assert.equal((await scan).length,1000000);assert.equal((await scan2).length,1000000);
 assert.equal(api.reminderApi.getHypixelApiUsageSnapshot().lastFiveMinutes,baseline+3);
 fs.writeFileSync(${JSON.stringify(path.join(directory, 'features_config.json'))},JSON.stringify({hypixelRequestDelayMs:100,hypixelRequestConcurrency:4}));
 await lookup('pacing','fixture:pacing',true,{hypixelRequestDelayMs:100,hypixelRequestConcurrency:4});
 assert.equal(api.reminderApi.getHypixelRequestSettings().hypixelRequestDelayMs,100);
 assert.equal(api.reminderApi.getHypixelRequestSettings().hypixelRequestConcurrency,4);
 assert.equal(api.reminderApi.getHypixelApiUsageSnapshot().lastFiveMinutes,baseline+3);
 const tested=await api.testApiKey('hypixel','synthetic-shared-key');assert.equal(tested.state,'available');
 await api.getApiStatus({keys:{hypixel:'synthetic-shared-key'}});
 assert.equal(api.reminderApi.getHypixelApiUsageSnapshot().lastFiveMinutes,baseline+5);
 const recovered=await Promise.all([lookup('recovery-plain','fixture:stats',false),lookup('recovery-errors','fixture:stats',true)]);
 for(const profile of recovered){assert.equal(profile.error,false);assert.equal(profile.length,1000000);assert.equal(profile.uuidLookups,1);assert.equal(profile.recoveryAttempts,2);}
 assert.equal(api.reminderApi.getHypixelApiUsageSnapshot().lastFiveMinutes,baseline+7);
 const stopped=await api.stopService('proxy');assert(stopped.clean&&stopped.exited);
 await api.startService('proxy');await ready.get(api.services.proxy.child);
 assert.equal(api.reminderApi.getHypixelRequestSettings().hypixelRequestDelayMs,100);
 assert.equal((await lookup('after-restart')).length,1000000);
 assert.equal(api.reminderApi.getHypixelApiUsageSnapshot().lastFiveMinutes,baseline+8);
 assert.equal((await lookup('limited')).status,429);
 const usage=api.reminderApi.getHypixelApiUsageSnapshot();assert(usage.queue.cooldownInMs>59000);assert.equal(usage.recent429,1);
 await lookup('cooldown-pacing','fixture:pacing',true,{hypixelRequestDelayMs:0,hypixelRequestConcurrency:16});
 assert(api.reminderApi.getHypixelApiUsageSnapshot().queue.cooldownInMs>59000);
 assert.equal(api.reminderApi.getHypixelApiUsageSnapshot().lastFiveMinutes,usage.lastFiveMinutes);
 const before=launcherCalls;api.clearApiStatus();
 await api.getApiStatus({keys:{hypixel:'synthetic-shared-key'}});
 assert.equal(launcherCalls,before,'Status checks must not bypass cooldown or wait for a reset');
 fs.writeFileSync(${JSON.stringify(report)},JSON.stringify({passed:true,combinedCalls:usage.lastFiveMinutes-baseline,launcherCalls,restartPreservedBudget:true,cooldownShared:true,sharedProfileRecovery:true,verifiedUuidReused:true,livePacingShared:true,pacingPersisted:true}));
 await api.requestQuit('hypixel-fixture');
}).catch(error=>{fs.writeFileSync(${JSON.stringify(report)},JSON.stringify({error:error.stack}));void api.requestQuit('hypixel-fixture-failed');});
`);
    const env = cleanEnvironment(directory, root, cosmetic, blocked);
    env.NODE_BINARY = process.execPath;
    child = startChild(require('electron'), [bootstrap], env, 'Hypixel coordinator Electron fixture');
    const result = await eventually(() => {
        if (fs.existsSync(report)) return JSON.parse(fs.readFileSync(report, 'utf8'));
        assertRunning(child);
        throw new Error('Waiting for native IPC checks');
    }, 'Hypixel coordinator checks', 45000);
    assert.equal(result.error, undefined, result.error);
    assert.equal(result.passed, true);
    await eventually(() => assert.equal(child.exitCode, 0, child.output), 'Clean launcher exit', 15000);
    console.log(JSON.stringify(result));
}

run().catch(error => { console.error(error, child?.output || ''); process.exitCode = 1; }).finally(async () => {
    if (child && child.exitCode === null && child.signalCode === null) {
        if (process.platform === 'win32') await new Promise(resolve => execFile('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true }, resolve));
        else child.kill('SIGKILL');
    }
    // Verify the complete resolved target before recursive cleanup on Windows.
    const target = path.resolve(directory);
    assert.equal(path.dirname(target), path.resolve(os.tmpdir()));
    assert(path.basename(target).startsWith('fury-hypixel-ipc-'));
    fs.rmSync(target, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});
