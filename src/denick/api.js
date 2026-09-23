'use strict';

// Denick cosmetic-api matching extracted from proxy.js. Owns the lookup tables
// (cosmetic field defs + alias map, stat aliases, hand-curated API exceptions),
// the per-mtime cosmetic_api_names.json cache for learned name -> apiValue
// overrides, and the two parsers /denick uses to turn a CLI arg list into a
// {filters, stats, labels} object.
//
// Pure constants and the slug helper live at module scope so callers can read
// them without spinning up an instance. The stateful pieces (the file cache
// and the /denick filter parsers) sit inside createDenickApi. parseStatCount
// is sourced directly from src/denick/commands.js — there is no DI thunk for
// it because commands.js owns it as a pure module-level helper.

const fs = require('fs');
const { parseStatCount } = require('./commands.js');
const { normalizeCosmeticKey, canonicalCosmeticName } = require('../cosmetics/catalog.js');
const {
    DENICK_ISLAND_TOPPER_NAMES,
    DENICK_DEATH_CRY_NAMES,
    DENICK_SHOPKEEPER_SKIN_NAMES,
    DENICK_GLYPH_NAMES,
    DENICK_FIGURINE_NAMES,
    DENICK_PROJECTILE_TRAIL_NAMES
} = require('../cosmetics/cosmetic_name_catalog.js');

const DENICK_KILL_MESSAGE_NAMES = [
    'Default',
    'Counter',
    'None',
    'Fire',
    'Western',
    'Honourable',
    'Multiverse',
    'Limbo',
    'Love',
    'BBQ',
    'Woof Woof',
    "Santa's Workshop",
    'Primal',
    'Oink',
    'Squeak',
    'Buzz',
    "Ox'd",
    'Pirate',
    'Literally Spooky',
    'Memed',
    'Dramatic',
    'Noble',
    'Snow Storm',
    'Eggy',
    'Celebratory',
    'Wrapped Up',
    'To The Moon',
    'Festive',
    'Roar',
    'Triumph',
    'Bridging for Dummies',
    'Social Distance',
    'Old Man',
    'Glorious',
    'Lucid'
];

const DENICK_VICTORY_DANCE_NAMES = [
    'None',
    'Anvil Rain',
    'Fireworks',
    'Cold Snap',
    'Yeehaw',
    'Meteor Shower',
    'Guardians',
    'Night Shift',
    'Floating Lanterns',
    'Raining Pigs',
    'Festive Music',
    'Another Dimension',
    'Aura',
    'Anvil Ascension',
    'Insomnia',
    'Winter Twister',
    'Special Fireworks',
    'Wither Rider',
    'Veggy SpringLazor',
    'Rabbit Meteors',
    'Rainbow Dolly',
    'Terror',
    'Toy Stick',
    'Pumpkin Patch',
    'Easter Bunnies',
    'Flower Bed',
    'Chinese Dragon',
    'Cake Walk',
    'Heat Wave',
    'Figurine Rain',
    'Kart Away',
    'Dragon Rider',
    'Haunted',
    'Graveyard Rave',
    'Dragon Fire',
    'Rooted',
    'Egg Meteors',
    'Chicken Apocalypse',
    'Twerk Apocalypse',
    'Ghast Rider',
    'Abominable Snowman',
    'Infection',
    'Pumpkin Bomber',
    'Chicken Rider',
    'Exploding Bunnies',
    'Puppy Party',
    'Snowed In',
    'To Build a Snowman',
    'Fanbase',
    'Elder Guardian',
    'Woolnado',
    'Ice Bomber',
    'Hurricane Hell',
    'Dreamscape'
];

