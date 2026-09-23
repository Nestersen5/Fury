'use strict';
const assert=require('assert'),fs=require('fs'),os=require('os'),path=require('path'),puppeteer=require('puppeteer');
const {cleanEnvironment,unusedPorts,startChild,stopChild,assertRunning,eventually,uiTestArguments}=require('./smoke_packaged_app');
const target=require('./launcher_verification_target').verificationTarget('onboarding');
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

  await page.evaluate(()=>{
    clearTimeout(refreshTimer);window.onboardingOriginalInvoke=ipcRenderer.invoke.bind(ipcRenderer);
    window.onboardingFixture=structuredClone(state);onboardingFixture.accountCatalog=[];onboardingFixture.viewedAccount=null;onboardingFixture.sessionHistory={sessions:[]};onboardingFixture.proxyHealth={};
    ipcRenderer.invoke=async(channel,...args)=>{
      if(channel==='state:get')return structuredClone(onboardingFixture);
      if(channel==='auth:microsoft-login'){window.onboardingUsername=args[0];return new Promise((resolve,reject)=>{window.resolveOnboarding=resolve;window.rejectOnboarding=reject;});}
      if(channel==='auth:microsoft-cancel'){window.rejectOnboarding(new Error('Microsoft sign-in cancelled.'));return true;}
      return onboardingOriginalInvoke(channel,...args);
    };
  });
  await page.evaluate('refresh()');await page.waitForFunction('!state.viewedAccount');
  const clickText=text=>page.evaluate(text=>[...document.querySelectorAll('.fury-onboarding button')].find(b=>b.textContent===text).click(),text);
  for(const width of [1440,1024]){
    await page.setViewport({width,height:900});
    assert(await page.$eval('.fury-onboarding',e=>e.textContent.includes('Sign in to Minecraft')));
    await page.screenshot({path:path.join(output,`welcome-${width}.png`)});
  }
  await clickText('Sign in with Microsoft');
  assert.equal(await page.evaluate('onboardingUsername'),'');
  await page.evaluate(()=>showMicrosoftLoginCode({code:'ABCD-EFGH',url:'https://www.microsoft.com/link',directUrl:'https://www.microsoft.com/link?otc=ABCD-EFGH'}));
  await clickText('Copy code');assert.equal(await page.evaluate('require("electron").clipboard.readText()'),'ABCD-EFGH');
  for(const width of [1440,1024]){await page.setViewport({width,height:900});await page.screenshot({path:path.join(output,`code-${width}.png`)});}
  await clickText('Cancel');await page.waitForFunction('!document.querySelector(".fury-onboarding-code")');
  await clickText('Sign in with Microsoft');
  await page.evaluate(()=>{
    const account={key:'a'.repeat(32),uuid:'a'.repeat(32),name:'Nestersen',hasLogin:true,state:'valid'};
    onboardingFixture.viewedAccount=account;onboardingFixture.accountCatalog=[account];
    resolveOnboarding({ok:true,username:account.name,account});
  });
  await page.waitForFunction('document.querySelector(".fury-onboarding").textContent.includes("ready to connect")');
  assert.equal(await page.$$eval('.fury-onboarding-steps li',els=>els.map(e=>e.textContent.replace(/^\d+/,''))).then(x=>x.join('|')),'Multiplayer|Add Server|Server Address|Done|Join Server');
  assert.equal(await page.$$eval('.fury-onboarding-intro',els=>els.length),0);
  assert(!await page.$eval('.fury-onboarding',e=>/Proxy running|Stop proxy/.test(e.textContent)));
  for(const width of [1440,1024]){
    await page.setViewport({width,height:900});
    assert(await page.$eval('.fury-onboarding',e=>e.scrollWidth<=e.clientWidth+1));
    await page.screenshot({path:path.join(output,`ready-${width}.png`)});
  }
  await page.evaluate(()=>{onboardingFixture.proxyHealth={connectedAccount:'Nestersen',connectionReady:true};});await page.evaluate('refresh()');await page.evaluate('refresh()');
  await page.waitForFunction('document.querySelector(".fury-onboarding").hidden');
  assert(await page.$eval('.fury-connection-strip',e=>e.checkVisibility()));
  await page.evaluate(()=>{onboardingFixture.viewedAccount=null;onboardingFixture.accountCatalog=[];onboardingFixture.proxyHealth={};});await page.evaluate('refresh()');
  await clickText('Sign in with Microsoft');await page.evaluate(()=>rejectOnboarding(new Error('Microsoft is temporarily unavailable.')));
  await page.waitForFunction('document.querySelector(".fury-onboarding").textContent.includes("Try again")');
  assert.deepEqual(errors,[]);console.log('PASS onboarding welcome, code copy/cancel, profile completion, one Minecraft stepper, connection completion, error recovery and responsive layouts');
 target.record();
 }finally{if(browser)await browser.disconnect();await stopChild(child);}
})().catch(e=>{console.error(e);process.exitCode=1;});
