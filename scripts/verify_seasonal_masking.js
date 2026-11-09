'use strict';

const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));

module.exports=async function verify({page,output,nativeWindow,baseline}){
    const checks=[],errors=[];page.on('pageerror',e=>errors.push(e.message));
    const check=(name,value)=>{assert(value,name);checks.push(name);console.log('PASS '+name);};
    const focus=async()=>{await nativeWindow('w.show();w.focus();return w.isFocused();');await page.bringToFront();};
    if(baseline){
        // Replay the captured pre-change renderer in this isolated test profile,
        // without replacing any current production source on disk.
        const source=fs.readFileSync(path.resolve(output,'../before/launcher_seasonal.js'),'utf8');
        await page.evaluate(source=>{
            NesterTheme.disposeSeasonal();
            const Module=require('node:module'),filename=require.resolve('./src/launcher/renderer/launcher_seasonal');
            const fixture=new Module(filename,module);fixture.filename=filename;fixture.paths=module.paths;
            fixture._compile(source,filename);fixture.exports.mount({document});
        },source);
    }
    await focus();await page.setViewport({width:1440,height:900,deviceScaleFactor:1});
    await page.evaluate(()=>{NesterTheme.applyMotion(false);activatePage('denicks');activateDenickSubpage('history');});
    await page.waitForSelector('.fury-nick-row');
    await delay(350);
    const getTargets=(selector,nameSelector='strong')=>page.evaluate(({selector,nameSelector})=>{
        const row=document.querySelector(selector),r=row.getBoundingClientRect(),text=[];
        const walker=document.createTreeWalker(row,NodeFilter.SHOW_TEXT),range=document.createRange();let node;
        while((node=walker.nextNode()))if(node.textContent.trim()){range.selectNodeContents(node);for(const b of range.getClientRects())text.push(b.toJSON());}
        for(const image of row.querySelectorAll('img,svg'))text.push(image.getBoundingClientRect().toJSON());
        const y=r.top+r.height/2;
        let x;
        for(let candidate=r.left+22;candidate<r.right-22;candidate+=12){
            if(!text.some(b=>candidate+9>b.left&&candidate-9<b.right&&y+9>b.top&&y-9<b.bottom)){x=candidate;break;}
        }
        if(x===undefined)throw Error('No clear row background point');
        const nameRange=document.createRange();nameRange.selectNodeContents(row.querySelector(nameSelector));
        const name=nameRange.getBoundingClientRect();
        return{background:{x,y},name:{x:name.left+name.width/2,y:name.top+name.height/2},row:r.toJSON()};
    },{selector,nameSelector});
    const targets=await getTargets('.fury-nick-row');

    async function probe(point){
        await focus();
        await page.evaluate(({x,y})=>{
            document.querySelector('[name="fury-seasonal-theme"][value="none"]').click();
            const snow=document.getElementById('seasonal-snow');if(snow.checked)snow.click();
            window.maskRealRandom=Math.random;let index=0;
            const values=[x/innerWidth,y/innerHeight,.7,.5,.2,.6];Math.random=()=>values[index++%values.length];
            document.querySelector('[name="fury-seasonal-theme"][value="christmas"]').click();
        },point);
        await page.waitForFunction(()=>document.querySelector('.fury-seasonal-canvas')?.width===Math.round(innerWidth*Math.min(devicePixelRatio,2)));
        await page.evaluate(()=>{Math.random=window.maskRealRandom;delete window.maskRealRandom;});
        const result=await page.evaluate(async({x,y})=>{
            const canvas=document.querySelector('.fury-seasonal-canvas'),ctx=canvas.getContext('2d'),original=ctx.drawImage.bind(ctx);
            let hits=0;ctx.drawImage=(source,dx,dy,w,h)=>{if(Math.abs(dx+w/2-x)<12&&dy+h/2>=y-1&&dy+h/2<=y+12)hits++;return original(source,dx,dy,w,h);};
            const snow=document.getElementById('seasonal-snow');snow.click();
            await new Promise(resolve=>setTimeout(resolve,120));
            ctx.drawImage=original;
            const d=Math.min(devicePixelRatio,2),pixel=ctx.getImageData(Math.round(x*d),Math.round((y+1)*d),1,1).data[3];
            return{hits,alpha:pixel,motion:document.documentElement.dataset.seasonalMotion};
        },point);
        return result;
    }
    const background=await probe(targets.background),name=await probe(targets.name);
    check(baseline?'Previous full-row exclusion reproduced':'Snow appears over player-row backgrounds',baseline?background.hits===0:background.hits>0);
    check('Player names remain clear of snow',name.hits===0);
    await page.evaluate(()=>{
        document.querySelector('[name="fury-seasonal-theme"][value="none"]').click();
        document.querySelector('[name="fury-seasonal-theme"][value="christmas"]').click();
        const original=requestAnimationFrame.bind(window),known=new WeakMap();window.maskFrameCosts=[];
        window.requestAnimationFrame=callback=>{
            if(!known.has(callback))known.set(callback,callback.name==='tick'&&callback.toString().includes('geometryDirty'));
            const seasonal=known.get(callback);return original(now=>{const start=performance.now();callback(now);if(seasonal)window.maskFrameCosts.push(performance.now()-start);});
        };
    });
    await focus();await delay(200);
    await page.evaluate(()=>{window.maskFrameCosts=[];});await delay(1000);
    const steady=await page.evaluate(()=>{const a=window.maskFrameCosts.slice().sort((a,b)=>a-b);return{frames:a.length,meanMs:a.reduce((a,b)=>a+b,0)/(a.length||1),p95Ms:a[Math.floor((a.length-1)*.95)]||0,motion:document.documentElement.dataset.seasonalMotion};});
    check('Steady animation measurement ran while focused',steady.frames>0&&steady.motion==='running');
    const costs=[];
    for(let i=0;i<12;i++){
        await focus();
        const cost=await page.evaluate(async()=>{
            window.maskFrameCosts=[];dispatchEvent(new Event('resize'));
            await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
            return window.maskFrameCosts[0];
        });
        assert.equal(typeof cost,'number','Geometry measurement requires an active animation callback');costs.push(cost);
    }
    costs.sort((a,b)=>a-b);const rebuild={medianMs:costs[6],maxMs:costs.at(-1)};
    await page.screenshot({path:path.join(output,'nicks-snow.png')});
    await page.click('.fury-nick-row');
    check('Snow does not intercept player-row clicks',await page.$eval('.fury-nick-dialog',d=>d.open));
    await page.keyboard.press('Escape');
    if(!baseline){
        await page.setViewport({width:1024,height:680,deviceScaleFactor:1});await focus();
        await page.evaluate(()=>{
            const spacer=document.createElement('div');spacer.id='seasonal-scroll-fixture';spacer.style.height='600px';spacer.setAttribute('aria-hidden','true');
            document.querySelector('.fury-nick-table').before(spacer);document.querySelector('main').scrollTop=400;
        });
        await delay(150);
        check('Scroll fixture uses the real page scroller',await page.$eval('main',main=>main.scrollTop>0));
        const scrolled=await getTargets('.fury-nick-row');
        check('Snow follows the row after scrolling', (await probe(scrolled.background)).hits>0);
        check('Scrolled player names remain protected',(await probe(scrolled.name)).hits===0);
        await page.evaluate(()=>document.getElementById('seasonal-scroll-fixture').remove());
        await page.setViewport({width:1440,height:900,deviceScaleFactor:1});await focus();
        await page.evaluate(()=>{activatePage('dashboard');document.querySelector('main').scrollTop=0;});await delay(350);
        const card=await getTargets('.da-recent','.da-session-metrics strong');
        check('Dashboard card backgrounds also show snow',(await probe(card.background)).hits>0);
        check('Card statistic text remains protected',(await probe(card.name)).hits===0);
    }
    assert.deepEqual(errors,[]);
    const report={at:new Date().toISOString(),baseline,targets,background,name,steady,rebuild,checks,errors};
    fs.writeFileSync(path.join(output,'masking-verification.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report));
};
