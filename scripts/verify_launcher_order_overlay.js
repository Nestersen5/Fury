'use strict';

// Real pointer events and hit testing catch animation drift and ancestor clipping
// that bounding-box-only layout checks miss.
module.exports = async function verifyLauncherOrderOverlay({ page, output }) {
    const assert = require('assert');
    const path = require('path');
    const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
    await page.waitForFunction('document.documentElement.classList.contains("fury-settings-roomy")');
    await page.evaluate(()=>document.querySelectorAll('dialog[open]').forEach(dialog=>dialog.close()));
    for (const [width,height] of [[1440,900],[1024,680]]) {
        await page.waitForFunction('!featureSaveTimer && !featureSaveInFlight && !featureSaveQueued && !settingsSaveInFlight');
        await page.setViewport({width,height,deviceScaleFactor:1});
        await page.evaluate(`clearTimeout(refreshTimer);activatePage('overlay');clearTimeout(refreshTimer);overlayState.orders.BEDWARS=Object.keys(OVERLAY_STAT_DEFS.BEDWARS);overlayTableSignature='';renderOverlay({connected:true,gameActive:true,currentGamemode:'BEDWARS',gameSessionId:'test',overlayPlayers:[{name:'Player_long_name',mode:'BEDWARS',stats:{stars:300,fkdr:6.5,wlr:2.5,wins:18117,finals:55004,beds:24269,ws:100},tags:[]}]});`);
        if (await page.$eval('#overlay-layout-drawer',e=>e.hidden)) await page.evaluate(()=>document.querySelector('#overlay-layout-toggle').click());
        await page.evaluate(()=>FuryNotifications.dismissAll());
        await delay(300);
        const reachDrawer = async () => page.evaluate(()=>{
            const drawer=document.querySelector('#overlay-layout-drawer');
            drawer.scrollTop=drawer.scrollHeight;
            const row=drawer.querySelector('.overlay-order-item:last-child');
            const rect=row.getBoundingClientRect();
            return {reachable:row.contains(document.elementFromPoint(rect.left+60,rect.top+rect.height/2)),inViewport:drawer.getBoundingClientRect().bottom<=innerHeight};
        });
        const drawerResult=await reachDrawer();
        assert(drawerResult.reachable && drawerResult.inViewport, JSON.stringify(await page.evaluate(()=>{
            const drawer=document.querySelector('#overlay-layout-drawer'),row=drawer.querySelector('.overlay-order-item:last-child'),r=row.getBoundingClientRect();
            return {hidden:drawer.hidden,display:getComputedStyle(drawer).display,rect:drawer.getBoundingClientRect().toJSON(),row:r.toJSON(),hit:document.elementFromPoint(r.left+60,r.top+r.height/2)?.outerHTML.slice(0,300),dialogs:[...document.querySelectorAll('dialog[open]')].map(d=>d.className)};
        })));
        await page.screenshot({path:path.join(output,`columns-last-${width}.png`)});
        await page.evaluate(()=>document.querySelector('#overlay-layout-toggle').click());
        const table=await page.evaluate(()=>{
            // With every stat enabled the board may scroll sideways; the last column must stay reachable and unclipped.
            const shell=document.querySelector('#overlay-table'),labels=shell.querySelector('.fury-board-labels'),last=labels.children[labels.children.length-2];
            shell.scrollLeft=shell.scrollWidth;shell.scrollTop=0;const r=last.getBoundingClientRect();
            return {hit:document.elementFromPoint(r.left+r.width/2,r.top+r.height/2)?.outerHTML.slice(0,160),rect:r.toJSON(),scroll:[shell.scrollLeft,shell.scrollWidth,shell.clientWidth],reachable:last.contains(document.elementFromPoint(r.left+r.width/2,r.top+r.height/2)),clipped:[...labels.children].filter(e=>e.scrollWidth>e.clientWidth+1).map(e=>e.textContent)};
        });
        assert.strictEqual(table.reachable,true,JSON.stringify(table));assert.deepStrictEqual(table.clipped,[]);
        await page.screenshot({path:path.join(output,`table-last-${width}.png`)});
        await page.evaluate(()=>{activatePage('settings');clearTimeout(refreshTimer);document.querySelector('[data-settings-subpage-button="display"]').click();furyDesign.showIngame('tablist');tabStatsPreviewMode='BEDWARS';tabStatsEditorLayouts.BEDWARS=['name','stars','fkdr','wlr','tags'];renderTabStatsEditor();document.querySelector('#tablist-order-list').scrollIntoView({block:'center'});});
        const order=()=>page.$$eval('#tablist-order-list [data-tablist-order-field]',items=>items.map(e=>e.dataset.tablistOrderField));
        const center=async index=>page.$$eval('#tablist-order-list [data-tablist-order-field]',(items,index)=>{const r=items[index].getBoundingClientRect();return{x:r.left+r.width/2,y:r.top+r.height/2};},index);
        const grab=async index=>{
            // A completed drop saves asynchronously and can reflow the editor.
            // Reuse neither an old coordinate nor a row still animating on a VM.
            await page.waitForFunction('!featureSaveTimer && !featureSaveInFlight && !featureSaveQueued && !settingsSaveInFlight && !refreshInFlight');
            await page.evaluate(()=>FuryNotifications.dismissAll());
            await page.$$eval('#tablist-order-list [data-tablist-order-field]',(items,index)=>items[index].scrollIntoView({block:'center',behavior:'instant'}),index);
            await page.waitForFunction(index=>{
                const list=document.querySelector('#tablist-order-list'),row=list.querySelectorAll('[data-tablist-order-field]')[index];
                const r=row.getBoundingClientRect(),previous=window.dragCheckBounds;
                window.dragCheckBounds={index,x:r.x,y:r.y};
                return previous?.index===index && Math.abs(previous.x-r.x)<.1 && Math.abs(previous.y-r.y)<.1
                    && !list.getAnimations({subtree:true}).some(a=>a.playState==='running')
                    && row.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2));
            },{},index);
            const start=await center(index),field=(await order())[index];
            await page.mouse.move(start.x,start.y);await page.mouse.down();
            await page.waitForFunction(field=>tablistOrderDrag?.item.dataset.tablistOrderField===field,{timeout:3000},field);
            return {...start,field};
        };
        const drag=async(from,to,cancel=false)=>{
            await grab(from);const end=await center(to);
            await page.mouse.move(end.x,end.y,{steps:12});
            await delay(250);const settled=await order();await delay(250);assert.deepStrictEqual(await order(),settled,'Stationary pointer must not oscillate');
            assert(await page.evaluate(()=>{
                const drag=tablistOrderDrag;
                renderTabStatsEditor();
                return Boolean(drag?.item.isConnected) && JSON.stringify(tabStatsLayoutForSave(drag.mode))===JSON.stringify(drag.originalLayout);
            }), 'Refreshing the editor must preserve the grabbed row and keep autosave on the committed order');
            if(cancel)await page.keyboard.press('Escape');await page.mouse.up();await delay(80);
        };
        await drag(0,1);assert.deepStrictEqual(await order(),['stars','name','fkdr','wlr','tags']);
        await drag(1,4);assert.deepStrictEqual(await order(),['stars','fkdr','wlr','tags','name']);
        await drag(4,0);assert.deepStrictEqual(await order(),['name','stars','fkdr','wlr','tags']);
        await drag(0,3,true);assert.deepStrictEqual(await order(),['name','stars','fkdr','wlr','tags']);
        await page.focus('[data-tablist-order-field="stars"]');await page.keyboard.press('ArrowUp');
        assert.deepStrictEqual(await order(),['stars','name','fkdr','wlr','tags']);
        assert.strictEqual(await page.evaluate('tablistOrderDrag'),null);
        await page.screenshot({path:path.join(output,`row-order-${width}.png`)});
        // Finish the keyboard reorder save before installing a larger synthetic
        // layout. Otherwise its late reply legitimately restores the saved five
        // rows, so the following test grabs Stars instead of the intended Name.
        await page.waitForFunction('!featureSaveTimer && !featureSaveInFlight && !featureSaveQueued && !settingsSaveInFlight && !refreshInFlight');
        await page.evaluate(()=>{
            clearTimeout(refreshTimer);
            tabStatsEditorLayouts.BEDWARS=normalizeTabStatsLayout(TABLIST_FIELDS,'BEDWARS');
            renderTabStatsEditor();
            document.querySelector('#tablist-order-list').scrollIntoView({block:'start'});
        });
        assert((await order()).length>=10,'The auto-scroll fixture must retain the full field list');
        const first=await grab(0);
        assert.strictEqual(first.field,'name');
        const bottom=await page.$eval('main',e=>e.getBoundingClientRect().bottom-12);
        await page.mouse.move(first.x,bottom,{steps:12});
        await page.waitForFunction('tabStatsEditorLayouts.BEDWARS.at(-1)==="name"',{timeout:5000});
        await page.keyboard.press('Escape');await page.mouse.up();
        assert.strictEqual((await order())[0],'name');
        console.log('PASS',width,'drawer and final table column reachable; adjacent/first/last drag, stationary hold, cancellation and keyboard ordering');
    }

};
