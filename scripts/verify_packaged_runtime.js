'use strict';
// Native packaged launcher acceptance. All auth/network collaborators are fenced
// in test-only inspector/preload seams before production Main executes.
const path=require('path'),fs=require('fs'),os=require('os'),assert=require('assert/strict');
if(process.argv[2]!=='--scenario') {
 (async()=>{
  const application=path.resolve(process.argv[2]||'');assert(process.argv[2],'Usage: node scripts/verify_packaged_runtime.js <Fury.exe|Fury.app> [report.json]');
  const {payloadInventory,assertPayloadParity}=require('./release_artifacts');
  const payload=process.platform==='darwin'?application:path.dirname(application),before=await payloadInventory(payload);
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'fury-packaged-runtime-'));
  const results=[];
  try {
   for(const mode of ['restart','busy','accounts']) {
    const run=require('child_process').spawnSync(process.execPath,[__filename,'--scenario',mode,application,root],{stdio:'inherit',windowsHide:true,timeout:120000});
    if(run.error)throw run.error;assert.equal(run.status,0,'Packaged '+mode+' failed');
    results.push(...JSON.parse(fs.readFileSync(path.join(root,'application-'+mode+'-results.json'))));
   }
   assertPayloadParity(before,await payloadInventory(payload));
   const report={passed:true,platform:process.platform,architecture:process.arch,isolatedData:true,defaultProfileTested:false,results};
   if(process.argv[3])fs.writeFileSync(path.resolve(process.argv[3]),JSON.stringify(report,null,2)+'\n');
  } finally {assert.equal(path.dirname(root),path.resolve(os.tmpdir()));assert(path.basename(root).startsWith('fury-packaged-runtime-'));fs.rmSync(root,{recursive:true,force:true,maxRetries:5,retryDelay:200});}
 })().catch(e=>{console.error(e);process.exitCode=1;});
} else {
'use strict';
const fs=require('fs'),path=require('path'),assert=require('assert/strict'),cp=require('child_process');
const {createRequire}=require('module');const root=process.argv[5],sourceRoot=path.resolve(__dirname,'..'),req=createRequire(path.join(sourceRoot,'package.json'));
assert(path.dirname(root)===path.resolve(require('os').tmpdir()) && path.basename(root).startsWith('fury-packaged-runtime-'));
const {cleanEnvironment,unusedPorts,eventually,getJson}=req('./scripts/smoke_packaged_app');
const puppeteer=req('puppeteer'),WS=req('ws');
const children=[],results=[];let connection,ui,player,upstream,extracted;
async function cdp(url){const ws=new WS(url);await new Promise((r,j)=>{ws.once('open',r);ws.once('error',j);});let n=0;const pending=new Map(),events=new Map();ws.on('message',raw=>{const m=JSON.parse(raw);if(m.id){const p=pending.get(m.id);pending.delete(m.id);m.error?p?.reject(Error(m.error.message)):p?.resolve(m.result);}else{events.get(m.method)?.(m.params);}});return {ws,events,call(method,params={}){return new Promise((resolve,reject)=>{const id=++n;pending.set(id,{resolve,reject});ws.send(JSON.stringify({id,method,params}));});}};}
async function main(){
 const mode=process.argv[3],kind='application',application=process.argv[4];const packaged=req('./scripts/smoke_packaged_app').packagePaths(application);
 const launch=path.join(root,'Portable Launch With Spaces'),data=path.join(root,'portable-data'),work=path.join(root,'different working directory');for(const d of [launch,data,work])fs.mkdirSync(d,{recursive:true});const previous=fs.existsSync(path.join(data,'session_data.json'))?JSON.parse(fs.readFileSync(path.join(data,'session_data.json'))).sessions.filter(s=>s.name==='Fixture'&&s.games.length).map(s=>s.id):[];
 const portable=packaged.executable;
 if(mode==='accounts'){const file=path.join(data,'session_data.json'),store=JSON.parse(fs.readFileSync(file));const source=store.sessions.find(s=>s.name==='Fixture'&&s.games.length);assert(source);store.sessions=store.sessions.filter(s=>s.id!=='fixture-other-account');store.sessions.push({...structuredClone(source),id:'fixture-other-account',uuid:'bbbbbbbbbbbb4bbbbbbbbbbbbbbbbbbb',name:'OtherFixture'});fs.writeFileSync(file,JSON.stringify(store));}
 const [debug,inspect,cosmetic,blocked,direct,failover,health,upstreamPort]=await unusedPorts(8);
 fs.writeFileSync(path.join(data,'server_config.json'),JSON.stringify({proxyDirectPort:direct,proxyFailoverPort:failover,healthPort:health,proxyDirectHost:'127.0.0.1',proxyFailoverHost:'127.0.0.1'}));
 fs.writeFileSync(path.join(data,'features_config.json'),JSON.stringify({apiKillSwitchEnabled:true,autoSkinDenickEnabled:false,autoStatsDenickEnabled:false,chatPrefixAccentHex:'#123456'}));
 const env=cleanEnvironment(data,'intentionally-invalid-resource-path',cosmetic,blocked);env.TEMP=path.join(root,'Portable Temp With Spaces');env.TMP=env.TEMP;env.TMPDIR=env.TEMP;fs.mkdirSync(env.TEMP,{recursive:true});
 const start=performance.now();const child=cp.spawn(portable,[`--inspect-brk=127.0.0.1:${inspect}`,`--remote-debugging-port=${debug}`,'--remote-debugging-address=127.0.0.1',`--proxy-server=${env.HTTPS_PROXY}`],{cwd:work,env,windowsHide:true,detached:process.platform!=='win32',stdio:['ignore','pipe','pipe']});children.push(child);let logs='';child.stdout.on('data',d=>logs+=d);child.stderr.on('data',d=>logs+=d);
 const target=await eventually(async()=>{assert.equal(child.exitCode,null,logs);return (await getJson(`http://127.0.0.1:${inspect}/json/list`))[0];},'packaged Main inspector',45000);
 connection=await cdp(target.webSocketDebuggerUrl);await connection.call('Debugger.enable');const paused=new Promise(resolve=>connection.events.set('Debugger.paused',resolve));await connection.call('Runtime.runIfWaitingForDebugger');const frame=(await paused).callFrames[0].callFrameId;
 const evaluate=async expression=>{const r=await connection.call('Debugger.evaluateOnCallFrame',{callFrameId:frame,expression,returnByValue:true});assert(!r.exceptionDetails,JSON.stringify(r.exceptionDetails));return r.result.value;};
 const info=await evaluate(`({pid:process.pid,exec:process.execPath,resources:process.resourcesPath,appData:require('electron').app.getPath('appData'),packaged:require('electron').app.isPackaged})`);extracted=path.dirname(info.exec);assert(info.packaged);
 const app=path.join(info.resources,'app'),preload=path.join(data,'proxy-fixture.cjs');const mod=file=>JSON.stringify(path.join(app,file));
 fs.writeFileSync(preload,`const fs=require('fs'),path=require('path'),appRequire=require('module').createRequire(${mod('package.json')});appRequire('prismarine-auth').Authflow.prototype.getMinecraftJavaToken=async()=>{throw Error('REAL AUTH DISABLED IN PACKAGING TEST');};
 const S=require(${mod('src/session/sessionStore.js')}),create=S.createSessionStore;S.createSessionStore=o=>{const s=create(o);process.on('message',m=>{if(m?.type==='fixture:seed'){const x=s.startSession({at:Date.now(),uuid:'aaaaaaaaaaaa4aaaaaaaaaaaaaaaaaaa',name:'Fixture',stats:{Bedwars:{wins_bedwars:1}},achievements:{}});s.appendGame(x.id,{at:Date.now(),mode:'BEDWARS',result:'win',verificationStatus:'pending'});process.send({type:'fixture:ready'});}});return s;};
 ${mode==='busy'?`const mc=appRequire('minecraft-protocol'),server=mc.createServer,client=mc.createClient;mc.createServer=o=>server({...o,host:'127.0.0.1','online-mode':false});mc.createClient=o=>client({...o,host:'127.0.0.1',port:${upstreamPort},auth:'offline'});require(${mod('src/accounts/connectionAuth.js')}).hasSavedLogin=()=>true;`:''}`);
 const setup=await evaluate(`(()=>{const cp=require('child_process'),e=require('electron'),fs=require('fs');globalThis.fixtureOwned=[];e.shell.openExternal=async()=>{throw Error('EXTERNAL BROWSER DISABLED IN PACKAGING TEST');};require('prismarine-auth').Authflow.prototype.getMinecraftJavaToken=async()=>{throw Error('REAL AUTH DISABLED IN PACKAGING TEST');};const spawn=cp.spawn;let proxy;cp.spawn=(file,args,options)=>{const isProxy=args?.[0]?.endsWith('proxy.js');const c=spawn(file,isProxy?['--require',${JSON.stringify(preload)},...args]:args,options);if(c.pid)fixtureOwned.push(c.pid);if(isProxy)proxy=c;return c;};e.ipcMain.handle('fixture:seed',()=>new Promise(resolve=>{const ready=m=>{if(m?.type==='fixture:ready'){proxy.removeListener('message',ready);resolve(true);}};proxy.on('message',ready);proxy.send({type:'fixture:seed'});}));e.ipcMain.handle('fixture:info',()=>({pids:fixtureOwned,root:process.env.FURY_DATA_DIR,userData:e.app.getPath('userData'),exec:process.execPath}));return true;})()`);assert(setup);
 await connection.call('Debugger.resume');connection.ws.close();connection=null;
 ui=await eventually(()=>puppeteer.connect({browserURL:`http://127.0.0.1:${debug}`,defaultViewport:null}),'portable renderer');
 const page=await eventually(async()=>{const p=(await ui.pages()).find(p=>p.url().endsWith('/launcher.html'));assert(p);return p;},'launcher');await page.waitForFunction('typeof furyDesign!=="undefined" && !!furyDesign');
 const invoke=(channel,...args)=>page.evaluate((c,a)=>require('electron').ipcRenderer.invoke(c,...a),channel,args);
 const ready=performance.now();const state=await invoke('state:get',{activePage:'settings'});assert(state.settings&&state.services);const owned=await invoke('fixture:info');assert.equal(owned.root,data);assert.equal(owned.userData,path.join(data,'launcher_data'));
 const parity=req('./scripts/verify_packaged_sources').verifySources(sourceRoot,app);await req('./scripts/release_artifacts').verifyApplication(sourceRoot,process.platform==='darwin'?application:extracted,process.platform==='darwin'?'mac':'win',process.arch);
 await invoke('service:start','proxy');await eventually(async()=>assert((await getJson(`http://127.0.0.1:${health}/health`)).ok),'proxy listening');
 if(mode==='restart') {await invoke('fixture:seed');const t=performance.now();const r=await page.evaluate(async()=>{const i=require('electron').ipcRenderer;return Promise.all([i.invoke('service:stop','proxy'),i.invoke('service:start','proxy')]);});assert(r[0].clean&&r[0].exited&&r[1].running);results.push({stopStartMs:performance.now()-t});await eventually(async()=>assert((await getJson(`http://127.0.0.1:${health}/health`)).ok),'replacement ready');}
 if(mode==='busy'){
 const mc=req('minecraft-protocol');upstream=mc.createServer({host:'127.0.0.1',port:upstreamPort,'online-mode':false,version:'1.8.9',keepAlive:false});upstream.on('login',c=>{c.on('error',()=>{});c.write('login',{entityId:1,gameMode:0,dimension:0,difficulty:1,maxPlayers:8,levelType:'default',reducedDebugInfo:false});c.write('position',{x:0,y:80,z:0,yaw:0,pitch:0,flags:0});});player=mc.createClient({host:'127.0.0.1',port:direct,username:'Fixture',auth:'offline',version:'1.8.9',keepAlive:false});player.on('error',()=>{});let logged=false;player.on('login',()=>logged=true);await eventually(()=>assert(logged),'offline fixture login');player.write('chat',{message:'/rc Fixture synthetic'});await eventually(()=>assert(fs.existsSync(path.join(data,'recordings'))),'recording');
 }
 if(mode==='accounts'){
   for(const uuid of ['aaaaaaaaaaaa4aaaaaaaaaaaaaaaaaaa','bbbbbbbbbbbb4bbbbbbbbbbbbbbbbbbb']){
     await invoke('account:select',uuid);
     const history=await eventually(async()=>{const h=await invoke('state:get',{activePage:'sessions',historyContract:1});assert(!h.historyStale);assert.equal(h.accountKey,uuid);assert.equal(h.sessionHistory.version,1);const sessions=h.sessionHistory.history.sessions;assert(sessions.length);assert(sessions.every(s=>s.uuid===uuid));assert(!h.proxyHealth?.sessionHistory);return h;},'compact account isolation');
     const session=history.sessionHistory.history.sessions.find(s=>s.games.length);assert(session);const game=session.games[0];assert(!Object.hasOwn(game,'delta'));const detail=await invoke('history:detail',{revision:history.sessionHistory.revision,sessionId:session.id,gameId:game.id});assert(detail.ok||detail.error==='STALE_REVISION');
   }
   results.push({compactContract:1,accountIsolation:'PASS',detailStaleGuard:'PASS'});
 }
 // Verify before triggering the bounded drain, so hashing does not consume its budget.
 req('./scripts/verify_packaged_sources').verifySources(sourceRoot,app);await req('./scripts/release_artifacts').verifyApplication(sourceRoot,process.platform==='darwin'?application:extracted,process.platform==='darwin'?'mac':'win',process.arch);
 const pids=(await invoke('fixture:info')).pids;await invoke('fixture:seed');const history=await invoke('state:get',{activePage:'sessions'});assert(history);
 const quitting=performance.now();await invoke('window:control','close').catch(()=>{});ui.disconnect();ui=null;
 await eventually(()=>assert.notEqual(child.exitCode,null),'packaged launcher exit',15000);assert.equal(child.exitCode,0,logs);assert(fs.existsSync(extracted));for(const pid of pids)assert.throws(()=>process.kill(pid,0));
 const saved=JSON.parse(fs.readFileSync(path.join(data,'session_data.json')));assert(saved.sessions.some(s=>s.name==='Fixture'&&s.games.some(g=>g.result==='win')));for(const id of previous)assert(saved.sessions.some(s=>s.id===id),'previous distribution profile history lost');
 if(mode==='busy'){const recordings=fs.readdirSync(path.join(data,'recordings')).filter(f=>f.endsWith('.jsonl'));assert(recordings.length>0,'accepted recording output missing');for(const f of recordings)assert.equal(JSON.parse(fs.readFileSync(path.join(data,'recordings',f),'utf8').trim().split('\n').at(-1)).k,'footer');}
 assert.deepEqual(fs.readdirSync(launch),[]);
 results.push({mode,kind,launcherPid:child.pid,mainPid:info.pid,extracted,launchMs:ready-start,quitMs:performance.now()-quitting,sourceFiles:parity.runtimeFileCount,defaultAppData:info.appData,testData:data});fs.writeFileSync(path.join(root,kind+'-'+mode+'-results.json'),JSON.stringify(results,null,2));console.log(JSON.stringify(results,null,2));
}
let watchdog;
Promise.race([main(),new Promise((_,reject)=>{watchdog=setTimeout(()=>reject(Error('Packaged scenario exceeded 90 seconds')),90000);})]).catch(e=>{console.error(e);process.exitCode=1;}).finally(async()=>{clearTimeout(watchdog);connection?.ws.close();ui?.disconnect();player?.socket?.destroy();if(player)clearTimeout(player.closeTimer);if(upstream){for(const c of Object.values(upstream.clients)){c.socket?.destroy();clearTimeout(c.closeTimer);}upstream.socketServer.close();}for(const c of children)if(c.exitCode===null){if(process.platform==='win32')cp.spawnSync(path.join(process.env.SystemRoot,'System32/taskkill.exe'),['/PID',String(c.pid),'/T','/F'],{windowsHide:true,stdio:'ignore'});else {try{process.kill(-c.pid,'SIGKILL');}catch{}}}});

}
