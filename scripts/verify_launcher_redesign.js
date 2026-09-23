'use strict';

// Launch the real app with two isolated accounts, no credentials and no external
// network. Exercise existing event handlers, IPC and PNG exports, then inspect
// every approved page at normal and minimum supported viewport sizes.
const assert=require('assert'),fs=require('fs'),path=require('path'),os=require('os');
const puppeteer=require('puppeteer');
const {cleanEnvironment,unusedPorts,startChild,stopChild,assertRunning,eventually,packagePaths,uiTestArguments}=require('./smoke_packaged_app');
const root=path.resolve(__dirname,'..');
const args=process.argv.slice(2),options={};
for(let i=0;i<args.length;i+=2){assert(['--app','--output','--focus'].includes(args[i])&&args[i+1], 'Usage: node scripts/verify_launcher_redesign.js [--app <Fury.app or executable>] [--output <directory>] [--focus sessions|order]');options[args[i]]=args[i+1];}
const packaged=options['--app']?packagePaths(options['--app']):null;
const output=path.resolve(options['--output']||path.join(root,'output','launcher-redesign-implemented'));
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));

(async()=>{
    fs.mkdirSync(output,{recursive:true});
    const profile=fs.mkdtempSync(path.join(os.tmpdir(),'fury-redesign-check-'));
    const [debugPort,cosmeticPort,blockedPort,directPort,failoverPort,healthPort]=await unusedPorts(6);
    const env=cleanEnvironment(profile,packaged?.resources||root,cosmeticPort,blockedPort);
    if(!packaged)env.NODE_BINARY=process.execPath;
    if(packaged)require('./verify_packaged_sources').verifySources(root,packaged.appRoot);
    const defaults=require('../src/session/settings').SESSION_DEFAULTS;
    fs.writeFileSync(path.join(profile,'features_config.json'),JSON.stringify({...defaults,apiKillSwitchEnabled:true,gameRecapEnabled:true,sessionGoalWins:10,sessionRecapStyle:'compact',friendAliasEnabled:true}));
    fs.writeFileSync(path.join(profile,'server_config.json'),JSON.stringify({proxyDirectPort:directPort,proxyFailoverPort:failoverPort,healthPort,proxyDirectHost:'mc.hypixel.net',proxyFailoverHost:'hypixel.fast'}));
    const accounts=[{uuid:'a'.repeat(32),name:'Nestersen'},{uuid:'b'.repeat(32),name:'SecondAccount'}];
    const store=require('../src/reminders/rememberedAccount').createReminderAccountStore(path.join(profile,'launcher_data','reminders'));
    for(const [i,a] of accounts.entries()){
        store.remember(a.uuid,a.name);store.observe(a.uuid,{player:{uuid:a.uuid,displayname:a.name,stats:{Bedwars:{slumber:{minion:{ender_dust:i?45:280},quest:{lastCompleted:{'Npc Bucky':Date.now()-86400000*3}}}}}}});
        store.saveGeorge(a.uuid,{active:true,wins:i?1:2,claimReady:!i},a.name);
    }store.remember(accounts[0].uuid,accounts[0].name);
    const start=new Date('2026-09-07T16:30:00').getTime(),end=start+4380000;
    const sessions=accounts.map((a,i)=>({...a,id:`fixture-${i}`,startedAt:start,lastSeen:end,endedAt:end,summary:{stats:{Bedwars:{wins_bedwars:i?2:10,losses_bedwars:4,games_played_bedwars:i?6:14,final_kills_bedwars:24,final_deaths_bedwars:4,kills_bedwars:24,deaths_bedwars:31,beds_broken_bedwars:9,beds_lost_bedwars:4,Experience:3200}}},games:[{id:`game-${i}`,at:end,mode:'BEDWARS',result:'win',durationMs:300000,delta:{stats:{Bedwars:{wins_bedwars:1}}}}]}));
    fs.writeFileSync(path.join(profile,'session_data.json'),JSON.stringify({version:3,sessions}));
    const nickFixtures=[{realIGN:'ExamplePlayer',nicks:['ExampleNick'],methods:['skin'],firstSeen:'2026-09-01T12:00:00Z',lastSeen:'2026-09-07T14:30:00Z',events:[{at:'2026-09-07T14:30:00Z',nick:'ExampleNick',method:'skin'}]},{realIGN:'PlayerTwo',nicks:['AnotherNick'],methods:['manual'],firstSeen:'2026-09-01T12:00:00Z',lastSeen:'2026-09-06T14:30:00Z',events:[{at:'2026-09-06T14:30:00Z',nick:'AnotherNick',method:'manual'}]}];
    fs.writeFileSync(path.join(profile,'denicked.json'),JSON.stringify(nickFixtures));
    const child=startChild(packaged?.executable||require('electron'),[...(packaged ? [] : [root]),...uiTestArguments(),`--remote-debugging-port=${debugPort}`,'--remote-debugging-address=127.0.0.1','--disable-backgrounding-occluded-windows','--disable-renderer-backgrounding',`--proxy-server=${env.HTTPS_PROXY}`],env,'Launcher redesign verification');
    let browser,page;const errors=[],checks=[],layouts=[];
    // Locator clicks wait for the moving page/control to settle before pressing.
    const click=selector=>page.locator(selector).click();
    const record=text=>{checks.push(text);console.log(`PASS ${text}`);};
    try{
        browser=await eventually(async()=>{assertRunning(child);return puppeteer.connect({browserURL:`http://127.0.0.1:${debugPort}`,defaultViewport:null});},'Connecting launcher');
        page=await eventually(async()=>{const p=(await browser.pages()).find(p=>p.url().endsWith('/launcher.html'));assert(p);return p;},'Opening launcher renderer');
        await page.setViewport({width:1440,height:900,deviceScaleFactor:1});
        page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error'&&m.text().includes('[Fury]'))errors.push(m.text());});
        await page.waitForFunction('Boolean(typeof furyDesign !== "undefined" && furyDesign && state?.viewedAccount)');
        assert.strictEqual(await page.evaluate('process.platform'),process.platform);
        assert(await page.evaluate('Boolean(windowsDesign && windowsSettingsDesign && document.querySelector(".fc-module") && document.querySelector(".fury-window-controls"))'));
        assert.deepStrictEqual(await page.evaluate('[...document.querySelectorAll("link[rel=stylesheet]")].filter(link=>!link.sheet).map(link=>link.getAttribute("href"))'),[],'A launcher stylesheet did not load');
        assert.strictEqual(await page.$eval('.global-search-shortcut',e=>e.textContent),process.platform==='darwin'?'Cmd K':'Ctrl K');
        const modifier=process.platform==='darwin'?'Meta':'Control';
        await page.focus('#proxy-start');await page.keyboard.down(modifier);await page.keyboard.press('k');await page.keyboard.up(modifier);
        assert(await page.evaluate('document.activeElement.id==="global-search-input"'));
        await page.keyboard.press('Escape');
        record('Current shared design, settings styles, window controls and native search shortcut load on '+process.platform+'/'+process.arch);
        await page.evaluate('refresh()');
        assert.strictEqual(await page.evaluate('state.accountKey'),accounts[0].uuid);
        assert.strictEqual(await page.evaluate('state.reminders.enderDust.enderDust'),280);
        assert.strictEqual(await page.evaluate('state.reminders.gamblerGeorge.claimReady'),true);
        const select=async name=>{
            await page.evaluate(`if(!document.querySelector('.fury-account-manager').open)furyDesign.openManager()`);
            await page.evaluate(name=>{const row=[...document.querySelectorAll('.fury-account-row')].find(r=>r.querySelector('strong')?.textContent===name);const b=[...row.querySelectorAll('button')].find(b=>b.textContent==='Select');b.click();},name);
        };
        await page.evaluate("activatePage('sessions')");await page.waitForFunction('state.sessionHistory?.sessions?.length===1');
        assert.deepStrictEqual(await page.evaluate('state.sessionHistory.sessions.map(s=>s.name)'),['Nestersen']);
        // Hold the old IPC reply while the actual account menu selects Bob.
        await page.evaluate(`window.actualInvoke=ipcRenderer.invoke.bind(ipcRenderer);window.holdNext=true;ipcRenderer.invoke=async(channel,...args)=>{const result=await window.actualInvoke(channel,...args);if(channel==='state:get'&&window.holdNext){window.holdNext=false;return new Promise(resolve=>{window.releaseOldReply=()=>resolve(result);});}return result;};void refresh();`);
        await page.waitForFunction('typeof window.releaseOldReply === "function"');
        await select('SecondAccount');
        assert.strictEqual(await page.evaluate('state.accountKey'),accounts[1].uuid);
        assert.strictEqual(await page.evaluate('document.querySelector("#session-history-list").textContent.includes("Nestersen")'),false);
        await page.evaluate('window.releaseOldReply()');
        await page.waitForFunction('state.reminders?.enderDust?.enderDust===45 && state.sessionHistory?.sessions?.[0]?.name==="SecondAccount"');
        await page.evaluate('ipcRenderer.invoke=window.actualInvoke');
        assert.strictEqual(await page.evaluate('state.reminders.gamblerGeorge.wins'),1);
        const wrong=await page.evaluate(`ipcRenderer.invoke('session:action',{type:'delete',sessionId:'fixture-0',accountKey:state.accountKey})`);
        assert.strictEqual(wrong.ok,false);
        assert.strictEqual(JSON.parse(fs.readFileSync(path.join(profile,'session_data.json'))).sessions.length,2);
        assert.strictEqual(JSON.parse(fs.readFileSync(path.join(profile,'launcher_data','viewed-account.json'))).uuid,accounts[1].uuid);
        record('Account menu switches sessions and all reminder readings; stale IPC and cross-account deletion are rejected');
        await select('Nestersen');await page.waitForFunction('state.reminders?.enderDust?.enderDust===280');
        await page.evaluate("document.querySelector('.fury-account-manager').close();activatePage('sessions');");
        await page.waitForFunction('state.sessionHistory?.sessions?.[0]?.name==="Nestersen"');
        await page.evaluate("document.querySelector('.fury-session-row').open=true");
        await page.waitForSelector('.fury-card-image canvas');
        const image=await page.evaluate(`(()=>{const c=document.querySelector('.fury-card-image canvas');return{width:c.width,height:c.height,text:c.getAttribute('aria-label'),png:c.toDataURL()}})()`);
        assert(image.text.includes('Wins: 10')&&image.text.includes('Deaths: 31')&&image.text.includes('Started: 4:30 PM')&&image.text.includes('Finished: 5:43 PM')&&image.text.includes('Duration: 1h 13m'));
        const png=Buffer.from(image.png.split(',')[1],'base64');assert.strictEqual(png.toString('ascii',1,4),'PNG');assert.strictEqual(png.readUInt32BE(16),image.width);fs.writeFileSync(path.join(output,'session-card.png'),png);
        const dynamic=await page.evaluate(`(async()=>{const render=require('./src/launcher/renderer/launcher_session_card').render,session=state.sessionHistory.sessions[0];const small=await render(session,{fields:['wins'],avatar:false});const all=await render(session,{avatar:false});const large=structuredClone(session);Object.assign(large.modes[0],{wins:123456789,finals:123456789,losses:123456789});const expanded=await render(large,{avatar:false});const overnight=structuredClone(session);overnight.startedAt=new Date("2026-09-07T23:30:00").getTime();overnight.endedAt=new Date("2026-09-08T01:15:00").getTime();overnight.durationMs=105*60000;const overnightCard=await render(overnight,{avatar:false});return {small:small.width,all:all.width,large:expanded.width,smallHeight:small.height,allHeight:all.height,overnight:overnightCard.canvas.getAttribute("aria-label")};})()`);
        assert(dynamic.large>dynamic.all&&dynamic.all>=dynamic.small);assert(dynamic.smallHeight<dynamic.allHeight);assert(dynamic.overnight.includes("Finished: Sep 8, 1:15 AM"));
        await page.evaluate(`window.originalWriteImage=clipboard.writeImage;clipboard.writeImage=image=>{window.copiedCardSize=image.getSize();};document.querySelector('.fury-card-toolbar button').click();`);
        assert.deepStrictEqual(await page.evaluate('window.copiedCardSize'),{width:image.width,height:image.height});await page.evaluate('clipboard.writeImage=window.originalWriteImage');
        const exports=path.join(profile,'exports');fs.mkdirSync(exports);const cdp=await page.createCDPSession();await cdp.send('Page.setDownloadBehavior',{behavior:'allow',downloadPath:exports});
        await click('.fury-card-toolbar .fury-gold-outline');await eventually(async()=>assert(fs.readdirSync(exports).some(file=>file.endsWith('.png'))),'Saving generated PNG');
        const downloaded=fs.readFileSync(path.join(exports,fs.readdirSync(exports).find(file=>file.endsWith('.png'))));assert(downloaded.equals(png));
        record('Session PNG uses real stats and timestamps, measures long values, and reaches both copy and download actions');
        if(options['--focus']==='sessions'){await require('./verify_launcher_session_modes')({page,output});assert.deepStrictEqual(errors,[]);record('Session game and team mode selection, responsive cards and exports passed');return;}
        if(options['--focus']==='order'){await require('./verify_launcher_order_overlay')({page,output});assert.deepStrictEqual(errors,[]);record('Pointer and keyboard ordering passed');return;}


        await page.evaluate(`openGlobalSearchEntry({page:'settings',category:'display',element:document.getElementById('denick-real-skin')})`);await delay(350);
        assert(await page.$eval('#denick-real-skin',e=>e.checkVisibility()));
        const before=await page.evaluate('collectFeatureSettings()');await click(`.fury-binary-choice:has(#denick-real-skin) .${before.features.denickRealSkin ? 'fury-binary-off' : 'fury-binary-on'}`);
        await eventually(async()=>assert.strictEqual(JSON.parse(fs.readFileSync(path.join(profile,'features_config.json'))).denickRealSkin,!before.features.denickRealSkin),'Saving checkbox chip');
        const after=await page.evaluate('collectFeatureSettings()');before.features.denickRealSkin=!before.features.denickRealSkin;assert.deepStrictEqual(after,before);
        record('Search opens the nested appearance tab and checkbox chips save only their own setting');
        const change=async(id,value,event='change')=>page.evaluate(({id,value,event})=>{const el=document.getElementById(id);if(el.type==='checkbox')el.checked=value;else el.value=value;el.dispatchEvent(new Event(event,{bubbles:true}));},{id,value,event});
        // Match verify_settings_autosave: the write chain acknowledges IPC,
        // while settingsSaveInFlight becomes false BEFORE refresh finishes.
        const settledOrdinarySave=async()=>{
            await page.evaluate(async()=>{await ordinarySaveChain;});
            await page.waitForFunction('!settingsSaveInFlight && !refreshInFlight');
            await page.evaluate(async()=>{await refresh();renderSettingsSaveState();});
        };
        const waitSaved=async(key,value)=>eventually(async()=>{assert.deepStrictEqual(JSON.parse(fs.readFileSync(path.join(profile,'features_config.json')))[key],value);assert(await page.evaluate('!featureSaveInFlight && !featureSaveTimer'));},`Saving ${key}`);
        assert.strictEqual(await page.$eval('#queue-time-party-chat-enabled',el=>el.checked),false);
        await change('queue-time-party-chat-enabled',true);await waitSaved('queueTimePartyChatEnabled',true);
        await page.evaluate('refresh()');
        assert.strictEqual(await page.$eval('#queue-time-party-chat-enabled',el=>el.checked),true);
        await change('queue-time-party-chat-enabled',false);await waitSaved('queueTimePartyChatEnabled',false);
        await page.evaluate('refresh()');
        assert.strictEqual(await page.$eval('#queue-time-party-chat-enabled',el=>el.checked),false);
        await page.evaluate("openGlobalSearchEntry({page:'settings',category:'overlay',element:ids.queueTimeEnabled})");
        await delay(600);
        const queueClick=async selector=>{await page.evaluate(()=>document.querySelectorAll('.notification-close').forEach(button=>button.click()));await delay(250);await click(selector);};
        const queueToggle='.fury-binary-choice:has(#queue-time-enabled)';
        assert.strictEqual(await page.$eval('#queue-time-enabled',el=>el.checked),true);
        assert(await page.$('.fury-binary-choice:has(#queue-time-party-chat-enabled)'));
        await page.$eval(queueToggle,el=>el.scrollIntoView({block:'center',behavior:'instant'}));await delay(350);
        await queueClick(queueToggle+' .fury-binary-off');await waitSaved('queueTimeEnabled',false);
        await page.evaluate('refresh()');
        assert.strictEqual(await page.$eval('#queue-time-enabled',el=>el.checked),false);
        assert(await page.$eval('#queue-time-party-chat-enabled',el=>el.disabled));
        await queueClick(queueToggle+' .fury-binary-on');await waitSaved('queueTimeEnabled',true);
        assert(!(await page.$eval('#queue-time-party-chat-enabled',el=>el.disabled)));
        await queueClick('.fury-binary-choice:has(#queue-time-party-chat-enabled) .fury-binary-on');await waitSaved('queueTimePartyChatEnabled',true);
        await queueClick(queueToggle+' .fury-binary-off');await waitSaved('queueTimeEnabled',false);
        await page.evaluate('refresh()');
        assert(await page.$eval('#queue-time-party-chat-enabled',el=>el.checked&&el.disabled));
        await queueClick(queueToggle+' .fury-binary-on');await waitSaved('queueTimeEnabled',true);
        await queueClick('.fury-binary-choice:has(#queue-time-party-chat-enabled) .fury-binary-off');await waitSaved('queueTimePartyChatEnabled',false);
        await page.evaluate(()=>{document.activeElement?.blur();document.querySelectorAll('.notification-close').forEach(button=>button.click());});
        await page.$eval('#queue-time-settings',el=>el.scrollIntoView({block:'center'}));await delay(350);
        const queueAlignment=await page.$eval('#queue-time-settings',card=>{
            const rows=[...card.querySelectorAll('.queue-time-row')].map(row=>{
                const copy=row.firstElementChild.getBoundingClientRect(),toggle=row.querySelector('.fury-binary-choice').getBoundingClientRect();
                return {left:copy.left,right:toggle.right,center:Math.abs((copy.top+copy.bottom-toggle.top-toggle.bottom)/2)};
            });return rows;
        });
        assert(Math.abs(queueAlignment[0].left-queueAlignment[1].left)<1);
        assert(Math.abs(queueAlignment[0].right-queueAlignment[1].right)<1);
        assert(queueAlignment.every(row=>row.center<1));
        await page.screenshot({path:path.join(output,'queue-time-controls.png')});
        record('Queue time uses standard toggles, master Off persists, and party-sharing preference survives disabling');

        await page.evaluate("openGlobalSearchEntry({page:'settings',category:'gameplay',element:ids.partySplitWarningsEnabled})");
        const partyToggle='.fury-binary-choice:has(#party-split-warnings-enabled)';
        assert(await page.$eval('#party-split-warnings-enabled',el=>el.checked));
        await queueClick(partyToggle+' .fury-binary-off');await waitSaved('partySplitWarningsEnabled',false);
        await page.evaluate('refresh()');assert.strictEqual(await page.$eval('#party-split-warnings-enabled',el=>el.checked),false);
        await queueClick(partyToggle+' .fury-binary-on');await waitSaved('partySplitWarningsEnabled',true);
        await queueClick(partyToggle+' .fury-binary-off');await waitSaved('partySplitWarningsEnabled',false);
        assert.strictEqual(require('../src/profiles/profileStore').filterPresetSettings({partySplitWarningsEnabled:true}).partySplitWarningsEnabled,undefined);
        await page.$eval(partyToggle,el=>el.scrollIntoView({block:'center'}));await delay(350);
        await page.screenshot({path:path.join(output,'party-split-warnings.png')});
        record('Party split warnings have a saved On/Off control in Automation and remain independent of profiles');

        for(const [id,key] of [['accent-bedwars-event-labels-enabled','accentBedwarsEventLabelsEnabled'],['bedwars-sidebar-team-colors-enabled','bedwarsSidebarTeamColorsEnabled']]){
            const before=await page.evaluate('collectFeatureSettings()');const value=!before.features[key];await change(id,value);await waitSaved(key,value);before.features[key]=value;assert.deepStrictEqual(await page.evaluate('collectFeatureSettings()'),before);
        }
        assert.strictEqual(await page.$$eval('[id^="friend-alias"], .fury-alias-panel', nodes=>nodes.length),0);
        await change('auto-dodge-delay-seconds-slider',6,'input');await waitSaved('autoDodgeDelaySeconds',6);assert.strictEqual(await page.evaluate('ids.autoDodgeDelaySeconds.value'),'6');
        await change('ender-dust-reminder-threshold',271);await waitSaved('enderDustReminderThreshold',271);assert.strictEqual(await page.evaluate('document.getElementById("ender-dust-reminder-threshold-slider").value'),'271');
        await change('auto-dodge-delay-seconds',50);await waitSaved('autoDodgeDelaySeconds',15);await change('ender-dust-reminder-threshold',0);await waitSaved('enderDustReminderThreshold',1);
        await page.evaluate(`ipcRenderer.invoke('settings:save-features',{features:{...state.settings.features,autoDodgeDelaySeconds:9,enderDustReminderThreshold:250}}).then(()=>refresh())`);
        assert(await page.evaluate(`document.getElementById('auto-dodge-delay-seconds-slider').value==='9' && document.getElementById('ender-dust-reminder-threshold-slider').value==='250'`));
        record('Custom names are removed; color options remain independent; sliders synchronize, clamp and persist');
        await page.evaluate("activatePage('settings');activateSettingsSubpage('overlay',false)");
        assert.strictEqual(await page.$eval('#overlay-sources-title',el=>el.textContent),'Use Overlay');
        assert.strictEqual(await page.$('.concept-choice-grid'),null);
        const overlayToggle='.fury-binary-choice:has(#social-overlay-adds-enabled)';
        await queueClick(overlayToggle+' .fury-binary-on');await waitSaved('socialOverlayAddsEnabled',true);
        await queueClick(overlayToggle+' .fury-binary-off');await waitSaved('socialOverlayAddsEnabled',false);
        await page.evaluate('refresh()');assert(!(await page.$eval('#social-overlay-adds-enabled',el=>el.checked)));
        await page.evaluate(()=>document.querySelectorAll('.notification-close').forEach(button=>button.click()));
        await page.$eval('.overlay-concept-module',el=>el.scrollIntoView({block:'center'}));await delay(350);
        await page.screenshot({path:path.join(output,'use-overlay.png')});
        await page.evaluate("activateSettingsSubpage('sessions',false)");
        const binary='.fury-binary-choice:has(#session-tracking-enabled)';
        await click(binary+' .fury-binary-off');await waitSaved('sessionTrackingEnabled',false);
        await click(binary+' .fury-binary-on');await waitSaved('sessionTrackingEnabled',true);
        await click(binary+' .fury-binary-on');assert(await page.$eval('#session-tracking-enabled',e=>e.checked));
        await require('./verify_session_settings')({page,output});
        record('Session settings use fixed lifecycle defaults and appearance edits update existing cards without modifying stored stats');
        await page.evaluate("activateSettingsSubpage('gameplay',false)");
        assert.strictEqual(await page.$('.fury-dodge-advanced'),null);
        assert.strictEqual(await page.$('#auto-party-dodge-enabled'),null);
        for (const width of [1440,1100]) {
            await page.setViewport({width,height:900,deviceScaleFactor:1});
            const centers=await page.evaluate(()=>{
                const rect=selector=>document.querySelector(selector).getBoundingClientRect();
                const left=rect('.fury-number-control:has(#auto-dodge-min-fkdr)'),right=rect('.fury-number-control:has(#auto-dodge-min-stars)'),or=rect('.auto-dodge-threshold-or'),delay=rect('.fury-number-control:has(#auto-dodge-delay-seconds)');
                return {delayY:delay.left>right.right ? Math.abs(delay.top-left.top) : 0,delayHeight:Math.abs(delay.height-left.height),x:Math.abs((or.left+or.right)/2-(left.right+right.left)/2),y:Math.abs((or.top+or.bottom)/2-(left.top+left.bottom)/2)};
            });
            assert(centers.x<1 && centers.y<1 && centers.delayY<1 && centers.delayHeight<1,JSON.stringify({width,...centers}));
        }
        await page.setViewport({width:1440,height:900,deviceScaleFactor:1});
        record('Auto Dodge advanced controls removed and OR centered and Leave delay aligned with threshold inputs');
        const stepper='.fury-number-control:has(#auto-dodge-delay-seconds)';
        await click(stepper+' button:last-child');await waitSaved('autoDodgeDelaySeconds',10);
        await click(stepper+' button:first-child');await waitSaved('autoDodgeDelaySeconds',9);
        await change('auto-dodge-delay-seconds',15);await waitSaved('autoDodgeDelaySeconds',15);
        assert(await page.$eval(stepper+' button:last-child',e=>e.disabled));
        record('Selection tiles support mouse and keyboard; explicit Off/On states and numeric steppers save correctly and respect limits');
        assert(await page.evaluate(`ipcRenderer.invoke('fury-hud:open').then(()=>false,()=>true)`));
        assert.strictEqual(await page.evaluate('document.querySelectorAll("#desktop-hud-controls,#overlay-floating-window,#overlay-preview-mode").length'),0);
        await page.evaluate("activatePage('cosmetics')");assert.strictEqual(await page.evaluate('activePageName()'),'dashboard');
        record('Desktop HUD, floating/fullscreen routes and diagnostic pages are unavailable');
        await page.evaluate(`activatePage('settings');activateSettingsSubpage('network',false);`);
        const [replacementPort]=await unusedPorts(1);await change('proxy-direct-port',replacementPort,'input');
        assert.strictEqual(JSON.parse(fs.readFileSync(path.join(profile,'server_config.json'))).proxyDirectPort,directPort,'Unfinished network edits must remain unsaved');
        await change('proxy-direct-port',replacementPort);await eventually(async()=>assert.strictEqual(JSON.parse(fs.readFileSync(path.join(profile,'server_config.json'))).proxyDirectPort,replacementPort),'Applying network settings');
        await page.waitForFunction('!settingsSaveInFlight');
        await change('proxy-direct-port',directPort);await eventually(async()=>assert.strictEqual(JSON.parse(fs.readFileSync(path.join(profile,'server_config.json'))).proxyDirectPort,directPort),'Restoring fixture port');
        await page.waitForFunction('!settingsSaveInFlight');
        record('Connection fields save automatically when editing finishes');
        await page.evaluate(`activateSettingsSubpage('api',false);document.querySelector('[data-api-card="hypixel"]').open=true`);
        await change('key-hypixel','isolated-test-value');
        await eventually(async()=>{await page.evaluate('refresh()');assert.strictEqual(await page.evaluate('state.settings.keys.hypixel'),'isolated-test-value');},'Saving API key draft');
        await page.waitForFunction('!settingsSaveInFlight');
        await change('key-hypixel','');
        await eventually(async()=>{await page.evaluate('refresh()');assert.strictEqual(await page.evaluate('state.settings.keys.hypixel'),'');},'Restoring empty test key');
        await page.waitForFunction('!settingsSaveInFlight');
        await page.evaluate(`window.actualSaveInvoke=ipcRenderer.invoke.bind(ipcRenderer);window.holdSave=true;ipcRenderer.invoke=async(channel,...args)=>{const result=await window.actualSaveInvoke(channel,...args);if(channel==='settings:save-patch'&&window.holdSave){window.holdSave=false;return new Promise(resolve=>{window.releaseSave=()=>resolve(result);});}return result;};`);
        await change('key-hypixel','first-isolated-draft');await page.waitForFunction('typeof window.releaseSave === "function"');
        await change('key-hypixel','newer-isolated-draft','input');assert(await page.evaluate('settingsSaveInFlight'));
        await page.evaluate('window.releaseSave()');await page.waitForFunction('!settingsSaveInFlight');
        assert.strictEqual(await page.$eval('#key-hypixel',e=>e.value),'newer-isolated-draft');assert(await page.evaluate('ordinaryDrafts.has(ids.hypixel)'));
        await page.evaluate('ipcRenderer.invoke=window.actualSaveInvoke');await change('key-hypixel','newer-isolated-draft');await settledOrdinarySave();
        assert.strictEqual(await page.evaluate('state.settings.keys.hypixel'),'newer-isolated-draft');
        await change('key-hypixel','');await settledOrdinarySave();assert.strictEqual(await page.evaluate('state.settings.keys.hypixel'),'');
        record('Edits made during an in-flight settings save survive its response and can be saved separately');
        assert.strictEqual(JSON.parse(fs.readFileSync(path.join(profile,'server_config.json'))).proxyDirectPort,directPort);
        record('API keys save automatically and preserve the saved network configuration');
        await delay(500);await page.evaluate(`document.querySelectorAll('.fury-notification button').forEach(button=>button.click())`);await delay(500);

        const views=[['dashboard','dashboard'],['overlay','overlay'],['sessions','sessions'],['denicks','nicks'],['reminders','reminders'],['profiles','profiles'],['console','console'],...['launcher','scan','gameplay','sessions','denick','overlay','display','api','network'].map(k=>['settings',`settings-${k}`,k])];
        for(const [width,height] of [[1440,900],[1024,680]]){
            await page.setViewport({width,height,deviceScaleFactor:1});
            for(const [view,name,category,tab] of [...views,['settings','settings-nametags','display','nametags'],['settings','settings-colors','display','colors']]){
                await page.evaluate(`activatePage('${view}');${category?`activateSettingsSubpage('${category}',false);`:''}${category==='display'?`furyDesign.showIngame('${tab||'tablist'}');`:''}document.querySelector('main').scrollTop=0;`);await delay(100);
                const layout=await page.evaluate(`(()=>{const active=document.querySelector('.tab-page.active'),main=document.querySelector('main');return{name:'${name}',width:${width},overflow:main.scrollWidth-main.clientWidth,controls:[...active.querySelectorAll('input,select,button')].filter(e=>e.checkVisibility()&&e.getBoundingClientRect().right>innerWidth+2).map(e=>e.id||e.className)}})()`);
                layouts.push(layout);assert(layout.overflow<=2,JSON.stringify(layout));assert.deepStrictEqual(layout.controls,[],JSON.stringify(layout));
                if(width===1440)await page.screenshot({path:path.join(output,`${name}.png`)});
            }
            await page.evaluate("activatePage('settings');activateSettingsSubpage('scan',false);document.querySelector('main').scrollTop=0");
            const centers=await page.evaluate(()=>{
                const cy=e=>{const r=e.getBoundingClientRect();return r.y+r.height/2;};
                const errors=[];
                for(const [input,icon] of [['#global-search-input','.global-search-icon']])if(Math.abs(cy(document.querySelector(input))-cy(document.querySelector(icon)))>.5)errors.push(input);
                for(const b of document.querySelectorAll('.scan-mode-buttons button'))if(Math.abs(cy(b)-cy(b.querySelector('strong')))>.5)errors.push('scan '+b.textContent.trim());
                for(const e of document.querySelectorAll('.fury-number-control'))if(e.checkVisibility())for(const c of e.children)if(Math.abs(cy(e)-cy(c))>.5)errors.push(c.id||c.tagName);
                return errors;
            });assert.deepStrictEqual(centers,[]);
            await page.evaluate(`clearTimeout(refreshTimer);activatePage('overlay');clearTimeout(refreshTimer);overlayState.orders.BEDWARS=['fkdr','wlr','ws','ping'];overlayState.view='teams';overlayState.modePreference='AUTO';overlayTableSignature='';renderOverlay({connected:true,gameActive:true,currentGamemode:'BEDWARS',gameSessionId:'test-16',overlayPlayers:Array.from({length:16},(_,i)=>({name:'Player_'+String(i+1).padStart(2,'0')+'_longID',mode:'BEDWARS',team:{name:['Red','Blue','Green','Yellow'][Math.floor(i/4)],letter:['R','B','G','Y'][Math.floor(i/4)],colorName:['red','blue','green','yellow'][Math.floor(i/4)]},stats:{stars:300+i,fkdr:6.5,wlr:2.5,wins:18117,finals:55004,beds:24269,ws:100},tags:[]}))});`);await delay(100);
            const board=await page.evaluate(`(()=>{const shell=document.querySelector('#overlay-table'),rows=[...shell.querySelectorAll('.fury-board-row[data-player]')],names=[...shell.querySelectorAll('.fury-board-player')],labels=[...shell.querySelectorAll('.fury-board-labels > span')];return{count:rows.length,cards:shell.querySelectorAll('.fury-board-card').length,shellBottom:shell.getBoundingClientRect().bottom,pageOverflow:document.querySelector('main').scrollHeight>document.querySelector('main').clientHeight+1,clipped:names.filter(e=>e.scrollWidth>e.clientWidth+1).length,clippedLabels:labels.filter(e=>e.scrollWidth>e.clientWidth+1).length}})()`);
            assert.strictEqual(board.count,16);assert.strictEqual(board.cards,4);assert(board.shellBottom<=height,JSON.stringify(board));assert(!board.pageOverflow,JSON.stringify(board));assert.strictEqual(board.clipped,0);assert.strictEqual(board.clippedLabels,0);await page.screenshot({path:path.join(output,`overlay-16-${width}.png`)});
            await click('#overlay-layout-toggle');
            assert(await page.$eval('#overlay-layout-drawer',e=>e.checkVisibility()&&e.getBoundingClientRect().right<=innerWidth&&e.getBoundingClientRect().bottom<=innerHeight));
            assert(await page.$$eval('.overlay-order-item .tablist-order-label',labels=>labels.length>0&&labels.every(e=>e.scrollWidth<=e.clientWidth+1)));
            if(width===1440)await page.screenshot({path:path.join(output,'overlay-columns.png')});
            await click('.fury-close-columns');assert.strictEqual(await page.$eval('#overlay-layout-drawer',e=>e.hidden),true);
        }
        record('All main pages and nine settings categories fit 1440×900 and 1024×680; all 16 board rows render in team cards with unclipped names while only the board scrolls');
        await page.setViewport({width:1440,height:900,deviceScaleFactor:1});
        await page.evaluate("activatePage('dashboard')");await click('#sidebar-toggle');
        await page.waitForFunction('document.documentElement.dataset.sidebar === "collapsed"');await delay(250);
        await page.screenshot({path:path.join(output,'sidebar-collapsed.png')});await click('#sidebar-toggle');
        await click('#global-search-input');await page.type('#global-search-input','nametag');
        await page.waitForFunction('document.getElementById("global-search-results").checkVisibility() && document.getElementById("global-search-results-content").textContent.toLowerCase().includes("nametag")');
        await page.screenshot({path:path.join(output,'global-search.png')});await page.keyboard.press('Escape');
        assert.strictEqual(await page.$eval('#global-search-results',e=>e.hidden),true);
        assert.strictEqual(await page.$eval('#global-search-input',e=>e.value),'');
        await page.$eval('#global-search-input',e=>{e.focus();e.value='profile';e.dispatchEvent(new Event('input',{bubbles:true}));e.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}));});await delay(100);
        assert.strictEqual(await page.$eval('#global-search-results',e=>e.hidden),true);
        record('Columns drawer stays within both window sizes; sidebar collapse and search popup work with keyboard dismissal');
        for(const tab of ['nametags','colors']) {await page.evaluate(`activatePage('settings');activateSettingsSubpage('display',false);furyDesign.showIngame('${tab}');document.querySelector('main').scrollTop=0;`);await delay(500);await page.screenshot({path:path.join(output,`settings-${tab}.png`)});assert.strictEqual(await page.evaluate('nametagPreviewIsVisible()'),tab==='nametags');if(tab==='nametags')await page.waitForFunction('nametagSkinViewer?.playerObject.skin.visible === true');}
        assert(await page.evaluate('nametagSkinViewer.renderPaused'));
        await page.evaluate(`activatePage('denicks');activateDenickSubpage('history');`);await delay(250);
        await page.waitForSelector('.fury-nick-row');await page.screenshot({path:path.join(output,'nicks-saved-matches.png')});
        await click('.fury-nick-row[data-real="PlayerTwo"]');assert(await page.$eval('.fury-nick-detail',e=>e.textContent.includes('PlayerTwo')));
        await page.evaluate(`document.querySelector('.denick-history-tools >button').click()`);await page.screenshot({path:path.join(output,'nicks-manual-mapping.png')});await page.keyboard.press('Escape');
        assert.strictEqual(await page.evaluate('document.querySelector(".fury-mapping-dialog").open'),false);
        await page.evaluate(`activateDenickSubpage('lookup')`);await delay(200);
        assert(await page.$eval('#denick-advanced-fields',el=>el.disabled));
        assert(!(await page.$eval('#denick-run-lookup',el=>el.disabled)));
        assert(await page.evaluate(()=>['denick-lookup-finals','denick-lookup-beds'].every(id=>!document.getElementById(id).matches(':disabled'))));
        const captureLookup=()=>page.evaluate(async()=>{
            await ensureDenickLookupCatalog();
            const original=ipcRenderer.invoke;let request;
            ipcRenderer.invoke=(channel,payload)=>channel==='denick:lookup'?(request=payload,Promise.resolve({candidates:[]})):original(channel,payload);
            try {await runDenickLookup();return request;}finally{ipcRenderer.invoke=original;}
        });
        await page.$eval('#denick-lookup-finals',el=>el.value='53180');
        await page.$eval('#denick-lookup-beds',el=>el.value='24333');
        assert.deepStrictEqual(await captureLookup(),{stats:{finals:'53180',beds:'24333'},cosmetics:[],limit:100});
        await page.screenshot({path:path.join(output,'nicks-lookup-disabled.png')});
        await queueClick('[data-denick-advanced="on"]');
        assert(!(await page.$eval('#denick-advanced-fields',el=>el.disabled)));
        assert.strictEqual(await page.evaluate('denickAdvancedLookupEnabled'),true);
        const fields=await page.evaluate(()=>['denick-lookup-finals','denick-lookup-beds','denick-cosmetic-type','denick-cosmetic-value','denick-add-cosmetic-filter'].map(id=>{
            const el=document.getElementById(id),r=(el.closest('.fury-number-control')||el).getBoundingClientRect();return {top:r.top,height:r.height};
        }));
        assert(fields.every((field,index)=>field.height===(index<2?46:44)),JSON.stringify(fields));
        assert(Math.abs(fields[0].top-fields[1].top)<1);
        assert(fields.slice(2).every(field=>Math.abs(field.top-fields[2].top)<1));
        assert(fields[2].top>fields[0].top);
        const cosmeticCatalog=await page.evaluate('denickLookupCatalog');
        for(const field of cosmeticCatalog.fields){
            assert.deepStrictEqual(field.options.slice(0,4).map(option=>option.name),['None','Random','Random Favorite','Not set']);
            assert.strictEqual(new Set(field.options.map(option=>option.apiValue.toLowerCase())).size,field.options.length);
        }
        await page.select('#denick-cosmetic-type','beddestroy');
        await page.$eval('#denick-cosmetic-value',el=>el.scrollIntoView({block:'center',behavior:'instant'}));await delay(250);
        await queueClick('#denick-cosmetic-value');
        assert(await page.$eval('#denick-cosmetic-value',el=>el.getAttribute('aria-expanded')==='true'));
        const popupRect=await page.$eval('.denick-cosmetic-picker',el=>{const r=el.getBoundingClientRect();return {top:r.top,bottom:r.bottom,height:innerHeight}});
        assert(popupRect.top>=0&&popupRect.bottom<=popupRect.height);
        await page.screenshot({path:path.join(output,'cosmetic-picker.png')});
        await page.type('#denick-cosmetic-value','random');
        assert.strictEqual(await page.$$eval('.denick-picker-option',els=>els.length),2);
        await page.keyboard.press('ArrowDown');await page.keyboard.press('Enter');
        assert.strictEqual(await page.$eval('#denick-cosmetic-value',el=>el.value),'Random Favorite');
        await queueClick('#denick-add-cosmetic-filter');
        assert.strictEqual((await captureLookup()).cosmetics[0].value,'random_favorite_cosmetic');
        await queueClick('#denick-cosmetic-value');await page.type('#denick-cosmetic-value','none');await page.keyboard.press('Enter');
        await queueClick('#denick-add-cosmetic-filter');
        assert.strictEqual((await captureLookup()).cosmetics[0].value,'beddestroy_none');
        await page.evaluate(()=>{denickLookupFilters=[];renderDenickLookupFilters();});
        record('Cosmetic picker searches, fits the window, supports keyboard selection, and sends distinct None/Random Favorite values');
        await page.evaluate(()=>{
            for(const [index,value] of ['Blood Explosion','Dragon Rider'].entries()) {
                document.getElementById('denick-cosmetic-type').selectedIndex=index;
                document.getElementById('denick-cosmetic-value').value=value;
                addDenickCosmeticFilter();
            }
        });
        assert.strictEqual(await page.$$eval('.denick-cosmetic-filter-row',rows=>rows.length),2);
        const advancedRequest=await captureLookup();assert.strictEqual(advancedRequest.cosmetics.length,2);
        await queueClick('[data-denick-advanced="off"]');
        assert.deepStrictEqual((await captureLookup()).cosmetics,[]);
        assert.strictEqual(await page.$$eval('.denick-cosmetic-filter-row',rows=>rows.length),2);
        await queueClick('[data-denick-advanced="on"]');
        assert.deepStrictEqual((await captureLookup()).cosmetics,advancedRequest.cosmetics);
        const filterRows=await page.$$eval('.denick-cosmetic-filter-row',rows=>rows.map(row=>{const r=row.getBoundingClientRect();return {top:r.top,bottom:r.bottom,left:r.left,width:r.width}}));
        assert(filterRows[1].top>filterRows[0].bottom&&filterRows[0].left===filterRows[1].left&&filterRows[0].width===filterRows[1].width);
        await page.evaluate(()=>renderDenickLookupResults({candidates:[{name:'Nestersen',rankPrefix:'\u00a76[MVP\u00a7c++\u00a76]',nameColor:'\u00a76',star:1911,finals:53180,beds:24333,fkdr:11.21,wins:18199,losses:4486,wlr:4.06,winstreak:9}]},{finals:53180,beds:24333}));
        const typography=await page.evaluate(()=>[...document.querySelectorAll('.denick-formatted-identity >span,.denick-result-stat strong')].map(el=>{
            const s=getComputedStyle(el);return {size:s.fontSize,line:s.lineHeight,weight:s.fontWeight};
        }));
        assert(typography.every(item=>item.size==='16px'&&item.line==='24px'&&item.weight==='600'),JSON.stringify(typography));
        const identityLines=await page.$$eval('.denick-formatted-identity >span',els=>els.map(el=>el.getBoundingClientRect().top));
        assert(identityLines.every(top=>Math.abs(top-identityLines[0])<1),JSON.stringify(identityLines));
        await page.screenshot({path:path.join(output,'nicks-lookup.png')});
        await queueClick('[data-denick-filter-remove="0"]');
        assert.strictEqual(await page.$$eval('.denick-cosmetic-filter-row',rows=>rows.length),1);
        assert.strictEqual(await page.$eval('.denick-filter-value',el=>el.textContent),'Dragon Rider');
        await queueClick('[data-denick-advanced="off"]');
        assert(await page.$eval('#denick-advanced-fields',el=>el.disabled));
        assert.strictEqual(await page.evaluate('denickAdvancedLookupEnabled'),false);
        record('Lookup fields align, identity and totals use consistent typography, and stat lookup stays available and Advanced Lookup gates only cosmetic filter rows');
        record('Saved nick rows select their own details; manual mapping and lookup remain accessible');
        await page.evaluate(`activatePage('profiles');document.querySelector('[data-profile-action=review]').click()`);await page.screenshot({path:path.join(output,'profile-details.png')});
        await page.evaluate(`document.querySelector('[data-profile-action="duplicate"]').click()`);await page.screenshot({path:path.join(output,'profile-editor.png')});await page.keyboard.press('Escape');
        await page.evaluate(`activatePage('dashboard');document.getElementById('fury-account-trigger').click()`);await page.screenshot({path:path.join(output,'account-menu.png')});await page.keyboard.press('Escape');
        assert(await page.evaluate('document.activeElement.id==="fury-account-trigger"'));
        record('Profile dialogs and account menu open and dismiss; the skin preview works offline and pauses when hidden');
        await page.evaluate('furyDesign.openManager()');await page.screenshot({path:path.join(output,'account-manager.png')});
        if (process.env.FURY_SKIP_REAL_AUTH_TEST !== '1') {
        await page.evaluate("document.querySelector('.fury-account-manager').close();furyDesign.showSignIn()");await page.screenshot({path:path.join(output,'account-signin.png')});
        await page.evaluate(()=>[...document.querySelectorAll('.fury-onboarding button')].find(b=>b.textContent==='Cancel').click());await page.waitForFunction(()=>!document.querySelector('.fury-onboarding-spinner'));
        const cancelled=await page.evaluate(`(async()=>{const pending=ipcRenderer.invoke('auth:microsoft-login','CancelTest').then(()=>({unexpected:true}),e=>({error:e.message}));const cancelled=await ipcRenderer.invoke('auth:microsoft-cancel');return {cancelled,result:await pending};})()`);
        assert.strictEqual(cancelled.cancelled,true);assert.match(cancelled.result.error,/cancelled/i);
        assert.deepStrictEqual(fs.readdirSync(path.join(profile,'launcher_data','auth-staging')),[]);
        assert(!fs.existsSync(path.join(profile,'auth_tokens','CancelTest')));
        record('Cancelling browser sign-in stops the auth worker and removes its temporary cache');
        } else {
            await page.evaluate("document.querySelector('.fury-account-manager').close()");
            record('Real-auth subtest not run in packaging CI; isolated onboarding fixtures cover sign-in UI');
        }
        await page.evaluate(`activatePage('settings');activateSettingsSubpage('overlay',false);FuryNotifications.dismissAll();window.notificationExample={kind:'success',title:'Clear at game boundaries updated',detail:'Changed Clear at game boundaries.',duration:9000};FuryNotifications.show(window.notificationExample);FuryNotifications.show(window.notificationExample);`);
        await delay(250);
        assert.strictEqual(await page.$$eval('.fury-notification',els=>els.length),1);
        assert(await page.$eval('.fury-notification',e=>{const r=e.getBoundingClientRect(),copy=e.querySelector('.notification-copy').getBoundingClientRect(),icon=e.querySelector('.notification-icon').getBoundingClientRect(),close=e.querySelector('.notification-close').getBoundingClientRect();return r.height===56&&Math.abs(icon.y+icon.height/2-close.y-close.height/2)<.5&&copy.width>240&&getComputedStyle(e.querySelector('.notification-progress')).display==='none';}));
        await page.screenshot({path:path.join(output,'notifications.png')});await click('.notification-close');await delay(300);assert.strictEqual(await page.$('.fury-notification'),null);
        record('Compact notification icon, message and dismiss button align; duplicate feedback coalesces and dismissal works');
        await page.evaluate(`activatePage('dashboard')`);await click('#proxy-start');
        await eventually(async()=>{await page.evaluate('refresh()');assert(await page.evaluate('state.services.proxy.running && document.getElementById("proxy-stop").checkVisibility() && !document.getElementById("proxy-start").checkVisibility()'));},'Starting the isolated test proxy');
        await eventually(async()=>{await page.evaluate('refresh()');assert.strictEqual(await page.evaluate('state.proxyHealth?.features?.partySplitWarningsEnabled'),false);},'Loading the saved warning preference into a fresh proxy process');
        await change('party-split-warnings-enabled',true);await waitSaved('partySplitWarningsEnabled',true);
        await eventually(async()=>{await page.evaluate('refresh()');assert.strictEqual(await page.evaluate('state.proxyHealth?.features?.partySplitWarningsEnabled'),true);},'Enabling warnings in the running proxy');
        await change('party-split-warnings-enabled',false);await waitSaved('partySplitWarningsEnabled',false);
        await eventually(async()=>{await page.evaluate('refresh()');assert.strictEqual(await page.evaluate('state.proxyHealth?.features?.partySplitWarningsEnabled'),false);},'Disabling warnings in the running proxy');
        record('The saved warning preference survives proxy startup and launcher changes reach the running proxy immediately');
        const buttonCenter=async id=>page.$eval(id,e=>{const r=e.getBoundingClientRect(),children=[...e.children].filter(c=>c.checkVisibility()).map(c=>c.getBoundingClientRect());return Math.abs((children[0].left+children.at(-1).right)/2-r.x-r.width/2)<.5&&children.every(c=>Math.abs(c.y+c.height/2-r.y-r.height/2)<.5);});
        assert(await buttonCenter('#proxy-stop'));
        await page.screenshot({path:path.join(output,'proxy-running.png')});await click('#proxy-stop');
        await eventually(async()=>{await page.evaluate('refresh()');assert(await page.evaluate('!state.services.proxy.running && document.getElementById("proxy-start").checkVisibility()'));},'Stopping the isolated test proxy');
        assert(await buttonCenter('#proxy-start'));
        record('The single Start/Stop control starts and stops an actual isolated proxy process');
        // Exercise API-free persistence through the real launcher's IPC and
        // canvas renderer, without touching the user's session history.
        let localNow=Date.now()-180000;
        const localStore=require('../src/session/sessionStore').createSessionStore({
            sessionFile:path.join(profile,'session_data.json'),now:()=>localNow,saveDelayMs:0,
            writeJsonOffThread:require('./test_support/publication_writer').writeJson
        });
        const localTracker=require('../src/session/sessionTracker').createSessionTracker({
            store:localStore,getIdentity:()=>accounts[0],now:()=>localNow,isApiAvailable:()=>false,
            fetchOwnStats:async()=>{throw new Error('Local tracking requested API stats');},
            setTimeoutImpl:()=>({unref(){}}),clearTimeoutImpl:()=>{}
        });
        const localStart={mode:'BEDWARS',sessionKey:'local-ui-game',observedFromStart:true,
            standardBedwars:true,identityKnown:true,ownTeam:'Aqua'};
        await localTracker.onGameStart(localStart);
        localTracker.observeLocalChat('Opponent was killed by Nestersen. FINAL KILL!',localStart);
        localTracker.observeLocalChat('Rival was killed by Nestersen. FINAL KILL!',localStart);
        localTracker.observeLocalChat('BED DESTRUCTION > Red Bed was destroyed by Nestersen!',localStart);
        localTracker.observeLocalChat('BED DESTRUCTION > Your Bed was destroyed by Rival!',localStart);
        localTracker.observeLocalResult('VICTORY!');localNow+=60000;
        await localTracker.onGameEnd({...localStart,durationMs:60000});
        const localId=await localTracker.finish();localTracker.detach();
        await localStore.flush({strict:true});
        localStore.verifyPersistence();
        await eventually(async()=>{await page.evaluate('refresh()');assert(await page.evaluate(id=>state.sessionHistory.sessions.some(s=>s.id===id),localId));},'Loading local session via account-scoped IPC');
        await page.evaluate("activatePage('sessions');document.querySelector('main').scrollTop=0;document.querySelector('.fury-session-row').open=true");
        await page.waitForFunction('document.querySelector(".fury-card-image canvas")?.getAttribute("aria-label")?.includes("Local tracking")');
        const localCard=await page.$eval('.fury-card-image canvas',c=>({text:c.getAttribute('aria-label'),png:c.toDataURL()}));
        assert(localCard.text.includes('Final kills: 2')&&localCard.text.includes('Beds broken: 1')&&localCard.text.includes('Beds lost: 1'));
        for(const available of ['Wins: 1','Losses: 0','Kills: 0','Deaths: 0','Final deaths: 0','FKDR:','WLR:','KDR:','BBLR:','Win rate: 100.0%','Local streak: 1'])assert(localCard.text.includes(available),available);
        assert(!localCard.text.includes('Stars gained:'));
        assert(!await page.$eval('.fury-session-row',e=>e.textContent.includes('undefined')));
        fs.writeFileSync(path.join(output,'local-session-card.png'),Buffer.from(localCard.png.split(',')[1],'base64'));
        await page.screenshot({path:path.join(output,'local-session.png')});
        const filteredLocal=await page.evaluate(async id=>{
            const session=state.sessionHistory.sessions.find(s=>s.id===id);
            if(!session?.modes.some(mode=>mode.local))throw new Error('Expected compact local session modes');
            for(const field of ['trackingSource','baseline','latest','localTracking'])
                if(Object.hasOwn(session,field))throw new Error('Internal field leaked into compact history: '+field);
            const rendered=await require('./src/launcher/renderer/launcher_session_card').render(session,{fields:['wins'],avatar:false});
            const partial=structuredClone(session);partial.modes[0]={mode:'BEDWARS',label:'BedWars',local:true,unavailable:['finals','beds','bedsLost']};
            const uncertain=await require('./src/launcher/renderer/launcher_session_card').render(partial,{avatar:false});
            return {text:rendered.canvas.getAttribute('aria-label'),partial:uncertain.canvas.getAttribute('aria-label'),partialPng:uncertain.canvas.toDataURL()};
        },localId);
        assert(filteredLocal.text.includes('Beds lost: 1'));
        assert(filteredLocal.partial.includes('No verified counters available')&&!filteredLocal.partial.includes('Final kills:'));
        fs.writeFileSync(path.join(output,'local-session-incomplete.png'),Buffer.from(filteredLocal.partialPng.split(',')[1],'base64'));
        await select('SecondAccount');await page.waitForFunction('state.accountKey==="bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb" && state.sessionHistory.sessions.every(s=>s.name==="SecondAccount")');
        assert(!await page.evaluate(id=>state.sessionHistory.sessions.some(s=>s.id===id),localId));
        record('API-free sessions persist per account and generate PNGs with only supported counters; unavailable fields and ratios stay hidden');
        await require('./verify_launcher_order_overlay')({page,output});
        record('Row ordering remains stable during dragging and save replies; every overlay column stays reachable at both window sizes');
        await require('./verify_session_card_designs')({page,output});
        record('New session card layouts render all three games, old missing data, partial counts and 1/5/10/17/31 modes');
        await require('./verify_launcher_session_modes')({page,output});
        record('Session mode picker supports keyboard switching, single-mode labels and consistent stats-only filtering');
        await require('./verify_launcher_account_actions')({page,output,profile});
        record('Accounts can be removed without losing history; offline player heads use Steve');
        assert.deepStrictEqual(errors,[]);
        fs.writeFileSync(path.join(output,'verification.json'),JSON.stringify({checkedAt:new Date().toISOString(),platform:process.platform,architecture:process.arch,packaged:Boolean(packaged),graphics:uiTestArguments().length?'SwiftShader (CI virtual GPU)':'default',version:require('../package.json').version,sourceCommit:process.env.GITHUB_SHA||null,checks,layouts,errors},null,2));
        const galleryCount=require('./launcher_review_gallery').writeGallery(output);
        await page.goto(require('url').pathToFileURL(path.join(output,'gallery.html')).href);
        await page.waitForFunction(count=>document.querySelectorAll('nav button').length===count && document.querySelector('img').naturalWidth>0,{},galleryCount);
        await page.screenshot({path:path.join(output,'gallery-preview.png')});
        console.log(JSON.stringify({checks:checks.length,layouts:layouts.length,errors,output},null,2));
    }catch(error){console.error('Renderer errors:', errors);if(page)await page.screenshot({path:path.join(output,'failure.png')}).catch(()=>{});throw error;}
    finally{if(browser)await browser.disconnect();await stopChild(child);fs.writeFileSync(path.join(output,'test-launcher.log'),child.output);}
})().catch(error=>{console.error(error);process.exitCode=1;});
