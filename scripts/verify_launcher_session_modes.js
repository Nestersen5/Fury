'use strict';
const assert=require('assert'),path=require('path');
module.exports=async({page,output})=>{
    await page.waitForFunction('!featureSaveTimer && !featureSaveInFlight && !featureSaveQueued && !settingsSaveInFlight');
    await page.evaluate(async()=>{document.querySelectorAll('dialog[open]').forEach(d=>d.close());activatePage('sessions');await refresh();clearTimeout(refreshTimer);});
    await new Promise(resolve=>setTimeout(resolve,500));
    await page.evaluate(()=>{
        clearTimeout(refreshTimer);
        window.modeTestHistory=state.sessionHistory;
        const base=structuredClone(state.sessionHistory.sessions[0]);
        base.id='mode-picker-fixture';base.active=false;base.startedAt=Date.now()-3600000;base.endedAt=Date.now();base.games=[];
        base.modes=[{mode:'BEDWARS',label:'BedWars',wins:40,losses:0},{mode:'DUELS',label:'Duels',wins:3,losses:1},{mode:'SKYWARS',label:'SkyWars',wins:2,losses:1}];
        window.modeTestSession=base;
        sessionDateFilter='all';sessionModeFilter='';sessionAccountFilter='';sessionResultFilter='';sessionOpponentFilter='';
        state.sessionHistory={sessions:[base]};renderSessionHistory(state.sessionHistory);
        document.querySelector('.fury-session-row').open=true;
    });
    await page.waitForSelector('.fury-card-image canvas');
    assert.equal(await page.$$eval('.fury-card-mode:not(.fury-card-submode-options) [role=radio]',e=>e.length),3);
    await page.locator('[data-mode="DUELS"]').click();
    await page.waitForFunction('document.querySelector(".fury-card-image canvas")?.getAttribute("aria-label").includes("Wins: 3")');
    assert.equal(await page.$eval('[data-mode="DUELS"]',e=>e.getAttribute('aria-checked')),'true');
    await page.keyboard.press('ArrowRight');
    await page.waitForFunction('document.querySelector(".fury-card-image canvas")?.getAttribute("aria-label").includes("Wins: 2")');
    await page.keyboard.press('Home');
    await page.waitForFunction('document.querySelector(".fury-card-image canvas")?.getAttribute("aria-label").includes("Wins: 40")');
    for(const width of [1440,1024]){
        await page.setViewport({width,height:900,deviceScaleFactor:1});
        assert(await page.$eval('.fury-card-toolbar',e=>e.scrollWidth<=e.clientWidth));
        await (await page.$('.fury-session-row')).screenshot({path:path.join(output,`session-mode-picker-${width}.png`)});
    }
    const {compactModes}=require('../src/session/launcherSessionHistory');
    const projected=compactModes({stats:{Bedwars:{games_played_bedwars:18,four_three_games_played_bedwars:2,four_four_games_played_bedwars:4,two_four_games_played_bedwars:2,wins_bedwars:7,losses_bedwars:3,eight_one_games_played_bedwars:4,eight_one_wins_bedwars:3,eight_one_losses_bedwars:1,eight_two_games_played_bedwars:6,eight_two_wins_bedwars:4,eight_two_losses_bedwars:2,eight_two_final_kills_bedwars:12,eight_two_final_deaths_bedwars:2}}});
    assert.equal(projected[0].submodes[1].fkdr,6);
    await page.evaluate(mode=>{state.sessionHistory.sessions[0].modes[0]=mode;renderSessionHistory(state.sessionHistory);document.querySelector('.fury-session-row').open=true;},projected[0]);
    await page.waitForSelector('[data-submode="eight_two"]');
    assert.deepEqual(await page.$$eval('.fury-card-submode-options button',els=>els.map(e=>e.textContent)),['Overall','Solos','Doubles','Threes','Fours','4v4']);
    await page.click('[data-submode="eight_two"]');
    await page.waitForFunction('document.querySelector(".fury-card-image canvas")?.getAttribute("aria-label").includes("Wins: 4")');
    assert(await page.$eval('.fury-card-image canvas',e=>e.getAttribute('aria-label').includes('BedWars - Doubles')));
    await page.evaluate(()=>{window.originalModeWrite=clipboard.writeImage;clipboard.writeImage=image=>{window.modeCopiedPng=image.toPNG().toString('base64');};[...document.querySelectorAll('.fury-card-toolbar button')].find(b=>b.textContent==='Copy image').click();clipboard.writeImage=window.originalModeWrite;});
    assert(await page.evaluate(()=>window.modeCopiedPng===require('electron').nativeImage.createFromDataURL(document.querySelector('.fury-card-image canvas').toDataURL()).toPNG().toString('base64')));
    await page.focus('[data-submode="eight_two"]');await page.keyboard.press('Home');
    await page.waitForFunction('document.querySelector(".fury-card-image canvas")?.getAttribute("aria-label").includes("Wins: 7")');
    await page.click('[data-submode="eight_two"]');
    await page.waitForFunction('document.querySelector(".fury-card-image canvas")?.getAttribute("aria-label").includes("Wins: 4")');
    const filename=await page.evaluate(async()=>{const s=state.sessionHistory.sessions[0];return (await require('./src/launcher/renderer/launcher_session_card').render(s,{mode:'BEDWARS',submode:'eight_two'})).filename;});
    assert(filename.endsWith('-BEDWARS-Doubles.png'));
    await page.evaluate(()=>renderSessionHistory(state.sessionHistory));
    assert.equal(await page.$eval('[data-submode="eight_two"]',e=>e.getAttribute('aria-checked')),'true');
    for(const width of [1440,1024]){
        await page.setViewport({width,height:900,deviceScaleFactor:1});
        assert(await page.$eval('.fury-card-toolbar',e=>e.scrollWidth<=e.clientWidth));
        await (await page.$('.fury-session-row')).screenshot({path:path.join(output,`session-submode-${width}.png`)});
    }
    await page.click('[data-mode="DUELS"]');
    assert(await page.$eval('.fury-card-submode-options',e=>e.hidden));
    await page.click('[data-mode="BEDWARS"]');
    assert.equal(await page.$eval('[data-submode="overall"]',e=>e.getAttribute('aria-checked')),'true');
    await page.select('#session-mode-filter','DUELS');
    await page.waitForFunction('document.querySelector(".fury-card-image canvas")?.getAttribute("aria-label").includes("Wins: 3")');
    assert.equal(await page.$$eval('.fury-card-mode:not(.fury-card-submode-options) [role=radio]',e=>e.length),0);
    assert.equal(await page.$eval('.fury-card-mode',e=>e.textContent),'Duels');
    assert(await page.evaluate('sessionMatchesFilters(modeTestSession)'),'Stats-only session must match its real mode');
    assert(!await page.evaluate('sessionMatchesFilters({...modeTestSession,modes:[modeTestSession.modes[0]]})'),'BedWars session must not match Duels');
    await page.select('#session-mode-filter','');
    await page.evaluate(()=>{state.sessionHistory.sessions[0].modes=[modeTestSession.modes[0]];renderSessionHistory(state.sessionHistory);});
    assert.equal(await page.$$eval('.fury-card-mode:not(.fury-card-submode-options) [role=radio]',e=>e.length),0);
    assert.equal(await page.$eval('.fury-card-mode',e=>e.textContent),'BedWars');
    const manyStats={rounds_played:31,wins:31};
    for(let i=0;i<31;i++)Object.assign(manyStats,{[`variant_${i}_duel_rounds_played`]:1,[`variant_${i}_duel_wins`]:1,[`variant_${i}_duel_kills`]:i});
    const many=compactModes({stats:{Duels:manyStats}})[0];
    await page.evaluate(mode=>{state.sessionHistory.sessions[0].modes=[mode];renderSessionHistory(state.sessionHistory);document.querySelector('.fury-session-row').open=true;},many);
    await page.waitForSelector('[data-submode="variant_30_duel"]');
    assert.equal(await page.$$eval('.fury-card-submode-options button',els=>els.length),32);
    for(const width of [1440,1024]){
        await page.setViewport({width,height:900,deviceScaleFactor:1});
        assert(await page.$eval('.fury-card-toolbar',e=>e.scrollWidth<=e.clientWidth),'many Duels modes must fit toolbar');
        assert(await page.$eval('.fury-card-submode-options',e=>e.scrollWidth<=e.clientWidth),'picker must wrap all modes');
    }
    await page.click('[data-submode="variant_30_duel"]');
    await page.waitForFunction('document.querySelector(".fury-card-image canvas")?.getAttribute("aria-label").includes("Kills: 30")');
    assert(await page.$eval('.fury-card-image canvas',e=>e.getAttribute('aria-label').includes('Variant 0 1v1: 1')),'chart retains other played modes');
    const manyCard=await page.$eval('.fury-card-image canvas',e=>({png:e.toDataURL(),text:e.getAttribute('aria-label'),height:e.height}));
    for(let i=0;i<31;i++)assert(manyCard.text.includes(`Variant ${i} 1v1: 1`),'every played mode must be in the exported chart');
    assert(manyCard.height>1200,'chart must grow to fit multiple rows');
    require('fs').writeFileSync(path.join(output,'session-duels-31-card.png'),Buffer.from(manyCard.png.split(',')[1],'base64'));
    await (await page.$('.fury-session-row')).screenshot({path:path.join(output,'session-duels-31-modes.png')});
    await page.evaluate(()=>{
        window.stableCanvas=document.querySelector('.fury-card-image canvas');
        state.sessionHistory.sessions[0].games.push({id:'background-verification'});
        renderSessionHistory(state.sessionHistory);
    });
    assert(await page.evaluate('stableCanvas===document.querySelector(".fury-card-image canvas")'),'metadata polling must preserve the canvas');
    await page.evaluate(()=>{
        const renderer=require('./src/launcher/renderer/launcher_session_card');window.originalCardRender=renderer.render;
        renderer.render=async(...args)=>{await new Promise(resolve=>window.finishCardUpdate=resolve);return window.originalCardRender(...args);};
        state.sessionHistory.sessions[0].modes[0].submodes.find(m=>m.id==='variant_30_duel').kills=32;
        renderSessionHistory(state.sessionHistory);
    });
    assert(await page.evaluate('stableCanvas===document.querySelector(".fury-card-image canvas")'),'old image stays visible while live update renders');
    await page.evaluate(()=>{require('./src/launcher/renderer/launcher_session_card').render=window.originalCardRender;window.finishCardUpdate();});
    await page.waitForFunction('document.querySelector(".fury-card-image canvas")?.getAttribute("aria-label").includes("Kills: 32")');
    const skyCard=await page.evaluate(async()=>{
        const renderer=require('./src/launcher/renderer/launcher_session_card'),{compactModes}=require('./src/session/launcherSessionHistory');
        const mode=compactModes({stats:{SkyWars:{games:5,wins:3,losses:2,kills:8,deaths:2,assists:1,games_solo:5,wins_solo_normal:3,losses_solo_normal:2}}})[0];
        const result=await renderer.render({...state.sessionHistory.sessions[0],modes:[mode]});
        return {png:result.canvas.toDataURL(),width:result.width,height:result.height,text:result.canvas.getAttribute('aria-label')};
    });
    assert(skyCard.width<1100&&skyCard.height<500,'single-mode SkyWars card should be compact');
    assert(skyCard.text.includes('Normal Solo: 5'));
    assert(!skyCard.text.includes('Insane Doubles: 0'));
    require('fs').writeFileSync(path.join(output,'session-skywars-compact.png'),Buffer.from(skyCard.png.split(',')[1],'base64'));
    await page.evaluate(()=>{state.sessionHistory=window.modeTestHistory;renderSessionHistory(state.sessionHistory);delete window.modeTestSession;delete window.modeTestHistory;});
};
