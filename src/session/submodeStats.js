'use strict';

const count = value => Math.max(0, Number.isFinite(value) ? value : 0);
const title = value => value.split('_').map(s => ({uhc:'UHC',op:'OP',sw:'SkyWars',mw:'Mega Walls',bowspleef:'Bow Spleef',potion:'NoDebuff',duel:'1v1',doubles:'2v2',four:'4v4',threes:'3v3'}[s] || s.charAt(0).toUpperCase()+s.slice(1))).join(' ');

function duelsPrefixes(stats) {
    return [...new Set(Object.keys(stats).flatMap(key => {
        const match = key.match(/^(.+)_(rounds_played|wins|losses)$/);
        return match && !/kit|streak|best|current|overall/.test(match[1]) ? [match[1]] : [];
    }))];
}

function detail(id, label, mode, raw, games) {
    const out = {id, label, mode, games};
    for (const [a,b,ratio] of [['wins','losses','wlr'],['kills','deaths','kdr']]) {
        if (Object.hasOwn(raw,a) || Object.hasOwn(raw,b)) {
            out[a] = count(raw[a]); out[b] = count(raw[b]);
            out[ratio] = out[a] / Math.max(1,out[b]);
        }
    }
    if (Object.hasOwn(raw,'assists')) out.assists = count(raw.assists);
    if ('wins' in out && games > 0) out.winRate = out.wins / games * 100;
    return out;
}

function submodeStats(mode, stats = {}) {
    const fields = ['wins','losses','kills','deaths','assists'];
    if (mode === 'DUELS') {
        const prefixes = duelsPrefixes(stats);
        return prefixes.flatMap(id => {
            // Subtract immediate children only: family counters include them.
            const children = prefixes.filter(p => p.startsWith(id+'_') && !prefixes.some(parent => parent !== id && p !== parent && p.startsWith(parent+'_') && parent.startsWith(id+'_')));
            const raw = {};
            for (const field of [...fields,'rounds_played']) {
                const key = `${id}_${field}`;
                if (Object.hasOwn(stats,key)) raw[field] = Math.max(0,count(stats[key])-children.reduce((n,p)=>n+count(stats[`${p}_${field}`]),0));
            }
            const games = Math.max(count(raw.rounds_played),count(raw.wins)+count(raw.losses));
            if (!games && !fields.some(f=>raw[f]>0)) return [];
            return [detail(id,title(id)+(children.length?' (unspecified)':''),mode,raw,games)];
        }).sort((a,b)=>a.label.localeCompare(b.label));
    }
    if (mode === 'SKYWARS') {
        const variants = [['solo_normal','Normal Solo'],['team_normal','Normal Doubles'],['solo_insane','Insane Solo'],['team_insane','Insane Doubles'],['mini','Mini SkyWars'],['mega','Mega'],['mega_doubles','Mega Doubles'],['lab','Laboratory'],['tourney','Tournament']];
        return variants.flatMap(([id,label]) => {
            const raw = {};
            for (const field of fields) if (Object.hasOwn(stats,`${field}_${id}`)) raw[field]=count(stats[`${field}_${id}`]);
            const games = Math.max(count(stats[`games_${id}`]),count(raw.wins)+count(raw.losses));
            if (!games && !fields.some(f=>raw[f]>0)) return [];
            return [detail(id,label,mode,raw,games)];
        });
    }
    return [];
}

module.exports = {submodeStats};
