'use strict';
// Isolated verification only. No live credentials, proxy start, or production data writes.
const assert=require('node:assert/strict'),fs=require('fs'),path=require('path'),os=require('os');
const puppeteer=require('puppeteer'),h=require('./smoke_packaged_app');
const workspace=path.resolve(__dirname,'..'),root=process.env.UI_AUDIT_ROOT||workspace,phase=process.argv[2]||'baseline',out=path.join(workspace,'output/consistency-implementation',phase);
const delay=ms=>new Promise(r=>setTimeout(r,ms));
async function boot(){
 fs.mkdirSync(out,{recursive:true});const profile=fs.mkdtempSync(path.join(os.tmpdir(),'fury-consistency-fix-'));
 const [debug,cosmetic,blocked,direct,failover,health]=await h.unusedPorts(6),env=h.cleanEnvironment(profile,root,cosmetic,blocked);env.NODE_BINARY=process.execPath;
 fs.writeFileSync(path.join(profile,'features_config.json'),JSON.stringify({...require('../src/session/settings').SESSION_DEFAULTS,apiKillSwitchEnabled:true,gameRecapEnabled:true,sessionGoalWins:10,sessionRecapStyle:'compact'}));
 fs.writeFileSync(path.join(profile,'server_config.json'),JSON.stringify({proxyDirectPort:direct,proxyFailoverPort:failover,healthPort:health,proxyDirectHost:'mc.hypixel.net',proxyFailoverHost:'hypixel.fast'}));
 const large=phase==='history-large'?JSON.parse(fs.readFileSync(path.join(root,'session_data.json'),'utf8')):null;
 const largest=large&&Object.values(large.sessions.reduce((groups,s)=>{(groups[s.uuid]??=[]).push(s);return groups;},{})).sort((a,b)=>b.length-a.length)[0][0];
 const account=largest?{uuid:largest.uuid,name:largest.name}:{uuid:'a'.repeat(32),name:'ExampleAccount'},store=require('../src/reminders/rememberedAccount').createReminderAccountStore(path.join(profile,'launcher_data/reminders'));store.remember(account.uuid,account.name);
 const auth=path.join(profile,'auth_tokens',account.name);fs.mkdirSync(auth,{recursive:true});const token='fixture.'+Buffer.from(JSON.stringify({profiles:{mc:account.uuid},pfd:[{type:'mc',id:account.uuid,name:account.name}]})).toString('base64url')+'.fixture';fs.writeFileSync(path.join(auth,'fixture_mca-cache.json'),JSON.stringify({mca:{access_token:token,obtainedOn:Date.now(),expires_in:86400}}));
 const start=1788798600000,end=start+4380000;
 const stats={Bedwars:{wins_bedwars:10,losses_bedwars:4,games_played_bedwars:14,final_kills_bedwars:24,final_deaths_bedwars:4,kills_bedwars:24,deaths_bedwars:31,beds_broken_bedwars:9,beds_lost_bedwars:4,Experience:3200}};
 fs.writeFileSync(path.join(profile,'session_data.json'),JSON.stringify(large||{version:3,sessions:[{...account,id:'fixture-0',startedAt:start,lastSeen:end,endedAt:end,summary:{stats},games:[{id:'game-0',at:end,mode:'BEDWARS',result:'win',durationMs:300000,delta:{stats:{Bedwars:{wins_bedwars:1}}}}]}]}));
 fs.writeFileSync(path.join(profile,'denicked.json'),JSON.stringify([{realIGN:'ExamplePlayer',nicks:['ExampleNick'],methods:['skin'],firstSeen:'2026-09-01T12:00:00Z',lastSeen:'2026-09-07T14:30:00Z',events:[{at:'2026-09-07T14:30:00Z',nick:'ExampleNick',method:'skin'}]}]));
 const child=h.startChild(require('electron'),[root,`--remote-debugging-port=${debug}`,'--remote-debugging-address=127.0.0.1','--disable-backgrounding-occluded-windows','--disable-renderer-backgrounding',`--proxy-server=${env.HTTPS_PROXY}`],env,'UI consistency verification');
 let browser;
 try{
  browser=await h.eventually(async()=>{h.assertRunning(child);return puppeteer.connect({browserURL:`http://127.0.0.1:${debug}`,defaultViewport:null});},'Connect');
  const page=await h.eventually(async()=>{const p=(await browser.pages()).find(p=>p.url().endsWith('/launcher.html'));assert(p);return p;},'Renderer');
  await page.evaluateOnNewDocument(()=>{
   window.__uiAudit={observerCallbacks:0,observerRecords:0,longTasks:[],ipc:[],renders:{}};
   const Native=window.MutationObserver;
   window.MutationObserver=class extends Native{constructor(callback){super((records,observer)=>{window.__uiAudit.observerCallbacks++;window.__uiAudit.observerRecords+=records.length;callback(records,observer);});}};
   new PerformanceObserver(list=>window.__uiAudit.longTasks.push(...list.getEntries().map(e=>({start:e.startTime,duration:e.duration})))).observe({type:'longtask',buffered:true});
  });
  await page.reload({waitUntil:'domcontentloaded'});await page.setViewport({width:1440,height:900,deviceScaleFactor:1});
  await page.waitForFunction('typeof furyDesign!=="undefined" && state?.profiles?.profiles?.length>0');
  await page.evaluate("NesterTheme.apply('dark',false);NesterTheme.applyAccent('sun',false);NesterTheme.applyMotion(true,false);localStorage.setItem('fury-onboarded:'+state.viewedAccount.key,'yes')");
  await page.evaluate('refresh()');await delay(400);await page.evaluate('clearTimeout(refreshTimer);FuryNotifications.dismissAll()');
  await page.evaluate(()=>{
   window.__originalInvoke=ipcRenderer.invoke.bind(ipcRenderer);
   ipcRenderer.invoke=async(channel,...args)=>{const result=await window.__originalInvoke(channel,...args);window.__uiAudit.ipc.push({channel,argsKeys:args.map(a=>a&&typeof a==='object'?Object.keys(a).sort():typeof a),resultKeys:result&&typeof result==='object'?Object.keys(result).sort():typeof result});return result;};
   for(const name of ['renderTabStatsEditor','renderOverlay','renderNametagPreview']){const original=window[name];if(typeof original==='function')window[name]=function(...args){window.__uiAudit.renders[name]=(window.__uiAudit.renders[name]||0)+1;return original.apply(this,args);};}
   const preview=require('./src/launcher/renderer/launcher_ingame_appearance'),render=preview.renderTab;preview.renderTab=function(...args){window.__uiAudit.renders.renderTab=(window.__uiAudit.renders.renderTab||0)+1;return render.apply(this,args);};
  });
  return{browser,page,child,profile};
 }catch(e){if(browser)await browser.disconnect();await h.stopChild(child);throw e;}
}
const overlayFixture=`clearTimeout(refreshTimer);activatePage('overlay');clearTimeout(refreshTimer);overlayState.orders.BEDWARS=['fkdr','wlr','ws','ping'];overlayState.view='teams';overlayState.modePreference='AUTO';overlayTableSignature='';renderOverlay({connected:true,gameActive:true,currentGamemode:'BEDWARS',gameSessionId:'review-16',overlayPlayers:Array.from({length:16},(_,i)=>({name:'Player_'+String(i+1).padStart(2,'0'),mode:'BEDWARS',team:{name:['Red','Blue','Green','Yellow'][Math.floor(i/4)],letter:['R','B','G','Y'][Math.floor(i/4)],colorName:['red','blue','green','yellow'][Math.floor(i/4)]},stats:{stars:300+i,fkdr:6.5,wlr:2.5,wins:18117,finals:55004,beds:24269,ws:100},tags:[]}))});`;
async function performanceChecks(page){
 const cdp=await page.createCDPSession();await cdp.send('Performance.enable');
 const result={rounds:5,iterations:12,workflows:{}};
 const setups={modal:"activatePage('profiles');closeProfileEditor();clearTimeout(refreshTimer)",selector:"activatePage('settings');activateSettingsSubpage('display',false);furyDesign.showIngame('tablist');clearTimeout(refreshTimer)",preview:"activatePage('settings');activateSettingsSubpage('display',false);furyDesign.showIngame('tablist');clearTimeout(refreshTimer)",filter:overlayFixture};
 for(const kind of phase.startsWith('modal-')?['modal']:Object.keys(setups)){
  await page.evaluate(setups[kind]);await delay(300);const rounds=[];
  for(let round=-1;round<5;round++){
   await page.evaluate(()=>{window.__uiAudit.observerCallbacks=0;window.__uiAudit.observerRecords=0;window.__uiAudit.longTasks=[];window.__uiAudit.ipc=[];window.__uiAudit.renders={};});
   const before=Object.fromEntries((await cdp.send('Performance.getMetrics')).metrics.map(x=>[x.name,x.value]));
   await page.evaluate(async kind=>{const frame=()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));for(let i=0;i<12;i++){
    if(kind==='modal'){openProfileEditor('duplicate',state.profiles.profiles[0]);await frame();closeProfileEditor();}
    if(kind==='selector')document.querySelector('[data-tablist-mode="'+(i%2?'BEDWARS':'SKYWARS')+'"]').click();
    if(kind==='preview')require('./src/launcher/renderer/launcher_ingame_appearance').renderTab({document,layout:i%2?['name','finals','wins','ping']:['name','stars','fkdr','wlr','finals','wins','ping','dailyfkdr','weeklyfkdr','monthlyfkdr'],mode:'BEDWARS',style:'compact',enabled:true});
    if(kind==='filter'){const e=document.querySelector('.fury-overlay-filter');e.value=i%2?'':'NoSuchPlayer';e.dispatchEvent(new Event('input',{bubbles:true}));}
    await frame();
   }await frame();},kind);
   const after=Object.fromEntries((await cdp.send('Performance.getMetrics')).metrics.map(x=>[x.name,x.value]));
   const probes=await page.evaluate(()=>window.__uiAudit);if(round>=0)rounds.push({...Object.fromEntries(['ScriptDuration','LayoutDuration','RecalcStyleDuration','TaskDuration','LayoutCount','RecalcStyleCount'].map(k=>[k,after[k]-before[k]])),...probes});
  }
  const median=k=>rounds.map(r=>r[k]).sort((a,b)=>a-b)[2];result.workflows[kind]={rounds,median:Object.fromEntries(['ScriptDuration','LayoutDuration','RecalcStyleDuration','TaskDuration','LayoutCount','RecalcStyleCount','observerCallbacks','observerRecords'].map(k=>[k,median(k)]))};
  console.log('MEASURE '+kind+' '+JSON.stringify(result.workflows[kind].median));
 }
 fs.writeFileSync(path.join(out,'performance.json'),JSON.stringify(result,null,2));return result;
}
async function historyCheck(page){
 const result=await page.evaluate(async()=>{clearTimeout(refreshTimer);const small=await ipcRenderer.invoke('state:get',{historyContract:HISTORY_VERSION}),full=await ipcRenderer.invoke('state:get');return{version:small.sessionHistory.version,revision:small.sessionHistory.revision,compactBytes:Buffer.byteLength(JSON.stringify(small.sessionHistory)),fullBytes:Buffer.byteLength(JSON.stringify(full.sessionHistory)),envelopeKeys:Object.keys(small.sessionHistory).sort(),historyKeys:Object.keys(small.sessionHistory.history).sort(),gameKeys:Object.keys(small.sessionHistory.history.sessions[0].games[0]).sort(),duplicateHealthHistory:small.proxyHealth?.sessionHistory||null};});
 assert.equal(result.version,1);assert.deepEqual(result.historyKeys,['calendarSessions','sessions']);assert.equal(result.duplicateHealthHistory,null);fs.writeFileSync(path.join(out,'history.json'),JSON.stringify(result,null,2));console.log('HISTORY '+JSON.stringify(result));
}
async function groupChecks(page,group){
 const shot=async name=>{await delay(80);await page.screenshot({path:path.join(out,name+'.png')});};
 if(group==='group2'){
  await page.evaluate("activatePage('dashboard');FuryNotifications.dismissAll();window.__groupInvoke=ipcRenderer.invoke;ipcRenderer.invoke=(channel,...args)=>channel==='settings:save-patch'?Promise.reject(new Error('')):window.__groupInvoke(channel,...args)");
  await page.evaluate("saveOrdinaryPatch({},[document.querySelector('#server-host')||document.querySelector('#manual-denick-nick')])");
  await page.waitForFunction("document.querySelector('.fury-notification-error .notification-title')?.textContent==='Couldn’t save'");
  assert.equal(await page.$eval('.fury-notification-error',e=>e.getAttribute('role')),'alert');await shot('notification-save-error');
  await page.evaluate('ipcRenderer.invoke=window.__groupInvoke;clearTimeout(refreshTimer);FuryNotifications.dismissAll()');
  await page.evaluate("document.querySelector('#save-status').textContent='Updating feature…'");await page.waitForSelector('.fury-notification.is-persistent');
  const pending=await page.$eval('.fury-notification',e=>e.dataset.notificationId);
  await page.evaluate("setLauncherStatus('Profile duplicated','success')");await page.waitForSelector('.fury-notification-success');assert.equal(await page.$eval('.fury-notification',e=>e.dataset.notificationId),pending);assert.equal(await page.$eval('.fury-notification',e=>e.classList.contains('is-persistent')),false);await shot('notification-profile-success');
  await page.evaluate("setLauncherStatus('Profile duplicated','success')");await delay(40);assert.equal(await page.$$eval('.fury-notification:not(.is-leaving)',es=>es.length),1);
  await page.evaluate("document.querySelector('#save-status').textContent='Unrelated notice'");await delay(40);assert.equal(await page.$eval('.fury-notification',e=>e.dataset.kind),'info');
  await page.click('.notification-close');await delay(60);assert.equal(await page.$$eval('.fury-notification:not(.is-leaving)',es=>es.length),1);
  await page.evaluate("setLauncherStatus('Give the profile a name','warning')");await delay(40);assert.equal(await page.$eval('.fury-notification',e=>e.dataset.kind),'warning');
  console.log('PASS group2: real save rejection, explicit success/error/warning, pending replacement, deduplication, dismissal, no severity leak');return;
 }
 if(group==='group3'){
  await page.evaluate("activatePage('profiles');clearTimeout(refreshTimer)");
  const invoker='[data-profile-card]:first-child [data-profile-action="review"]';
  const open=async(kind='editor',mode='duplicate')=>{await page.focus(invoker);await page.evaluate((kind,mode)=>{const p=state.profiles.profiles[0];if(kind==='editor')openProfileEditor(mode,p);else openProfileDetail(p);},kind,mode);await delay(30);};
  for(const kind of ['editor','detail']){
   await open(kind);const selector='#profile-'+kind+'-modal';assert(await page.$eval(selector,e=>e.matches(':modal')));
   for(const reverse of [false,true]){if(reverse)await page.keyboard.down('Shift');for(let i=0;i<18;i++){await page.keyboard.press('Tab');assert(await page.$eval(selector,e=>e.contains(document.activeElement)),'Tab containment '+kind+' reverse='+reverse);}if(reverse)await page.keyboard.up('Shift');}
   assert(await page.evaluate(selector=>{document.querySelector('[data-page-tab="dashboard"]').focus();return document.querySelector(selector).contains(document.activeElement);},selector),'background programmatic focus inert');
   await page.keyboard.press('Escape');assert(!(await page.$eval(selector,e=>e.open)));assert(await page.$eval(invoker,e=>e===document.activeElement));
   for(const method of ['button','cancel','backdrop']){await open(kind);const close=method==='button'?'.profile-'+kind+'-close':method==='cancel'?'#profile-'+kind+'-modal [data-profile-'+kind+'-close]:last-child':'.profile-'+kind+'-backdrop';
    if(method==='backdrop')await page.mouse.click(4,200);else if(method==='cancel')await page.$eval('#profile-'+kind+'-modal',e=>[...e.querySelectorAll('button')].find(b=>/^(Cancel|Back to profiles)$/.test(b.textContent.trim())).click());else await page.click(close);
    assert(!(await page.$eval(selector,e=>e.open)),kind+' '+method);assert(await page.$eval(invoker,e=>e===document.activeElement));assert(await page.$eval('[data-page="profiles"]',e=>e.classList.contains('active')));
   }
  }
  await open();await shot('profile-dark');await page.$eval('.profile-editor-dialog',async()=>{});await (await page.$('.profile-editor-dialog')).screenshot({path:path.join(out,'profile-fields-dark.png')});
  const styles=await page.evaluate(()=>['profile-editor-label','profile-editor-description'].map(id=>{const s=getComputedStyle(document.getElementById(id));return{fontFamily:s.fontFamily,fontSize:s.fontSize,color:s.color,background:s.backgroundColor,lineHeight:s.lineHeight};}));
  assert.equal(styles[0].fontFamily,styles[1].fontFamily);assert.equal(styles[0].fontSize,styles[1].fontSize);assert.equal(styles[0].color,styles[1].color);assert.equal(styles[0].background,styles[1].background);
  await page.evaluate("NesterTheme.apply('light',false)");await (await page.$('.profile-editor-dialog')).screenshot({path:path.join(out,'profile-fields-light.png')});await page.setViewport({width:1024,height:680});await shot('profile-1024');assert(await page.$eval('.profile-editor-dialog',e=>{const r=e.getBoundingClientRect();return r.top>=0&&r.bottom<=innerHeight&&r.left>=0&&r.right<=innerWidth}));await page.setViewport({width:1440,height:900});await page.evaluate("NesterTheme.apply('dark',false);closeProfileEditor()");
  // Replaced and removed invokers while open: resolve an equivalent control or stable fallback.
  for(const remove of [false,true]){await open();await page.$eval(invoker,(e,remove)=>remove?e.closest('[data-profile-card]').remove():e.replaceWith(e.cloneNode(true)),remove);await page.keyboard.press('Escape');assert(await page.evaluate(()=>document.activeElement.matches('[data-profile-action="review"]')));await page.evaluate('renderProfiles(state.profiles)');}
  await open();await page.evaluate("window.__profileInvocations=[];window.__profileInvoke=ipcRenderer.invoke;ipcRenderer.invoke=(channel,...args)=>{window.__profileInvocations.push(channel);return window.__profileInvoke(channel,...args)};document.getElementById('profile-editor-name').value='';document.getElementById('profile-editor-submit').click()");await delay(60);assert(await page.$eval('#profile-editor-modal',e=>e.open));assert(!(await page.evaluate("window.__profileInvocations.some(c=>c==='profiles:duplicate')")));
  await page.evaluate("document.getElementById('profile-editor-name').value='review-test-copy';document.getElementById('profile-editor-submit').click()");await page.waitForFunction("!document.getElementById('profile-editor-modal').open && state.profiles.profiles.some(p=>p.name==='review-test-copy')");await delay(100);assert(await page.evaluate(()=>document.activeElement!==document.body));
  const calls=await page.evaluate('window.__profileInvocations');assert.equal(calls.filter(c=>c==='profiles:duplicate').length,1);assert(calls.filter(c=>c==='state:get').length<=3,'bounded existing notification/submit refreshes');await page.evaluate('clearTimeout(refreshTimer);ipcRenderer.invoke=window.__profileInvoke');
  // Real isolated edit and delete; deletion can remove the focused card during the existing refresh.
  for(const mode of ['edit','delete']){await page.evaluate(mode=>{profileReviewName='review-test-copy';renderProfiles(state.profiles);const e=document.querySelector('[data-profile-name="review-test-copy"][data-profile-action="review"]');e.focus();openProfileEditor(mode,state.profiles.profiles.find(p=>p.name==='review-test-copy'));},mode);await delay(30);await page.click('#profile-editor-submit');await page.waitForFunction("!document.getElementById('profile-editor-modal').open");await delay(150);assert(await page.evaluate(()=>document.activeElement!==document.body),'focus after '+mode);await page.evaluate('clearTimeout(refreshTimer)');}
  assert(!(await page.evaluate("state.profiles.profiles.some(p=>p.name==='review-test-copy')")));
  await open();await page.evaluate("window.__profileInvoke=ipcRenderer.invoke;ipcRenderer.invoke=(c,...a)=>c==='profiles:duplicate'?new Promise((resolve,reject)=>window.__rejectProfile=reject):window.__profileInvoke(c,...a)");await page.click('#profile-editor-submit');assert(await page.$eval('#profile-editor-submit',e=>e.disabled));
  for(const reverse of [false,true]){if(reverse)await page.keyboard.down('Shift');for(let i=0;i<12;i++){await page.keyboard.press('Tab');assert(await page.$eval('#profile-editor-modal',e=>e.contains(document.activeElement)));assert(!(await page.evaluate('document.activeElement.disabled')));}if(reverse)await page.keyboard.up('Shift');}
  await page.evaluate("window.__rejectProfile(new Error('Fixture pending failure'))");await delay(40);assert(await page.$eval('#profile-editor-modal',e=>e.open));await page.keyboard.press('Escape');await page.evaluate('ipcRenderer.invoke=window.__profileInvoke');
  await page.focus(invoker);await page.evaluate("openProfileDetail(state.profiles.profiles.find(p=>p.applyChanges.length>0))");await page.click('#profile-detail-apply');await page.waitForFunction("!document.getElementById('profile-detail-modal').open");await delay(350);await page.evaluate('clearTimeout(refreshTimer)');assert(await page.evaluate('document.activeElement!==document.body'));
  // Rejected submit stays modal and re-enables the action.
  await open();await page.evaluate("window.__profileInvoke=ipcRenderer.invoke;ipcRenderer.invoke=(c,...a)=>c==='profiles:duplicate'?Promise.reject(new Error('Fixture failure')):window.__profileInvoke(c,...a)");await page.click('#profile-editor-submit');await delay(80);assert(await page.$eval('#profile-editor-modal',e=>e.open));assert(!(await page.$eval('#profile-editor-submit',e=>e.disabled)));await page.keyboard.press('Escape');await page.evaluate('ipcRenderer.invoke=window.__profileInvoke');
  fs.writeFileSync(path.join(out,'checks.json'),JSON.stringify({styles,calls,tabCycles:18,shiftTabCycles:18,backgroundInert:true,escape:true,cancel:true,closeButton:true,backdrop:true,focusRestored:true,replacedAndDeletedInvoker:true,validationFailure:true,successfulDuplicateEditDelete:true,rejectedSubmit:true},null,2));
  console.log('PASS group3: native modality, complete/pending keyboard cycles, all close paths, focus recovery, validation/success/failure, successful apply and bounded existing refreshes');return;
 }
 if(group==='group4'){
  const cdp=await page.createCDPSession(),trees={};const tree=async key=>{await delay(60);return trees[key]=(await cdp.send('Accessibility.getFullAXTree')).nodes;};
  await page.evaluate("activatePage('settings');activateSettingsSubpage('display',false);furyDesign.showIngame('tablist');clearTimeout(refreshTimer);window.__uiAudit.ipc=[];window.__uiAudit.renders={}");
  const selected=async(selector,attribute,value)=>{assert.equal(await page.$$eval(selector,(es,a)=>es.filter(e=>e.getAttribute(a)==='true').length,attribute),1);assert.equal(await page.$eval(selector+'['+attribute+'="true"]',e=>e.textContent.trim()),value);};
  await page.focus('#fury-ingame-tablist-tab');await page.keyboard.press('ArrowRight');await selected('.fury-ingame-tabs button','aria-selected','Tab list');assert.equal(await page.evaluate('Object.keys(window.__uiAudit.renders).length'),0);
  await page.keyboard.press('Enter');await selected('.fury-ingame-tabs button','aria-selected','Nametags');
  await page.keyboard.press('End');await selected('.fury-ingame-tabs button','aria-selected','Nametags');await page.keyboard.press('Space');await selected('.fury-ingame-tabs button','aria-selected','Names & colors');await page.keyboard.press('ArrowLeft');await page.keyboard.press('Space');await selected('.fury-ingame-tabs button','aria-selected','Nametags');
  await page.focus('[data-preview-audience="threats"]');await page.keyboard.press('ArrowRight');await selected('[data-preview-audience]','aria-checked','Others');
  await page.evaluate("renderNametagPreview('teammates')");await selected('[data-preview-audience]','aria-checked','Teammates');await page.click('[data-preview-audience="threats"]');await selected('[data-preview-audience]','aria-checked','Threats');
  await shot('audience-selected');
  assert((await tree('audience')).some(n=>n.role?.value==='radio'&&n.name?.value==='Threats'&&n.properties?.some(p=>p.name==='checked'&&p.value.value==='true')));
  await page.evaluate("furyDesign.showIngame('tablist')");await selected('.fury-ingame-tabs button','aria-selected','Tab list');
  await page.focus('[data-tablist-mode="BEDWARS"]');await page.keyboard.press('ArrowRight');await selected('[data-tablist-mode]','aria-checked','SkyWars');
  await page.keyboard.press('Home');await selected('[data-tablist-mode]','aria-checked','BedWars');
  await page.keyboard.press('ArrowLeft');await selected('[data-tablist-mode]','aria-checked','SkyWars');await page.keyboard.press('End');await selected('[data-tablist-mode]','aria-checked','SkyWars');await page.keyboard.press('Home');await selected('[data-tablist-mode]','aria-checked','BedWars');
  await page.evaluate("tabStatsPreviewMode='SKYWARS';renderTabStatsEditor()");await selected('[data-tablist-mode]','aria-checked','SkyWars');await page.click('[data-tablist-mode="BEDWARS"]');await selected('[data-tablist-mode]','aria-checked','BedWars');
  await shot('mode-selected');
  const ax=await tree('tablist');
  assert(ax.some(n=>n.role?.value==='tab'&&n.name?.value==='Tab list'&&n.properties?.some(p=>p.name==='selected'&&p.value.value===true)));
  assert(ax.some(n=>n.role?.value==='radio'&&n.name?.value==='BedWars'&&n.properties?.some(p=>p.name==='checked'&&p.value.value==='true')));
  await page.evaluate("activatePage('denicks');activateDenickSubpage('history');clearTimeout(refreshTimer);window.__catalogCalls=0;window.__ensureCatalog=ensureDenickLookupCatalog;ensureDenickLookupCatalog=async()=>{window.__catalogCalls++}");
  await page.focus('[data-denick-subpage-button="history"]');await page.keyboard.press('ArrowRight');assert.equal(await page.evaluate('window.__catalogCalls'),0);await selected('[data-denick-subpage-button]','aria-selected','History');
  await page.keyboard.press('Enter');assert.equal(await page.evaluate('window.__catalogCalls'),1);await selected('[data-denick-subpage-button]','aria-selected','Denick Lookup');
  await page.keyboard.press('Home');assert.equal(await page.evaluate('window.__catalogCalls'),1);await page.keyboard.press('Space');await selected('[data-denick-subpage-button]','aria-selected','History');
  await page.evaluate("activateDenickSubpage('history')");await selected('[data-denick-subpage-button]','aria-selected','History');
  await page.click('[data-denick-subpage-button="lookup"]');assert.equal(await page.evaluate('window.__catalogCalls'),2);await page.evaluate('ensureDenickLookupCatalog=window.__ensureCatalog');
  assert((await tree('nicks')).some(n=>n.role?.value==='tab'&&n.name?.value==='Denick Lookup'&&n.properties?.some(p=>p.name==='selected'&&p.value.value===true)));
  const names=await page.evaluate(()=>Object.fromEntries(['.fury-account-manager','.fury-mapping-dialog','#overlay-player-input','.fury-close-columns'].map(s=>{const e=document.querySelector(s);return[s,e?.getAttribute('aria-label')||document.getElementById(e?.getAttribute('aria-labelledby'))?.textContent||null];})));
  assert(Object.values(names).every(Boolean),JSON.stringify(names));assert.equal(await page.$$eval('[data-page-tab][aria-current="page"]',es=>es.length),1);
  for(const selector of ['.fury-account-manager','.fury-mapping-dialog']){const name=names[selector];await page.$eval(selector,e=>e.showModal());const nodes=await tree(name);assert(nodes.some(n=>n.role?.value==='dialog'&&n.name?.value===name),name+': '+JSON.stringify(nodes.filter(n=>n.role?.value==='dialog')));await page.$eval(selector,e=>e.close());}
  await page.evaluate("activatePage('overlay');clearTimeout(refreshTimer);document.getElementById('overlay-layout-toggle').click()");const overlay=await tree('overlay');assert(overlay.some(n=>n.role?.value==='textbox'&&n.name?.value==='Minecraft username'));assert(overlay.some(n=>n.role?.value==='button'&&n.name?.value==='Close columns'));
  const ipc=await page.evaluate('window.__uiAudit.ipc');assert(!ipc.some(x=>/save|patch/.test(x.channel)),'preview/navigation must not save');
  fs.writeFileSync(path.join(out,'checks.json'),JSON.stringify({names,ipc,accessibilityTrees:trees,keyboard:true,mouse:true,programmatic:true,manualTabsDoNotLoad:true},null,2));
  console.log('PASS group4: selected AX states, keyboard/manual activation, programmatic and mouse selection, names, no saves');return;
 }
 if(group==='group5'){
  const label=require('../src/profiles/profileStore').profileSettingLabel('accentBedwarsEventLabelsEnabled');assert.equal(label,'BedWars event text color');
  await page.evaluate("activatePage('profiles');clearTimeout(refreshTimer);openProfileDetail({...state.profiles.profiles[0],applyChanges:[{key:'accentBedwarsEventLabelsEnabled',label:require('./src/profiles/profileStore').profileSettingLabel('accentBedwarsEventLabelsEnabled'),from:false,to:true}]})");await shot('event-label');await page.evaluate('closeProfileDetail()');
  await page.evaluate("activatePage('dashboard');clearTimeout(refreshTimer);document.querySelector('.fury-connection-options').open=true;window.__copied=[];require('electron').clipboard.writeText=text=>window.__copied.push(text)");
  const routes=[];for(const route of ['direct','failover']){const value=await page.$eval('#join-'+route+'-address',e=>e.value);await page.click('[data-copy-route="'+route+'"]');const status=await page.$eval('.join-copy-status',e=>e.textContent);assert.equal(status,(route==='direct'?'Direct':'Proxy')+' address copied.');assert.equal(await page.evaluate('window.__copied.at(-1)'),value);routes.push({route,value,status});}
  assert.equal(await page.$eval('[data-copy-route="failover"]',e=>e.getAttribute('aria-label')),'Copy proxy address');await shot('proxy-feedback');
  fs.writeFileSync(path.join(out,'checks.json'),JSON.stringify({label,routes},null,2));console.log('PASS group5: existing setting label, both route addresses and copy feedback');return;
 }
 if(group==='group6'){
  const proxy=fs.readFileSync(path.join(root,'proxy.js'),'utf8'),vm=require('vm'),mc=require('../features/minecraft_chat'),fmt=require('../src/stats/format'),colors=require('../src/stats/colors');
  const start=proxy.indexOf('            const labelFor = (field, compact, full) => tabStatsLabelStyle'),end=proxy.indexOf('            let baseLine =',start);
  const widths=proxy.slice(proxy.indexOf('        function minecraftCharWidth('),proxy.indexOf('        function padMinecraftStart('));assert(start>0&&end>start);
  const layouts=[['name','finals','wins','ping'],['name','stars','fkdr','wlr','finals','wins','ping','dailyfkdr','weeklyfkdr','monthlyfkdr'],['stars','fkdr','dailyfkdr','weeklyfkdr','monthlyfkdr','wins','ping','name']];
  const samples=[['DemoPlayer_',24,8,'1.98','1.21','A'],['SecondSample',16,11,'0.04','0.38','B'],['ThirdSample7',11,14,'0.18','0.96','G'],['AlisonSmith',1347,17,'7.44','3.82','R'],['oFourthDemo',168,20,'1.60','1.82','Y']];
  await page.evaluate("activatePage('settings');activateSettingsSubpage('display',false);furyDesign.showIngame('tablist');clearTimeout(refreshTimer)");const results=[];
  for(const mode of ['BEDWARS','SKYWARS'])for(const style of ['compact','full','value'])for(const layout of layouts){
   const actual=await page.evaluate(options=>{require('./src/launcher/renderer/launcher_ingame_appearance').renderTab({document,enabled:true,...options});return[...document.querySelectorAll('.ia-tab-row')].map(row=>[...row.querySelectorAll('[data-preview-field]')].map(field=>{const walker=document.createTreeWalker(field,NodeFilter.SHOW_TEXT),chars=[];let n;while(n=walker.nextNode()){for(const text of n.textContent)chars.push({text,color:getComputedStyle(n.parentElement).color});}return{field:field.dataset.previewField,text:field.textContent,chars};}));},{mode,style,layout});
   const attached=layout[0]==='name'&&layout[1]==='stars',stars=samples.map(p=>mode==='SKYWARS'?fmt.formatSkyWarsLevel({level:p[2]}):fmt.formatBedwarsPrestige(p[1])),identities=samples.map((p,i)=>(mode==='BEDWARS'?p[5]+' ':'')+p[0]+(attached?' '+stars[i]:''));
   const stripAnsi=s=>s.replace(/§[0-9a-fk-or]/gi,''),wcontext={stripAnsi,identities};const identityWidth=vm.runInNewContext(widths+'Math.max(138,...identities.map(minecraftTextWidth))',wcontext);
   const expected=samples.map((p,i)=>vm.runInNewContext(widths+proxy.slice(start,end)+'columns',{
    ...colors,stripAnsi,fields:layout,name:p[0],identityText:identities[i],padTabIdentity:(name,text)=>vm.runInNewContext(widths+'padMinecraftEnd(text,target)',{stripAnsi,text,target:identityWidth}),
    starsAttachedToName:attached,starText:stars[i],tabStatsLabelStyle:style,tabStatsShowKillRatio:true,tabStatsShowWinRatio:true,fkdr:Number(p[3]),wlr:Number(p[4]),finals:4120,wins:945,ping:42+i*12,sessionStats:{daily:{fkdr:2.61},weekly:{fkdr:3.44},monthly:{fkdr:3.09}}
   }));
   for(let i=0;i<samples.length;i++){
    assert.deepEqual(actual[i].map(x=>x.field),Array.from(expected[i],x=>x.field),mode+' '+style+' field omission '+i);
    for(const field of actual[i].filter(x=>!['name','stars'].includes(x.field))){const raw=expected[i].find(x=>x.field===field.field).text,components=mc.legacyTextToJsonComponent(raw),named={white:'rgb(255, 255, 255)',aqua:'rgb(85, 255, 255)',green:'rgb(85, 255, 85)',gray:'rgb(170, 170, 170)'};
     assert.equal(field.text,stripAnsi(raw));if(['finals','wins','ping'].includes(field.field))assert.deepEqual(field.chars,components.extra.flatMap(s=>[...s.text].map(text=>({text,color:named[s.color]}))));
    }
   }results.push({mode,style,layout,rows:actual.map(row=>row.map(({chars,...rest})=>rest))});
  }
  await page.evaluate("require('./src/launcher/renderer/launcher_ingame_appearance').renderTab({document,layout:['name','finals','wins','ping'],mode:'BEDWARS',style:'compact',enabled:true})");await shot('preview-runtime-parity');
  fs.writeFileSync(path.join(out,'checks.json'),JSON.stringify({runtimeBuilderSource:proxy.slice(start,end),cases:results},null,2));console.log('PASS group6: 90 preview rows vs unchanged runtime builder; colors/text and padded field budget across modes/styles/reordered identity');return;
 }
 if(group==='group7'){
  await page.evaluate(overlayFixture);const empty='#overlay-table + [role="status"]';
  const filter=async value=>{await page.$eval('.fury-overlay-filter',(e,value)=>{e.value=value;e.dispatchEvent(new Event('input',{bubbles:true}));},value);await delay(40);};
  const records=[];
  for(const view of ['teams','list']){await page.click('[data-overlay-view="'+view+'"]');await page.evaluate(overlayFixture.replace("overlayState.view='teams'",`overlayState.view='${view}'`));await delay(60);
   await filter('NoSuchPlayer');assert(await page.$eval(empty,e=>e.checkVisibility()),view+' no-results visible');assert.equal(await page.$$eval('#overlay-table .fury-board-row[data-player]:not(.fury-filtered)',es=>es.length),0);await shot('overlay-'+view+'-no-results');
   await filter('Player_01');assert(!(await page.$eval(empty,e=>e.checkVisibility())));assert.equal(await page.$$eval('#overlay-table .fury-board-row[data-player]:not(.fury-filtered)',es=>es.length),1);
   await filter('');assert(!(await page.$eval(empty,e=>e.checkVisibility())));assert.equal(await page.$$eval('#overlay-table .fury-board-row[data-player]:not(.fury-filtered)',es=>es.length),16);records.push({view,noResults:true,oneMatch:true,cleared:true});
  }
  await filter('NoSuchPlayer');await page.evaluate("overlayTableSignature='';renderOverlay({connected:true,gameActive:true,currentGamemode:'BEDWARS',overlayPlayers:[]})");await delay(60);assert(!(await page.$eval(empty,e=>e.checkVisibility())),'empty roster retains its own empty state');
  fs.writeFileSync(path.join(out,'checks.json'),JSON.stringify({views:records,emptyRosterPreserved:true},null,2));console.log('PASS group7: Teams/List no-results, matching/cleared filter, original empty roster');return;
 }
 throw Error('Unknown group '+group);
}
(async()=>{const {browser,page,child}=await boot(),errors=[];page.on('pageerror',e=>errors.push(e.message));try{
 if(/^(baseline|final)/.test(phase)){await performanceChecks(page);await historyCheck(page);}else if(phase==='history-large'){
  await historyCheck(page);await page.evaluate("activatePage('sessions');document.querySelector('#fury-period-sessions').click()");await page.evaluate('refresh()');await delay(200);await page.evaluate('clearTimeout(refreshTimer);window.__uiAudit.ipc=[];window.__uiAudit.longTasks=[]');
  for(let i=0;i<6;i++){await page.evaluate('refresh()');await delay(100);}
  const result=await page.evaluate('window.__uiAudit');assert.equal(result.ipc.filter(c=>c.channel==='state:get').length,6);assert(!result.ipc.some(c=>c.channel==='history:detail'));assert.equal(result.longTasks.length,0);
  fs.writeFileSync(path.join(out,'refreshes.json'),JSON.stringify(result,null,2));console.log('PASS large history: six explicit compact refreshes, six state requests, no detail calls or long tasks');
 }else if(phase.startsWith('modal-')){if(phase==='modal-nonmodal-control')await page.evaluate(()=>HTMLDialogElement.prototype.showModal=HTMLDialogElement.prototype.show);await performanceChecks(page);}else await groupChecks(page,phase);
 assert.deepEqual(errors,[]);fs.writeFileSync(path.join(out,'result.json'),JSON.stringify({phase,passed:true,rendererErrors:errors},null,2));
}finally{await browser.disconnect();await h.stopChild(child);}})().catch(e=>{console.error(e);process.exitCode=1});
