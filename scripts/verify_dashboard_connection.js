'use strict';
const assert=require('assert'),fs=require('fs'),os=require('os'),path=require('path'),puppeteer=require('puppeteer');
const {cleanEnvironment,unusedPorts,startChild,stopChild,assertRunning,eventually,uiTestArguments}=require('./smoke_packaged_app');
const target=require('./launcher_verification_target').verificationTarget('dashboard-connection');
(async()=>{
 const root=path.resolve(__dirname,'..'),profile=fs.mkdtempSync(path.join(os.tmpdir(),'fury-dashboard-check-'));
 const output=target.output;fs.mkdirSync(output,{recursive:true});
 const [debugPort,cosmeticPort,blockedPort]=await unusedPorts(3),env=cleanEnvironment(profile,target.resources,cosmeticPort,blockedPort);if(!target.packaged)env.NODE_BINARY=process.execPath;
 const account={uuid:'a'.repeat(32),name:'Nestersen'};
 require('../src/reminders/rememberedAccount').createReminderAccountStore(path.join(profile,'launcher_data','reminders')).remember(account.uuid,account.name);
 fs.writeFileSync(path.join(profile,'session_data.json'),JSON.stringify({version:3,sessions:[{...account,id:'dashboard-test',startedAt:1788798600000,lastSeen:1788802980000,endedAt:1788802980000,summary:{stats:{Bedwars:{wins_bedwars:10,losses_bedwars:4,games_played_bedwars:14,final_kills_bedwars:24}}},games:[{id:"game-1",at:1788802980000,mode:"BEDWARS",result:"win",durationMs:300000,delta:{stats:{Bedwars:{wins_bedwars:1}}}}]}]}));
 const authDir=path.join(profile,'auth_tokens',account.name);fs.mkdirSync(authDir,{recursive:true});
 const token='fixture.'+Buffer.from(JSON.stringify({profiles:{mc:account.uuid},pfd:[{type:'mc',id:account.uuid,name:account.name}]})).toString('base64url')+'.fixture';
 fs.writeFileSync(path.join(authDir,'fixture_mca-cache.json'),JSON.stringify({mca:{access_token:token,obtainedOn:Date.now(),expires_in:86400}}));
 const child=startChild(target.executable,[...target.args,...uiTestArguments(),`--remote-debugging-port=${debugPort}`,'--remote-debugging-address=127.0.0.1','--disable-backgrounding-occluded-windows','--disable-renderer-backgrounding',`--proxy-server=${env.HTTPS_PROXY}`],env,'Dashboard connection verification');
 let browser;
 try{
  browser=await eventually(async()=>{assertRunning(child);return puppeteer.connect({browserURL:`http://127.0.0.1:${debugPort}`,defaultViewport:null});},'Connecting launcher');
  const page=await eventually(async()=>{const p=(await browser.pages()).find(p=>p.url().endsWith('/launcher.html'));assert(p);return p;},'Opening launcher');
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.waitForFunction('typeof furyDesign !== "undefined" && furyDesign && state?.viewedAccount');
  await page.evaluate(()=>{localStorage.setItem('fury-onboarded:'+state.viewedAccount.key,'yes');furyDesign.update(state);});
  const click=s=>page.locator(s).click();
  for(const [width,height] of [[1440,900],[1024,680]]){
   await page.setViewport({width,height});await page.evaluate("activatePage('dashboard')");
   await page.waitForFunction('document.getElementById("join-direct-address").value.length > 0');
   assert(await page.$eval('.fury-connection-status',e=>e.textContent==='Proxy stopped'));
   assert.strictEqual(await page.$eval('.join-steps',e=>e.checkVisibility()),false);
   assert.strictEqual(await page.$eval('#join-failover-address',e=>e.checkVisibility()),false);
   await click('[data-copy-route="direct"]');
   assert.strictEqual(await page.evaluate('require("electron").clipboard.readText()'),await page.$eval('#join-direct-address',e=>e.value));
   await page.waitForFunction('document.querySelector("[data-copy-route=direct]").textContent === "Copy address"');
   await click('.fury-connection-help > summary');assert(await page.$eval('.join-steps',e=>e.checkVisibility()));
   await page.keyboard.press('Escape');assert.strictEqual(await page.$eval('.fury-connection-help',e=>e.open),false);
   await click('.fury-connection-options > summary');assert(await page.$eval('#join-failover-address',e=>e.checkVisibility()));
   assert(await page.$eval('.fury-route-menu',e=>{const r=e.getBoundingClientRect();return r.width<=420&&r.left>=0&&r.right<=innerWidth&&r.bottom<=innerHeight&&e.scrollWidth<=e.clientWidth+1;}));
   await page.screenshot({path:path.join(output,`connection-options-${width}.png`)});
   await click('[data-copy-route="failover"]');assert.strictEqual(await page.evaluate('require("electron").clipboard.readText()'),await page.$eval('#join-failover-address',e=>e.value));
   await click('[data-page="dashboard"] > .page-title h2');assert.strictEqual(await page.$eval('.fury-connection-options',e=>e.open),false);
   const geometry=await page.evaluate(()=>{const rect=s=>{const r=document.querySelector(s).getBoundingClientRect();return{left:r.left,right:r.right,top:r.top,bottom:r.bottom};};return{strip:rect('.fury-connection-strip'),recent:rect('.fury-recent'),account:rect('.fury-dashboard-right'),overflow:document.querySelector('main').scrollWidth>document.querySelector('main').clientWidth+1};});
   assert(!geometry.overflow,JSON.stringify(geometry));assert(geometry.strip.bottom<=geometry.recent.top);assert(geometry.recent.right<=geometry.account.left);
   await page.evaluate(()=>{
    clearTimeout(refreshTimer);
    furyDesign.update({...state,sessionHistory:{sessions:[{id:'preview',name:'Nestersen',startedAt:1788798600000,lastSeen:1788802980000,endedAt:1788802980000,durationMs:4380000}]}});
   });
   assert(await page.$eval('.fury-recent-content',e=>e.textContent.includes('Open session')));
   assert(await page.$$eval('.fury-recent-content strong',elements=>elements.every(e=>e.scrollWidth<=e.clientWidth+1)));
   await page.screenshot({path:path.join(output,`dashboard-${width}.png`)});
   await click('.fury-view-sessions');assert(await page.$eval('[data-page="sessions"]',e=>e.classList.contains('active')));
  }
  await page.evaluate(()=>{clearTimeout(refreshTimer);furyDesign.update({...state,services:{...state.services,proxy:{...state.services.proxy,running:true}}});});
  assert.strictEqual(await page.$eval('.fury-connection-status',e=>e.textContent),'Proxy running');
  assert.deepStrictEqual(errors,[]);console.log('PASS live connection status, direct/backup clipboard copy, help/options disclosure and dismissal, session navigation and dashboard geometry at 1440 and 1024');
 target.record();
 }finally{if(browser)await browser.disconnect();await stopChild(child);}
})().catch(e=>{console.error(e);process.exitCode=1;});
