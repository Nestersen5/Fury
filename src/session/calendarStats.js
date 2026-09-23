'use strict';

// Calendar arithmetic uses civil dates, never 24-hour offsets in local time.
// Stored timestamps remain UTC; the launcher's saved timezone controls grouping.
const FIELDS = ['wins','losses','kills','deaths','finals','finalDeaths','beds','bedsLost','assists','games','stars'];
const formatters = new Map();
function validTimezone(zone) {
    try { new Intl.DateTimeFormat('en', { timeZone: zone }).format(); return zone; }
    catch { return 'UTC'; }
}
function dayAt(at, zone) {
    zone = validTimezone(zone);
    if (!formatters.has(zone)) formatters.set(zone, new Intl.DateTimeFormat('en-CA', { timeZone: zone, year:'numeric', month:'2-digit', day:'2-digit' }));
    const parts = Object.fromEntries(formatters.get(zone).formatToParts(at).map(p => [p.type,p.value]));
    return `${parts.year}-${parts.month}-${parts.day}`;
}
const civil = day => Date.parse(`${day}T00:00:00Z`);
const shiftDay = (day, count) => new Date(civil(day) + count * 86400000).toISOString().slice(0,10);
function periodStart(day, kind) {
    if (kind === 'monthly') return day.slice(0,7) + '-01';
    if (kind === 'weekly') return shiftDay(day, -(new Date(civil(day)).getUTCDay() + 6) % 7);
    return day;
}
function nextPeriod(day, kind) {
    if (kind !== 'monthly') return shiftDay(day, kind === 'weekly' ? 7 : 1);
    const d = new Date(civil(day)); d.setUTCMonth(d.getUTCMonth()+1); return d.toISOString().slice(0,10);
}
function periodLabel(start, kind) {
    const fmt = (day, options) => new Date(civil(day)).toLocaleDateString('en-US', { timeZone:'UTC', ...options });
    if (kind === 'monthly') return fmt(start,{month:'long',year:'numeric'});
    if (kind === 'daily') return fmt(start,{month:'short',day:'numeric',year:'numeric'});
    const end = shiftDay(nextPeriod(start,kind),-1);
    return `${fmt(start,{month:'short',day:'numeric'})} – ${fmt(end,{month:'short',day:'numeric',year:'numeric'})}`;
}
// Binary search for the next civil midnight handles 23/25-hour DST days and
// timezones with non-hour offsets without depending on the machine timezone.
function nextMidnight(at, zone) {
    const day = dayAt(at,zone); let lo = Math.floor(at), hi = lo + 48*3600000;
    while (hi-lo>1) { const mid=Math.floor((lo+hi)/2); if(dayAt(mid,zone)===day)lo=mid;else hi=mid; }
    return hi;
}
function addMode(target, source, includeSubmodes = true) {
    let out=target.get(source.mode);
    if(!out) { out={mode:source.mode,label:source.label,values:{},missing:new Set(),breakdown:new Map(),breakdownMissing:false,local:true,submodes:new Map(),submodeMissing:false};target.set(source.mode,out); }
    out.local &&= source.local === true;
    if(Number.isFinite(source.localStreakAt)&&(!Number.isFinite(out.localStreakAt)||source.localStreakAt>=out.localStreakAt)){
        out.localStreakAt=source.localStreakAt;out.localStreak=source.localStreak;
    }
    for(const key of FIELDS) {
        if(Number.isFinite(source[key]))out.values[key]=(out.values[key]||0)+source[key];
        else out.missing.add(key);
    }
    if(includeSubmodes) {
        if(!source.submodes?.length && source.games !== 0) out.submodeMissing=true;
        for(const sub of source.submodes||[]) addMode(out.submodes,{...sub,mode:sub.id},false);
    }
    const breakdown=source.breakdown;
    if(!breakdown || ['partial','unavailable'].includes(breakdown.status))out.breakdownMissing=true;
    for(const entry of breakdown?.entries||[]) {
        if(entry.unavailableValue)continue;
        const old=out.breakdown.get(entry.id);
        out.breakdown.set(entry.id,{...entry,games:(old?.games||0)+entry.games});
    }
}
function finishMode(out) {
    const mode={mode:out.mode,label:out.label,...Object.fromEntries(Object.entries(out.values).filter(([key])=>!out.missing.has(key)))};
    if(out.local)mode.local=true;
    if(out.local&&Number.isFinite(out.localStreakAt)){mode.localStreakAt=out.localStreakAt;if(Number.isFinite(out.localStreak))mode.localStreak=out.localStreak;}
    for(const [key,a,b] of [['wlr','wins','losses'],['fkdr','finals','finalDeaths'],['kdr','kills','deaths'],['bblr','beds','bedsLost']]) {
        if(a in mode && b in mode)mode[key]=mode[a]/Math.max(1,mode[b]);
    }
    if('wins' in mode && 'games' in mode)mode.winRate=mode.games?mode.wins/mode.games*100:0;
    mode.breakdown={entries:[...out.breakdown.values()],total:mode.games||0,status:out.breakdownMissing?'partial':'available',note:out.breakdownMissing?'Some mode detail is unavailable':''};
    if(!out.submodeMissing && out.submodes.size) mode.submodes=[...out.submodes.values()].map(sub=>({...finishMode(sub),id:sub.mode,mode:out.mode}));
    return mode;
}

