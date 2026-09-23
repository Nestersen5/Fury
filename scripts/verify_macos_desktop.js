'use strict';
// Isolated CI acceptance only. Never included in a production application.
const fs=require('fs'),os=require('os'),path=require('path'),cp=require('child_process'),net=require('net'),assert=require('assert/strict');
const {cleanEnvironment,unusedPorts,eventually,getJson,packagePaths}=require('./smoke_packaged_app');
const {payloadInventory,assertPayloadParity}=require('./release_artifacts');
const puppeteer=require('puppeteer'),WS=require('ws');
const results=[],children=[],connections=[],root=fs.mkdtempSync(path.join(os.tmpdir(),'fury-native-desktop-'));
const canonical=path.join(os.homedir(),'Library','Application Support','Fury');
let ownsCanonical=false;
function record(name,status,detail){results.push({name,status,...detail});console.log(name+': '+status);}
async function probe(name,fn){try{record(name,'PASS',await fn());}catch(e){record(name,'FAIL',{error:e.message});process.exitCode=1;}}
async function cdp(url){const ws=new WS(url);await new Promise((r,j)=>{ws.once('open',r);ws.once('error',j)});let id=0;const pending=new Map(),events=new Map();ws.on('message',b=>{const m=JSON.parse(b);if(m.id){const p=pending.get(m.id);pending.delete(m.id);m.error?p?.reject(Error(m.error.message)):p?.resolve(m.result);}else events.get(m.method)?.(m.params)});return{ws,events,call(method,params={}){return new Promise((resolve,reject)=>{pending.set(++id,{resolve,reject});ws.send(JSON.stringify({id,method,params}));})}};}
async function start(application){
 const [debug,inspect,cosmetic,blocked,direct,failover,health]=await unusedPorts(7);
 if(!fs.existsSync(canonical)){assert(ownsCanonical);fs.mkdirSync(canonical,{recursive:true});}
 fs.writeFileSync(path.join(canonical,'server_config.json'),JSON.stringify({proxyDirectPort:direct,proxyFailoverPort:failover,healthPort:health}));
 const featureFile=path.join(canonical,'features_config.json');
 const features=fs.existsSync(featureFile)?JSON.parse(fs.readFileSync(featureFile)):{};
 fs.writeFileSync(featureFile,JSON.stringify({...features,apiKillSwitchEnabled:true,autoSkinDenickEnabled:false}));
 const env=cleanEnvironment(canonical,'invalid-resource-override',cosmetic,blocked);delete env.FURY_DATA_DIR;
 const executable=packagePaths(application).executable;
 const child=cp.spawn(executable,[`--inspect-brk=127.0.0.1:${inspect}`,`--remote-debugging-port=${debug}`,'--remote-debugging-address=127.0.0.1',`--proxy-server=${env.HTTPS_PROXY}`],{cwd:root,env,detached:true,stdio:['ignore','pipe','pipe']});children.push(child);let log='';child.stdout.on('data',b=>log+=b);child.stderr.on('data',b=>log+=b);
 const target=await eventually(async()=>{assert.equal(child.exitCode,null,log);return(await getJson(`http://127.0.0.1:${inspect}/json/list`))[0]},'Main inspector',45000);
 const conn=await cdp(target.webSocketDebuggerUrl);connections.push(conn);await conn.call('Debugger.enable');const paused=new Promise(r=>conn.events.set('Debugger.paused',r));await conn.call('Runtime.runIfWaitingForDebugger');const frame=(await paused).callFrames[0].callFrameId;
 const evaluate=async expression=>{const r=await conn.call('Debugger.evaluateOnCallFrame',{callFrameId:frame,expression,returnByValue:true});assert(!r.exceptionDetails,JSON.stringify(r.exceptionDetails));return r.result.value;};
 await evaluate(`(()=>{const e=require('electron'),cp=require('child_process');e.shell.openExternal=async()=>{throw Error('External navigation disabled in isolated acceptance')};require('prismarine-auth').Authflow.prototype.getMinecraftJavaToken=async()=>{throw Error('Real auth disabled in isolated acceptance')};const spawn=cp.spawn;globalThis.diagOwned=[];cp.spawn=(...a)=>{const c=spawn(...a);if(c.pid)diagOwned.push(c.pid);return c};const fork=cp.fork;cp.fork=(file,...a)=>{if(file.endsWith('launcher_auth_worker.js'))throw Error('Real sign-in disabled');return fork(file,...a)};e.ipcMain.handle('diagnostic:desktop',(_event,action)=>{const w=e.BrowserWindow.getAllWindows().find(x=>x.webContents.getURL().endsWith('/launcher.html'));function roles(menu){return(menu?.items||[]).flatMap(i=>[{role:i.role,label:i.label,accelerator:i.accelerator},...roles(i.submenu)])}function item(menu,role){for(const i of menu?.items||[]){if(i.role===role)return i;const found=item(i.submenu,role);if(found)return found}}if(action==='minimize')w.minimize();if(action==='hide')e.app.hide();if(action==='show'){e.app.show();w.restore();w.show();w.focus()}if(action==='close')w.close();if(action==='quit')e.app.quit();if(action?.startsWith('role:')){const i=item(e.Menu.getApplicationMenu(),action.slice(5));if(!i)throw Error('Native menu role missing: '+action);e.app.show();w.show();w.focus();e.Menu.sendActionToFirstResponder(action==='role:close'?'performClose:':'terminate:')}return{pid:process.pid,packaged:e.app.isPackaged,root:require('./src/storage/runtimePaths').getDataDir(),userData:e.app.getPath('userData'),hidden:e.app.isHidden(),minimized:w?.isMinimized(),visible:w?.isVisible(),menu:roles(e.Menu.getApplicationMenu()),pids:diagOwned}});return true})()`);
 await conn.call('Debugger.resume');conn.ws.close();
 const ui=await eventually(()=>puppeteer.connect({browserURL:`http://127.0.0.1:${debug}`,defaultViewport:null}),'renderer');connections.push(ui);
 const page=await eventually(async()=>{const p=(await ui.pages()).find(p=>p.url().endsWith('/launcher.html'));assert(p);return p;},'Fury page');await page.waitForFunction('typeof furyDesign!=="undefined" && !!furyDesign');
 const invoke=(channel,...args)=>page.evaluate((c,a)=>require('electron').ipcRenderer.invoke(c,...a),channel,args);
 const state=()=>invoke('diagnostic:desktop','state');
 return{child,ui,page,invoke,state,env,application,ports:{direct,failover,health,cosmetic},log:()=>log};
}
async function secondary(primary,application){const c=cp.spawn(packagePaths(application).executable,[],{cwd:root,env:primary.env,detached:true,stdio:'ignore'});children.push(c);await eventually(()=>assert.notEqual(c.exitCode,null),'secondary exits',10000);assert.equal(c.exitCode,0);assert.equal(primary.child.exitCode,null);return c;}
async function quit(p,action){const s=await p.state();const t=performance.now();await p.invoke('diagnostic:desktop',action).catch(()=>{});await eventually(()=>assert.notEqual(p.child.exitCode,null),'F7 exit',7000);assert.equal(p.child.exitCode,0,p.log());for(const pid of s.pids)assert.throws(()=>process.kill(pid,0));p.ui.disconnect();return{milliseconds:performance.now()-t};}
async function connection(host,port){return new Promise(resolve=>{const s=net.connect({host,port});s.once('connect',()=>{s.destroy();resolve(true)});s.once('error',()=>resolve(false));s.setTimeout(1500,()=>{s.destroy();resolve(false)});});}
async function main(){
 assert.equal(process.platform,'darwin');assert.equal(process.env.GITHUB_ACTIONS,'true','Fresh ephemeral CI host required');assert(!fs.existsSync(canonical),'Refuse to touch an existing default Fury profile');ownsCanonical=true;
 const [zipApp,dmgApp,report]=process.argv.slice(2);assert(zipApp&&dmgApp&&report);
 const before=await Promise.all([zipApp,dmgApp].map(app=>payloadInventory(app)));
 assertPayloadParity(before[0],before[1]);
 const machine=cp.execFileSync('/usr/bin/uname',['-m'],{encoding:'utf8'}).trim();let hardware;try{hardware=cp.execFileSync('/usr/sbin/sysctl',['-n','hw.optional.arm64'],{encoding:'utf8',stdio:['ignore','pipe','ignore']}).trim()}catch{assert.equal(process.arch,'x64');assert.equal(machine,'x86_64');hardware='0'}let translated='0';try{translated=cp.execFileSync('/usr/sbin/sysctl',['-in','sysctl.proc_translated'],{encoding:'utf8',stdio:['ignore','pipe','ignore']}).trim()||'0'}catch{}
 if(process.arch==='x64')assert(cp.execFileSync('/usr/bin/uname',['-v'],{encoding:'utf8'}).includes('RELEASE_X86_64'),'Native Intel kernel required');assert.equal(translated,'0','Rosetta is not native acceptance');assert.equal(hardware,process.arch==='arm64'?'1':'0');
 for(const [index,apps] of [[zipApp,dmgApp],[dmgApp,zipApp]].entries()){
  if(index){assert(ownsCanonical);assert.equal(fs.realpathSync(canonical),canonical);fs.renameSync(canonical,path.join(root,'first-direction-profile'));}
  const direction=index?'DMG -> ZIP':'ZIP -> DMG';let p=await start(apps[0]);
  await probe(direction+' default storage',async()=>{const s=await p.state();assert(s.packaged);assert.equal(s.root,canonical);assert.equal(s.userData,path.join(canonical,'launcher_data'));return{root:s.root,userData:s.userData}});
  await p.invoke('service:start','proxy');await eventually(async()=>assert((await getJson(`http://127.0.0.1:${p.ports.health}/health`)).ok),'proxy ready');
  await probe(direction+' local listeners and LAN rejection',async()=>{const lan=Object.values(os.networkInterfaces()).flat().filter(i=>i.family==='IPv4'&&!i.internal);for(const port of [p.ports.direct,p.ports.failover]){for(const host of ['127.0.0.1','localhost','::1'])assert(await connection(host,port),host);for(const i of lan)assert(!await connection(i.address,port),'LAN listener reachable')}return{lanInterfaces:lan.length}});
  await probe(direction+' paired secondary',async()=>{await secondary(p,apps[1]);return{secondaryExited:true}});
  await probe(direction+' rapid double launch',async()=>{await Promise.all([secondary(p,apps[0]),secondary(p,apps[1])]);return{owner:(await p.state()).pid}});
  await p.invoke('diagnostic:desktop','minimize');await eventually(async()=>assert((await p.state()).minimized),'minimized');
  await probe(direction+' minimize preserves proxy',async()=>{assert.equal(p.child.exitCode,null);assert((await getJson(`http://127.0.0.1:${p.ports.health}/health`)).ok);return{}});
  await probe(direction+' secondary restores minimized',async()=>{await secondary(p,apps[1]);await eventually(async()=>{const s=await p.state();assert(!s.minimized&&s.visible&&!s.hidden)},'restore',5000);return{}});
  await p.invoke('diagnostic:desktop','hide');await eventually(async()=>assert((await p.state()).hidden),'hidden');
  await probe(direction+' Hide preserves proxy',async()=>{assert((await getJson(`http://127.0.0.1:${p.ports.health}/health`)).ok);return{}});
  await probe(direction+' secondary reveals hidden',async()=>{await secondary(p,apps[1]);await eventually(async()=>{const s=await p.state();assert(!s.hidden&&s.visible)},'unhide',5000);return{}});
  await p.invoke('diagnostic:desktop','show');await p.invoke('diagnostic:desktop','hide');
  await probe(direction+' LaunchServices activation of hidden app',async()=>{cp.execFileSync('/usr/bin/open',['-a',apps[0]],{timeout:10000});await eventually(async()=>{const s=await p.state();assert(!s.hidden&&s.visible)},'activation',5000);return{physicalDockClickTested:false}});
  await p.invoke('diagnostic:desktop','show');
  await p.page.evaluate(()=>window.dispatchEvent(new CustomEvent('fury:accent-change',{detail:{color:'#345678'}})));
  const state=await p.state();record(direction+' native menu inspection','PASS',{menu:state.menu});
  await probe(direction+' native window close',()=>quit(p,'close'));
  if(p.child.exitCode===null)await quit(p,'quit');
  p=await start(apps[1]);
  await probe(direction+' persisted preference interoperability',async()=>{const f=JSON.parse(fs.readFileSync(path.join(canonical,'features_config.json')));assert.equal(f.chatPrefixAccentHex,'#345678');return{}});
  await probe(direction+' native menu Close role',()=>quit(p,'role:close'));
  if(p.child.exitCode===null)await quit(p,'quit');
  p=await start(apps[1]);await probe(direction+' native menu Quit role',()=>quit(p,'role:quit'));if(p.child.exitCode===null)await quit(p,'quit');
 }
 for(const [i,app] of [zipApp,dmgApp].entries())assertPayloadParity(before[i],await payloadInventory(app));
 record('Both application bundles unchanged','PASS',{});
 fs.writeFileSync(report,JSON.stringify({platform:process.platform,arch:process.arch,hardwareArm64:hardware,rosetta:translated,defaultProfileTested:true,physicalKeyboardDockTested:false,results},null,2));
}
function stopOwnedChildren(){for(const child of children)if(child.exitCode===null){try{process.kill(-child.pid,'SIGKILL')}catch{}}}
let timer=setTimeout(()=>{console.error('Native desktop acceptance deadline');stopOwnedChildren();process.exit(2)},300000);timer.unref();
main().catch(e=>{console.error(e.stack);process.exitCode=1}).finally(async()=>{clearTimeout(timer);for(const c of connections){c.ws?.close();c.disconnect?.()}for(const child of children)if(child.exitCode===null){try{process.kill(-child.pid,'SIGKILL')}catch{}}const report=process.argv[4];if(report&&!fs.existsSync(report))fs.writeFileSync(report,JSON.stringify({incomplete:true,results},null,2));});
