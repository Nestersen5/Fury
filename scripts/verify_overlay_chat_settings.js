'use strict';

const assert=require('assert'),fs=require('fs'),path=require('path');

module.exports=async function verifyOverlayChatSettings({page,output,profile}){
    await page.evaluate("activatePage('settings');activateSettingsSubpage('overlay',false)");
    const click=selector=>page.locator(selector).click();
    assert.strictEqual(await page.$('#social-overlay-adds-enabled'),null);
    assert.strictEqual(await page.evaluate("'socialOverlayAddsEnabled' in collectFeatureSettings().features"),false);
    assert.strictEqual(await page.$eval('#chat-triggers-dialog',el=>el.open),false);
    assert.strictEqual(await page.$eval('#chat-trigger-input',el=>el.checkVisibility()),false);
    await page.evaluate(()=>{
        const input=document.getElementById('lobby-chat-stats-trigger-enabled');
        if(input.checked)input.click();
    });
    await click('label:has(#lobby-chat-stats-trigger-enabled)');
    assert.strictEqual(await page.$eval('#chat-triggers-dialog',el=>el.open),false,'Enabling does not open the editor');
    await click('#chat-trigger-manage');
    await page.waitForFunction("document.getElementById('chat-triggers-dialog').open");
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
    assert.strictEqual(await page.evaluate('document.activeElement.id'),'chat-trigger-manage');
    await click('#chat-trigger-manage');
    assert(await page.$eval('[data-chat-trigger-remove="test phrase"]',el=>el.checkVisibility()));
    for(const width of [1440,1100]){
        await page.setViewport({width,height:900,deviceScaleFactor:1});
        assert(await page.$eval('#chat-triggers-dialog',el=>el.scrollWidth<=el.clientWidth));
        await page.screenshot({path:path.join(output,`chat-triggers-${width}.png`)});
    }
    await page.keyboard.press('Tab');
    assert(await page.evaluate("document.getElementById('chat-triggers-dialog').contains(document.activeElement)"));
    await click('[data-chat-trigger-remove="test phrase"]');
    await page.waitForFunction("!state.settings.chatTriggers.triggers.includes('test phrase')");
    await click('[aria-label="Close chat triggers"]');
    assert.strictEqual(await page.evaluate('document.activeElement.id'),'chat-trigger-manage');
    await click('label:has(#lobby-chat-stats-trigger-enabled)');
    assert.strictEqual(await page.$eval('#chat-triggers-dialog',el=>el.open),false,'Disabling does not open the editor');
    await click('#chat-trigger-manage');
    assert(await page.$eval('#chat-triggers-dialog',el=>el.open),'Phrases can be managed while disabled');
    // Backdrop dismissal follows the existing account dialogs.
    await page.mouse.click(5,5);
    assert.strictEqual(await page.$eval('#chat-triggers-dialog',el=>el.open),false);
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
    console.log('PASS Overlay tab visibility refresh, phrase dialog, persistence, validation, keyboard and responsive layout');
};
