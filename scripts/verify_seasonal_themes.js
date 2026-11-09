'use strict';

// Uses the production Electron renderer and the parent harness's isolated profile.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));

async function measure(page,label){
    const client=await page.createCDPSession();
    await client.send('Performance.enable');
    const metrics=async()=>Object.fromEntries((await client.send('Performance.getMetrics')).metrics.map(m=>[m.name,m.value]));
    await page.evaluate(()=>{
        let step=0;
        window.seasonalBenchPointer=setInterval(()=>window.dispatchEvent(new PointerEvent('pointermove',{
            pointerType:'mouse',clientX:28+(step++%8)*23,clientY:440
        })),80);
    });
    const samples=[];
    try{
        await delay(500);
        for(let i=0;i<3;i++){
            const before=await metrics();await delay(2000);const after=await metrics(),elapsed=after.Timestamp-before.Timestamp;
            samples.push({elapsedSeconds:elapsed,taskMsPerSecond:1000*(after.TaskDuration-before.TaskDuration)/elapsed,
                scriptMsPerSecond:1000*(after.ScriptDuration-before.ScriptDuration)/elapsed,
                layoutMsPerSecond:1000*(after.LayoutDuration-before.LayoutDuration)/elapsed,
                styleMsPerSecond:1000*(after.RecalcStyleDuration-before.RecalcStyleDuration)/elapsed,
                heapBefore:before.JSHeapUsedSize,heapAfter:after.JSHeapUsedSize});
        }
    }finally{await page.evaluate(()=>clearInterval(window.seasonalBenchPointer));await client.detach();}
    const median=key=>samples.map(s=>s[key]).sort((a,b)=>a-b)[1];
    return{label,samples,taskMsPerSecond:median('taskMsPerSecond'),scriptMsPerSecond:median('scriptMsPerSecond'),layoutMsPerSecond:median('layoutMsPerSecond')};
}

