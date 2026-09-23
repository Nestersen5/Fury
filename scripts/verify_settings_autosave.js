'use strict';
const assert=require('assert'),fs=require('fs'),os=require('os'),path=require('path'),puppeteer=require('puppeteer');
const {cleanEnvironment,unusedPorts,startChild,stopChild,assertRunning,eventually,uiTestArguments}=require('./smoke_packaged_app');
const target=require('./launcher_verification_target').verificationTarget('settings-autosave');
(async()=>{
 const root=path.resolve(__dirname,'..'),profile=fs.mkdtempSync(path.join(os.tmpdir(),'fury-dashboard-check-'));
 const output=target.output;fs.mkdirSync(output,{recursive:true});
 const [debugPort,cosmeticPort,blockedPort]=await unusedPorts(3),env=cleanEnvironment(profile,target.resources,cosmeticPort,blockedPort);if(!target.packaged)env.NODE_BINARY=process.execPath;
 const account={uuid:'a'.repeat(32),name:'Nestersen'};
 require('../src/reminders/rememberedAccount').createReminderAccountStore(path.join(profile,'launcher_data','reminders')).remember(account.uuid,account.name);
 fs.writeFileSync(path.join(profile,'session_data.json'),JSON.stringify({version:3,sessions:[{...account,id:'dashboard-test',startedAt:1788798600000,lastSeen:1788802980000,endedAt:1788802980000,summary:{stats:{Bedwars:{wins_bedwars:10,losses_bedwars:4,games_played_bedwars:14,final_kills_bedwars:24}}},games:[{id:"game-1",at:1788802980000,mode:"BEDWARS",result:"win",durationMs:300000,delta:{stats:{Bedwars:{wins_bedwars:1}}}}]}]}));
 const child=startChild(target.executable,[...target.args,...uiTestArguments(),`--remote-debugging-port=${debugPort}`,'--remote-debugging-address=127.0.0.1','--disable-backgrounding-occluded-windows','--disable-renderer-backgrounding',`--proxy-server=${env.HTTPS_PROXY}`],env,'Dashboard connection verification');
 let browser;
 try{
  browser=await eventually(async()=>{assertRunning(child);return puppeteer.connect({browserURL:`http://127.0.0.1:${debugPort}`,defaultViewport:null});},'Connecting launcher');
  const page=await eventually(async()=>{const p=(await browser.pages()).find(p=>p.url().endsWith('/launcher.html'));assert(p);return p;},'Opening launcher');
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.waitForFunction('typeof furyDesign !== "undefined" && furyDesign && state?.viewedAccount');

  await page.evaluate("activatePage('settings')");
  await page.evaluate(async()=>{
    window.saveTestInvoke=ipcRenderer.invoke.bind(ipcRenderer);
    window.saveTestCalls=[];
    ipcRenderer.invoke=async(channel,...args)=>{
      if(channel==='settings:save-patch'){
        saveTestCalls.push(structuredClone(args[0]));
        if(window.failSaveTest)throw new Error('Fixture save failure');
      }
      return saveTestInvoke(channel,...args);
    };
  });
  const edit=async(id,value,commit=true)=>page.evaluate(({id,value,commit})=>{
    const el=document.getElementById(id);el.focus();el.value=value;
    el.dispatchEvent(new Event('input',{bubbles:true}));
    if(commit)el.dispatchEvent(new Event('change',{bubbles:true}));
  },{id,value,commit});
  const settled=async()=>{await page.evaluate(async()=>{await ordinarySaveChain;});await page.waitForFunction('!settingsSaveInFlight && !refreshInFlight');await page.evaluate(async()=>{await refresh();renderSettingsSaveState();});};
  await edit('key-hypixel','unfinished-key',false);
  await edit('min-fkdr','7.5');await settled();
  assert.equal(await page.evaluate('state.settings.scan.minFkdr'),7.5);
  assert.notEqual(await page.evaluate('state.settings.keys.hypixel'),'unfinished-key');
  assert.equal(await page.$eval('#key-hypixel',e=>e.value),'unfinished-key');
  assert.deepEqual(await page.evaluate('saveTestCalls[0]'),{scan:{minFkdr:7.5}});
  await edit('key-hypixel','committed-key');await settled();
  assert.equal(await page.evaluate('state.settings.keys.hypixel'),'committed-key');
  await edit('min-fkdr','-1');
  assert.equal(await page.evaluate('state.settings.scan.minFkdr'),7.5);
  assert.equal(await page.$eval('.fury-autosaved',e=>e.textContent),'Check value');
  await edit('min-fkdr','8');await settled();
  await page.evaluate('window.failSaveTest=true');
  await edit('min-stars','501');await settled();
  assert.equal(await page.$eval('.fury-autosaved',e=>e.textContent),'Couldn\u2019t save');
  await page.evaluate('window.failSaveTest=false');
  await edit('min-stars','502');await settled();
  await edit('proxy-direct-host','example.com');await settled();
  assert.equal(await page.evaluate('state.settings.server.proxyDirectHost'),'example.com');
  await edit('proxy-direct-host','bad/host');await settled();
  assert.equal(await page.evaluate('state.settings.server.proxyDirectHost'),'example.com');
  await edit('proxy-direct-host','mc.hypixel.net');await settled();
  await page.evaluate(()=>{
    document.getElementById('network-safe-defaults').click();
  });await settled();
  assert.equal(await page.evaluate('state.settings.server.proxyDirectPort'),25565);
  assert(await page.$eval('#save-settings',e=>!e.checkVisibility()));
  assert.equal(await page.$('.fury-api-save'),null);
  await page.evaluate(()=>{
    const el=ids.autoSkinDenickEnabled;el.checked=!el.checked;el.dispatchEvent(new Event('change',{bubbles:true}));
  });
  await page.waitForFunction('!featureSaveTimer && !featureSaveInFlight');
  await page.evaluate('renderSettingsSaveState()');
  assert.equal(await page.$eval('.fury-autosaved',e=>e.textContent),'Saved');

  // A text draft must not leak into another feature's automatic save.
  await edit('auto-dodge-min-fkdr','123',false);
  const savedThreshold=await page.evaluate('state.settings.features.autoDodgeMinFkdr');
  await page.evaluate(()=>{ids.autoSkinDenickEnabled.checked=!ids.autoSkinDenickEnabled.checked;ids.autoSkinDenickEnabled.dispatchEvent(new Event('change',{bubbles:true}));});
  await page.waitForFunction('!featureSaveTimer && !featureSaveInFlight');
  assert.equal(await page.evaluate('state.settings.features.autoDodgeMinFkdr'),savedThreshold);
  await edit('auto-dodge-min-fkdr',String(savedThreshold));
  await page.waitForFunction('!featureSaveTimer && !featureSaveInFlight');
  // Exercise the actual child lifecycle; no Minecraft client is connected.
  await page.evaluate(async()=>{await ipcRenderer.invoke('service:start','proxy');await refresh();});
  await page.waitForFunction('state.services.proxy.running');
  const oldPid=await page.evaluate('state.services.proxy.pid');
  await edit('proxy-direct-host','example.com');await settled();
  assert.equal(await page.$eval('.fury-autosaved',e=>e.textContent),'Saved — restart proxy to apply');
  assert.equal(await page.$eval('#connection-restart',e=>e.hidden),false);
  await page.evaluate(()=>document.getElementById('connection-restart').click());
  await page.waitForFunction('!settingsSaveStates.has("restart") && state.services.proxy.running && !state.services.proxy.restartRequired');
  assert.notEqual(await page.evaluate('state.services.proxy.pid'),oldPid);
  await page.evaluate(async()=>{await ipcRenderer.invoke('service:stop','proxy');});
  assert.deepEqual(errors,[]);
  console.log('PASS autosave field isolation, thresholds, keys, invalid values, failure/retry, network reset, feature saves and restart status');
 target.record();
 }finally{if(browser)await browser.disconnect();await stopChild(child);}
})().catch(e=>{console.error(e);process.exitCode=1;});
