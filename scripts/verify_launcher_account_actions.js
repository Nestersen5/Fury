'use strict';

module.exports = async function verifyAccountActions({page, output, profile}) {
    const assert=require('assert'),fs=require('fs'),path=require('path');
    await page.evaluate(()=>{document.querySelectorAll('dialog[open]').forEach(d=>d.close());activatePage('dashboard');clearTimeout(refreshTimer);});
    const accounts=await page.evaluate('state.accountCatalog');
    assert.strictEqual(accounts.length,2);
    const sessionsFile=path.join(profile,'session_data.json'),sessions=fs.readFileSync(sessionsFile,'utf8');
    for(const account of accounts){
        const folder=path.join(profile,'auth_tokens',account.name);
        fs.mkdirSync(folder,{recursive:true});fs.writeFileSync(path.join(folder,'fixture.json'),'{}');
    }
    await page.evaluate('refresh()');
    await page.evaluate('furyDesign.openManager()');
    await page.waitForFunction(()=>[...document.querySelectorAll('.fury-account-row img')].every(img=>!img.hidden&&img.complete&&img.naturalWidth>0));
    assert(await page.evaluate(async()=>{
        const skins=require('./src/launcher/renderer/launcher_account_skin');
        const fallback=await skins.fallbackSkin(),unknown=await skins.get('cccccccccccccccccccccccccccccccc');
        return unknown.fallback&&unknown.headUrl===fallback.headUrl;
    }),'offline accounts use the bundled Steve head');
    for(const width of [1440,1024]){
        await page.setViewport({width,height:900,deviceScaleFactor:1});
        assert(await page.$$eval('.fury-account-row',rows=>rows.every(row=>row.scrollWidth<=row.clientWidth+1)));
        await page.screenshot({path:path.join(output,`manage-accounts-${width}.png`)});
    }
    // Cover external nickname/player head failures, including old inline handlers.
    await page.evaluate(()=>{
        const wrapper=document.createElement('span');wrapper.className='fury-nick-avatar';wrapper.id='test-head-fallback';
        const img=document.createElement('img');img.onerror=()=>{img.hidden=true;};wrapper.append(img);document.querySelector('.fury-account-manager').append(wrapper);
        img.src='file:///missing-fury-player-head.png';
    });
    await page.waitForFunction(()=>{const img=document.querySelector('#test-head-fallback img');return !img.hidden&&img.naturalWidth>0&&img.src.startsWith('data:image/png');});
    await page.evaluate(()=>document.querySelector('#test-head-fallback').remove());
    const selected=await page.evaluate('state.accountKey');
    const row=`.fury-account-row[data-account-key="${selected}"]`;
    await page.locator(row+' .fury-remove-account').click();
    await page.screenshot({path:path.join(output,'remove-account-confirmation.png')});
    await page.evaluate(selector=>[...document.querySelector(selector).querySelectorAll('button')].find(b=>b.textContent==='Cancel').click(),row);
    assert.strictEqual(await page.evaluate('state.accountCatalog.length'),2);
    await page.locator(row+' .fury-remove-account').click();
    await page.locator(row+' .fury-remove-account').click();
    await page.waitForFunction('state.accountCatalog.length===1');
    assert.notStrictEqual(await page.evaluate('state.accountKey'),selected);
    assert(!fs.existsSync(path.join(profile,'auth_tokens',accounts.find(a=>a.key===selected).name)));
    const remaining=await page.evaluate('state.accountKey');
    await page.locator(`.fury-account-row[data-account-key="${remaining}"] .fury-remove-account`).click();
    await page.locator(`.fury-account-row[data-account-key="${remaining}"] .fury-remove-account`).click();
    await page.waitForFunction('state.accountCatalog.length===0 && state.accountKey===null');
    await page.evaluate('refresh()');
    assert.strictEqual(await page.evaluate('state.accountCatalog.length'),0,'saved history cannot resurrect removed accounts');
    assert.strictEqual(fs.readFileSync(sessionsFile,'utf8'),sessions,'removing logins preserves session history');
    assert.strictEqual(await page.evaluate('state.sessionHistory.sessions.length'),0,'last removal never leaks another account history');
    await page.screenshot({path:path.join(output,'manage-accounts-empty.png')});
    const invalid=await page.evaluate(()=>ipcRenderer.invoke('account:remove','../outside').then(()=>false,()=>true));
    assert(invalid,'IPC accepts catalog identities only');
    console.log('PASS account removal confirmation, selected/last account fallback, preserved history, and offline/broken head fallbacks');
};
