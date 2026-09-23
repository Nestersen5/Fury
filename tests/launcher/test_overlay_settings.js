'use strict';
const REPOSITORY_ROOT = require('path').resolve(__dirname, '../..');
const assert=require('assert'),fs=require('fs'),path=require('path'),os=require('os'),vm=require('vm');
const source=fs.readFileSync(path.join(REPOSITORY_ROOT,'proxy.js'),'utf8');
const predicate=source.match(/function canAutoAddSocialOverlayPlayer\(type\) \{[\s\S]*?\n        \}/)[0];
const context=vm.createContext({socialOverlayAddsEnabled:false,overlayAutoAddOutsideGamesOnly:true,
    gameActive:false,currentGamemode:'BEDWARS',isSupportedTabStatsMode:mode=>mode==='BEDWARS'});
vm.runInContext(predicate,context);
for(const type of ['mention','dm','party']) {
    context.socialOverlayAddsEnabled=false;
    assert.strictEqual(context.canAutoAddSocialOverlayPlayer(type),false);
    context.socialOverlayAddsEnabled=true;
    assert.strictEqual(context.canAutoAddSocialOverlayPlayer(type),true);
    context.gameActive=true;
    assert.strictEqual(context.canAutoAddSocialOverlayPlayer(type),false);
    context.gameActive=false;
}
const directory=fs.mkdtempSync(path.join(os.tmpdir(),'fury-overlay-settings-'));
process.env.FURY_DATA_DIR=directory;
try {
    const config=require('../../app_config');
    const old={socialOverlayAddsEnabled:true,overlayMentionAddsEnabled:false,overlayDmAddsEnabled:false,overlayPartyInviteAddsEnabled:false};
    fs.writeFileSync(config.paths.features,JSON.stringify(old));
    const loaded=config.loadFeatureSettings();
    assert.strictEqual(loaded.socialOverlayAddsEnabled,true);
    for(const key of Object.keys(old).slice(1))assert.strictEqual(loaded[key],undefined);
    config.saveFeatureSettings({...old,socialOverlayAddsEnabled:false});
    const saved=JSON.parse(fs.readFileSync(config.paths.features,'utf8'));
    assert.strictEqual(saved.socialOverlayAddsEnabled,false);
    for(const key of Object.keys(old).slice(1))assert.strictEqual(saved[key],undefined);
} finally {fs.rmSync(directory,{recursive:true,force:true});}
console.log('Overlay master switch and legacy settings tests passed.');
