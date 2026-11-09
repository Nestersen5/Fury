'use strict';

const { FIELDS, normalizeLocal, normalizeTotals, normalizeVariant, addVariant, mergeTotals, localModes, nextStreak, settleGame } = require('./localStats');
const { MODE_DEFINITIONS } = require('./modeDefinitions');
const { modeBreakdown } = require('./modeBreakdown');
const { submodeStats, submodeCounterKeys } = require('./submodeStats');
const { isOwnTeamElimination } = require('./gameResult');
// Like launcherSessionHistory's game cache, this follows immutable saved game
// records: SessionStore.updateGame replaces them. No keys or snapshots survive
// their owning records, and a pending game's replacement is resolved afresh.
const gameVariants = new WeakMap();
const COMBAT_FIELDS = FIELDS.filter(field => !['wins', 'losses', 'games'].includes(field));
const API_EXTRA_FIELDS = ['assists','experience'];
function weakResult(record) {
    if (record.resultSource==='api') return false;
    if (record.resultSource==='manual' || record.observation?.resultConflict) return true;
    if (record.observation?.resultFromGameOver) return true;
    return record.result==='loss' && record.events?.some(event=>event.type==='defeat' && event.cause==='game_over')
        && !record.events.some(event=>event.type==='victory' || (event.type==='defeat' && event.cause!=='game_over')
            || isOwnTeamElimination(event,record.mode,record.metadata?.team));
}
const observedModes = record => record.localModes?.length ? record.localModes
    : record.observation ? localModes({ current: record.observation }) : null;

// An API window is attributable to one match only when it contains exactly
// one completed result. Starts/games-played alone are not completion evidence.
function singleApiResult(delta, mode, observedDraw = false) {
    const definition = MODE_DEFINITIONS.find(entry => entry.mode === mode);
    const stats = delta?.stats?.[definition?.key];
    if (!stats) return null;
    const wins = stats[definition.fields.wins] ?? 0;
    const losses = stats[definition.fields.losses] ?? 0;
    if (wins === 1 && losses === 0) return 'win';
    if (wins === 0 && losses === 1) return 'loss';
    if (observedDraw && wins === 0 && losses === 0 && stats[definition.fields.games] === 1) return 'draw';
    return null;
}

function apiCompletedGames(delta, mode) {
    const definition = MODE_DEFINITIONS.find(entry => entry.mode === mode);
    const stats = delta?.stats?.[definition?.key];
    if (!stats) return 0;
    return Math.max(0, Number(stats[definition.fields.wins]) || 0)
        + Math.max(0, Number(stats[definition.fields.losses]) || 0);
}

// A published result does not guarantee the combat counters have caught up.
// Keep the observation until this API window includes at least what we saw.
function apiCountsCoverObservations(delta, record) {
    const definition = MODE_DEFINITIONS.find(entry => entry.mode === record.mode);
    const observed = observedModes(record)?.find(entry => entry.mode === record.mode);
    if (!definition || !observed) return true;
    const stats = delta?.stats?.[definition.key] || {};
    return FIELDS.every(field => ['wins', 'losses', 'games'].includes(field)
        || !definition.fields[field] || !Number.isFinite(observed[field])
        || (stats[definition.fields[field]] || 0) >= observed[field]);
}

function gameVariant(record) {
    let variant = gameVariants.get(record);
    if (!variant) {
        variant = resolveGameVariant(record);
        gameVariants.set(record, variant);
    }
    return variant;
}