const DENICK_SPRAY_NAMES = [
    'Hypixel Logo',
    'Creeper',
    'Thanks',
    'Diamond',
    'Invisibility Potion',
    'Disco Pumpkin',
    'Reveillon',
    'Christmas Tree',
    'Careful Santa',
    'Easter Eggs',
    'Bunny GG',
    'Fireworks',
    'Year of the Dog',
    'Year of the Pig',
    'Lantern',
    'Year of the Rat',
    'Year of the Ox',
    'Lion Dancer',
    'Year of the Tiger',
    'Year of the Rabbit',
    'Year of the Dragon',
    'Year of the Snake',
    'Bed Shield',
    'GG WP',
    'Sorry',
    'Enderman',
    'Golem Riding',
    'Leaping Potion',
    'Sir von Mewrtimer',
    'Defenestration',
    'Boo!',
    'Perfect Sword Throw',
    'FaBOOlous',
    'Found U',
    'Snowball Fight',
    'Merry Base',
    'Surprise Snowball',
    'Angry Turkey',
    'Santa Slips',
    'Easter Creeper',
    'The Great Egg Hunt',
    'Easter Basket',
    'Egg Hunt',
    'Rabbit Costume',
    'Dragon',
    'Pig Peace',
    'Angry Cow',
    'Egg Gunner',
    'Egg Hit',
    'Rabbits in a Basket',
    'Pumpkinz',
    'Sweets',
    'Snow Angel',
    'Good Fortune',
    'Bunny Parkour',
    'Lucky Rabbit',
    'Spooky Game Over',
    "Season's Greetings",
    'Silent Night',
    'Ugly Bed Wars Sweater',
    'Golem Picnic',
    'Cooler Climates',
    'Comfy Web',
    'Casual Christmas',
    'Family Photo (Christmas Edition)',
    'Flowers For You',
    'Lazy Spring',
    'Sand Castle',
    'Bed Breaker',
    'I Love You',
    'Bye Bye',
    'TNT Drop',
    'Candy King',
    'Groovy the Ghost',
    'Starry Veggie',
    'Witch Bouillon',
    'Fake Vampire',
    'Scared',
    'Garlic',
    'Witch Please',
    'Mob Party',
    'Festive Harbinger',
    'Sleep Well',
    'Snowball Spammer',
    'Puppy Surprise',
    'Sniper Snowball',
    'Wrong Eggs',
    'Egg Surprise',
    'Golden Egg',
    'Dogs of Wisdom',
    'Peaceful',
    'Smug Pig',
    'Earth Pig',
    'Rat Costume',
    'Rats 2020',
    'Curled Ox',
    'Cute Bunny',
    'Egg Time',
    'Distinguished Ghost',
    'Spooky Skelington',
    'Menorah',
    'Mistletoe',
    'Snow Jerry',
    'Sleeps and Treats',
    'Easter Sweater',
    'Egg Decorations',
    'Lazy Bunnies',
    'Rabbit Celebration',
    'Bunny Lantern',
    'Monster Under the Bed',
    'Party Crasher',
    'Pumpkin Farm',
    'Gingerbread Jerry',
    'One of Us',
    'Buff Chicken',
    'Ice Scream Cart',
    'Jerry Island Poster',
    'Undead Lifesaving Association',
    'Gothic Jerry',
    'Haunted Conscience',
    'Angelic Jerry',
    'Turkey Day',
    'Bee That Chicken',
    'Painted Dragon Egg',
    'Sea Bass',
    'Sloth Burn',
    'Surfs Up',
    'Carried',
    'Dragon Slayer',
    'Loot Chest',
    'VIP',
    'VIP+',
    'MVP',
    'MVP+',
    'Doot Doot',
    'GG WPumpkin',
    'Skeleton Says Hi',
    'Watcher',
    'Snowman Rampage',
    'Chocolate Feast',
    'Sweet Dreams',
    'Ox Costume',
    'Trick or Treat',
    'Candy Cane Sniper',
    'Chickens',
    'SaBEEtage',
    'Pumpkin Pals'
];

const DENICK_COSMETIC_NAME_LISTS = {
    killmessage: DENICK_KILL_MESSAGE_NAMES,
    victorydance: DENICK_VICTORY_DANCE_NAMES,
    sprays: DENICK_SPRAY_NAMES,
    islandtopper: DENICK_ISLAND_TOPPER_NAMES,
    deathcry: DENICK_DEATH_CRY_NAMES,
    npcskin: DENICK_SHOPKEEPER_SKIN_NAMES,
    glyph: DENICK_GLYPH_NAMES,
    figurine: DENICK_FIGURINE_NAMES,
    projectiletrail: DENICK_PROJECTILE_TRAIL_NAMES
};

const DENICK_COSMETIC_API_EXCEPTIONS = {
    finalkill: {
        shockwave: 'killeffect_shockwave'
    },
    killmessage: {
        none: 'killmessages_default',
        default: 'killmessages_default'
    },
    victorydance: {
        none: 'victorydance_none',
        kartaway: 'victorydance_kartaway',
        hurricanehell: 'victorydance_hurricanehell'
    },
    sprays: {
        vipplus: 'sprays_vip_plus',
        mvpplus: 'sprays_mvp_plus'
    }
};

