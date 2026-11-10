'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');

module.exports=async function({page,output}){
 const checks=[],check=(name,condition)=>{assert(condition,name);checks.push(name);console.log('PASS '+name);};
 await page.evaluate(()=>{clearTimeout(refreshTimer);NesterTheme.applyMotion(true,false);activatePage('dashboard');});
 await page.waitForFunction(()=>!refreshInFlight&&!featureSaveInFlight&&!featureSaveTimer&&!settingsSaveInFlight);
 const metrics=await page.evaluate(()=>{
  const next=JSON.parse(JSON.stringify(state)),latest=next.sessionHistory.sessions[0];
  const read=()=>Object.fromEntries([...document.querySelectorAll('.da-session-metrics>div')].map(n=>[n.firstChild.textContent,n.lastChild.textContent]));
  latest.modes=[{mode:'BEDWARS',games:5,wins:4,finals:24,finalDeaths:4,beds:9}];designA.update(next);const bedwars=read();
  latest.modes.push({mode:'SKYWARS',games:1,wins:1,kills:3,deaths:2});designA.update(next);const mixed=read();
  latest.modes[0].finals=null;designA.update(next);const partial=read();
  latest.modes.shift();designA.update(next);const skywars=read();
  latest.modes=[{mode:'BEDWARS',games:1,wins:0,finals:0,finalDeaths:0,beds:0}];designA.update(next);const zero=read();
  designA.update(state);return{bedwars,mixed,partial,skywars,zero};
 });
 check('Mixed sessions keep known BedWars finals, FKDR and beds',metrics.mixed['Final kills']==='24'&&metrics.mixed.FKDR==='6.00'&&metrics.mixed['Beds broken']==='9'&&metrics.mixed.Wins==='5');
 check('Unknown applicable stats stay unknown; SkyWars does not invent BedWars stats',metrics.partial['Final kills']==='—'&&metrics.partial.FKDR==='—'&&metrics.skywars['Final kills']==='—'&&metrics.skywars.Wins==='1');
 check('Known zero BedWars stats remain visible',metrics.zero['Final kills']==='0'&&metrics.zero.FKDR==='0.00'&&metrics.zero['Beds broken']==='0');
 check('Fresh launcher and game-prefix accents agree',await page.evaluate(()=>getComputedStyle(document.documentElement).getPropertyValue('--accent').trim()==='#0022cc'&&state.settings.features.chatPrefixAccentHex==='#0022cc'));

 async function holdSave(tabEnabled){
  await page.evaluate(tabEnabled=>{
   const previous=ipcRenderer.invoke;window.featureReliability={previous,calls:[],held:false};
   const held=new Promise(resolve=>window.featureReliability.release=resolve);
   ipcRenderer.invoke=async function(channel,...args){
    window.featureReliability.calls.push(channel);
    const result=await previous.call(this,channel,...args);
    if(channel==='settings:save-features'&&!window.featureReliability.held){window.featureReliability.held=true;await held;}
    return result;
   };
   ids.tabStatsEnabled.checked=tabEnabled;window.featureReliability.first=saveFeatureControlsNow();
  },tabEnabled);
  await page.waitForFunction(()=>window.featureReliability.held);
 }
 const own=async()=>{
  await holdSave(true);
  return page.evaluate(async()=>{
   try{
    ids.enderDustReminderEnabled.checked=true;void saveFeatureControlsNow();
    const applying=applyLauncherProfile('chill');
    await new Promise(resolve=>setTimeout(resolve,40));
    const blocked={profileCalls:window.featureReliability.calls.filter(x=>x==='profiles:apply').length,disabled:ids.tabStatsEnabled.disabled};
    window.featureReliability.release();await applying;await refresh();
    return{blocked,saved:require('./app_config').loadFeatureSettings().tabStatsEnabled,displayed:ids.tabStatsEnabled.checked,disabled:ids.tabStatsEnabled.disabled,calls:window.featureReliability.calls};
   }finally{window.featureReliability.release();ipcRenderer.invoke=window.featureReliability.previous;}
  });
 };
 const ownResult=await own();
 await page.waitForFunction(()=>!refreshInFlight&&!profileApplyInFlight&&!featureSaveInFlight);
 Object.assign(ownResult,await page.evaluate(()=>({displayed:ids.tabStatsEnabled.checked,disabled:ids.tabStatsEnabled.disabled})));
 check('Profile application waits for the outstanding save and queued follow-up',ownResult.blocked.profileCalls===0&&ownResult.blocked.disabled&&ownResult.calls.filter(x=>x==='settings:save-features').length===2);
 check('A successfully applied profile stays applied and controls recover',ownResult.saved===false&&ownResult.displayed===false&&!ownResult.disabled);

 await holdSave(false);
 const external=await page.evaluate(async()=>{
  try{
   ids.enderDustReminderEnabled.checked=false;void saveFeatureControlsNow();
   ids.autoDodgeMinFkdr.value='';ids.autoDodgeMinFkdr.dispatchEvent(new Event('input',{bubbles:true}));
   // Bypass the renderer queue to model a profile applied from the game.
   await window.featureReliability.previous.call(ipcRenderer,'profiles:apply','normal-sweaty');
   const before=require('./app_config').loadFeatureSettings().tabStatsEnabled;
   window.featureReliability.release();await window.featureReliability.first;await refresh();
   return{before,after:require('./app_config').loadFeatureSettings().tabStatsEnabled,displayed:ids.tabStatsEnabled.checked,queued:featureSaveQueued};
  }finally{window.featureReliability.release();ipcRenderer.invoke=window.featureReliability.previous;}
 });
 await page.waitForFunction(()=>!refreshInFlight&&!featureSaveInFlight);
 external.displayed=await page.evaluate(()=>ids.tabStatsEnabled.checked);
 external.staleDraftStatus=await page.evaluate(()=>settingsSaveStates.get(ids.autoDodgeMinFkdr.id)||null);
 fs.writeFileSync(path.join(output,'external-profile.json'),JSON.stringify(external,null,2));
 check('An externally applied profile rejects older queued form saves and restores valid controls',external.before===true&&external.after===true&&external.displayed===true&&!external.queued&&!external.staleDraftStatus);

 await page.evaluate(()=>{
  const previous=ipcRenderer.invoke;window.profileReliability={previous,held:false,revision:renderedProfileRevision};
  const held=new Promise(resolve=>window.profileReliability.release=resolve);
  ipcRenderer.invoke=async function(channel,...args){const result=await previous.call(this,channel,...args);if(channel==='profiles:apply'){window.profileReliability.held=true;await held;}return result;};
  window.profileReliability.operation=applyLauncherProfile('chill');
 });
 await page.waitForFunction(()=>window.profileReliability.held);
 const suspended=await page.evaluate(async()=>{
  try{await refresh();return{disabled:ids.tabStatsEnabled.disabled,unchangedRevision:renderedProfileRevision===window.profileReliability.revision};}
  finally{window.profileReliability.release();}
 });
 await page.evaluate(async()=>{try{await window.profileReliability.operation;}finally{ipcRenderer.invoke=window.profileReliability.previous;}});
 await page.waitForFunction(()=>!refreshInFlight&&!profileApplyInFlight);
 check('Refreshes during profile application keep controls suspended until the accepted settings render',suspended.disabled&&suspended.unchangedRevision&&await page.evaluate(()=>!ids.tabStatsEnabled.disabled&&!ids.tabStatsEnabled.checked));

 const stalePatch=await page.evaluate(async()=>{
  const old=renderedProfileRevision;await ipcRenderer.invoke('profiles:apply','chill');
  const reply=await ipcRenderer.invoke('settings:save-patch',{scan:{minStars:1},expectedProfileRevision:old});
  await refresh();return{rejected:reply.profileChanged,stars:require('./app_config').loadScanSettings().minStars};
 });
 check('Scan patches from before a profile change cannot overwrite its thresholds',stalePatch.rejected===true&&stalePatch.stars!==1);

 const timer=await page.evaluate(async()=>{
  ids.tabStatsEnabled.checked=true;scheduleFeatureAutoSave({currentTarget:ids.tabStatsEnabled});
  await applyLauncherProfile('chill');await refresh();
  return{saved:require('./app_config').loadFeatureSettings().tabStatsEnabled,displayed:ids.tabStatsEnabled.checked,pending:!!featureSaveTimer};
 });
 await page.waitForFunction(()=>!refreshInFlight&&!profileApplyInFlight&&!featureSaveInFlight);
 timer.displayed=await page.evaluate(()=>ids.tabStatsEnabled.checked);
 check('Profile application flushes scheduled saves as well as in-flight saves',timer.saved===false&&timer.displayed===false&&!timer.pending);

 const failed=await page.evaluate(async()=>{
  const previous=ipcRenderer.invoke;let applies=0;
  ipcRenderer.invoke=async function(channel,...args){if(channel==='settings:save-features')throw Error('Fixture settings save failed');if(channel==='profiles:apply')applies++;return previous.call(this,channel,...args);};
  try{await saveFeatureControlsNow();await applyLauncherProfile('normal-sweaty');return{applies,disabled:ids.tabStatsEnabled.disabled,status:document.getElementById('save-status').textContent};}
  finally{ipcRenderer.invoke=previous;}
 });
 check('Failed pending saves stop profile application and restore its controls',failed.applies===0&&!failed.disabled&&failed.status.includes('current settings edits'));
 await page.evaluate(async()=>{await saveFeatureControlsNow();await refresh();});

 const colors=await page.evaluate(async()=>{
  await ipcRenderer.invoke('settings:save-chat-prefix-accent','#a66bea');
  await ipcRenderer.invoke('settings:save-features',{features:{quickMathsEnabled:false}});
  return require('./app_config').loadFeatureSettings().chatPrefixAccentHex;
 });
 check('Existing saved accents and legacy settings callers stay supported',colors==='#a66bea');
 await page.reload({waitUntil:'domcontentloaded'});
 await page.waitForFunction(()=>typeof state!=='undefined'&&state?.settings?.features);
 check('Explicit in-game accent preference survives a renderer reload',await page.evaluate(()=>state.settings.features.chatPrefixAccentHex==='#a66bea'));
 fs.writeFileSync(path.join(output,'feature-reliability.json'),JSON.stringify({checks,metrics,ownResult,external,stalePatch,timer,failed},null,2));
};
