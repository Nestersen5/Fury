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
        // Longer scope labels and shorter mode values must not resize the
        // canvas or move its headline/table columns when switching tabs.
        const comparison=compactModeStats(MODE_DEFINITIONS[0],{
            wins_bedwars:11,games_played_bedwars:11,final_kills_bedwars:28,final_deaths_bedwars:1,
            kills_bedwars:25,deaths_bedwars:36,beds_broken_bedwars:9,beds_lost_bedwars:2,Experience:178,
            four_four_games_played_bedwars:9,four_four_wins_bedwars:9,four_four_final_kills_bedwars:22,
            four_four_final_deaths_bedwars:1,four_four_kills_bedwars:18,four_four_deaths_bedwars:27,
            four_four_beds_broken_bedwars:7,four_four_beds_lost_bedwars:2
        });
        const traces=new WeakMap(),proto=CanvasRenderingContext2D.prototype;
        const originals={roundRect:proto.roundRect,fillRect:proto.fillRect,drawImage:proto.drawImage};
        for(const method of Object.keys(originals))proto[method]=function(...args){
            if(!traces.has(this.canvas))traces.set(this.canvas,{roundRect:[],fillRect:[],drawImage:[]});
            traces.get(this.canvas)[method].push(args.slice(method==='drawImage'?5:0));
            return originals[method].apply(this,args);
        };
        try{
            for(const avatar of [false,true])for(const chartOff of [false,true])for(const calendar of [false,true])for(const submode of ['overall','four_four']){
                const session={...base,modes:[comparison],...(calendar?{calendar:{kind:'daily',label:'September 10, 2026',sessionIds:['fixture'],activeDays:1,timeZone:'UTC'}}:{})};
                const fields=chartOff?[...require('./src/session/settings').SESSION_TRACKED_FIELDS.BEDWARS.filter(key=>key!=='gamesByMode'),'hideGamesByMode']:undefined;
                const card=await renderer.render(session,{submode,avatar,fields,skinAccount:null});
                const trace=traces.get(card.canvas),hero=trace.roundRect.find(rect=>rect[3]===116);
                const scales=[...new Set(trace.drawImage.filter(([,y,,h])=>y>=hero[1]&&y<hero[1]+hero[3]&&h>16).map(([,y,,h])=>`${y}:${h}`))];
                results.push({name:`stable-${avatar}-${chartOff}-${calendar}-${submode}`,width:card.width,height:card.height,
                    text:card.canvas.getAttribute('aria-label'),png:card.canvas.toDataURL(),stable:true,
                    geometry:{boxes:trace.roundRect,rules:trace.fillRect,scales}});
            }
        }finally{Object.assign(proto,originals);}
        return results;
    });
    for(const label of ['Wins: 7','Losses: 3','Final deaths: 3','WLR:','FKDR:','KDR:','BBLR:','Local streak: 3','Games: 10','70.0%','Doubles: 10'])assert(result.find(c=>c.name==='observed-local').text.includes(label),label);
    // Stars are a headline gain; the card no longer draws a progress bar.
    for(const gain of ['0','0.4','1.5','2','2.35'])assert(result.find(c=>c.name==='stars-'+gain).text.includes(`Stars gained: +${Number(gain).toFixed(2)}`),'stars-'+gain);
    assert(result.every(c=>!c.text.includes('Progress to star')));
    for(const card of result){if(card.stable)continue;if(card.chartOff){assert(!card.text.includes('Games by mode'));assert(card.width<card.shownWidth||card.height<card.shownHeight);}else assert(card.text.includes('Games by mode')||card.name==='unavailable');assert(!/at least|uncertain|incomplete coverage|Mode breakdown unavailable/i.test(card.text));fs.writeFileSync(path.join(output,`new-card-${card.name}.png`),Buffer.from(card.png.split(',')[1],'base64'));}
    for(const card of result.filter(c=>c.stable&&c.name.endsWith('-overall'))){
        const selected=result.find(c=>c.name===card.name.replace(/overall$/,'four_four'));
        assert.deepStrictEqual([selected.width,selected.height,selected.geometry],[card.width,card.height,card.geometry],card.name);
        assert(card.text.includes('Wins: 11')&&selected.text.includes('Wins: 9'),'Mode selection must retain the distinct stats');
        assert(selected.text.includes('Full session stars:')||selected.text.includes('Full period stars:'),'Keep the full-session star scope clear');
        assert(!selected.text.includes('Unknown: 0'));
        for(const item of [card,selected])fs.writeFileSync(path.join(output,`${item.name}.png`),Buffer.from(item.png.split(',')[1],'base64'));
    }
    assert(result.find(c=>c.name==='bedwars').text.includes('Threes: 40 (100.0%)'));
    assert(result.find(c=>c.name==='skywars').text.includes('Insane Solo: 9 (75.0%)'));
    assert(!result.find(c=>c.name==='bedwars').text.includes('Solos: 0'),'Unplayed BedWars modes stay off the bar');
    assert(!result.find(c=>c.name==='skywars').text.includes('Mini SkyWars: 0 (0.0%)'),'SkyWars hides unplayed mode columns');
    assert(!result.find(c=>c.name==='duels').text.includes('0 (0.0%)'));
    assert(result.find(c=>c.name==='partial').text.includes('Unknown: 3 (60.0%)'));
    // Small modes share one part of the bar, but the image description keeps every mode.
    assert(result.find(c=>c.name==='modes-31').text.includes('Bow Spleef 1v1 Variant 29: 2'));
    assert(result.find(c=>c.name==='modes-31').height>=result.find(c=>c.name==='modes-5').height);
};