function resolveGameVariant(record) {
    const saved = normalizeVariant(record.mode, record.metadata?.variant);
    if (!saved.unknown) return saved;
    // Older records sometimes retained the local breakdown but lost metadata.
    const observed = record.localModes?.find(entry => entry.mode === record.mode);
    const entries = observed?.breakdown?.entries || observed?.submodes || [];
    const active = entries.filter(entry => entry.games > 0);
    if (active.length === 1 && active[0].games === 1 && !active[0].unknown) {
        const variant = normalizeVariant(record.mode, active[0]);
        if (!variant.unknown) return variant;
    }
    // Only a verified, single-result window can recover an individual game's
    // mode. Never infer from a combined window, lifetime stats or other games.
    if (record.verificationStatus !== 'verified' || !singleApiResult(record.delta, record.mode, record.result==='draw' && record.observation?.endObserved)) return saved;
    const definition = MODE_DEFINITIONS.find(entry => entry.mode === record.mode);
    const stats = record.delta.stats[definition.key];
    let modeStats = stats;
    if (record.mode === 'BEDWARS') {
        modeStats = {};
        for (const [field, value] of Object.entries(stats)) {
            const match = field.match(/^(.+)_(wins|losses)_bedwars$/);
            if (match && Number.isFinite(value) && value > 0) {
                const key = `${match[1]}_games_played_bedwars`;
                modeStats[key] = (modeStats[key] || 0) + value;
            }
        }
    }
    const breakdown = modeBreakdown(record.mode, modeStats, 1);
    const candidates = breakdown.entries.filter(entry => entry.games > 0);
    if (candidates.length !== 1 || candidates[0].games !== 1 || candidates[0].unknown) return saved;
    const candidate = candidates[0];
    if (record.mode === 'BEDWARS') {
        const wins = stats[`${candidate.id}_wins_bedwars`] || 0;
        const losses = stats[`${candidate.id}_losses_bedwars`] || 0;
        const result = singleApiResult(record.delta, record.mode);
        if (wins !== (result === 'win' ? 1 : 0) || losses !== (result === 'loss' ? 1 : 0)) return saved;
    }
    return normalizeVariant(record.mode, candidate);
}

// Shared by session totals and game details: an API sample must belong to one
// verified result and include every combat count already observed for it.
function gameApiStats(record) {
    const definition = MODE_DEFINITIONS.find(entry => entry.mode === record.mode);
    return definition && record.verificationStatus === 'verified' && singleApiResult(record.delta, record.mode, record.result==='draw' && record.observation?.endObserved)
        && apiCountsCoverObservations(record.delta, record) ? record.delta.stats[definition.key] : null;
}

function gameModes(record) {
    const observed = observedModes(record);
    const definition = MODE_DEFINITIONS.find(entry => entry.mode === record.mode);
    const stats = gameApiStats(record);
    if (stats) {
        const counts = normalizeTotals();
        for (const key of FIELDS) {
            const field = definition.fields[key];
            if (field) counts[key] = { value: stats[field] || 0, available: true };
        }
        counts.games = { value: 1, available: true };
        return localModes({ totals: { [record.mode]: counts } });
    }
    return observed;
}

// The same persisted game IDs drive immediate totals and later reconciliation.
// Replacing a game's counters never adds another game to the session. Legacy
// sessions without live observations keep their existing API projection.
function countsForGame(record) {
    if ((!(record.durationMs >= 1000) && !['win', 'loss', 'draw'].includes(record.result)) || record.metadata?.privateGame) return null;
    const mode = gameModes(record)?.find(entry => entry.mode === record.mode);
    const counts = normalizeTotals();
    for (const field of FIELDS) {
        if (Number.isFinite(mode?.[field])) counts[field] = { value: mode[field], available: !mode.unavailable?.includes(field), observed: true };
    }
    if (['win', 'loss', 'draw'].includes(record.result)) {
        counts.games = { value: 1, available: true };
        counts.wins = { value: record.result === 'win' ? 1 : 0, available: true };
        counts.losses = { value: record.result === 'loss' ? 1 : 0, available: true };
    } else {
        // A confirmed end can count as a game before its win/loss is known.
        // Leaving without an end still contributes only its observed combat.
        for (const field of ['games', 'wins', 'losses']) counts[field] = {
            value:field==='games' && record.observation?.endObserved?1:0,available:true};
    }
    return counts;
}

