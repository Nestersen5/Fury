'use strict';
const assert=require('assert'),fs=require('fs'),path=require('path');
module.exports=async({page,output})=>{
    const result=await page.evaluate(async()=>{
        const renderer=require('./src/launcher/renderer/launcher_session_card'),{MODE_DEFINITIONS,compactModeStats}=require('./src/session/launcherSessionHistory');
        const fixtures=[
            ['bedwars',0,{wins_bedwars:40,losses_bedwars:0,games_played_bedwars:40,final_kills_bedwars:67,final_deaths_bedwars:0,kills_bedwars:39,deaths_bedwars:53,beds_broken_bedwars:25,beds_lost_bedwars:0,Experience:5700,four_three_games_played_bedwars:40}],
            ['skywars',1,{wins:8,losses:4,kills:24,deaths:4,games:12,games_solo:12,wins_solo_normal:2,losses_solo_normal:1,wins_solo_insane:6,losses_solo_insane:3}],
            ['duels',2,{wins:14,losses:6,kills:18,deaths:6,rounds_played:20,classic_duel_rounds_played:10,bridge_duel_rounds_played:6,sumo_duel_rounds_played:4}],
            ['unavailable',2,{wins:1,losses:1}],
            ['partial',0,{wins_bedwars:5,games_played_bedwars:5,eight_one_games_played_bedwars:2}]
        ];
        const base={name:'Nestersen',uuid:'a'.repeat(32),startedAt:new Date('2026-09-10T19:02:00').getTime(),endedAt:new Date('2026-09-10T21:52:00').getTime(),durationMs:10200000};
        const results=[];
        const localStats=require('./src/session/localStats');
        const observed=localStats.createGame({key:'preview',mode:'BEDWARS',startedAt:base.startedAt,ownName:'Nestersen',ownTeam:'Aqua',identityKnown:true,observedFromStart:true,standardBedwars:true,variant:'Doubles'});
        for(const [key,value]of Object.entries({wins:7,losses:3,games:10,finals:22,finalDeaths:3,kills:17,deaths:12,beds:8,bedsLost:4}))observed.counts[key].value=value;
        const local={totals:{BEDWARS:observed.counts},variants:{},streaks:{BEDWARS:{value:3,available:true,at:base.endedAt}}};localStats.addVariant(local,observed);
        const localCard=await renderer.render({...base,modes:localStats.localModes(local)});
        results.push({name:'observed-local',width:localCard.width,height:localCard.height,text:localCard.canvas.getAttribute('aria-label'),png:localCard.canvas.toDataURL()});
        for(const [name,index,stats]of fixtures){const mode=compactModeStats(MODE_DEFINITIONS[index],stats);const card=await renderer.render({...base,modes:[mode]});results.push({name,width:card.width,height:card.height,text:card.canvas.getAttribute('aria-label'),png:card.canvas.toDataURL()});}
        for(const count of [5,10,17,31]){
            const mode=compactModeStats(MODE_DEFINITIONS[2],{wins:35,losses:15,kills:45,deaths:15,rounds_played:50});
            const names=['Classic 1v1','Sumo 1v1','Bridge 1v1','UHC 1v1','OP 1v1','Bow 1v1','Combo 1v1','Blitz 1v1','NoDebuff 1v1','Bow Spleef 1v1'];
            mode.breakdown={entries:Array.from({length:count},(_,i)=>({id:String(i),label:names[i%10]+(i>=10?' Variant '+i:''),games:count-i})),total:count*(count+1)/2,status:'available'};
            mode.games=mode.breakdown.total;mode.winRate=mode.wins/mode.games*100;
            const card=await renderer.render({...base,modes:[mode]});results.push({name:'modes-'+count,width:card.width,height:card.height,text:card.canvas.getAttribute('aria-label'),png:card.canvas.toDataURL()});
        }
        for(const gain of [0,0.4,1.5,2,2.35]){
            const mode=compactModeStats(MODE_DEFINITIONS[0],{wins_bedwars:1,games_played_bedwars:1,eight_one_games_played_bedwars:1,Experience:gain*5000});
            const card=await renderer.render({...base,modes:[mode]});
            results.push({name:'stars-'+gain,width:card.width,height:card.height,text:card.canvas.getAttribute('aria-label'),png:card.canvas.toDataURL()});
        }
        // Both side-by-side and multi-row charts must disappear without reserving space.
        for(const [name,index,stats] of fixtures.slice(0,3)){
            const mode=compactModeStats(MODE_DEFINITIONS[index],stats);
            if(index===2)mode.breakdown={entries:Array.from({length:17},(_,i)=>({id:String(i),label:'Mode '+i,games:i+1})),total:153,status:'available'};
            for(const local of [false,true]){
                const session={...base,modes:[{...mode,local}]};
                const fields=require('./src/session/settings').SESSION_TRACKED_FIELDS[mode.mode].filter(key=>key!=='hideGamesByMode');
                const shown=await renderer.render(session,{fields});
                const hidden=await renderer.render(session,{fields:[...fields.filter(key=>key!=='gamesByMode'),'hideGamesByMode']});
                results.push({name:name+'-chart-off'+(local?'-local':''),width:hidden.width,height:hidden.height,text:hidden.canvas.getAttribute('aria-label'),png:hidden.canvas.toDataURL(),chartOff:true,shownWidth:shown.width,shownHeight:shown.height});
            }
        }
        return results;
    });
    for(const label of ['Wins: 7','Losses: 3','Final deaths: 3','WLR:','FKDR:','KDR:','BBLR:','Local streak: 3','Games: 10','70.0%','Doubles: 10'])assert(result.find(c=>c.name==='observed-local').text.includes(label),label);
    assert(result.find(c=>c.name==='stars-0.4').text.includes('0.40/1 \u272b'));
    assert(result.find(c=>c.name==='stars-1.5').text.includes('1.50/2 \u272b'));
    assert(result.find(c=>c.name==='stars-2').text.includes('2.00/2 \u272b'));
    assert(result.find(c=>c.name==='stars-0').text.includes('0.00/0 \u272b'));
    assert(result.find(c=>c.name==='stars-2.35').text.includes('2.35/3 \u272b'));
    assert(result.every(c=>!c.text.includes('Progress to star')));
    for(const card of result){if(card.chartOff){assert(!card.text.includes('Games by mode'));assert(card.width<card.shownWidth||card.height<card.shownHeight);}else assert(card.text.includes('Games by mode')||card.text.includes('Mode breakdown unavailable'));fs.writeFileSync(path.join(output,`new-card-${card.name}.png`),Buffer.from(card.png.split(',')[1],'base64'));}
    assert(result.find(c=>c.name==='bedwars').text.includes('Threes: 40 (100.0%)'));
    assert(result.find(c=>c.name==='skywars').text.includes('Insane Solo: 9 (75.0%)'));
    assert(result.find(c=>c.name==='bedwars').text.includes('Solos: 0 (0.0%)'));
    assert(!result.find(c=>c.name==='skywars').text.includes('Mini SkyWars: 0 (0.0%)'),'SkyWars hides unplayed mode columns');
    assert(!result.find(c=>c.name==='duels').text.includes('0 (0.0%)'));
    assert(result.find(c=>c.name==='partial').text.includes('Unavailable: 3 (60.0%)'));
    assert(result.find(c=>c.name==='modes-17').height>result.find(c=>c.name==='modes-10').height);
    assert(result.find(c=>c.name==='modes-31').height>result.find(c=>c.name==='modes-17').height);
};
