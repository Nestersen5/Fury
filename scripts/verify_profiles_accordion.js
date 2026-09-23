'use strict';
const assert=require('assert'),fs=require('fs'),os=require('os'),path=require('path'),puppeteer=require('puppeteer');
const {cleanEnvironment,unusedPorts,startChild,stopChild,assertRunning,eventually,uiTestArguments}=require('./smoke_packaged_app');
const target=require('./launcher_verification_target').verificationTarget('profiles-accordion');
(async()=>{
 const root=path.resolve(__dirname,'..'),profile=fs.mkdtempSync(path.join(os.tmpdir(),'fury-profiles-check-'));
 const output=target.output;fs.mkdirSync(output,{recursive:true});
 const [debugPort,cosmeticPort,blockedPort]=await unusedPorts(3),env=cleanEnvironment(profile,target.resources,cosmeticPort,blockedPort);if(!target.packaged)env.NODE_BINARY=process.execPath;
 const account={uuid:'a'.repeat(32),name:'Nestersen'};
 require('../src/reminders/rememberedAccount').createReminderAccountStore(path.join(profile,'launcher_data','reminders')).remember(account.uuid,account.name);
 fs.writeFileSync(path.join(profile,'session_data.json'),JSON.stringify({version:3,sessions:[{...account,id:'dashboard-test',startedAt:1788798600000,lastSeen:1788802980000,endedAt:1788802980000,summary:{stats:{Bedwars:{wins_bedwars:10,losses_bedwars:4,games_played_bedwars:14,final_kills_bedwars:24}}},games:[{id:"game-1",at:1788802980000,mode:"BEDWARS",result:"win",durationMs:300000,delta:{stats:{Bedwars:{wins_bedwars:1}}}}]}]}));
 const child=startChild(target.executable,[...target.args,...uiTestArguments(),`--remote-debugging-port=${debugPort}`,'--remote-debugging-address=127.0.0.1','--disable-backgrounding-occluded-windows','--disable-renderer-backgrounding',`--proxy-server=${env.HTTPS_PROXY}`],env,'Profiles accordion verification');
 let browser;
 try{
  browser=await eventually(async()=>{assertRunning(child);return puppeteer.connect({browserURL:`http://127.0.0.1:${debugPort}`,defaultViewport:null});},'Connecting launcher');
  const page=await eventually(async()=>{const p=(await browser.pages()).find(p=>p.url().endsWith('/launcher.html'));assert(p);return p;},'Opening launcher');
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.waitForFunction('typeof furyDesign !== "undefined" && furyDesign && state?.viewedAccount');
  const click=s=>page.locator(s).click();
  await page.waitForFunction('state?.profiles?.profiles?.length >= 3');
  for(const [width,height] of [[1440,900],[1024,680]]){
   await page.setViewport({width,height});await page.evaluate("activatePage('profiles')");
   await page.waitForSelector('[data-profile-card]');
   const before=await page.evaluate('state.profiles.active');
   await click('[data-profile-card]:nth-child(2) [data-profile-action="review"]');
   assert.strictEqual(await page.evaluate('state.profiles.active'),before);
   const selected=await page.evaluate('profileReviewName');
   await page.evaluate('renderProfiles(state.profiles)');assert.strictEqual(await page.evaluate('profileReviewName'),selected);
   await page.focus('[data-profile-card]:first-child [data-profile-action="review"]');await page.keyboard.press('Enter');
   const rows=await page.$$eval('.fury-review-row',els=>els.map(e=>e.querySelector('strong').textContent));
   assert(rows.length<=8);assert.strictEqual(new Set(rows).size,rows.length);
   assert.strictEqual(await page.$$eval('.fury-review-row p',els=>els.length),0);
   assert(await page.$eval('main',e=>e.scrollWidth<=e.clientWidth+1));
   assert(await page.$eval('#fury-profile-review',e=>e.getBoundingClientRect().right<=innerWidth));
   await page.screenshot({path:path.join(output,`profiles-${width}.png`)});
  }
  await click('.fury-profile-library-card.reviewing .fury-profile-more > summary');
  await click('.fury-profile-library-card.reviewing [data-profile-action="duplicate"]');
  assert(await page.$eval('#profile-editor-modal',e=>!e.classList.contains('hidden')));await page.evaluate('closeProfileEditor()');
  await click('[data-page="profiles"] .page-actions .fury-gold-outline');
  assert(await page.$eval('#profile-create-name',e=>e===document.activeElement&&e.checkVisibility()));
  const name=await page.evaluate('profileReviewName');
  await click('#fury-profile-review [data-profile-action="apply"]');
  await page.waitForFunction(name=>state.profiles.active===name,{},name);
  assert.deepStrictEqual(errors,[]);console.log('PASS docked review, keyboard selection, selection retention, unique title-only feature rows, apply, duplicate/save controls and both sizes');
 target.record();
 }finally{if(browser)await browser.disconnect();await stopChild(child);}
})().catch(e=>{console.error(e);process.exitCode=1;});