function archiveObservedGames(session, games) {
    if (!session.games.some(game => game.localModes?.length || game.observation)) return;
    const local = normalizeLocal(session.localTracking || {});
    for (const game of games) {
        const counts = countsForGame(game);
        if (counts) {
            if (session.trackingSource==='local') applyLocalCorrection(local,game,counts);
            else addGame(local, game, counts);
        }
        const checkpoint = session.apiTotals?.[game.mode];
        if (counts && checkpoint && game.sequence > checkpoint.throughSequence) {
            for (const field of FIELDS) checkpoint.afterArchive[field] = (checkpoint.afterArchive[field] || 0) + counts[field].value;
            const variant = checkpoint.variants?.[gameVariant(game).id];
            if (variant) for (const field of FIELDS) variant.afterArchive[field] = (variant.afterArchive[field] || 0) + counts[field].value;
        }
    }
    session.localTracking = local;
}

function addGame(local, record, counts) {
    local.totals[record.mode] = mergeTotals(local.totals[record.mode], counts);
    addVariant(local, { mode: record.mode, counts, variant: gameVariant(record) });
}

// Local sessions already hold the raw contributions of retained games. Replace
// only the part supported by a later API/result correction, never add it twice.
function applyLocalCorrection(local,record,counts) {
    const raw=observedModes(record)?.find(mode=>mode.mode===record.mode);
    if (!raw) return;
    const api=gameApiStats(record),variant=record.observation?.variant?.id || gameVariant(record).id;
    const targets=[local.totals[record.mode],local.variants[record.mode]?.[variant]?.counts].filter(Boolean);
    for (const field of FIELDS) {
        if (!api && (!['games','wins','losses'].includes(field) || !['win','loss','draw'].includes(record.result))) continue;
        for (const target of targets) {
            target[field].value=Math.max(0,target[field].value+counts[field].value-(raw[field]||0));
            target[field].observed ||= counts[field].observed || counts[field].available;
        }
    }
}

function observedSessionDelta(session, apiDelta) {
    if (!session?.games?.some(game => game.localModes?.length || game.observation) && !session?.localTracking && !session?.liveGame) return apiDelta;
    const local = normalizeLocal(session.localTracking || {});
    let records = session.games || [];
    const localSource=session.trackingSource==='local';
    if (localSource && local.current) {
        const game=local.current;local.current=null;
        if (game.leftAt) settleGame(game);
        local.totals[game.mode]=mergeTotals(local.totals[game.mode],game.counts);addVariant(local,game);
        if (game.endObserved) local.streaks[game.mode]=nextStreak(local.streaks[game.mode],game);
        records=records.concat({mode:game.mode,sequence:(session.gameSequence||0)+1,durationMs:Math.max(1000,session.lastSeen-game.startedAt),
            result:game.resultConflict?null:game.result,localModes:localModes({current:game}),live:true});
    }
    if (session.liveGame?.observed) {
        const live = session.liveGame, game = live.observed;
        const prior = records.find(record => record.id === live.recordId);
        records = records.filter(record => record.id !== live.recordId).concat({
            mode: game.mode, sequence: prior?.sequence || (session.gameSequence || 0) + 1,
            durationMs: Math.max(1000, session.lastSeen - game.startedAt), result: game.result,
            verificationStatus: 'local', localModes: localModes({ current: game }),
            metadata: { variant: game.variant.unknown ? null : game.variant.label }
        });
    }
    for (const record of records) {
        const counts = countsForGame(record);
        if (counts) {
            if (localSource) { if (!record.live) applyLocalCorrection(local,record,counts); }
            else addGame(local, record, counts);
        }
    }
    for (const [mode, checkpoint] of Object.entries(session.apiTotals || {})) {
        const totals = local.totals[mode];
        if (!totals) continue;
        const after = { ...checkpoint.afterArchive };
        for (const record of records) if (record.mode === mode && record.sequence > checkpoint.throughSequence) {
            const counts = countsForGame(record);
            if (counts) for (const field of FIELDS) after[field] = (after[field] || 0) + counts[field].value;
        }
        for (const [field, value] of Object.entries(checkpoint.values)) if (FIELDS.includes(field)) {
            const corrected=value+(after[field]||0);
            totals[field].value = COMBAT_FIELDS.includes(field)?Math.max(totals[field].value,corrected):corrected;
            totals[field].observed = true;
        }
        for (const [id, correction] of Object.entries(checkpoint.variants || {})) {
            const variant = local.variants[mode]?.[id];
            if (!variant || variant.unknown) continue;
            const later = { ...correction.afterArchive };
            for (const record of records) if (record.mode === mode && record.sequence > checkpoint.throughSequence && gameVariant(record).id === id) {
                const counts = countsForGame(record);
                if (counts) for (const field of FIELDS) later[field] = (later[field] || 0) + counts[field].value;
            }
            for (const [field, value] of Object.entries(correction.values)) if (FIELDS.includes(field)) {
                const corrected=value+(later[field]||0);
                variant.counts[field].value = COMBAT_FIELDS.includes(field)?Math.max(variant.counts[field].value,corrected):corrected;
                variant.counts[field].observed = true;
            }
        }
        for (const field of COMBAT_FIELDS) totals[field].value = Math.max(totals[field].value,
            Object.values(local.variants[mode] || {}).reduce((sum, variant) => sum + variant.counts[field].value, 0));
    }
    const modes=localModes(local);
    for (const mode of modes) {
        const extras=session.apiTotals?.[mode.mode]?.values;
        if (Number.isFinite(extras?.assists)) mode.assists=extras.assists;
        if (Number.isFinite(extras?.experience)) mode.stars=extras.experience/5000;
    }
    return { ...apiDelta, local: true, modes,
        from: session.startedAt, to: session.endedAt || session.lastSeen,
        spanMs: Math.max(0, (session.endedAt || session.lastSeen) - session.startedAt) };
}

