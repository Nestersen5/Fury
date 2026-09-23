'use strict';

// Queue/round counters and combat telemetry can increase without any result.
// They must not create a card whose displayed performance stats are all zero.
// Required once: this runs for every stat key of every session and game.
const { hasGameplayMovement } = require('./sessionSnapshot');
const PERFORMANCE = /(^|_)(wins|losses|kills|deaths|beds_broken|beds_lost|assists)(_|$)/;
function hasCardStatMovement(game, stats = {}) {
    return Object.entries(stats || {}).some(([key,value]) => Number.isFinite(value) && value > 0 &&
        ((!/streak/i.test(key) && PERFORMANCE.test(key)) || (game === 'Bedwars' && key === 'Experience' && hasGameplayMovement(stats))));
}
function pruneEmptyModeStats(summary) {
    if(!summary?.stats)return summary;
    const empty=['Bedwars','SkyWars','Duels'].filter(key=>key in summary.stats&&!hasCardStatMovement(key,summary.stats[key]));
    if(!empty.length)return summary;
    return {...summary,stats:Object.fromEntries(Object.entries(summary.stats).filter(([key])=>!empty.includes(key)))};
}
module.exports={hasCardStatMovement,pruneEmptyModeStats};