function aggregate(sessions, kind, zone, now) {
    const buckets=new Map();
    const get=(day,session)=>{
        const start=periodStart(day,kind);
        if(!buckets.has(start))buckets.set(start,{start,modes:new Map(),sessionIds:new Set(),intervals:[],partial:false,name:session.name,uuid:session.uuid});
        const bucket=buckets.get(start);bucket.sessionIds.add(session.id);return bucket;
    };
    for(const session of sessions) {
        if(!Number.isFinite(session.startedAt)||session.startedAt<=0)continue;
        // lastSeen is the last observed connection, so an idle/offline launcher
        // cannot manufacture tracked playtime by repeatedly opening this view.
        const end=Math.max(session.startedAt,Math.min(now,session.endedAt||session.lastSeen||session.startedAt));
        const first=dayAt(session.startedAt,zone),last=dayAt(end,zone);
        const touched=new Set();
        for(let at=session.startedAt;at<end;) {
            const until=Math.min(end,nextMidnight(at,zone));
            const bucket=get(dayAt(at,zone),session);bucket.intervals.push([at,until]);touched.add(bucket);at=until;
        }
        const firstBucket=get(first,session);touched.add(firstBucket);
        if(periodStart(first,kind)===periodStart(last,kind)) {
            for(const mode of session.modes||[])addMode(firstBucket.modes,mode);
            firstBucket.partial ||= (session.modes||[]).some(m=>m.local&&m.unavailable?.length);
            continue;
        }
        const games=(session.games||[]).filter(g=>Number.isFinite(g.at)&&g.at>=session.startedAt&&g.at<=end);
        // A delayed API response can contain several earlier matches. If that
        // sample spans a boundary, its timestamp cannot locate each result.
        const uncertainModes=new Set(games.filter(g=>!g.stats||['pending','unverified'].includes(g.verificationStatus)||g.statsSource==='events'||
            (g.stats.games>1&&(!g.from||periodStart(dayAt(g.from,zone),kind)!==periodStart(dayAt(g.at,zone),kind)))).map(g=>g.mode));
        const seen=new Set();const sums=new Map();const allocations=new Map();
        const allocation=bucket=>{if(!allocations.has(bucket))allocations.set(bucket,new Map());return allocations.get(bucket);};
        for(const game of games) {
            if(seen.has(game.id))continue;seen.add(game.id);
            const bucket=get(dayAt(game.at,zone),session);touched.add(bucket);
            if(!game.stats){bucket.partial=true;continue;}
            addMode(allocation(bucket),game.stats);addMode(sums,game.stats);
            if(['pending','unverified'].includes(game.verificationStatus)||game.statsSource==='events'||game.stats?.unavailable?.length)bucket.partial=true;
        }
        // A retained match list can be incomplete. Do not spread its residual
        // session counters arbitrarily across days or count both sources twice.
        for(const summary of session.modes||[]) {
            const sum=sums.get(summary.mode);
            for(const bucket of touched) {
                const modes=allocation(bucket);
                if(!modes.has(summary.mode))addMode(modes,{mode:summary.mode,label:summary.label,local:summary.local});
                const target=modes.get(summary.mode);
                // Keep mode details only when retained matches fully reconcile
                // with the session, so cross-boundary totals cannot leak days.
                if(uncertainModes.has(summary.mode) || !summary.submodes || summary.submodes.some(sub=>{
                    const detail=sum?.submodes.get(sub.id);
                    return !detail || FIELDS.some(field=>Number.isFinite(sub[field]) && (detail.missing.has(field) || Math.abs((detail.values[field]||0)-sub[field])>0.000001));
                })) target.submodeMissing=true;
                for(const field of FIELDS) {
                    if(uncertainModes.has(summary.mode) || !Number.isFinite(summary[field]) || !sum || sum.missing.has(field) || Math.abs((sum.values[field]||0)-summary[field])>0.000001) {
                        target.missing.add(field);
                        if(Number.isFinite(summary[field]))bucket.partial=true;
                    } else if(!(field in target.values)) {
                        target.values[field]=0;target.missing.delete(field);
                    }
                }
            }
        }
        for(const [bucket,modes]of allocations)for(const value of modes.values())addMode(bucket.modes,finishMode(value));
    }
    return [...buckets.values()].map(bucket=>{
        const intervals=bucket.intervals.sort((a,b)=>a[0]-b[0]);let durationMs=0,end=0;
        for(const [a,b]of intervals){durationMs+=Math.max(0,b-Math.max(a,end));end=Math.max(end,b);}
        return {...bucket,modes:[...bucket.modes.values()].map(finishMode),sessionIds:[...bucket.sessionIds],intervals:undefined,durationMs};
    }).sort((a,b)=>b.start.localeCompare(a.start));
}
function buildCalendarStats(sessions=[], {kind='weekly',timeZone='UTC',now=Date.now(),mode=''}={}) {
    if(!['daily','weekly','monthly'].includes(kind))kind='weekly';
    timeZone=validTimezone(timeZone);
    const selected=sessions.map(s=>({...s,modes:(s.modes||[]).filter(m=>!mode||m.mode===mode),games:(s.games||[]).filter(g=>!mode||g.mode===mode)})).filter(s=>s.modes.length);
    const daily=aggregate(selected,'daily',timeZone,now);
    const periods=kind==='daily'?daily:aggregate(selected,kind,timeZone,now);
    const today=dayAt(now,timeZone);
    return periods.map(period=>{
        const end=nextPeriod(period.start,kind);
        const days=[];for(let day=period.start;day<end;day=shiftDay(day,1))days.push(day);
        const contributions=daily.filter(d=>d.start>=period.start&&d.start<end);
        return {id:`calendar:${kind}:${period.start}`,name:period.name,uuid:period.uuid,modes:period.modes,durationMs:period.durationMs,
            startedAt:civil(period.start),active:today>=period.start&&today<end,
            calendar:{kind,start:period.start,end,timeZone,label:periodLabel(period.start,kind),partial:period.partial,
                sessionIds:period.sessionIds,activeDays:contributions.length,
                chart:kind==='daily'?null:{title:'Games by day',entries:days.map(day=>{
                    const data=contributions.find(d=>d.start===day);
                    return {id:day,label:kind==='weekly'?new Date(civil(day)).toLocaleDateString('en-US',{timeZone:'UTC',weekday:'short'}):String(Number(day.slice(-2))),
                        future:day>today,modes:data?.modes||[],partial:data?.partial||false};
                })}
            }};
    });
}
module.exports={buildCalendarStats,dayAt,periodStart,nextPeriod,nextMidnight,validTimezone,FIELDS};