function reconciliationBaseline(snapshot) {
    if (!snapshot) return null;
    return { at: snapshot.at, uuid: snapshot.uuid, present: snapshot.present,
        ...(Number.isFinite(snapshot.sequence)?{sequence:snapshot.sequence}:{}),
        ...(snapshot.gameKey?{gameKey:String(snapshot.gameKey).slice(0,200),gameMode:snapshot.gameMode}:{}),
        ...(Array.isArray(snapshot.priorGameKeys)?{priorGameKeys:snapshot.priorGameKeys.slice(-250).map(key=>String(key).slice(0,200))}:{}),
        ...(Array.isArray(snapshot.prefix)?{prefix:snapshot.prefix.slice(0,3).map(mode=>({mode:mode.mode,
            ...Object.fromEntries([...FIELDS,...API_EXTRA_FIELDS].filter(field=>Number.isFinite(mode[field])).map(field=>[field,mode[field]])),
            submodes:(mode.submodes||[]).slice(0,128).map(sub=>({id:sub.id,label:sub.label,
                ...Object.fromEntries(FIELDS.filter(field=>Number.isFinite(sub[field])).map(field=>[field,sub[field]]))}))}))}:{}),
        stats: Object.fromEntries(MODE_DEFINITIONS.map(def => [def.key, Object.fromEntries(
            [...new Set([...Object.values(def.fields), ...submodeCounterKeys(def.mode,snapshot.stats?.[def.key])])]
                .filter(field => Number.isFinite(snapshot.stats?.[def.key]?.[field]))
                .map(field => [field, snapshot.stats[def.key][field]]))])) };
}

