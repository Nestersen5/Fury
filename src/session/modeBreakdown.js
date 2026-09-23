'use strict';
// Read session deltas only: never turn lifetime stats or kit/aggregate counters
// into extra matches. Missing coverage remains explicit in old sessions.
const positive = value => Number.isFinite(value) && value > 0 ? Math.floor(value) : 0;
const title = value => value.split('_').map(s => ({uhc:'UHC',op:'OP',sw:'SkyWars',mw:'Mega Walls',bowspleef:'Bow Spleef',potion:'NoDebuff',duel:'1v1',doubles:'2v2',four:'4v4',threes:'3v3'}[s] || s.charAt(0).toUpperCase()+s.slice(1))).join(' ');
function bedwarsLabel(id) {
    const names={eight_one:'Solos',eight_two:'Doubles',four_three:'Threes',four_four:'Fours',two_four:'4v4',castle:'Castle'};
    if(names[id])return names[id];
    for(const [prefix,label] of Object.entries(names))if(id.startsWith(prefix+'_'))return `${label} ${title(id.slice(prefix.length+1))}`;
    return title(id);
}
function collectBreakdown(mode, stats={}, total=0) {
    let entries=[];let estimated=false;
    const add=(id,label,games)=>{games=positive(games);if(games)entries.push({id,label,games});};
    if(mode==='BEDWARS'){
        for(const [key,value] of Object.entries(stats)){
            const match=key.match(/^(.+)_games_played_bedwars$/);
            if(match)add(match[1],bedwarsLabel(match[1]),value);
        }
    }else if(mode==='DUELS'){
        for(const entry of require('./submodeStats').submodeStats(mode,stats))add(entry.id,entry.label,entry.games);
    }else if(mode==='SKYWARS'){
        for(const [id,label] of [['solo','Solo'],['team','Doubles']]){
            const parent=positive(stats[`games_${id}`]);
            const normal=positive(stats[`wins_${id}_normal`])+positive(stats[`losses_${id}_normal`]);
            const insane=positive(stats[`wins_${id}_insane`])+positive(stats[`losses_${id}_insane`]);
            // Aggregate games can lag recorded results. Keep the explicit
            // variant evidence instead of collapsing it back to Solo/Doubles.
            if(normal+insane){
                add(id+'_normal',label+' Normal',normal);add(id+'_insane',label+' Insane',insane);
                add(id+'_unknown',label+' (unspecified)',parent-normal-insane);estimated=true;
            }else add(id+'_unknown',label+' (unspecified)',parent);
        }
        for(const [id,label] of [['mini','Mini SkyWars'],['mega','Mega'],['mega_doubles','Mega Doubles'],['lab','Laboratory'],['tourney','Tournament']])add(id,label,stats[`games_${id}`]);
    }
    // Duels family/child counters have already been reconciled by submodeStats.
    const known=entries.reduce((n,e)=>n+e.games,0), expected=positive(total);
    if(!known)return {entries:[],status:'unavailable',total:expected,note:'Mode breakdown unavailable'};
    if(expected && known>expected)return {entries:[],status:'unavailable',total:expected,note:'Mode counters disagree with session total'};
    entries.sort((a,b)=>b.games-a.games||a.label.localeCompare(b.label));
    const missing=expected?expected-known:0;
    if(missing)entries.push({id:'unavailable',label:'Unavailable',games:missing,unknown:true});
    return {entries,total:expected||known,status:missing?'partial':estimated?'results':'available',
        note:missing?`${missing} games have no mode detail`:estimated?'Normal/Insane split uses recorded wins + losses':!expected?'Total from available mode counters':''};
}
const ALWAYS_SHOWN = {
    BEDWARS: [['eight_one','Solos'],['eight_two','Doubles'],['four_three','Threes'],['four_four','Fours'],['two_four','4v4']],
    SKYWARS: [['mini','Mini SkyWars'],['solo_normal','Normal Solo'],['team_normal','Normal Doubles'],['solo_insane','Insane Solo'],['team_insane','Insane Doubles']]
};
function displayBreakdown(mode, breakdown={entries:[],status:'unavailable',note:'Mode breakdown unavailable'}) {
    if(!ALWAYS_SHOWN[mode])return breakdown;
    const entries=breakdown.entries||[];
    const incomplete=['partial','unavailable'].includes(breakdown.status);
    const fixed=ALWAYS_SHOWN[mode].map(([id,label])=>({...(entries.find(e=>e.id===id)||{id,games:0,...(incomplete?{unavailableValue:true}:{})}),label}));
    return {...breakdown,entries:[...fixed,...entries.filter(e=>!fixed.some(f=>f.id===e.id))]};
}
function modeBreakdown(mode, stats={}, total=0) {return displayBreakdown(mode,collectBreakdown(mode,stats,total));}
module.exports={modeBreakdown,displayBreakdown};
