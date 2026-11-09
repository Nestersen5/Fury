'use strict';

// Real Chromium layout is essential here: measuring a collapsed details
// subtree can force its otherwise hidden content to be laid out synchronously.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));

module.exports=async function verify({page,output,nativeWindow}){
    const checks=[],samples=[],errors=[];
    page.on('pageerror',error=>errors.push(error.message));
    const check=(name,value)=>{assert(value,name);checks.push(name);console.log('PASS '+name);};
    const focus=async()=>{await nativeWindow('w.show();w.focus();return w.isFocused();');await page.bringToFront();};
    await focus();await page.setViewport({width:1440,height:900,deviceScaleFactor:1});
    await page.evaluate(()=>{
        NesterTheme.applyMotion(true,false);clearTimeout(refreshTimer);
        window.navigationFixture={refresh,history:state.sessionHistory};refresh=async()=>{};
        const base=structuredClone(state.sessionHistory.sessions[0]);
        const sessions=Array.from({length:150},(_,index)=>({...structuredClone(base),id:'navigation-fixture-'+index,active:false,
            startedAt:Date.now()-(index+1)*86400000,endedAt:Date.now()-(index+1)*86400000+3600000,durationMs:3600000,games:[],
            modes:[{mode:'BEDWARS',label:'BedWars',wins:10,losses:4,games:14,finals:24,finalDeaths:4,
                submodes:[{id:'eight_one',label:'Solos',wins:4,losses:2},{id:'eight_two',label:'Doubles',wins:6,losses:2}]}]}));
        state.sessionHistory={...state.sessionHistory,sessions,calendarSessions:sessions};
        sessionDateFilter='all';sessionModeFilter='';sessionAccountFilter='';sessionResultFilter='';sessionOpponentFilter='';
        window.navigationReads={hiddenElements:0,hiddenText:0,summaryText:0,openedText:0,frames:[]};
        const elementRects=Element.prototype.getClientRects,textRects=Range.prototype.getClientRects,raf=requestAnimationFrame.bind(window);
        window.navigationFixture.restore=()=>{Element.prototype.getClientRects=elementRects;Range.prototype.getClientRects=textRects;window.requestAnimationFrame=raf;};
        const owner=node=>node?.closest('.fury-session-content')?.parentElement;
        Element.prototype.getClientRects=function(){if(owner(this)?.open===false)window.navigationReads.hiddenElements++;return elementRects.call(this);};
        Range.prototype.getClientRects=function(){
            const element=this.commonAncestorContainer.nodeType===1?this.commonAncestorContainer:this.commonAncestorContainer.parentElement;
            const row=owner(element);
            if(row?.open===false)window.navigationReads.hiddenText++;
            if(row?.open===true)window.navigationReads.openedText++;
            if(element?.closest('.fury-session-row>summary'))window.navigationReads.summaryText++;
            return textRects.call(this);
        };
        const known=new WeakMap();
        window.requestAnimationFrame=callback=>{
            if(!known.has(callback))known.set(callback,callback.name==='tick'&&callback.toString().includes('geometryDirty'));
            return raf(now=>{const start=performance.now();callback(now);if(known.get(callback))window.navigationReads.frames.push(performance.now()-start);});
        };
        document.querySelector('[name="fury-seasonal-theme"][value="christmas"]').click();
        NesterTheme.applyMotion(false,false);
    });
    const read=()=>page.evaluate(()=>structuredClone(window.navigationReads));
    try{
        for(let i=0;i<3;i++){
            await focus();
            const sample=await page.evaluate(async()=>{
                activatePage('dashboard');
                const start=performance.now();document.querySelector('[data-page-tab="sessions"]').click();
                const synchronousMs=performance.now()-start;
                await new Promise(resolve=>requestAnimationFrame(()=>setTimeout(resolve,0)));
                return{synchronousMs,presentedMs:performance.now()-start,page:activePageName(),rows:document.querySelectorAll('#session-history-list>.fury-session-row').length};
            });
            samples.push(sample);check('Sessions opens with 150 saved sessions, attempt '+(i+1),sample.page==='sessions'&&sample.rows===150);
        }
        let reads=await read();
        check('Snow never queries collapsed session-card element bounds',reads.hiddenElements===0);
        check('Snow never queries collapsed session-card text bounds',reads.hiddenText===0);
        check('Visible session-row labels remain protected',reads.summaryText>0);
        check('Snow keeps running after page switching',await page.evaluate(()=>document.documentElement.dataset.seasonalMotion==='running'));
        await page.click('.fury-session-row>summary');
        await page.waitForSelector('.fury-session-row[open] .fury-card-image canvas',{visible:true});
        await delay(100);
        reads=await read();check('Opened card text is measured and its preview renders',reads.openedText>0);
        await page.click('[data-submode="eight_two"]');
        await page.waitForFunction(()=>document.querySelector('.fury-session-row[open] .fury-card-image canvas')?.getAttribute('aria-label').includes('BedWars - Doubles'));
        check('Card mode choices still work',true);
        await page.screenshot({path:path.join(output,'sessions-snow.png')});
        for(const kind of ['daily','weekly','monthly']){
            await focus();await page.click('[data-period="'+kind+'"]');
            await page.waitForSelector('.fury-period-row');await delay(80);
            reads=await read();
            check(kind+' summaries open without measuring collapsed cards',reads.hiddenElements===0&&reads.hiddenText===0);
        }
        await page.click('[data-period="sessions"]');
        await page.evaluate(()=>{NesterTheme.applyMotion(true,false);window.navigationPausedFrames=window.navigationReads.frames.length;});
        await delay(100);
        check('Animations off still pauses the effect',await page.evaluate(()=>window.navigationPausedFrames===window.navigationReads.frames.length));
        await page.evaluate(()=>{
            document.querySelector('[name="fury-seasonal-theme"][value="none"]').click();
            activatePage('dashboard');document.querySelector('[data-page-tab="sessions"]').click();
        });
        check('Sessions also opens with None selected',await page.evaluate(()=>activePageName()==='sessions'&&document.querySelectorAll('#session-history-list>.fury-session-row').length===150));
        check('The navigation fixture retains session order and identity',await page.evaluate(()=>state.sessionHistory.sessions.every((session,index)=>session.id==='navigation-fixture-'+index)));
        assert.deepEqual(errors,[]);
    }finally{
        const measured=await read();
        fs.writeFileSync(path.join(output,'navigation-verification.json'),JSON.stringify({checks,samples,reads:measured,errors,runtime:await page.evaluate(()=>process.versions)},null,2));
        await page.evaluate(()=>{
            document.querySelector('[name="fury-seasonal-theme"][value="none"]').click();
            window.navigationFixture.restore();refresh=window.navigationFixture.refresh;state.sessionHistory=window.navigationFixture.history;
            delete window.navigationFixture;delete window.navigationReads;delete window.navigationPausedFrames;
        });
    }
};
