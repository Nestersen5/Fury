'use strict';

// Production Main/renderer with the parent harness's private profile and local
// fixture history. Never open or change the player's real saved nicknames.
const assert=require('assert/strict'),fs=require('fs'),path=require('path');
module.exports=async function verify({page,output,profile}){
    const checks=[],views=[],errors=[];page.on('pageerror',error=>errors.push(error.message));
    const check=(name,result)=>{assert.ok(result,name);checks.push(name);};
    const click=selector=>page.locator(selector).click();
    const screenshot=async name=>{await page.screenshot({path:path.join(output,name+'.png')});views.push(name);};
    const names=()=>page.$$eval('.fury-nick-row',rows=>rows.map(row=>row.dataset.real));
    const open=()=>page.evaluate(()=>{activatePage('denicks');activateDenickSubpage('history');});
    const filter=async(id,value)=>{await page.select(id,value);};
    await open();await page.waitForSelector('.fury-nick-row');
    await page.waitForFunction(()=>[...document.querySelectorAll('.fury-nick-row .fury-nick-avatar img')].every(img=>img.complete&&img.naturalWidth>0&&!img.hidden));
    checks.push('Visible player heads use the existing offline fallback');
    check('Details stay closed until a match is opened',await page.$eval('.fury-nick-dialog',dialog=>!dialog.open));
    check('The table spans the saved-matches area',await page.$eval('.fury-nick-table',table=>Math.abs(table.getBoundingClientRect().width-document.getElementById('denick-list').getBoundingClientRect().width)<2));
    for(const theme of ['graphite','midnight','forest','light','obsidian','frost']){
        await page.evaluate(theme=>NesterTheme.apply(theme,false),theme);
        for(const [width,height]of [[1440,900],[1024,680]]){
            await page.setViewport({width,height});
            const metrics=await page.evaluate(()=>{
                const table=document.querySelector('.fury-nick-table'),row=table.querySelector('.fury-nick-row'),head=table.querySelector('.fury-nick-table-head');
                const visible=el=>el.getClientRects().length&&getComputedStyle(el).display!=='none';
                return{overflow:document.querySelector('main').scrollWidth-document.querySelector('main').clientWidth,tableOverflow:table.scrollWidth-table.clientWidth,rowHeight:row.getBoundingClientRect().height,headColumns:[...head.children].filter(visible).map(el=>el.getBoundingClientRect().left),rowColumns:[...row.children].filter(visible).map(el=>el.getBoundingClientRect().left),avatar:visible(row.querySelector('.fury-nick-avatar')),method:visible(row.querySelector('.fury-nick-method'))};
            });
            check(`${theme} ${width}: one compact row, aligned columns and no overflow`,metrics.rowHeight===62&&metrics.overflow<=2&&metrics.tableOverflow<=2&&metrics.headColumns.length===metrics.rowColumns.length&&metrics.headColumns.every((left,i)=>Math.abs(left-metrics.rowColumns[i])<1));
            check(`${theme} ${width}: player heads remain visible and the narrow layout retains the method in its accessible label`,metrics.avatar&&(metrics.method||width===1024&&await page.$eval('.fury-nick-row',row=>row.getAttribute('aria-label').includes('matched by'))));
            await screenshot(`nicks-table-${theme}-${width}`);
            await click('.fury-nick-row[data-real="PlayerTwo"]');
            const bounds=await page.$eval('.fury-nick-dialog',dialog=>({open:dialog.open,title:dialog.querySelector('h2').textContent,rect:dialog.getBoundingClientRect().toJSON(),window:[innerWidth,innerHeight],scroll:[dialog.scrollWidth,dialog.clientWidth]}));
            check(`${theme} ${width}: row opens its own bounded details ${JSON.stringify(bounds)}`,bounds.open&&bounds.title==='PlayerTwo'&&bounds.rect.left>=0&&bounds.rect.right<=width&&bounds.rect.top>=0&&bounds.rect.bottom<=height&&bounds.scroll[0]<=bounds.scroll[1]+1);
            await page.keyboard.press('Tab');
            check(`${theme} ${width}: dialog traps keyboard focus`,await page.evaluate(()=>document.querySelector('.fury-nick-dialog').contains(document.activeElement)));
            await screenshot(`nicks-details-${theme}-${width}`);
            await page.keyboard.press('Escape');
            check(`${theme} ${width}: Escape restores the selected row`,await page.evaluate(()=>!document.querySelector('.fury-nick-dialog').open&&document.activeElement.dataset.real==='PlayerTwo'));
        }
    }
    await page.setViewport({width:1440,height:900});await page.evaluate(()=>NesterTheme.apply('graphite',false));
    await click('[data-nick-sort="nick"]');assert.deepEqual(await names(),['PlayerTwo','ExamplePlayer']);
    check('Nickname header uses the native saved-match sorter',await page.$eval('#denick-sort',input=>input.value==='nick'));
    await click('[data-nick-sort="name"]');assert.deepEqual(await names(),['ExamplePlayer','PlayerTwo']);
    check('Real IGN header uses the native sorter',await page.$eval('#denick-sort',input=>input.value==='name'));
    await click('[data-nick-sort="recent"]');assert.deepEqual(await names(),['ExamplePlayer','PlayerTwo']);
    check('Last seen restores newest-first ordering',await page.$eval('#denick-sort',input=>input.value==='recent'));
    await click('.da-nick-filters>summary');await filter('#denick-method-filter','skin');assert.deepEqual(await names(),['ExamplePlayer']);checks.push('Existing method filter retains matching players');
    await filter('#denick-method-filter','all');await filter('#denick-time-filter','today');
    check('Empty filtered history has a visible empty state and no stale dialog',await page.$eval('#denick-list',host=>host.textContent.includes('No saved matches fit')&&!host.querySelector('dialog').open));
    await filter('#denick-time-filter','all');await page.keyboard.press('Escape');
    await page.type('#denick-search','AnotherNick');await page.waitForFunction(()=>document.querySelectorAll('.fury-nick-row').length===1&&document.querySelector('.fury-nick-row').dataset.real==='PlayerTwo');assert.deepEqual(await names(),['PlayerTwo']);checks.push('Search matches the nickname across the full history');
    await page.$eval('#denick-search',input=>{input.value='';input.dispatchEvent(new Event('input',{bubbles:true}));});
    await page.waitForFunction(()=>document.querySelectorAll('.fury-nick-row').length===2);
    await page.focus('.fury-nick-row');await page.keyboard.press('ArrowDown');await page.keyboard.press('Enter');
    check('Arrow navigation and Enter open the focused match',await page.$eval('.fury-nick-dialog',dialog=>dialog.open&&dialog.querySelector('h2').textContent==='PlayerTwo'));
    await click('.fury-nick-dialog [data-copy-denick]');
    check('Copy IGN reaches the original clipboard handler',await page.evaluate(()=>clipboard.readText()==='PlayerTwo'));
    check('Another player updating does not rebuild open details or steal focus',await page.evaluate(()=>{
        const copy=document.querySelector('.fury-nick-dialog [data-copy-denick]'),next=structuredClone(state.denickHistory);
        next.revision='nicks-focus-check';next.players.find(p=>p.realIGN==='ExamplePlayer').lastSeen=new Date().toISOString();
        renderDenickHistory(next);
        return copy===document.querySelector('.fury-nick-dialog [data-copy-denick]')&&document.activeElement===copy;
    }));
    await page.mouse.click(5,5);check('Backdrop dismissal restores table focus',await page.evaluate(()=>!document.querySelector('.fury-nick-dialog').open&&document.activeElement.dataset.real==='PlayerTwo'));
    await click('.denick-history-tools>button');await click('#manual-denick-save');
    await page.waitForFunction(()=>document.getElementById('manual-denick-status').textContent.includes('valid Minecraft names'));
    checks.push('Manual mapping keeps native name validation');
    await page.type('#manual-denick-nick','MappingNick');await page.type('#manual-denick-real','MappingPlayer');await click('#manual-denick-save');
    await page.waitForFunction(()=>document.getElementById('manual-denick-status').textContent.includes('Saved MappingNick'));
    await page.keyboard.press('Escape');await page.waitForSelector('.fury-nick-row[data-real="MappingPlayer"]');
    const saved=JSON.parse(fs.readFileSync(path.join(profile,'denicked.json')));
    check('Manual mapping persists through real Main IPC',JSON.stringify(saved).includes('MappingNick')&&JSON.stringify(saved).includes('MappingPlayer'));
    await click('.fury-nick-row[data-real="MappingPlayer"]');
    await page.evaluate(()=>{window.nicksOriginalConfirm=window.confirm;window.confirm=()=>false;});await click('.fury-nick-dialog [data-denick-remove]');
    check('Cancelling removal preserves the entry',await page.$eval('.fury-nick-dialog',dialog=>dialog.open&&!dialog.querySelector('[data-denick-remove]').disabled));
    await page.evaluate(()=>{window.confirm=()=>true;window.nicksActualInvoke=ipcRenderer.invoke;ipcRenderer.invoke=(channel,...args)=>channel==='denick:remove'?Promise.resolve({ok:false,error:'Fixture removal failure'}):nicksActualInvoke(channel,...args);});
    await click('.fury-nick-dialog [data-denick-remove]');
    await page.waitForFunction(()=>!document.querySelector('.fury-nick-dialog [data-denick-remove]').disabled);
    check('A failed removal keeps details open and allows retry',await page.$eval('.fury-nick-dialog',dialog=>dialog.open));
    await page.evaluate(()=>{ipcRenderer.invoke=nicksActualInvoke;});await click('.fury-nick-dialog [data-denick-remove]');
    await page.waitForFunction(()=>!document.querySelector('.fury-nick-dialog').open&&!document.querySelector('.fury-nick-row[data-real="MappingPlayer"]'));
    check('Successful removal closes stale details and preserves unrelated entries',(await names()).length===2&&!fs.readFileSync(path.join(profile,'denicked.json'),'utf8').includes('MappingNick'));
    await page.evaluate(()=>{window.confirm=nicksOriginalConfirm;});
    await page.evaluate(()=>{clearTimeout(refreshTimer);window.nicksLargeFixture={fileExists:true,revision:'compact-table-large',players:Array.from({length:2000},(_,i)=>({realIGN:`Fixture${String(i).padStart(4,'0')}`,nicks:[`Nick${i}`],methods:['manual'],firstSeen:'2026-01-01',lastSeen:'2026-01-01',events:[{nick:`Nick${i}`,method:'manual',at:'2026-01-01'}]}))};renderDenickHistory(nicksLargeFixture);});
    const bounded=await page.$$eval('.fury-nick-row',rows=>rows.length);
    check('A 2,000-player history mounts only a bounded row window',bounded>0&&bounded<60);
    await page.focus('.fury-nick-row');await page.keyboard.press('End');
    check('End reaches the unmounted final row',await page.evaluate(()=>document.activeElement.dataset.index==='1999'));
    await page.keyboard.press('Enter');check('The final row opens the correct details',await page.$eval('.fury-nick-dialog',dialog=>dialog.open&&dialog.querySelector('h2').textContent==='Fixture1999'));
    await page.keyboard.press('Escape');await page.keyboard.press('Home');check('Home returns to the first row after dismissal',await page.evaluate(()=>document.activeElement.dataset.index==='0'));
    await page.$eval('#denick-search',input=>{input.value='Fixture0123';input.dispatchEvent(new Event('input',{bubbles:true}));});
    await page.evaluate(()=>renderDenickHistory(nicksLargeFixture));assert.deepEqual(await names(),['Fixture0123']);checks.push('Search still reaches offscreen players');
    await page.evaluate(()=>{document.getElementById('denick-search').value='';renderDenickHistory(state.denickHistory);});
    const mutations=await page.evaluate(async()=>{let changes=0;const observer=new MutationObserver(records=>changes+=records.length);observer.observe(document.getElementById('denick-list'),{subtree:true,attributes:true,childList:true,characterData:true});for(let i=0;i<100;i++)renderDenickHistory(state.denickHistory);await new Promise(resolve=>setTimeout(resolve,0));observer.disconnect();return changes;});
    check('Unchanged history refreshes do not mutate the table',mutations===0);
    await page.reload({waitUntil:'domcontentloaded'});await page.waitForFunction('Boolean(furyDesign)&&state?.settings');await open();await page.waitForSelector('.fury-nick-row');
    check('Saved matches survive a full renderer reload',(await names()).length===2);
    await click('[data-denick-subpage-button="lookup"]');
    check('Lookup retains its existing form and cosmetic gating',await page.$eval('#denick-lookup-finals',input=>input.checkVisibility()&&!input.disabled)&&await page.$eval('#denick-advanced-fields',fields=>fields.disabled));
    await screenshot('nicks-lookup-preserved');check('No renderer errors',errors.length===0);
    fs.writeFileSync(path.join(output,'nicks-verification.json'),JSON.stringify({checks,views,errors,boundedRows:bounded,unchangedMutations:mutations},null,2));
    console.log(JSON.stringify({checks:checks.length,views:views.length,errors,boundedRows:bounded,unchangedMutations:mutations}));
};
