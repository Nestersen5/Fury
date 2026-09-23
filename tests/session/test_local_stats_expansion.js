'use strict';
const assert=require('assert'),fs=require('fs'),os=require('os'),path=require('path');
const {createGame,observe,observeResult,localModes,normalizeLocal,nextStreak}=require('../../src/session/localStats');
const {createSessionStore}=require('../../src/session/sessionStore');
const {createSessionTracker}=require('../../src/session/sessionTracker');
const {buildLauncherSessionHistory}=require('../../src/session/launcherSessionHistory');
const {buildCalendarStats}=require('../../src/session/calendarStats');
const start={key:'test',mode:'BEDWARS',ownName:'Tester',ownTeam:'Aqua',observedFromStart:true,standardBedwars:true,identityKnown:true,variant:'Doubles',startedAt:1000};
const game=createGame(start);
for(const text of ['Rival was killed by Tester.','Tester fell into the void.','Rival was killed by Tester. FINAL KILL!','Tester fell into the void. FINAL KILL!','BED DESTRUCTION > Red Bed was destroyed by Tester!','BED DESTRUCTION > Your Bed was destroyed by Rival!']){
    observe(game,text,{at:2000});observe(game,text,{at:2001});
}
assert(!observeResult(game,'[VIP] Rival: VICTORY!'));
observeResult(game,'GAME OVER!',{at:3000});
assert.equal(localModes({current:game})[0].games,1);
assert.equal(localModes({current:game})[0].losses,1,'A BedWars GAME OVER! is a loss');
assert.equal(game.resultFromGameOver,true);
observeResult(game,'VICTORY!',{at:3001});observeResult(game,'VICTORY!',{at:3002});
const mode=localModes({current:game})[0];
for(const field of ['games','wins','finals','finalDeaths','kills','deaths','beds','bedsLost','fkdr','kdr','wlr','bblr','localStreak'])assert.equal(mode[field],1,field);
assert.equal(mode.winRate,100);assert.equal(mode.losses,0);assert.equal(game.endedAt,3000);
assert.deepEqual(mode.breakdown.entries,[{id:'eight_two',label:'Doubles',games:1,unknown:false}]);
assert.equal(mode.submodes[0].finalDeaths,1);
observeResult(game,'DEFEAT!');assert(!('wlr'in localModes({current:game})[0]),'Conflicting results invalidate the ratio');
const loss=createGame(start);observe(loss,'TEAM ELIMINATED > Aqua Team has been eliminated!',{at:4000});
assert.equal(loss.result,'loss');assert.equal(localModes({current:loss})[0].localStreak,0);
let streak;for(const [banner,expected]of [['VICTORY!',1],['VICTORY!',2],['DEFEAT!',0],['VICTORY!',1],['GAME OVER!',0],['VICTORY!',1]]){
    const g=createGame(start);observeResult(g,banner);streak=nextStreak(streak,g);assert.equal(streak.available?streak.value:undefined,expected);
}
const skyOver=createGame({...start,mode:'SKYWARS'});observeResult(skyOver,'GAME OVER!');assert.equal(skyOver.result,null,'GAME OVER! outside BedWars stays unknown');
const unknown=createGame({...start,observedFromStart:false});observeResult(unknown,'VICTORY!');assert(!('games'in localModes({current:unknown})[0]));
const nick=createGame({...start,identityKnown:false});observeResult(nick,'VICTORY!');assert.equal(localModes({current:nick})[0].wins,1);assert(!('kdr'in localModes({current:nick})[0]));
const legacy=localModes(normalizeLocal({totals:{BEDWARS:{finals:{value:3,available:true},beds:{value:1,available:true},bedsLost:{value:0,available:true}}}}))[0];
assert.equal(legacy.finals,3);for(const key of ['games','wins','losses','kills','deaths','finalDeaths','fkdr','kdr','wlr'])assert(!(key in legacy),key+' must remain unknown in old saves');
const odd=createGame(start);observe(odd,'Rival was mysteriously vaporized.');assert(!('kdr'in localModes({current:odd})[0]));
const unknownMode=createGame({...start,variant:null});observeResult(unknownMode,'VICTORY!');assert.equal(localModes({current:unknownMode})[0].breakdown.status,'partial');

