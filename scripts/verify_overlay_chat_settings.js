'use strict';

const assert=require('assert'),fs=require('fs'),path=require('path');

module.exports=async function verifyOverlayChatSettings({page,output,profile}){
    await page.evaluate("activatePage('settings');activateSettingsSubpage('overlay',false)");
    const click=selector=>page.locator(selector).click();
    const settle=async()=>{
        await page.waitForFunction('!featureSaveTimer && !featureSaveInFlight && !settingsSaveInFlight && !refreshInFlight');
        await page.evaluate(async()=>{await ordinarySaveChain;await refresh();});
    };
    const queueGeometry=()=>page.evaluate(()=>{
        const geometry=row=>{
            const bounds=row.getBoundingClientRect(),copy=row.querySelector('.fury-overlay-copy').getBoundingClientRect(),toggle=row.querySelector('label').getBoundingClientRect();
            return {left:copy.left-bounds.left,right:bounds.right-toggle.right,height:bounds.height,divider:getComputedStyle(row).borderBottomWidth};
        };
        return {reference:geometry(document.querySelector('.fury-overlay-row:has(#lobby-spam-enabled)')),rows:[...document.querySelectorAll('#queue-time-settings .fury-overlay-row')].map(geometry)};
    });
    for(const theme of ['graphite','midnight','forest','light','obsidian','frost']){
        await page.evaluate(theme=>NesterTheme.apply(theme,false),theme);
        for(const width of [1440,1040]){
            await page.setViewport({width,height:900,deviceScaleFactor:1});
            const {reference,rows}=await queueGeometry();
            for(const row of rows){
                assert(Math.abs(row.left-reference.left)<1,'Queue labels use the same inset as other settings');
                assert(Math.abs(row.right-reference.right)<1,'Queue switches use the same inset as other settings');
                assert(Math.abs(row.height-reference.height)<=1,`Queue rows use the same height as other settings: ${JSON.stringify({reference,row})}`);
            }
            assert.strictEqual(rows[0].divider,reference.divider,'Queue rows use the standard divider');
            assert.strictEqual(rows[1].divider,'0px','The last row has no trailing divider');
        }
    }
    await page.evaluate(()=>NesterTheme.apply('graphite',false));
    for(const id of ['queue-time-enabled','queue-time-party-chat-enabled']){
        await page.$eval('#'+id,el=>{if(!el.checked)el.click();});await settle();
    }
    await click('#queue-time-enabled');await settle();
    assert(await page.$eval('#queue-time-party-chat-enabled',el=>el.checked&&el.disabled),'Disabling queue time retains the party-chat preference');
    await click('#queue-time-enabled');await settle();
    assert(await page.$eval('#queue-time-party-chat-enabled',el=>el.checked&&!el.disabled));
    await page.$eval('#queue-time-settings',el=>el.scrollIntoView({block:'center'}));
    await page.screenshot({path:path.join(output,'queue-time-aligned.png')});
    const eventId='#accent-bedwars-event-labels-enabled';
    assert.strictEqual(await page.$eval(eventId,el=>el.closest('[data-settings-subpage]').dataset.settingsSubpage),'display');
    await page.evaluate("activateSettingsSubpage('display',false)");
    await click('.fury-ingame-tabs button[data-ingame="colors"]');
    assert(await page.$eval(eventId,el=>el.checkVisibility()),'Event color is reachable from In-game appearance');
    const eventColors=()=>page.$$eval('.ia-chat-sample .ia-event-label',labels=>labels.map(el=>getComputedStyle(el).color));
    const bodyColors=await page.$$eval('.ia-chat-sample span',nodes=>nodes.map(el=>getComputedStyle(el).color));
    await page.evaluate(()=>NesterTheme.applyAccent('sun',false));
    for(const enabled of [false,true]){
        await page.$eval(eventId,(el,enabled)=>{if(el.checked!==enabled)el.click();},enabled);
        // Check the preview before waiting for autosave or a state refresh.
        await page.waitForFunction(enabled=>[...document.querySelectorAll('.ia-chat-sample .ia-event-label')].every((el,i)=>getComputedStyle(el).color===(enabled?'rgb(255, 170, 0)':i===0?'rgb(255, 255, 255)':'rgb(85, 255, 255)')),{},enabled);
        await settle();
        assert.strictEqual(JSON.parse(fs.readFileSync(path.join(profile,'features_config.json'))).accentBedwarsEventLabelsEnabled,enabled);
        assert.deepStrictEqual(await page.$$eval('.ia-chat-sample span',nodes=>nodes.map(el=>getComputedStyle(el).color)),bodyColors,'Team and message colors stay unchanged');
        await page.screenshot({path:path.join(output,`event-color-${enabled?'on':'off'}.png`)});
    }
    await page.evaluate(()=>NesterTheme.applyAccent('rose',false));
    await page.waitForFunction('[...document.querySelectorAll(".ia-chat-sample .ia-event-label")].every(el=>getComputedStyle(el).color==="rgb(255, 85, 85)")');
    await page.$eval(eventId,el=>el.focus());await page.keyboard.press('Space');await settle();
    assert.deepStrictEqual(await eventColors(),['rgb(255, 255, 255)','rgb(85, 255, 255)']);
    await page.reload({waitUntil:'domcontentloaded'});
    await page.waitForFunction('typeof designA!=="undefined" && designA && state?.viewedAccount');
    await page.evaluate("activatePage('settings');activateSettingsSubpage('display',false);furyDesign.showIngame('colors')");
    assert.strictEqual(await page.$eval(eventId,el=>el.checked),false,'Event color choice survives reload');
    assert.deepStrictEqual(await eventColors(),['rgb(255, 255, 255)','rgb(85, 255, 255)']);
    for(const theme of ['graphite','light']){
        await page.evaluate(theme=>NesterTheme.apply(theme,false),theme);
        for(const width of [1440,1040]){
            await page.setViewport({width,height:680,deviceScaleFactor:1});
            assert(await page.$eval('.ia-preview-setting:has(#accent-bedwars-event-labels-enabled)',el=>el.scrollWidth<=el.clientWidth),'Event settings and preview fit the page');
            assert(await page.$eval('.fury-ingame-tabs',el=>el.scrollWidth<=el.clientWidth),'Appearance tabs fit the page');
        }
    }
    await page.evaluate("NesterTheme.apply('graphite',false);activateSettingsSubpage('overlay',false)");
    console.log('PASS Queue row geometry in six themes/two widths; event-color navigation, live on/off/accent, unchanged team colors, keyboard, autosave and reload');
    assert.strictEqual(await page.$('#social-overlay-adds-enabled'),null);
    assert.strictEqual(await page.evaluate("'socialOverlayAddsEnabled' in collectFeatureSettings().features"),false);
    assert.strictEqual(await page.$eval('#chat-triggers-dialog',el=>el.open),false);
    assert.strictEqual(await page.$eval('#chat-trigger-input',el=>el.checkVisibility()),true);
    await page.evaluate(()=>{
        const input=document.getElementById('lobby-chat-stats-trigger-enabled');
        if(input.checked)input.click();
    });
    await click('label:has(#lobby-chat-stats-trigger-enabled)');
    assert.strictEqual(await page.$eval('#chat-triggers-dialog',el=>el.open),false,'Enabling does not open the editor');
    await click('#chat-trigger-input');
    assert.strictEqual(await page.evaluate('document.activeElement.id'),'chat-trigger-input');
    await page.waitForFunction('!featureSaveTimer && !featureSaveInFlight');
    assert.strictEqual(JSON.parse(fs.readFileSync(path.join(profile,'features_config.json'))).lobbyChatStatsTriggerEnabled,true);
    await click('#chat-trigger-add');
    assert((await page.$eval('#chat-trigger-status',el=>el.textContent)).includes('1–24'));
    await page.$eval('#chat-trigger-input',el=>{el.value='test phrase';el.focus();});await page.keyboard.press('Enter');
    await page.waitForFunction("state.settings.chatTriggers.triggers.includes('test phrase') && document.getElementById('chat-trigger-status').textContent==='Saved'");
    assert(await page.$('[data-chat-trigger-remove="test phrase"]'));
    await page.keyboard.press('Escape');
    assert.strictEqual(await page.$eval('#chat-triggers-dialog',el=>el.open),false);
    assert.strictEqual(await page.$eval('#chat-trigger-input',el=>el.checkVisibility()),true);
    assert(await page.$eval('[data-chat-trigger-remove="test phrase"]',el=>el.checkVisibility()));
    for(const width of [1440,1100]){
        await page.setViewport({width,height:900,deviceScaleFactor:1});
        assert(await page.$eval('#chat-trigger-input',el=>{const card=el.closest('.da-card');return card.scrollWidth<=card.clientWidth;}));
        await page.screenshot({path:path.join(output,`chat-triggers-${width}.png`)});
    }
    await page.keyboard.press('Tab');
    assert(await page.evaluate("document.querySelector('[data-settings-subpage=overlay]').contains(document.activeElement)"));
    await click('[data-chat-trigger-remove="test phrase"]');
    await page.waitForFunction("!state.settings.chatTriggers.triggers.includes('test phrase')");
    await click('label:has(#lobby-chat-stats-trigger-enabled)');
    assert.strictEqual(await page.$eval('#chat-triggers-dialog',el=>el.open),false,'Disabling does not open the editor');
    assert(await page.$eval('#chat-trigger-input',el=>el.checkVisibility()),'Phrases can be managed while disabled');
    await click('#chat-trigger-input');await page.type('#chat-trigger-input','disabled phrase');await page.keyboard.press('Enter');
    await page.waitForFunction("state.settings.chatTriggers.triggers.includes('disabled phrase')");
    await click('[data-chat-trigger-remove="disabled phrase"]');
    await page.waitForFunction("!state.settings.chatTriggers.triggers.includes('disabled phrase')");
    await page.screenshot({path:path.join(output,'overlay-chat-settings.png')});
    // Use the real navigation hooks and keep unrelated refresh behavior intact.
    const pages=await page.evaluate(async()=>{
        await refresh();
        const original=ipcRenderer.invoke.bind(ipcRenderer),seen=[];
        ipcRenderer.invoke=(channel,...args)=>{if(channel==='state:get')seen.push(args[0].activePage);return original(channel,...args);};
        try{
            activatePage('overlay');await refresh();
            while(refreshInFlight)await new Promise(resolve=>setTimeout(resolve,20));
            activatePage('settings');await refresh();
            while(refreshInFlight)await new Promise(resolve=>setTimeout(resolve,20));
            return seen;
        }finally{ipcRenderer.invoke=original;}
    });
    assert(pages.includes('overlay')&&pages.includes('settings'));
    console.log('PASS Overlay tab visibility refresh, inline phrases, persistence, validation, keyboard and responsive layout');
};