function variantCorrections(def, mode, base, snapshot, stats, values, previous = {}, games = []) {
    const known = (mode.submodes || []).filter(sub => sub.games > 0);
    const variants = {};
    for (const sub of known) if (previous[sub.id]) {
        variants[sub.id] = { values: Object.fromEntries(FIELDS.filter(field => Number.isFinite(previous[sub.id].values[field]))
            .map(field => [field, sub[field] || 0])), afterArchive: {} };
    }
    if (known.length === 1 && known[0].games === mode.games
        && known[0].wins === mode.wins && known[0].losses === mode.losses
        && mode.breakdown.entries.every(entry => entry.id === known[0].id)) {
        variants[known[0].id] = { values: { ...values }, afterArchive: {} };
        return variants;
    }
    const details = def.mode === 'BEDWARS' ? known.map(sub => ({ id: sub.id, label: sub.label,
        ...Object.fromEntries(Object.entries(def.fields).map(([field,key]) => [field, stats[`${sub.id}_${key}`] || 0]))
    })) : submodeStats(def.mode, stats);
    const label = value => String(value).toLowerCase().replace(/[^a-z0-9]/g,'');
    for (const sub of known) {
        const matches = details.filter(detail => detail.id === sub.id || label(detail.label) === label(sub.label));
        if (matches.length !== 1) continue;
        const detail = matches[0];
        const prefix=base.prefix?.find(entry=>entry.mode===def.mode)?.submodes?.find(entry=>entry.id===sub.id)||{};
        const retained=games.filter(game=>gameVariant(game).id===sub.id),weak=retained.filter(weakResult);
        const strongWins=retained.filter(game=>game.result==='win' && !weak.includes(game)).length;
        const strongLosses=retained.filter(game=>game.result==='loss' && !weak.includes(game)).length;
        const draws=retained.filter(game=>game.result==='draw').length;
        if (detail.wins+detail.losses+draws!==sub.games-(prefix.games||0)
            || detail.wins<strongWins || detail.losses<strongLosses) continue;
        const counterKey=field=>def.mode==='BEDWARS'?`${detail.id}_${def.fields[field]}`
            :def.mode==='SKYWARS'?`${field}_${detail.id}`:`${detail.id}_${field}`;
        const corrected = {};
        if ((detail.wins+(prefix.wins||0)!==sub.wins || detail.losses+(prefix.losses||0)!==sub.losses)
            && ['wins','losses'].every(field=>Number.isFinite(base.stats?.[def.key]?.[counterKey(field)])
                && Number.isFinite(snapshot.stats?.[def.key]?.[counterKey(field)]))) {
            Object.assign(corrected,{wins:detail.wins+(prefix.wins||0),losses:detail.losses+(prefix.losses||0),games:sub.games});
        }
        for (const field of COMBAT_FIELDS) {
            const key = counterKey(field);
            // An omitted historical counter must not become a lifetime gain.
            if (Number.isFinite(base.stats?.[def.key]?.[key]) && Number.isFinite(snapshot.stats?.[def.key]?.[key])
                && Number.isFinite(detail[field]) && detail[field]+(prefix[field]||0) <= (values[field] ?? -1)) {
                corrected[field] = Math.max(sub[field] || 0, detail[field]+(prefix[field]||0));
            }
        }
        if (Object.keys(corrected).length) {
            variants[sub.id] ||= { values: {}, afterArchive: {} };
            Object.assign(variants[sub.id].values,corrected);
        }
    }
    return variants;
}