module.exports=async function verify({page,output,profile,child,baseline=false,masking=false,maskingBaseline=false,navigation=false}){
    let nativeWindow=null,mainSocket=null;
    if(!baseline){
        // Test-only Main inspector: drive actual BrowserWindow focus/minimize,
        // rather than confusing DevTools' emulated page focus with native focus.
        const url=child.output.match(/Debugger listening on (ws:\/\/127\.0\.0\.1:[^\s]+)/)?.[1];
        assert(url,'Missing isolated Main inspector');
        mainSocket=new(require('ws'))(url);await new Promise((resolve,reject)=>{mainSocket.once('open',resolve);mainSocket.once('error',reject);});
        const pending=new Map();let id=0;
        mainSocket.on('message',raw=>{const msg=JSON.parse(raw);const entry=pending.get(msg.id);if(!entry)return;pending.delete(msg.id);clearTimeout(entry.timer);if(msg.error||msg.result.exceptionDetails)entry.reject(Error(JSON.stringify(msg)));else entry.resolve(msg.result.result.value);});
        mainSocket.on('close',()=>{for(const entry of pending.values()){clearTimeout(entry.timer);entry.reject(Error('Main inspector closed'));}pending.clear();});
        nativeWindow=code=>new Promise((resolve,reject)=>{const token=++id;const timer=setTimeout(()=>{pending.delete(token);reject(Error('Native window action timed out'));},5000);pending.set(token,{resolve,reject,timer});mainSocket.send(JSON.stringify({id:token,method:'Runtime.evaluate',params:{expression:'(async()=>{const w=process.mainModule.require("electron").BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().endsWith("/launcher.html"));'+code+'})()',returnByValue:true,awaitPromise:true}}));});
        await nativeWindow('w.show();w.focus();return w.isFocused();');
    }
    if(masking){
        try{return await require('./verify_seasonal_masking')({page,output,profile,nativeWindow,baseline:maskingBaseline});}
        finally{mainSocket?.close();}
    }
    if(navigation){
        try{return await require('./verify_seasonal_navigation')({page,output,nativeWindow});}
        finally{mainSocket?.close();}
    }
    await page.bringToFront();
    await page.evaluate(()=>{window.NesterTheme.applyMotion(false,false);activatePage('dashboard');window.focus();});
    await delay(500);
    const report={at:new Date().toISOString(),baseline,runtime:await page.evaluate(()=>process.versions),viewport:page.viewport(),measurements:[]};
    report.measurements.push(await measure(page,baseline?'before: existing launcher':'after: None'));
    if(!baseline){
        const checks=[],views=[],errors=[];page.on('pageerror',e=>errors.push(e.message));
        const check=(name,value)=>{assert(value,name);checks.push(name);console.log('PASS '+name);};
        const saved=()=>page.evaluate(()=>JSON.parse(localStorage.getItem('fury-seasonal-v1')));
        const open=async()=>{
            await nativeWindow('w.show();w.focus();return w.isFocused();');
            await page.bringToFront();
            await page.evaluate(()=>{activatePage('settings');activateSettingsSubpage('launcher',false);document.querySelector('main').scrollTop=0;});
        };
        const shot=async name=>{await page.screenshot({path:path.join(output,name+'.png')});views.push(name);};
        const running=()=>page.waitForFunction(()=>document.documentElement.dataset.seasonalMotion==='running',{timeout:7000});
        const stopped=()=>page.waitForFunction(()=>document.documentElement.dataset.seasonalMotion==='paused',{polling:100,timeout:7000});
        await open();
        check('Seasonal themes default to None with no canvas allocated',await page.evaluate(()=>document.querySelector('[name="fury-seasonal-theme"]:checked').value==='none'&&!document.querySelector('.fury-seasonal-layer')));
        await shot('appearance-none');
        const initialAppearance=await page.evaluate(()=>({theme:document.documentElement.dataset.theme,accent:document.documentElement.dataset.accent,color:getComputedStyle(document.documentElement).getPropertyValue('--accent').trim()}));
        await page.evaluate(()=>{
            window.seasonalNativeEvents=[];
            ipcRenderer.on('window:activity',(_event,value)=>window.seasonalNativeEvents.push(value));
            window.NesterTheme.applyMotion(false);
            const original=window.requestAnimationFrame.bind(window),types=new WeakMap();
            window.seasonalTestFrames=0;
            window.requestAnimationFrame=callback=>{
                if(!types.has(callback))types.set(callback,callback.name==='tick'&&callback.toString().includes('geometryDirty'));
                const seasonal=types.get(callback);
                return original(now=>{if(seasonal)window.seasonalTestFrames++;callback(now);});
            };
        });
        await page.focus('[name="fury-seasonal-theme"][value="none"]');await page.keyboard.press('ArrowRight');
        await running();
        check('Native arrow-key selection saves Christmas and keeps the base theme/accent',await page.evaluate(before=>{
            const p=JSON.parse(localStorage.getItem('fury-seasonal-v1'));
            return p.theme==='christmas'&&document.documentElement.dataset.theme===before.theme&&document.documentElement.dataset.accent===before.accent&&getComputedStyle(document.documentElement).getPropertyValue('--accent').trim()===before.color;
        },initialAppearance));
        check('Decorations cannot intercept player input',await page.$eval('.fury-seasonal-layer',e=>getComputedStyle(e).pointerEvents==='none'));
        check('Snowbank reserves space below the account button',await page.evaluate(()=>document.querySelector('.fury-account-trigger').getBoundingClientRect().bottom<=document.querySelector('.fury-seasonal-bank').getBoundingClientRect().top));
        await shot('appearance-christmas');
        await page.evaluate(()=>activatePage('dashboard'));await delay(300);
        await shot('dashboard-christmas');
        check('Snow clears protected controls',await page.evaluate(()=>{
            const canvas=document.querySelector('.fury-seasonal-canvas'),ctx=canvas.getContext('2d'),r=document.querySelector('.da-dashboard-start').getBoundingClientRect(),d=Math.min(devicePixelRatio,2);
            return ctx.getImageData(Math.round((r.left+r.width/2)*d),Math.round((r.top+r.height/2)*d),1,1).data[3]===0;
        }));
        report.measurements.push(await measure(page,'after: focused Christmas with pointer movement'));
        for(const theme of ['graphite','midnight','forest','light','obsidian','frost']){
            await page.evaluate(theme=>NesterTheme.apply(theme,false),theme);
            for(const [width,height]of [[1440,900],[1024,680]]){
                await page.setViewport({width,height});await open();await delay(80);
                check(theme+' '+width+': seasonal row stays within the page',await page.evaluate(()=>{
                    const row=document.querySelector('.fury-seasonal-winter'),r=row.getBoundingClientRect();
                    return row.offsetHeight<=76&&r.left>=0&&r.right<=innerWidth&&document.querySelector('main').scrollWidth<=document.querySelector('main').clientWidth+1;
                }));
                if(theme==='graphite'||theme==='light')await shot('appearance-'+theme+'-'+width);
            }
        }
        await page.setViewport({width:1440,height:900});await page.evaluate(()=>NesterTheme.apply('graphite',false));await open();
        await page.click('#seasonal-preview');
        check('Winter preview opens the native dialog with packaged artwork',await page.$eval('.fury-seasonal-dialog',d=>d.open&&d.querySelector('img').naturalWidth>0));
        await page.keyboard.press('Escape');
        check('Escape closes the preview and restores focus',await page.evaluate(()=>!document.querySelector('.fury-seasonal-dialog').open&&document.activeElement.id==='seasonal-preview'));
        for(const [id,key]of [['seasonal-edges','edges'],['seasonal-lights','lights'],['seasonal-trail','trail'],['seasonal-snow','snow']]){
            await page.click('#'+id);check(key+' can be disabled and is saved',(await saved())[key]===false);
            await page.click('#'+id);check(key+' can be restored',(await saved())[key]===true);
        }
        await page.click('#settings-animations-enabled');await stopped();
        check('Animations preference stops seasonal frames',await page.evaluate(()=>{window.seasonalFrameCheckpoint=window.seasonalTestFrames;return document.documentElement.dataset.motion==='reduced';}));
        await delay(200);check('No seasonal animation callbacks while Animations is off',await page.evaluate(()=>window.seasonalTestFrames===window.seasonalFrameCheckpoint));
        await page.click('#settings-animations-enabled');await running();
        await nativeWindow('globalThis.seasonalFocusProbe=new(process.mainModule.require("electron").BrowserWindow)({width:260,height:180,show:false,title:"Fury seasonal focus verification",webPreferences:{nodeIntegration:false,contextIsolation:true}});await globalThis.seasonalFocusProbe.loadURL("about:blank");globalThis.seasonalFocusProbe.show();globalThis.seasonalFocusProbe.focus();return true;');
        await stopped();
        check('Native BrowserWindow blur pauses the visible launcher',await nativeWindow('return !w.isFocused()&&w.isVisible()&&!w.isMinimized();'));
        await page.evaluate(()=>{window.seasonalFrameCheckpoint=window.seasonalTestFrames;});await delay(250);
        check('No seasonal animation callbacks while unfocused',await page.evaluate(()=>window.seasonalTestFrames===window.seasonalFrameCheckpoint));
        report.measurements.push(await measure(page,'after: unfocused Christmas'));
        await nativeWindow('globalThis.seasonalFocusProbe.close();delete globalThis.seasonalFocusProbe;w.focus();return w.isFocused();');await page.bringToFront();await running();
        await page.evaluate(()=>ipcRenderer.invoke('window:control','minimize'));await stopped();
        check('Minimizing the real window hides and pauses effects',await page.evaluate(()=>document.hidden));
        await nativeWindow('w.restore();w.focus();return w.isFocused();');await page.bringToFront();await running();
        await page.setViewport({width:1440,height:900});await open();await page.click('#seasonal-snow');await page.evaluate(()=>activatePage('dashboard'));await delay(850);
        await nativeWindow('w.focus();return w.isFocused();');await running();
        report.measurements.push(await measure(page,'after: mouse trail only with pointer movement'));
        await page.evaluate(()=>{
            const ctx=document.querySelector('.fury-seasonal-canvas').getContext('2d'),draw=ctx.drawImage.bind(ctx),clear=ctx.clearRect.bind(ctx);
            window.seasonalMaxDraws=0;let drawn=0;
            ctx.drawImage=(...args)=>{drawn++;window.seasonalMaxDraws=Math.max(window.seasonalMaxDraws,drawn);return draw(...args);};
            ctx.clearRect=(...args)=>{drawn=0;return clear(...args);};
        });
        await nativeWindow('w.focus();return w.isFocused();');await running();
        await measure(page,'trail-cap probe');
        const trailProbe=await page.evaluate(()=>({max:window.seasonalMaxDraws,focused:document.hasFocus(),state:document.documentElement.dataset.seasonalMotion,snow:document.documentElement.dataset.seasonalSnow,trail:document.documentElement.dataset.seasonalTrail,page:document.documentElement.dataset.workspacePage}));
        console.log('Trail probe',trailProbe);
        check('Mouse trails draw at most eight flakes per frame',trailProbe.max>0&&trailProbe.max<=8);
        await delay(900);await page.evaluate(()=>{window.seasonalFrameCheckpoint=window.seasonalTestFrames;});await delay(250);
        check('Trail-only mode becomes idle after its short fade',await page.evaluate(()=>window.seasonalTestFrames===window.seasonalFrameCheckpoint));
        await open();await page.click('#seasonal-snow');
        await nativeWindow('w.focus();return w.isFocused();');await running();
        await page.emulateMediaFeatures([{name:'prefers-reduced-motion',value:'reduce'}]);await delay(150);await stopped();
        console.log('Reduced-motion state',await page.evaluate(()=>({matches:matchMedia('(prefers-reduced-motion: reduce)').matches,noteHidden:document.getElementById('seasonal-motion-note').hidden,motion:document.documentElement.dataset.motion,focused:document.hasFocus()})));
        check('System reduced motion stops all seasonal movement',await page.evaluate(()=>!document.getElementById('seasonal-motion-note').hidden));
        await page.emulateMediaFeatures([{name:'prefers-reduced-motion',value:'no-preference'}]);await delay(150);await running();
        await page.click('#seasonal-lights');const beforeReload=await saved();
        await page.reload();await page.waitForFunction(()=>document.documentElement.dataset.seasonalTheme==='christmas');
        check('Seasonal choices survive a real launcher reload',JSON.stringify(await saved())===JSON.stringify(beforeReload));
        await open();check('Disabled light preference restores its checkbox',await page.$eval('#seasonal-lights',e=>!e.checked));
        await page.click('[name="fury-seasonal-theme"][value="none"]');await stopped();
        check('None restores original logos and releases the canvas backing store',await page.evaluate(()=>{
            const canvas=document.querySelector('.fury-seasonal-canvas');
            return canvas.width===0&&canvas.height===0&&document.querySelector('.ds-brand .fury-mark img').getAttribute('src')==='assets/fury-icon.png'&&document.querySelector('.da-server-icon').getAttribute('src')==='assets/fury-server-icon.png';
        }));
        check('Turning Christmas off keeps its effect choices',(await saved()).lights===false);
        await page.evaluate(()=>{
            window.seasonalRealSetItem=Storage.prototype.setItem;
            Storage.prototype.setItem=function(key,value){if(key==='fury-seasonal-v1')throw new DOMException('full','QuotaExceededError');return window.seasonalRealSetItem.call(this,key,value);};
        });
        try{
            await page.click('[name="fury-seasonal-theme"][value="christmas"]');
            check('A failed save restores the accepted choice without enabling effects',await page.evaluate(()=>document.querySelector('[name="fury-seasonal-theme"]:checked').value==='none'&&document.documentElement.dataset.seasonalTheme==='none'&&JSON.parse(localStorage.getItem('fury-seasonal-v1')).theme==='none'));
        }finally{await page.evaluate(()=>{Storage.prototype.setItem=window.seasonalRealSetItem;delete window.seasonalRealSetItem;});}
        await page.evaluate(()=>localStorage.setItem('fury-seasonal-v1','{broken'));await page.reload();
        await page.waitForFunction(()=>document.documentElement.dataset.seasonalTheme==='none');
        check('Damaged preferences fail closed without affecting base themes',await page.evaluate(()=>document.documentElement.dataset.theme==='graphite'&&!document.querySelector('.fury-seasonal-layer')));
        await open();await page.click('[name="fury-seasonal-theme"][value="christmas"]');
        await page.evaluate(()=>NesterTheme.disposeSeasonal());
        check('Renderer shutdown removes effect layers and lifecycle listeners',await page.evaluate(()=>!document.querySelector('.fury-seasonal-layer')&&!document.documentElement.hasAttribute('data-seasonal-theme')));
        assert.deepEqual(errors,[]);Object.assign(report,{checks,views,errors});
    }
    fs.writeFileSync(path.join(output,'seasonal-verification.json'),JSON.stringify(report,null,2));
    console.log(JSON.stringify(report.measurements));
    mainSocket?.close();
};
