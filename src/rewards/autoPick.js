'use strict';

// Port of AutoPick.java and its bundled preference model. Unknown cards, ties
// and conflicting preferences always leave the choice to the player.
const SERIES = { ARCADE: ['arcade'], ARENA: ['arena'], SURVIVAL_GAMES: ['blitz'], MCGO: ['cvc'],
    WALLS3: ['mega'], PAINTBALL: ['paint'], QUAKECRAFT: ['quake'], SKYWARS: ['swcoin', 'swt'],
    SUPER_SMASH: ['smash'], GINGERBREAD: ['tkr'], VAMPIREZ: ['vamp'], WALLS: ['walls'],
    BATTLEGROUND: ['warlords'], UHC: ['uhc'], BEDWARS: ['bed'], BUILD_BATTLE: ['build'],
    DUELS: ['duels'], MURDER_MYSTERY: ['murder'], TNTGAMES: ['tnt'], LEGACY: ['classic'] };

function createAutoPick(model) {
    const ids = new Set(model.rewards.map(row => row.id));
    const classes = new Map([...ids].map(id => [id, id]));
    const known = id => { if (!ids.has(id)) throw new Error('Unknown reward preference'); return id; };
    for (const group of model.equalityClasses) for (const id of group) classes.set(known(id), known(group[0]));
    const classOf = id => {
        const visited = new Set();
        while (classes.get(id) !== id) {
            if (visited.has(id)) throw new Error('Invalid reward preference group');
            visited.add(id); id = classes.get(id);
        }
        return id;
    };
    for (const id of ids) classes.set(id, classOf(id));
    const edges = new Map([...ids].map(id => [id, new Set()]));
    const edge = (better, worse) => {
        const a = classes.get(known(better)), b = classes.get(known(worse));
        if (a !== b) edges.get(a).add(b);
    };
    for (const relation of model.relations) edge(relation.better, relation.worse);
    let tokenRule = false;
    for (const rule of model.rules) {
        if (rule.rule !== 'skywarsTokensFallback') throw new Error('Unknown reward preference rule');
        const tokens = new Set(rule.tokens.map(known));
        for (const id of ids) if (!tokens.has(id)) for (const token of tokens) edge(id, token);
        tokenRule = true;
    }
    if (!tokenRule) throw new Error('Reward token rule missing');
    const reach = new Map();
    for (const root of new Set(classes.values())) {
        const seen = new Set(), todo = [...edges.get(root)];
        while (todo.length) {
            const next = todo.pop();
            if (seen.has(next)) continue;
            seen.add(next); todo.push(...edges.get(next));
        }
        reach.set(root, seen);
    }
    function compare(a, b) {
        const x = classes.get(a), y = classes.get(b);
        if (x === y) return 'equal';
        const ab = reach.get(x).has(y), ba = reach.get(y).has(x);
        return ab && ba ? 'conflict' : ab ? 'better' : ba ? 'worse' : 'unknown';
    }
    function predict(cards) {
        if (!cards.length || cards.some(id => !ids.has(id))) return { mode: 'manual', reason: 'unknown', best: [] };
        if (cards.some(a => cards.some(b => compare(a, b) === 'conflict'))) return { mode: 'manual', reason: 'conflict', best: cards.slice() };
        const winner = cards.find(a => cards.every(b => a === b || compare(a, b) === 'better'));
        if (winner) return { mode: 'auto', reason: 'unique', best: [winner] };
        const best = cards.filter(a => !cards.some(b => a !== b && compare(b, a) === 'better'));
        const tied = best.length > 1 && best.every(a => best.every(b => compare(a, b) === 'equal'));
        return { mode: 'manual', reason: tied ? 'tie' : 'unknown', best };
    }
    function id(row) {
        let key;
        switch (row.type) {
        case 'experience': key = `exp${row.amount}`; break;
        case 'dust': key = `dust${row.amount}`; break;
        case 'souls': key = `souls${row.amount}`; break;
        case 'adsense_token': key = `reward${row.amount}`; break;
        case 'coins': case 'tokens': {
            const matches = (SERIES[row.gameType] || []).map(prefix => prefix + row.amount).filter(key => ids.has(key));
            if (matches.length !== 1) return null;
            key = matches[0]; break;
        }
        case 'add_vanity':
            if (row.key?.startsWith('suit_treasure_')) {
                const piece = row.key.slice(14);
                if (!piece) return null;
                key = 'suit' + piece[0].toUpperCase() + piece.slice(1);
            } else if (row.key === 'emote_moustache') key = 'emote';
            else if (row.key === 'taunt_treasure') key = 'gesture';
            break;
        default: return null;
        }
        return ids.has(key) && (row.amount >= 0 || row.type === 'add_vanity') ? key : null;
    }
    return { predict, id, choose: rows => {
        const cards = rows.map(id), result = predict(cards);
        return result.mode === 'auto' ? cards.indexOf(result.best[0]) : -1;
    } };
}

let bundled;
function choose(rows) {
    try {
        bundled ??= createAutoPick(require('../../assets/rewards/auto-pick-model.json'));
        return bundled.choose(rows);
    } catch { return -1; }
}

module.exports = { createAutoPick, choose };