// Whole-session checkpoints correct totals without allocating an API window to
// matches. Exact result counts and an idle mode bound the window to this session.
function reconciliationForSnapshot(session, snapshot, blockedModes = []) {
    const initial = session.reconciliationBaseline || session.baseline;
    if (!initial || initial.uuid !== session.uuid || snapshot?.uuid !== session.uuid) return null;
    const { diffSessionSnapshots, snapshotRegressed } = require('./sessionSnapshot');
    const { gamePresent } = require('./sessionSnapshot');
    // API stats exclude the unfinished game. Do not include its combat in a
    // checkpoint and then add that same live observation a second time.
    const completed={...session,liveGame:null};
    if (session.trackingSource==='local') completed.localTracking={...session.localTracking,current:null};
    const observed = observedSessionDelta(completed, null);
    const checkpoints = {};
    for (const def of MODE_DEFINITIONS) {
        const base=gamePresent(initial,def.key)?initial:session.apiBaselines?.[def.mode];
        const accepted=session.apiBoundaries?.[def.mode];
        if (!base || base.uuid!==session.uuid || !gamePresent(base,def.key)
            || snapshotRegressed({uuid:base.uuid,stats:{[def.key]:base.stats[def.key]}},snapshot)
            || (accepted && snapshotRegressed({uuid:accepted.uuid,stats:{[def.key]:accepted.stats?.[def.key]}},snapshot))) continue;
        const delta=diffSessionSnapshots(base,snapshot);
        if (blockedModes.includes(def.mode) || (session.liveGame?.mode===def.mode && (!session.liveGame.observed || session.liveGame.observed.endObserved))
            || delta.unmeasurable?.includes(def.key)) continue;
        const prefix=base.prefix?.find(mode=>mode.mode===def.mode)||{};
        const games = session.games.filter(game => game.mode === def.mode && game.sequence>(base.sequence||0));
        if (!games.length || games.some(game => (!['win', 'loss', 'draw'].includes(game.result) && !game.observation?.endObserved)
            || !game.observation || (game.observation.startedAt < base.at && game.observation.key!==base.gameKey
                && !base.priorGameKeys?.includes(game.observation.key)))) continue;
        const mode = observed?.modes?.find(mode => mode.mode === def.mode);
        const stats = delta.stats?.[def.key];
        if (!stats || !mode) continue;
        const wins=stats[def.fields.wins]||0,losses=stats[def.fields.losses]||0;
        const weak=games.filter(weakResult);
        const original=weak.length && session.apiTotals?.[def.mode]
            ? observedSessionDelta({...completed,apiTotals:{}},null)?.modes.find(entry=>entry.mode===def.mode) : mode;
        const expectedWins=original.wins-(prefix.wins||0),expectedLosses=original.losses-(prefix.losses||0);
        const expectedGames=original.games-(prefix.games||0),draws=games.filter(game=>game.result==='draw').length;
        const weakCounts=field=>weak.reduce((sum,game)=>sum+(session.trackingSource==='local'
            ? observedModes(game)?.find(entry=>entry.mode===def.mode)?.[field]||0
            : countsForGame(game)?.[field].value||0),0);
        if (!(expectedGames>0) || wins+losses+draws!==expectedGames
            || (draws>0 && (!Number.isFinite(base.stats?.[def.key]?.[def.fields.games]) || stats[def.fields.games]!==expectedGames))
            || wins<Math.max(0,expectedWins-weakCounts('wins'))
            || losses<Math.max(0,expectedLosses-weakCounts('losses'))) continue;
        const previous = session.apiTotals?.[def.mode];
        const values = Object.fromEntries(COMBAT_FIELDS.filter(field => Number.isFinite(previous?.values?.[field]))
            .map(field => [field, mode[field] || 0]));
        for (const field of COMBAT_FIELDS) {
            const key = def.fields[field];
            if (key && Number.isFinite(snapshot.stats?.[def.key]?.[key]) && Number.isFinite(stats[key])) values[field] = Math.max(0, stats[key]+(prefix[field]||0), mode[field] || 0);
        }
        values.wins=wins+(prefix.wins||0);values.losses=losses+(prefix.losses||0);values.games=wins+losses+draws+(prefix.games||0);
        for (const field of API_EXTRA_FIELDS) {
            const key=def.fields[field];
            if (key && Number.isFinite(base.stats?.[def.key]?.[key]) && Number.isFinite(snapshot.stats?.[def.key]?.[key])) {
                values[field]=Math.max(previous?.values?.[field]||0,(stats[key]||0)+(prefix[field]||0));
            }
        }
        const coversObservations=COMBAT_FIELDS.every(field=>!def.fields[field] || !Number.isFinite(mode[field])
            || (stats[def.fields[field]]||0)+(prefix[field]||0)>=mode[field]);
        if (Object.keys(values).length) checkpoints[def.mode] = { throughSequence: session.gameSequence || 0, values, afterArchive: {}, coversObservations,
            variants: variantCorrections(def, mode, base, snapshot, stats, values, previous?.variants, games) };
    }
    return Object.keys(checkpoints).length ? checkpoints : null;
}

module.exports = { singleApiResult, apiCompletedGames, apiCountsCoverObservations, gameApiStats, gameModes, countsForGame, observedSessionDelta, archiveObservedGames, weakResult,
    reconciliationBaseline, reconciliationForSnapshot };
