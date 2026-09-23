'use strict';
const assert=require('assert');
const {buildCalendarStats,dayAt,periodStart,nextPeriod,nextMidnight}=require('../../src/session/calendarStats');
const {buildLauncherSessionHistory}=require('../../src/session/launcherSessionHistory');
const stamp=value=>Date.parse(value);
const mode=(wins=2,losses=1,finals=6,finalDeaths=2)=>({mode:'BEDWARS',label:'BedWars',wins,losses,finals,finalDeaths,games:wins+losses,stars:.1,kills:5,deaths:3,beds:2,bedsLost:1});
const session=(id,start,end,modes=[mode()],games=[])=>({id,name:'Player',uuid:'a'.repeat(32),startedAt:stamp(start),endedAt:stamp(end),lastSeen:stamp(end),modes,games});
const options={timeZone:'Europe/Warsaw',now:stamp('2026-09-22T12:00:00Z')};
const build=(sessions,kind='daily',extra={})=>buildCalendarStats(sessions,{...options,kind,...extra});
assert.equal(periodStart('2026-09-20','weekly'),'2026-09-14');
assert.equal(periodStart('2026-09-21','weekly'),'2026-09-21');
assert.equal(periodStart('2027-01-01','weekly'),'2026-12-28');
assert.equal(nextPeriod('2028-02-01','monthly'),'2028-03-01');
assert.equal(dayAt(stamp('2026-09-14T22:05:00Z'),'Europe/Warsaw'),'2026-09-15');
for(const [date,hours]of [['2026-03-28T23:00:00Z',23],['2026-10-24T22:00:00Z',25]])assert.equal((nextMidnight(stamp(date),'Europe/Warsaw')-stamp(date))/3600000,hours);
const a=session('a','2026-09-14T10:00:00Z','2026-09-14T11:00:00Z');
const b=session('b','2026-09-14T12:00:00Z','2026-09-14T13:00:00Z',[mode(8,2,24,6)]);
const daily=build([a,b]);assert.equal(daily.length,1);assert.equal(daily[0].modes[0].wins,10);assert.equal(daily[0].modes[0].fkdr,30/8);assert.equal(daily[0].durationMs,7200000);
// Account data are scoped before aggregation; mode filtering doesn't mix ratios.
assert.equal(build([a],'weekly',{mode:'DUELS'}).length,0);
const g1={id:'g1',at:stamp('2026-09-14T21:55:00Z'),mode:'BEDWARS',stats:mode(1,0,3,1),verificationStatus:'verified'};
const g2={...g1,id:'g2',at:stamp('2026-09-14T22:05:00Z')};
const summary={...mode(2,0,6,2),games:2,stars:.2,kills:10,deaths:6,beds:4,bedsLost:2};
const crossing=session('cross','2026-09-14T21:30:00Z','2026-09-14T22:30:00Z',[summary],[g1,g2]);
const split=build([crossing]);assert.equal(split.length,2);assert(split.every(p=>p.modes[0].wins===1));assert(split.every(p=>p.durationMs===1800000));assert(split.every(p=>!p.calendar.partial));
assert.equal(build([crossing],'weekly')[0].modes[0].wins,2);
assert.equal(build([crossing],'weekly')[0].calendar.chart.entries.find(e=>e.id==='2026-09-15').modes[0].games,1);
// Old cross-midnight summaries without game detail cannot be assigned to days.
const old={...crossing,games:[]};const partial=build([old]);assert(partial.every(p=>p.calendar.partial));assert(partial.every(p=>!('wins'in p.modes[0])));
assert.equal(build([old],'weekly')[0].modes[0].wins,2,'Whole-week summary is still usable');
// A later verified session must not restore a field missing from another session.
const mixed=build([old,a]);assert(!('wins'in mixed.find(p=>p.calendar.start==='2026-09-14').modes[0]));
const incomplete={...crossing,games:[g1]};assert(build([incomplete]).every(p=>!('wins'in p.modes[0])));
const duplicate={...crossing,games:[g1,g1,g2]};assert.equal(build([duplicate])[1].modes[0].wins,1);
const delayed={...crossing,games:[{...g2,stats:summary,from:crossing.startedAt}]};assert(build([delayed]).every(p=>!('wins'in p.modes[0])),'A multi-match API delta across midnight is not assigned to its latest match');
const local={...a,modes:[{mode:'BEDWARS',label:'BedWars',local:true,finals:4}]};assert(!('wins'in build([local])[0].modes[0]));assert.equal(build([local])[0].modes[0].finals,4);
const overlap={...a,id:'overlap',startedAt:a.startedAt+1800000,endedAt:a.endedAt+1800000};assert.equal(build([a,overlap])[0].durationMs,5400000);
const ongoing={...a,endedAt:0,active:true};assert.equal(build([ongoing])[0].durationMs,3600000,'Offline time is not tracked time');
const monthly=build([a],'monthly')[0];assert.equal(monthly.calendar.chart.entries.length,30);assert.equal(monthly.calendar.chart.entries[0].id,'2026-09-01');
const leap=build([session('leap','2028-02-29T10:00:00Z','2028-02-29T11:00:00Z')],'monthly',{now:stamp('2028-03-01T10:00:00Z')});assert.equal(leap[0].calendar.chart.entries.length,29);
const entries=Array.from({length:300},(_,i)=>({session:{id:String(i),uuid:'a'.repeat(32),name:'Player',startedAt:a.startedAt-i*86400000,endedAt:a.endedAt-i*86400000,games:[]},delta:{stats:{Bedwars:{wins_bedwars:1,games_played_bedwars:1}}}}));
entries.push({session:{...entries[0].session,id:'other',uuid:'b'.repeat(32),name:'Other'},delta:entries[0].delta});
const history=buildLauncherSessionHistory(entries,{account:{uuid:'a'.repeat(32),name:'Player'},accountScoped:true});
assert.equal(history.sessions.length,250);assert.equal(history.calendarSessions.length,300);assert(history.calendarSessions.every(s=>s.name==='Player'));
console.log('PASS calendar boundaries, DST, weighted ratios, midnight attribution, partial coverage, local tracking, deduplication, playtime, leap month and all-history/account scoping.');