(async()=>{
    const folder=fs.mkdtempSync(path.join(os.tmpdir(),'fury-local-expanded-')),sessionFile=path.join(folder,'sessions.json');
    let stamp=Date.parse('2026-09-14T21:58:00Z'),calls=0;
    const account={uuid:'a'.repeat(32),name:'Tester'};
    const storeOptions={sessionFile,now:()=>stamp,saveDelayMs:0,writeJsonOffThread:(f,data,label,done)=>{
        fs.writeFileSync(f,JSON.stringify(data));
        done(null,{version:1,stamp:require('../../src/storage/filePublication').readPublicationStamp(f)});
    }};
    const store=createSessionStore(storeOptions);
    const tracker=createSessionTracker({store,now:()=>stamp,getIdentity:()=>account,isApiAvailable:()=>false,fetchOwnStats:async()=>{calls++;throw Error('Unexpected API call');},setTimeoutImpl:()=>({unref(){}}),clearTimeoutImpl:()=>{}});
    try{
        await tracker.onGameStart({...start,sessionKey:'before-midnight'});
        stamp=Date.parse('2026-09-14T21:59:59Z');tracker.observeLocalResult('VICTORY!');
        stamp=Date.parse('2026-09-14T22:00:02Z');await tracker.onGameEnd({mode:'BEDWARS',durationMs:122000});
        await tracker.onGameStart({...start,sessionKey:'after-midnight',variant:'Solos'});
        stamp+=15000;tracker.observeLocalResult('DEFEAT!');await tracker.onGameEnd({mode:'BEDWARS',durationMs:15000});
        await tracker.onGameEnd({mode:'BEDWARS',durationMs:15000});
        await tracker.onGameStart({...start,sessionKey:'short-duel',mode:'DUELS',variant:{id:'sumo_duel',label:'Sumo'}});
        await tracker.onGameEnd({mode:'BEDWARS',durationMs:60000});
        assert.equal(tracker.getActiveSession().localTracking.current.mode,'DUELS','A stale end from another game cannot close a Duel');
        stamp+=3000;tracker.observeLocalResult('VICTORY!');await tracker.onGameEnd({mode:'DUELS',durationMs:3000});
        await tracker.finish();
        const reloaded=createSessionStore(storeOptions);
        const history=buildLauncherSessionHistory(reloaded.getHistory(),{account,accountScoped:true,now:stamp});
        assert.equal(history.sessions.length,1);assert.equal(history.sessions[0].games.length,3);
        assert.equal(history.sessions[0].games.find(g=>g.mode==='BEDWARS'&&g.result==='win').at,Date.parse('2026-09-14T21:59:59Z'),'Use the result day, not the lobby return day');
        const bw=history.sessions[0].modes.find(m=>m.mode==='BEDWARS');assert.equal(bw.games,2);assert.equal(bw.winRate,50);assert.equal(bw.localStreak,0);
        assert.equal(bw.breakdown.entries.length,2);assert.equal(history.sessions[0].modes.find(m=>m.mode==='DUELS').games,1);
        const options={timeZone:'Europe/Warsaw',now:stamp};
        const daily=buildCalendarStats(history.calendarSessions,{...options,kind:'daily'});
        assert.equal(daily.length,2);assert.equal(daily.find(d=>d.calendar.start==='2026-09-14').modes[0].wins,1);
        assert.equal(daily.find(d=>d.calendar.start==='2026-09-15').modes.find(m=>m.mode==='BEDWARS').losses,1);
        const weekly=buildCalendarStats(history.calendarSessions,{...options,kind:'weekly'})[0];
        assert.equal(weekly.modes.find(m=>m.mode==='BEDWARS').winRate,50);assert.equal(weekly.modes.find(m=>m.mode==='BEDWARS').localStreak,0);
        assert.equal(calls,0);
    }finally{tracker.detach();fs.rmSync(folder,{recursive:true,force:true});}
    console.log('PASS local results, duplicate events, final deaths, ratios, streaks, variants, legacy coverage, short Duels, persistence and midnight activity.');
})().catch(error=>{console.error(error);process.exitCode=1;});
