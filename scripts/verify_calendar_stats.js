'use strict';
const assert=require('assert'),fs=require('fs'),os=require('os'),path=require('path'),puppeteer=require('puppeteer');
const {cleanEnvironment,unusedPorts,startChild,stopChild,assertRunning,eventually,uiTestArguments}=require('./smoke_packaged_app');
const {dayAt,periodStart}=require('../src/session/calendarStats');
const target=require('./launcher_verification_target').verificationTarget('calendar-stats');
(async()=>{
    const profile=fs.mkdtempSync(path.join(os.tmpdir(),'fury-calendar-check-'));
    const [debugPort,cosmeticPort,blockedPort,directPort,failoverPort,healthPort]=await unusedPorts(6),env=cleanEnvironment(profile,target.resources,cosmeticPort,blockedPort);
    fs.writeFileSync(path.join(profile,'server_config.json'),JSON.stringify({proxyDirectPort:directPort,proxyFailoverPort:failoverPort,healthPort}));
    if(!target.packaged)env.NODE_BINARY=process.execPath;
    const account={uuid:'a'.repeat(32),name:'Nestersen'};
    require('../src/reminders/rememberedAccount').createReminderAccountStore(path.join(profile,'launcher_data','reminders')).remember(account.uuid,account.name);
    const monday=Date.parse(periodStart(dayAt(Date.now(),'Europe/Warsaw'),'weekly')+'T12:00:00Z');
    const sessions=[];
    for(let day=-21;day<=0;day++){
        const at=monday+day*86400000;if(at>Date.now())continue;
        const games=12+(day+21)%7*2,wins=Math.floor(games*.7),stats={wins_bedwars:wins,losses_bedwars:games-wins,games_played_bedwars:games,final_kills_bedwars:wins*3,final_deaths_bedwars:games-wins,kills_bedwars:games*2,deaths_bedwars:games,beds_broken_bedwars:wins,beds_lost_bedwars:games-wins,Experience:games*140,eight_one_games_played_bedwars:Math.floor(games/3),eight_two_games_played_bedwars:games-Math.floor(games/3)};
        for(const prefix of ['eight_one','eight_two']) {
            const n=stats[`${prefix}_games_played_bedwars`],w=Math.floor(n*.7);
            Object.assign(stats,{[`${prefix}_wins_bedwars`]:w,[`${prefix}_losses_bedwars`]:n-w,[`${prefix}_final_kills_bedwars`]:w*3,[`${prefix}_final_deaths_bedwars`]:n-w,[`${prefix}_kills_bedwars`]:n*2,[`${prefix}_deaths_bedwars`]:n,[`${prefix}_beds_broken_bedwars`]:w,[`${prefix}_beds_lost_bedwars`]:n-w});
        }
        sessions.push({...account,id:'calendar-'+day,startedAt:at,lastSeen:at+7200000,endedAt:at+7200000,summary:{stats:{Bedwars:stats}},games:[]});
    }
    fs.writeFileSync(path.join(profile,'session_data.json'),JSON.stringify({version:4,sessions}));
    const authDir=path.join(profile,'auth_tokens',account.name);fs.mkdirSync(authDir,{recursive:true});
    const token='fixture.'+Buffer.from(JSON.stringify({profiles:{mc:account.uuid},pfd:[{type:'mc',id:account.uuid,name:account.name}]})).toString('base64url')+'.fixture';
    fs.writeFileSync(path.join(authDir,'fixture_mca-cache.json'),JSON.stringify({mca:{access_token:token,obtainedOn:Date.now(),expires_in:86400}}));
    const child=startChild(target.executable,[...target.args,...uiTestArguments(),`--remote-debugging-port=${debugPort}`,'--remote-debugging-address=127.0.0.1','--disable-backgrounding-occluded-windows','--disable-renderer-backgrounding',`--proxy-server=${env.HTTPS_PROXY}`],env,'Calendar stats verification');
    let browser;
    try{
        browser=await eventually(async()=>{assertRunning(child);return puppeteer.connect({browserURL:`http://127.0.0.1:${debugPort}`,defaultViewport:null});},'Connecting launcher');
        const page=await eventually(async()=>{const p=(await browser.pages()).find(p=>p.url().endsWith('/launcher.html'));assert(p);return p;},'Opening launcher');
        const errors=[];page.on('pageerror',e=>{errors.push(e.message);console.error('Renderer:',e.message);});
        await page.waitForFunction('typeof furyDesign!=="undefined" && furyDesign && state?.viewedAccount');
        await page.evaluate(()=>activatePage('sessions'));
        await page.waitForFunction('state?.sessionHistory?.sessions?.length>0');
        await page.evaluate(()=>clearTimeout(refreshTimer));
        await page.setViewport({width:1440,height:1000});
        await page.emulateTimezone('Europe/Warsaw');
        await page.evaluate(()=>localStorage.setItem('fury.stats.timezone','Pacific/Honolulu'));
        assert.equal(await page.$$eval('.fury-period-tabs button',els=>els.length),4);
        await page.click('[data-period="weekly"]');
        assert.equal(await page.$('.fury-calendar-timezone select'),null,'Timezone is automatic');
        await page.click('.fury-history-modes [data-filter-mode="BEDWARS"]');
        assert.equal(await page.$eval('#session-mode-filter',e=>e.value),'BEDWARS');
        assert(await page.$eval('.fury-calendar-footnote',e=>e.textContent.includes('Europe/Warsaw')),'Ignore the old manual timezone');
        await page.focus('.fury-history-modes [data-filter-mode="BEDWARS"]');await page.keyboard.press('ArrowRight');
        assert.equal(await page.$eval('#session-mode-filter',e=>e.value),'SKYWARS');
        await page.keyboard.press('ArrowLeft');
        assert.equal(await page.$eval('#session-mode-filter',e=>e.value),'BEDWARS');
        await page.evaluate(()=>document.activeElement.blur());
        await page.waitForSelector('.fury-period-row');
        assert.equal(await page.$$eval('.fury-period-row canvas',els=>els.length),0,'Collapsed summaries generate no images');
        await page.screenshot({path:path.join(target.output,'weekly-list-1440.png')});
        await page.evaluate(()=>{document.querySelectorAll('.fury-period-row')[1].open=true;});
        await page.waitForSelector('.fury-period-row[open] canvas');
        fs.writeFileSync(path.join(target.output,'weekly-card.png'),Buffer.from((await page.$eval('.fury-period-row[open] canvas',c=>c.toDataURL())).split(',')[1],'base64'));
        await page.screenshot({path:path.join(target.output,'weekly-card-1440.png')});
        assert(await page.$eval('.fury-period-row[open] canvas',c=>c.getAttribute('aria-label').includes('Games by day')));
        assert.equal(await page.$('.fury-calendar-account'),null,'No redundant account field');
        assert.equal(await page.$$eval('.fury-history-modes',els=>els.length),1,'One shared mode filter');
        assert.equal(await page.$$eval('.fury-period-row[open] select',els=>els.length),0,'Calendar mode choices use buttons');
        await page.click('.fury-period-row[open] [data-calendar-choice="eight_one"]');
        await page.waitForFunction(()=>document.querySelector('.fury-period-row[open] canvas')?.getAttribute('aria-label').includes('BedWars - Solos'));
        fs.writeFileSync(path.join(target.output,'weekly-solos-card.png'),Buffer.from((await page.$eval('.fury-period-row[open] canvas',c=>c.toDataURL())).split(',')[1],'base64'));
        assert(await page.$eval('.fury-period-row[open] canvas',c=>c.getAttribute('aria-label').includes('Wins:')));
        const rowIdentity=await page.evaluate(()=>{window.checkedPeriodRow=document.querySelector('.fury-period-row[open]');furyDesign.renderSessions(state.sessionHistory,{mode:'BEDWARS'});return checkedPeriodRow===document.querySelector('.fury-period-row[open]');});assert(rowIdentity,'Stable refresh retains row and canvas');
        await page.evaluate(()=>{window.savedCopy=clipboard.writeImage;clipboard.writeImage=image=>window.calendarCopy=image.getSize();document.querySelector('.fury-period-row[open] .fury-calendar-copy').click();});
        assert((await page.evaluate('calendarCopy')).width>500);await page.evaluate('clipboard.writeImage=savedCopy');
        const exports=path.join(profile,'exports');fs.mkdirSync(exports);const cdp=await page.createCDPSession();await cdp.send('Page.setDownloadBehavior',{behavior:'allow',downloadPath:exports});
        await page.click('.fury-period-row[open] .fury-gold-outline');await eventually(async()=>assert(fs.readdirSync(exports).some(f=>f.includes('-weekly')&&f.endsWith('.png'))),'Exporting weekly PNG');
        await page.setViewport({width:1024,height:900});await page.screenshot({path:path.join(target.output,'weekly-card-1024.png')});
        assert(await page.$eval('[data-page="sessions"]',e=>e.scrollWidth<=e.clientWidth+1),'Narrow view has no horizontal overflow');
        await page.click('.fury-period-row[open] .fury-contributions');
        assert.equal(await page.$eval('[data-period="sessions"]',e=>e.getAttribute('aria-selected')),'true');
        assert.equal(await page.$$eval('#session-history-list .fury-session-row',els=>els.length),7);
        await page.click('.fury-contribution-filter button');
        assert.equal(await page.$$eval('#session-history-list .fury-session-row',els=>els.length),sessions.length);
        for(const kind of ['daily','monthly']){
            await page.click(`[data-period="${kind}"]`);await page.evaluate(()=>{document.querySelector('.fury-period-row').open=true;});
            await page.waitForSelector('.fury-period-row[open] canvas');
            assert.equal(await page.$eval('.fury-history-modes [aria-checked="true"]',e=>e.dataset.filterMode),'BEDWARS','Global mode persists across periods');
            await page.click('.fury-period-row[open] [data-calendar-choice="eight_two"]');
            await page.waitForFunction(()=>document.querySelector('.fury-period-row[open] canvas')?.getAttribute('aria-label').includes('BedWars - Doubles'));
            fs.writeFileSync(path.join(target.output,`${kind}-card.png`),Buffer.from((await page.$eval('.fury-period-row[open] canvas',c=>c.toDataURL())).split(',')[1],'base64'));
            await page.setViewport({width:1440,height:1000});await page.screenshot({path:path.join(target.output,`${kind}-card-1440.png`)});
            assert(await page.$eval('.fury-period-row[open] canvas',(c,kind)=>c.getAttribute('aria-label').includes(kind),kind));
        }
        // Verify the common renderer and every chart variant, including bar gaps.
        await require('./verify_session_card_designs')({page,output:target.output});
        const gaps=await page.evaluate(async()=>{
            const cards=require('./src/launcher/renderer/launcher_session_card');const s=structuredClone(state.sessionHistory.sessions[0]);
            s.modes=[{mode:'DUELS',label:'Duels',wins:2,losses:1,games:3,breakdown:{entries:[{id:'a',label:'A',games:1},{id:'b',label:'B',games:1},{id:'c',label:'C',games:1}],total:3,status:'available'}}];
            const {canvas}=await cards.render(s,{avatar:false});const ctx=canvas.getContext('2d');
            // At a row through the bar interiors, background separates each bar.
            const y=250;let runs=0,inside=false;for(let x=0;x<canvas.width;x++){const [r,g,b]=ctx.getImageData(x,y,1,1).data;const bar=r===41&&g===44&&b===49;if(bar&&!inside)runs++;inside=bar;}return runs;
        });assert.equal(gaps,3,'All three bars are separated by background gaps');
        await page.evaluate(()=>{state.sessionHistory={sessions:[],calendarSessions:[]};furyDesign.clearAccount();furyDesign.renderSessions(state.sessionHistory,{});});
        assert.equal(await page.$$eval('.fury-period-row',els=>els.length),0,'Account changes clear stale period cards');
        assert.deepEqual(errors,[]);target.record();console.log('PASS calendar tabs, lazy cards, refresh, filters, contributions, PNG/copy export, responsive layout, monthly activity, account clearing and shared chart gaps.');
    }finally{if(browser)await browser.disconnect();await stopChild(child);}
})().catch(error=>{console.error(error);process.exitCode=1;});