// Submode counters aggregate independently; ratios are recomputed from totals.
const variant=(wins,losses)=>({mode:'DUELS',label:'Duels',games:wins+losses,wins,losses,submodes:[{mode:'DUELS',id:'classic_duel',label:'Classic 1v1',games:wins+losses,wins,losses,kills:wins*2,deaths:losses}]});
const variants=[session('v1','2026-09-14T10:00:00Z','2026-09-14T11:00:00Z',[variant(3,1)]),session('v2','2026-09-14T12:00:00Z','2026-09-14T13:00:00Z',[variant(5,3)])];
for(const kind of ['daily','weekly','monthly']){
 const card=build(variants,kind)[0],sub=card.modes[0].submodes[0];
 assert.equal(sub.id,'classic_duel');assert.equal(sub.mode,'DUELS');assert.equal(sub.games,12);assert.equal(sub.wins,8);assert.equal(sub.wlr,2);assert.equal(sub.kdr,4);
 if(card.calendar.chart)assert.equal(card.calendar.chart.entries.find(e=>e.id==='2026-09-14').modes[0].submodes[0].games,12);
}
const oldVariant={...variants[0],id:'legacy',modes:[{mode:'DUELS',label:'Duels',games:4}]};
assert(!build([...variants,oldVariant])[0].modes[0].submodes,'Legacy missing detail cannot become complete totals');
const crossVariant=session('vc','2026-09-14T21:30:00Z','2026-09-14T22:30:00Z',[variant(2,0)],[
 {id:'vga',mode:'DUELS',at:stamp('2026-09-14T21:55:00Z'),stats:variant(1,0),verificationStatus:'verified'},
 {id:'vgb',mode:'DUELS',at:stamp('2026-09-14T22:05:00Z'),stats:variant(1,0),verificationStatus:'verified'}]);
assert(build([crossVariant]).every(p=>p.modes[0].submodes[0].wins===1));
assert(build([{...crossVariant,games:crossVariant.games.slice(0,1)}]).every(p=>!p.modes[0].submodes));
console.log('PASS calendar submode totals, weighted ratios, daily chart data, legacy coverage and cross-midnight reconciliation.');