function denickCosmeticSlug(name) {
    return String(name || '')
        .toLowerCase()
        .replace(/['’]/g, '')
        .replace(/[^a-z0-9]+/g, '_')
        .replace(/^_+|_+$/g, '');
}

const DENICK_COSMETIC_FIELDS = {
    finalkill: {
        query: 'finalKill',
        label: 'Final Kill',
        type: 'finalkill',
        prefix: 'killeffect',
        aliases: ['finalkill', 'final', 'killeffect', 'finalkilleffect']
    },
    beddestroy: {
        query: 'bedDestroy',
        label: 'Bed Destroy',
        type: 'beddestroy',
        prefix: 'beddestroy',
        aliases: ['beddestroy', 'bed', 'bedbreak', 'bedbreakeffect']
    },
    killmessage: {
        query: 'killMessage',
        label: 'Kill Message',
        prefix: 'killmessages',
        aliases: ['killmessage', 'killmessages', 'killmsg', 'message']
    },
    victorydance: {
        query: 'victoryDance',
        label: 'Victory Dance',
        prefix: 'victorydance',
        aliases: ['victorydance', 'victory', 'dance']
    },
    woodskin: {
        query: 'woodSkin',
        label: 'Wood Skin',
        type: 'woodskin',
        prefix: 'woodskin',
        aliases: ['woodskin', 'woodtype', 'wood']
    },
    deathcry: {
        query: 'deathCry',
        label: 'Death Cry',
        prefix: 'deathcry',
        aliases: ['deathcry', 'death']
    },
    projectiletrail: {
        query: 'projectileTrail',
        label: 'Projectile Trail',
        prefix: 'projectiletrail',
        aliases: ['projectiletrail', 'projectile', 'trail']
    },
    glyph: {
        query: 'glyph',
        label: 'Glyph',
        prefix: 'glyph',
        aliases: ['glyph']
    },
    islandtopper: {
        query: 'islandTopper',
        label: 'Island Topper',
        prefix: 'islandtopper',
        aliases: ['islandtopper', 'topper']
    },
    npcskin: {
        query: 'npcSkin',
        label: 'Shopkeeper Skin',
        prefix: 'npcskin',
        aliases: ['npcskin', 'shopkeeper', 'shopkeeperskin']
    },
    sprays: {
        query: 'sprays',
        label: 'Spray',
        prefix: 'sprays',
        aliases: ['sprays', 'spray']
    },
    figurine: {
        query: 'figurine',
        label: 'Figurine',
        prefix: 'figurine',
        aliases: ['figurine']
    }
};

const DENICK_COSMETIC_FIELD_BY_ALIAS = (() => {
    const map = new Map();
    Object.entries(DENICK_COSMETIC_FIELDS).forEach(([key, def]) => {
        map.set(normalizeCosmeticKey(key), key);
        def.aliases.forEach(alias => map.set(normalizeCosmeticKey(alias), key));
    });
    return map;
})();

const DENICK_STAT_FIELD_BY_ALIAS = new Map([
    ['finals', 'finals'],
    ['finalkills', 'finals'],
    ['finalkillcount', 'finals'],
    ['beds', 'beds'],
    ['bedbreaks', 'beds'],
    ['bedsbroken', 'beds'],
    ['bedscount', 'beds']
]);

function createDenickApi({ cosmeticApiNamesFile }) {
    if (!cosmeticApiNamesFile) {
        throw new Error('createDenickApi: cosmeticApiNamesFile is required');
    }

    let denickCosmeticApiNameCache = null;
    let denickCosmeticApiNameCacheMtime = 0;

    function loadDenickCosmeticApiNames() {
        try {
            if (!fs.existsSync(cosmeticApiNamesFile)) return {};
            const stat = fs.statSync(cosmeticApiNamesFile);
            const mtime = stat.mtimeMs || 0;
            if (denickCosmeticApiNameCache && denickCosmeticApiNameCacheMtime === mtime) {
                return denickCosmeticApiNameCache;
            }

            const parsed = JSON.parse(fs.readFileSync(cosmeticApiNamesFile, 'utf8'));
            const rawMatches = parsed?.matches && typeof parsed.matches === 'object' ? parsed.matches : {};
            const next = {};
            Object.entries(rawMatches).forEach(([type, entries]) => {
                if (!entries || typeof entries !== 'object') return;
                const bucket = {};
                Object.entries(entries).forEach(([displayName, value]) => {
                    const apiValue = typeof value === 'string'
                        ? value
                        : (value?.apiValue || value?.id || value?.value || '');
                    if (!apiValue) return;
                    bucket[normalizeCosmeticKey(displayName)] = String(apiValue).toLowerCase();
                });
                next[type] = bucket;
            });

            denickCosmeticApiNameCache = next;
            denickCosmeticApiNameCacheMtime = mtime;
            return next;
        } catch (e) {
            return {};
        }
    }

    function learnedDenickCosmeticApiValue(fieldKey, rawValue) {
        const learned = loadDenickCosmeticApiNames();
        const bucket = learned[fieldKey];
        if (!bucket) return null;
        const normalized = normalizeCosmeticKey(rawValue);
        if (!normalized) return null;
        return bucket[normalized] || null;
    }

    function matchDenickCosmeticField(args, index) {
        const one = normalizeCosmeticKey(args[index]);
        const two = normalizeCosmeticKey(`${args[index] || ''} ${args[index + 1] || ''}`);
        if (DENICK_COSMETIC_FIELD_BY_ALIAS.has(two)) {
            return { key: DENICK_COSMETIC_FIELD_BY_ALIAS.get(two), length: 2 };
        }
        if (DENICK_COSMETIC_FIELD_BY_ALIAS.has(one)) {
            return { key: DENICK_COSMETIC_FIELD_BY_ALIAS.get(one), length: 1 };
        }
        return null;
    }

    function matchDenickStatField(args, index) {
        const key = DENICK_STAT_FIELD_BY_ALIAS.get(normalizeCosmeticKey(args[index]));
        return key ? { key, length: 1 } : null;
    }

    function denickCosmeticApiValue(fieldKey, rawValue) {
        const def = DENICK_COSMETIC_FIELDS[fieldKey];
        const raw = String(rawValue || '').trim();
        const rawLower = raw.toLowerCase();
        const normalized = normalizeCosmeticKey(raw);
        if (!raw) return null;
        if (normalized === 'null') return 'null';
        if (normalized === 'random') return 'random';
        if (normalized === 'randomcosmetic') return 'random_cosmetic';
        if (normalized === 'randomfavoritecosmetic') return 'random_favorite_cosmetic';

        const exception = DENICK_COSMETIC_API_EXCEPTIONS[fieldKey]?.[normalized];
        if (exception) return exception;

        const learnedValue = learnedDenickCosmeticApiValue(fieldKey, raw);
        if (learnedValue) return learnedValue;

        if (def.type) {
            if (rawLower.startsWith(`${def.prefix}_`)) return rawLower;
            if (fieldKey === 'finalkill' && rawLower.startsWith('killeffect_')) return rawLower;
            if (fieldKey === 'beddestroy' && ['ghost', 'ghosts'].includes(normalized)) return 'beddestroy_ghosts';

            const canonical = canonicalCosmeticName(def.type, raw)
                || (normalized.endsWith('s') ? canonicalCosmeticName(def.type, normalized.slice(0, -1)) : null);
            if (!canonical && fieldKey === 'woodskin') {
                return `woodskin_${denickCosmeticSlug(raw)}`;
            }
            if (!canonical) return null;
            const canonicalKey = normalizeCosmeticKey(canonical);
            const canonicalSlug = denickCosmeticSlug(canonical);
            if (fieldKey === 'beddestroy' && canonicalKey === 'ghost') return 'beddestroy_ghosts';
            if (fieldKey === 'beddestroy' && canonicalKey === 'lightningstrike') return 'beddestroy_lighting_strike,beddestroy_lightning_strike';
            if (fieldKey === 'finalkill' && canonicalKey === 'lightningstrike') return 'killeffect_lighting_strike,killeffect_lightning_strike';
            if (fieldKey === 'woodskin') {
                const woodMap = {
                    oakplank: 'woodskin_oak',
                    darkoakplank: 'woodskin_dark_oak',
                    acaciaplank: 'woodskin_acacia',
                    jungleplank: 'woodskin_jungle',
                    birchplank: 'woodskin_birch',
                    spruceplank: 'woodskin_spruce',
                    oaklog: 'woodskin_oak_log',
                    darkoaklog: 'woodskin_dark_oak_log',
                    acacialog: 'woodskin_acacia_log',
                    junglelog: 'woodskin_jungle_log',
                    birchlog: 'woodskin_birch_log',
                    sprucelog: 'woodskin_spruce_log'
                };
                return woodMap[canonicalKey] || `woodskin_${canonicalSlug}`;
            }
            return `${def.prefix}_${canonicalSlug}`;
        }

        if (rawLower.startsWith(`${def.prefix}_`)) return rawLower;

        const knownList = DENICK_COSMETIC_NAME_LISTS[fieldKey] || null;
        if (knownList) {
            const canonical = knownList.find(name => normalizeCosmeticKey(name) === normalized)
                || (normalized.endsWith('s') ? knownList.find(name => normalizeCosmeticKey(name) === normalized.slice(0, -1)) : null);
            if (!canonical) return null;
            return `${def.prefix}_${denickCosmeticSlug(canonical)}`;
        }

        return `${def.prefix}_${denickCosmeticSlug(rawLower)}`;
    }

    function parseDenickCosmeticFilters(args) {
        const filters = {};
        const labels = [];
        let index = 1;

        while (index < args.length) {
            const field = matchDenickCosmeticField(args, index);
            if (!field) {
                return { error: `Unknown cosmetic type: ${args[index]}` };
            }

            const def = DENICK_COSMETIC_FIELDS[field.key];
            index += field.length;
            const valueTokens = [];
            while (index < args.length) {
                const nextField = valueTokens.length > 0 ? matchDenickCosmeticField(args, index) : null;
                if (nextField) break;
                valueTokens.push(args[index]);
                index += 1;
            }

            const rawValue = valueTokens.join(' ').trim();
            const apiValue = denickCosmeticApiValue(field.key, rawValue);
            if (!apiValue) {
                return { error: `Unknown ${def.label}: ${rawValue || '(missing)'}` };
            }

            filters[def.query] = apiValue;
            labels.push(`${def.label}: ${rawValue}`);
        }

        if (Object.keys(filters).length === 0) {
            return { error: 'No cosmetic filters were provided.' };
        }

        return { filters, labels };
    }

    function parseDenickFilters(args) {
        const filters = {};
        const stats = {};
        const labels = [];
        const cosmeticLabels = [];
        const statLabels = [];
        let index = 1;

        while (index < args.length) {
            const statField = matchDenickStatField(args, index);
            if (statField) {
                const rawValue = args[index + statField.length];
                const parsed = parseStatCount(rawValue);
                if (parsed === null) {
                    return { error: `Invalid ${statField.key} value: ${rawValue || '(missing)'}` };
                }
                stats[statField.key] = parsed;
                const label = `${statField.key}: ${parsed.toLocaleString()}`;
                labels.push(label);
                statLabels.push(label);
                index += statField.length + 1;
                continue;
            }

            const field = matchDenickCosmeticField(args, index);
            if (!field) {
                return { error: `Unknown denick filter: ${args[index]}` };
            }

            const def = DENICK_COSMETIC_FIELDS[field.key];
            index += field.length;
            const valueTokens = [];
            while (index < args.length) {
                const nextStatField = valueTokens.length > 0 ? matchDenickStatField(args, index) : null;
                const nextCosmeticField = valueTokens.length > 0 ? matchDenickCosmeticField(args, index) : null;
                if (nextStatField || nextCosmeticField) break;
                valueTokens.push(args[index]);
                index += 1;
            }

            const rawValue = valueTokens.join(' ').trim();
            const apiValue = denickCosmeticApiValue(field.key, rawValue);
            if (!apiValue) {
                return { error: `Unknown ${def.label}: ${rawValue || '(missing)'}` };
            }

            filters[def.query] = apiValue;
            const label = `${def.label}: ${rawValue}`;
            labels.push(label);
            cosmeticLabels.push(label);
        }

        return {
            filters,
            stats,
            labels,
            cosmeticLabels,
            statLabels,
            hasCosmetics: Object.keys(filters).length > 0,
            hasStats: Object.keys(stats).length > 0
        };
    }

    return {
        loadDenickCosmeticApiNames,
        learnedDenickCosmeticApiValue,
        matchDenickCosmeticField,
        matchDenickStatField,
        denickCosmeticApiValue,
        parseDenickCosmeticFilters,
        parseDenickFilters
    };
}

module.exports = {
    createDenickApi,
    denickCosmeticSlug,
    DENICK_KILL_MESSAGE_NAMES,
    DENICK_VICTORY_DANCE_NAMES,
    DENICK_SPRAY_NAMES,
    DENICK_COSMETIC_FIELDS,
    DENICK_COSMETIC_FIELD_BY_ALIAS,
    DENICK_STAT_FIELD_BY_ALIAS,
    DENICK_COSMETIC_NAME_LISTS,
    DENICK_COSMETIC_API_EXCEPTIONS
};
