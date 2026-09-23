'use strict';

// Values and coverage travel together. Old saves do not acquire invented zeros
// when new counters are introduced; derived ratios require both inputs.
const FIELDS=['finals','beds','bedsLost','wins','losses','games','finalDeaths','kills','deaths'];
const BEDWARS_FIELDS=['finals','beds','bedsLost','finalDeaths'];
const LABELS={BEDWARS:'BedWars',SKYWARS:'SkyWars',DUELS:'Duels'};
const clean=value=>String(value||'').replace(/(?:\u00c2)?\u00a7[0-9a-fk-or]/gi,'').trim();
const team=value=>/^(Red|Blue|Green|Yellow|Aqua|White|Pink|Gray|Grey)$/i.test(String(value))?String(value).toLowerCase().replace('grey','gray'):null;
const number=value=>Math.max(0,Number.isFinite(Number(value))?Number(value):0);
// Every name the player is known by in this game: the account name, or the
// nick Hypixel shows while nicked. Older saves only carry ownName.
const names=(list,fallback)=>[...new Set([...(Array.isArray(list)?list:[]),fallback].map(name=>String(name||'').toLowerCase()).filter(name=>/^[a-z0-9_]{2,16}$/.test(name)))].slice(0,8);
function normalizeTotals(raw={}){return Object.fromEntries(FIELDS.map(key=>[key,{value:number(raw[key]?.value),available:raw[key]?.available===true}]));}
function mergeTotals(target,source){
    if(!target)return normalizeTotals(source);
    for(const key of FIELDS){target[key].value+=source[key].value;target[key].available&&=source[key].available;}
    return target;
}
function normalizeVariant(mode,raw){
    const label=clean(typeof raw==='object'?raw?.label:raw).slice(0,60);
    const known={Solos:'eight_one',Solo:'eight_one',Doubles:'eight_two',Threes:'four_three',Fours:'four_four','4v4':'two_four'};
    if(!label)return {id:'unavailable',label:'Unspecified',unknown:true};
    return {id:mode==='BEDWARS'&&known[label]?known[label]:String(raw?.id||label).toLowerCase().replace(/[^a-z0-9_]+/g,'_').slice(0,80),label,unknown:false};
}
function normalizeLocal(raw={}){
    const totals={},variants={},streaks={};
    for(const mode of Object.keys(LABELS)){
        if(raw.totals?.[mode])totals[mode]=normalizeTotals(raw.totals[mode]);
        if(raw.variants?.[mode])variants[mode]=Object.fromEntries(Object.entries(raw.variants[mode]).map(([id,v])=>[id,{label:clean(v.label).slice(0,60),unknown:v.unknown===true,counts:normalizeTotals(v.counts)}]));
        if(raw.streaks?.[mode])streaks[mode]={value:number(raw.streaks[mode].value),available:raw.streaks[mode].available===true,at:number(raw.streaks[mode].at)};
    }
    const g=raw.current;
    return {totals,variants,streaks,lastGameKey:String(raw.lastGameKey||''),current:g&&LABELS[g.mode]?{
        key:String(g.key),mode:g.mode,startedAt:number(g.startedAt),endedAt:number(g.endedAt),
        observedFromStart:g.observedFromStart===true,standardBedwars:g.standardBedwars===true,
        result:['win','loss'].includes(g.result)?g.result:null,resultConflict:g.resultConflict===true,resultFromGameOver:g.resultFromGameOver===true,endObserved:g.endObserved===true,leftAt:number(g.leftAt),bedGone:g.bedGone===true,
        ownName:String(g.ownName||'').toLowerCase(),ownNames:names(g.ownNames,g.ownName),ownTeam:team(g.ownTeam),
        variant:g.variant&&typeof g.variant==='object'?{id:String(g.variant.id),label:clean(g.variant.label).slice(0,60),unknown:g.variant.unknown===true}:normalizeVariant(g.mode,null),
        counts:normalizeTotals(g.counts),victims:[...new Set(g.victims||[])].slice(0,32),destroyedTeams:[...new Set(g.destroyedTeams||[])].slice(0,8),
        recent:(g.recent||[]).filter(e=>typeof e.text==='string'&&Number.isFinite(e.at)).slice(-64)
    }:null};
}
function deriveRatios(mode){
    for(const [key,a,b]of [['wlr','wins','losses'],['fkdr','finals','finalDeaths'],['kdr','kills','deaths'],['bblr','beds','bedsLost']]){
        if(Number.isFinite(mode[a])&&Number.isFinite(mode[b]))mode[key]=mode[a]/Math.max(1,mode[b]);
    }
    if(Number.isFinite(mode.wins)&&Number.isFinite(mode.games))mode.winRate=mode.games?mode.wins/mode.games*100:0;
    return mode;
}
function displayMode(mode,totals){
    const expected=FIELDS.filter(key=>mode==='BEDWARS'||!BEDWARS_FIELDS.includes(key));
    return deriveRatios({mode,label:LABELS[mode],local:true,
        ...Object.fromEntries(expected.filter(key=>totals[key].available).map(key=>[key,totals[key].value])),
        unavailable:expected.filter(key=>!totals[key].available)});
}
function addVariant(local,game){
    const variants=local.variants[game.mode]||={};const v=game.variant;
    const target=variants[v.id]||={label:v.label,unknown:v.unknown,counts:null};
    target.counts=mergeTotals(target.counts,game.counts);
}
function nextStreak(previous,game){
    const at=game.endedAt||game.startedAt;
    if(!game.endObserved||!game.counts.wins.available||!game.counts.losses.available||!game.result)return {value:0,available:false,at};
    return {value:game.result==='loss'?0:(previous?.available?previous.value:0)+1,available:true,at};
}
function localModes(raw){
    const local=normalizeLocal(raw);
    // A paused game shows only what is certain until it is rejoined.
    if(local.current){const g=local.current;if(g.leftAt)settleGame(g);local.totals[g.mode]=mergeTotals(local.totals[g.mode],g.counts);addVariant(local,g);if(g.endObserved)local.streaks[g.mode]=nextStreak(local.streaks[g.mode],g);}
    return Object.entries(local.totals).map(([mode,totals])=>{
        const out=displayMode(mode,totals),variants=local.variants[mode]||{};
        const entries=Object.entries(variants).filter(([,v])=>v.counts.games.available).map(([id,v])=>({id,label:v.label,games:v.counts.games.value,unknown:v.unknown}));
        const total=entries.reduce((sum,e)=>sum+e.games,0);
        const covered=Number.isFinite(out.games)&&total===out.games&&Object.values(variants).every(v=>v.counts.games.available&&(!v.unknown||v.counts.games.value===0));
        out.breakdown={entries,total:out.games??total,status:covered?'available':'partial',note:covered?'Completed games observed by Fury':'Some game-mode counts are unavailable'};
        out.submodes=Object.entries(variants).filter(([,v])=>!v.unknown).map(([id,v])=>({...displayMode(mode,v.counts),id,label:v.label}));
        const streak=local.streaks[mode];if(streak){out.localStreakAt=streak.at;if(streak.available)out.localStreak=streak.value;}
        return out;
    });
}
function createGame({key,mode,startedAt,ownName,ownNames,ownTeam,observedFromStart,standardBedwars,identityKnown,variant}){
    const observed=observedFromStart===true;
    return {key:String(key),mode,startedAt,endedAt:0,endObserved:false,result:null,resultConflict:false,
        observedFromStart:observed,standardBedwars:standardBedwars===true,ownName:String(ownName||'').toLowerCase(),ownNames:names(ownNames,ownName),ownTeam:team(ownTeam),variant:normalizeVariant(mode,variant),
        counts:Object.fromEntries(FIELDS.map(field=>[field,{value:0,available:observed&&
            (BEDWARS_FIELDS.includes(field)?mode==='BEDWARS'&&standardBedwars===true&&(field==='bedsLost'?Boolean(team(ownTeam)):identityKnown===true):
                ['kills','deaths'].includes(field)?identityKnown===true:true)}])),victims:[],destroyedTeams:[],recent:[],leftAt:0,bedGone:false};
}
function invalidate(game,fields=FIELDS){for(const key of fields)game.counts[key].available=false;}
function observeResult(game,message,{at=Date.now()}={}){
    const text=clean(message);if(!game||! /^(VICTORY|DEFEAT|GAME OVER)\s*!?$/i.test(text))return false;
    // BedWars shows GAME OVER! to every losing player; winners get VICTORY!.
    // It is a weak loss: a VICTORY! for the same game replaces it.
    const gameOver=/^GAME OVER/i.test(text);
    const result=/^VICTORY/i.test(text)?'win':/^DEFEAT/i.test(text)?'loss':gameOver&&game.mode==='BEDWARS'?'loss':null;
    game.endObserved=true;game.endedAt ||= at;
    if(game.observedFromStart)game.counts.games={value:1,available:true};
    if(result&&gameOver){
        if(!game.result){game.result=result;game.resultFromGameOver=true;}
    }else if(result){
        if(game.resultFromGameOver){game.result=result;game.resultFromGameOver=false;}
        else if(game.result&&game.result!==result)game.resultConflict=true;
        game.result ||= result;
    }
    if(!game.observedFromStart||game.resultConflict||!game.result)invalidate(game,['wins','losses']);
    else {game.counts.wins={value:game.result==='win'?1:0,available:true};game.counts.losses={value:game.result==='loss'?1:0,available:true};}
    return true;
}
function observe(game,message,{identityKnown=true,ownNames=null,ownTeam=null,at=Date.now()}={}){
    if(!game)return false;
    if(!game.ownTeam&&team(ownTeam))game.ownTeam=team(ownTeam);
    if(!identityKnown)invalidate(game,['finals','beds','finalDeaths','kills','deaths']);
    else if(ownNames)game.ownNames=names([...game.ownNames,...ownNames]);
    const own=name=>Boolean(name)&&game.ownNames.includes(name);
    const text=clean(message);
    if(!text||/:/.test(text)||/^(?:Party|Guild|Officer|From|To|\[)/i.test(text))return false;
    if(game.mode==='BEDWARS'&&/\b(?:all beds (?:have been )?destroyed|bed destruction)\b/i.test(text)&&!/\bby\b/i.test(text)&&!/TEAM ELIMINATED/.test(text)){
        if(/\ball beds\b|^(?:BED DESTRUCTION\s*>\s*)?Your Bed\b/i.test(text))game.bedGone=true;
        invalidate(game,['beds','bedsLost']);return true;
    }
    const eliminated=text.match(/^TEAM ELIMINATED\s*>\s*(Red|Blue|Green|Yellow|Aqua|White|Pink|Gr[ae]y) Team has been eliminated[!.]?$/i);
    if(game.mode==='BEDWARS'&&eliminated&&team(eliminated[1])===game.ownTeam)return observeResult(game,'DEFEAT!',{at});
    if(game.mode==='BEDWARS'&&/\bBED DESTRUCTION\b|\bBed\b.*\bdestroyed\b/i.test(text)){
        // Hypixel names the player's own bed "Your Bed" whatever the verb.
        if(/^(?:BED DESTRUCTION\s*>\s*)?Your Bed\b/i.test(text))game.bedGone=true;
        const match=text.match(/^(?:BED DESTRUCTION\s*>\s*)?(Your|Red|Blue|Green|Yellow|Aqua|White|Pink|Gr[ae]y) Bed was (?:bed #[\d,]+ )?destroyed by ([A-Za-z0-9_]{2,16})[!.]?$/i);
        if(!match){invalidate(game,['beds','bedsLost']);return true;}
        const target=/^your$/i.test(match[1])?game.ownTeam:team(match[1]);if(!target){invalidate(game,['beds','bedsLost']);return true;}
        if(game.destroyedTeams.includes(target))return false;game.destroyedTeams.push(target);
        if(own(match[2].toLowerCase()))game.counts.beds.value++;
        if(target===game.ownTeam){game.counts.bedsLost.value++;game.bedGone=true;}
        return true;
    }
    const final=/\bFINAL KILL!/i.test(text);
    const victim=text.match(/^([A-Za-z0-9_]{2,16})\s+/)?.[1]?.toLowerCase();
    const actor=text.match(/\bby\s+([A-Za-z0-9_]{2,16})(?:'s Golem)?[.!]?\s*(?:FINAL KILL!)?$/i)?.[1]?.toLowerCase()
        ||text.match(/^\w+ was ([A-Za-z0-9_]{2,16})'s final #[\d,]+[.!]?\s*FINAL KILL!$/i)?.[1]?.toLowerCase();
    const suicide=/^\w+ (?:fell into the void|fell from a high place|hit the ground too hard|died|drowned|burned to death|went up in flames|tried to swim in lava|suffocated in a wall)[.!]?\s*(?:FINAL KILL!)?$/i.test(text);
    const combat=final||suicide||/^\w+ (?:was|got|fell|died|drowned|burned|suffocated)\b/i.test(text);
    if(!combat)return false;
    if(game.recent.some(e=>e.text===text&&at>=e.at&&at-e.at<1000))return false;
    game.recent.push({text,at});game.recent=game.recent.slice(-64);
    if(final&&game.mode==='BEDWARS'){
        if(!victim){invalidate(game,['finals','finalDeaths']);return true;}
        if(game.victims.includes(victim))return false;game.victims.push(victim);
        if(own(victim))game.counts.finalDeaths.value++;
        if(own(actor)&&victim!==actor)game.counts.finals.value++;
        else if(!actor&&!suicide)invalidate(game,['finals']);
        return true;
    }
    if(!victim||(!actor&&!suicide)){invalidate(game,['kills','deaths']);return true;}
    if(own(victim))game.counts.deaths.value++;
    if(own(actor)&&actor!==victim)game.counts.kills.value++;
    return true;
}
// Leaving before the end. BedWars can be rejoined while the bed stands, so
// the game pauses; leaving without a bed is a final death and ends it.
function leaveGame(game){
    if(!game||game.endObserved||game.mode!=='BEDWARS')return 'finish';
    if(game.counts.finalDeaths.value>0)return 'finish';
    if(game.bedGone){game.counts.finalDeaths.value++;return 'finish';}
    return 'pause';
}
// A game finished without its end. Counters observed while present stay
// exact; only what could still change after leaving becomes unknown.
function settleGame(game){
    if(!game||game.endObserved)return game;
    invalidate(game,['wins','losses','games']);
    if(game.mode==='BEDWARS'){if(!(game.counts.finalDeaths.value>0))invalidate(game,['finalDeaths','bedsLost']);}
    else if(!(game.counts.deaths.value>0))invalidate(game,['deaths']);
    return game;
}
module.exports={FIELDS,LABELS,clean,normalizeLocal,normalizeTotals,mergeTotals,localModes,createGame,observe,observeResult,invalidate,deriveRatios,addVariant,nextStreak,leaveGame,settleGame};
