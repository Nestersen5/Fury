'use strict';
const REPOSITORY_ROOT = require('path').resolve(__dirname, '../..');
const assert=require('assert'),fs=require('fs'),path=require('path'),os=require('os'),vm=require('vm');
const source=fs.readFileSync(path.join(REPOSITORY_ROOT,'proxy.js'),'utf8');
const predicate=source.match(/function canAutoAddSocialOverlayPlayer\(type\) \{[\s\S]*?\n        \}/)[0];
const context=vm.createContext({overlayAutoAddOutsideGamesOnly:true,
    gameActive:false,currentGamemode:'BEDWARS',isSupportedTabStatsMode:mode=>mode==='BEDWARS'});
vm.runInContext(predicate,context);
for(const type of ['mention','dm','party','trigger']) {
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
    for(const key of Object.keys(old))assert.strictEqual(loaded[key],undefined);
    config.saveFeatureSettings({...old,socialOverlayAddsEnabled:false});
    const saved=JSON.parse(fs.readFileSync(config.paths.features,'utf8'));
    for(const key of Object.keys(old))assert.strictEqual(saved[key],undefined);
} finally {fs.rmSync(directory,{recursive:true,force:true});}
let now=1000;
context.Date={now:()=>now};
vm.runInContext(source.match(/const OVERLAY_UI_ACTIVE_TTL_MS[\s\S]*?(?=let pregameChatStatsEnabled)/)[0],context);
assert.strictEqual(context.isOverlayUiActive(),false);
context.reportOverlayUiVisible(true);
assert.strictEqual(context.isOverlayUiActive(),true);
context.reportOverlayUiVisible(false);
assert.strictEqual(context.isOverlayUiActive(),false,'Leaving Overlay clears visibility immediately');
context.reportOverlayUiVisible(true);
now+=15001;
assert.strictEqual(context.isOverlayUiActive(),false,'Lost launcher heartbeats expire');

const rows=new Map();let lookups=0,resolveLookup=null;
Object.assign(context,{
    manualOverlayPlayers:rows,isValidPlayerName:()=>true,isOwnPlayerName:()=>false,
    overlayContainsPlayer:()=>false,nickKey:name=>name.toLowerCase(),
    buildOverlayPlaceholderPlayer:name=>({name}),
    getOverlayPlayerData:async name=>{lookups++;return resolveLookup===null?{name,loaded:true}:new Promise(resolve=>{resolveLookup=resolve;});}
});
for(const name of ['getSocialOverlayMode','socialOverlayDetails','addChatTriggerOverlayPlayer','addMentionOverlayPlayer','addPartyInviteOverlayPlayer','addDirectMessageOverlayPlayer']){
    const fn=source.match(new RegExp(`(?:async )?function ${name}\\([^]*?\\n        \\}`));
    assert(fn,`Missing ${name}`);vm.runInContext(fn[0],context);
}
(async()=>{
    const additions=[
        options=>context.addChatTriggerOverlayPlayer('Alice','3/4',options),
        options=>context.addMentionOverlayPlayer('Alice',options),
        options=>context.addDirectMessageOverlayPlayer('Alice',options),
        ()=>context.addPartyInviteOverlayPlayer('Alice')
    ];
    for(const [index,add] of additions.entries()){
        rows.clear();lookups=0;context.reportOverlayUiVisible(false);
        assert.strictEqual(await add(),false);assert.strictEqual(lookups,0);assert.strictEqual(rows.size,0);
        if(index<3){
            const reply=await add({returnDetails:true});
            assert.strictEqual(reply.row.loaded,true,'Chat stats still work outside Overlay');
            assert.strictEqual(rows.size,0);
        }
        context.reportOverlayUiVisible(true);
        assert.strictEqual(await add(),true);assert.strictEqual(rows.size,1);
        rows.clear();resolveLookup=()=>{};
        const pending=add();assert.strictEqual(rows.size,1);
        context.reportOverlayUiVisible(false);rows.clear();
        resolveLookup({name:'Alice',loaded:true});await pending;
        assert.strictEqual(rows.size,0,'An in-flight lookup must not insert after leaving Overlay');
        resolveLookup=null;
    }
    console.log('Overlay visibility, independent chat stats and retired settings tests passed.');
})().catch(error=>{console.error(error);process.exitCode=1;});
