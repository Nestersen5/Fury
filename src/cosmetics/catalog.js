'use strict';

// Static cosmetic catalog + canonicalization helpers extracted from proxy.js.
// All exports are pure data / pure functions. sendCosmeticList still needs
// sendChat, so it's exposed via createCosmeticCommands({ sendChat }).

const COSMETIC_CATEGORIES = [
    'Bed Destroys',
    'Death Cries',
    'Figurines',
    'Final Kill Effects',
    'Glyphs',
    'Island Toppers',
    'Kill Messages',
    'Projectile Trails',
    'Shopkeeper Skins',
    'Sprays',
    'Victory Dances',
    'Wood Skins'
];

const BED_DESTROY_EFFECTS = [
    'None',
    'Squid Missile',
    'Firework',
    'Lightning Strike',
    'Ghost',
    'Lava Explosion',
    'Pig Missile',
    'Glyph',
    'Tornado',
    'Thief',
    'Pumpkin Explosion',
    'Present',
    'Eggsplosion',
    'Blizzard',
    'Shattering Ice',
    'Bed Bugs',
    'Pigsplosion',
    'Fishy',
    'Lady Bug',
    'Stormy',
    'Egg Popper',
    'Burned Up',
    'Water Spout',
    'Uncraft'
];

const FINAL_KILL_EFFECTS = [
    'Team Destroy',
    'Shock Wave',
    'Snowplosion',
    'Final Smash',
    'Lightning Strike',
    'Golem Yeet',
    'Frozen in Time',
    'Guardian Rocket',
    'Cow Rocket',
    'Pig Smash',
    'Holiday Tree',
    'Afterlife',
    'Soul Ripper',
    'Batcrux',
    'Petal Gust',
    'Rainbow',
    'Lit',
    'Witch Ritual',
    'Bee Abduction',
    "Dracula's Flight",
    'Ring of Fire',
    'Rising Dragon',
    'Tornado',
    'Heart Beat',
    'Balloons',
    'Pedestal',
    'Present Rain',
    'Crackling Ice',
    'Anvil Smash',
    'Beef Everywhere',
    'Spirit',
    'Holiday Fireworks',
    'Gift Explosion',
    'Snow Globe',
    "Jack O' Twister",
    'Pumpkin Rocket',
    'Haunted',
    'Kill Counter',
    'Rain on my Parade',
    'Chicken Tower',
    'Bunny Explosion',
    'Skeletal Remains',
    'Blood Bats',
    'Lantern Spiral',
    'Hatching Eggs',
    'Raining Easter Eggs',
    'Smiley',
    'Experience Orb',
    'Pinata',
    'Rekt',
    'Blood Explosion',
    'Its Raining Gold',
    'Fire Breath',
    'Last Candle',
    'Black Mark',
    'Magnolia',
    'Easter Egg Theft',
    'Head Rocket',
    'Wind Gusts',
    'Campfire',
    'Cookie Fountain',
    'Burning Shoes',
    'Heart Aura',
    'TNT',
    'Firework',
    'Squid Missile',
    'Pumpkin Popper',
    'Shattered',
    'None'
];

const WOOD_SKINS = [
    'Oak Plank',
    'Dark Oak Log',
    'Dark Oak Plank',
    'Acacia Log',
    'Jungle Log',
    'Acacia Plank',
    'Jungle Plank',
    'Birch Log',
    'Spruce Log',
    'Birch Plank',
    'Spruce Plank',
    'Oak Log'
];

const WOOD_SKIN_BY_ITEM = {
    5: {
        0: 'Oak Plank',
        1: 'Spruce Plank',
        2: 'Birch Plank',
        3: 'Jungle Plank',
        4: 'Acacia Plank',
        5: 'Dark Oak Plank'
    },
    17: {
        0: 'Oak Log',
        1: 'Spruce Log',
        2: 'Birch Log',
        3: 'Jungle Log',
        4: 'Acacia Log',
        5: 'Dark Oak Log'
    },
    162: {
        0: 'Acacia Log',
        1: 'Dark Oak Log'
    }
};

const COSMETIC_CATALOG = {
    categories: COSMETIC_CATEGORIES,
    beddestroy: BED_DESTROY_EFFECTS,
    finalkill: FINAL_KILL_EFFECTS,
    woodskin: WOOD_SKINS
};

function normalizeCosmeticKey(value) {
    return String(value || '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

function normalizeCosmeticType(value) {
    const key = normalizeCosmeticKey(value);
    if (['beddestroy', 'beddestroys', 'bedbreak', 'bedbreaks', 'beddestruction'].includes(key)) return 'beddestroy';
    if (['finalkill', 'finalkills', 'finalkilleffect', 'finalkilleffects', 'final'].includes(key)) return 'finalkill';
    if (['woodskin', 'woodskins', 'wood', 'woodtype', 'woodtypes'].includes(key)) return 'woodskin';
    return null;
}

function cosmeticTypeLabel(type) {
    if (type === 'beddestroy') return 'Bed Destroy';
    if (type === 'finalkill') return 'Final Kill';
    if (type === 'woodskin') return 'Wood Skin';
    return type || 'Cosmetic';
}

function canonicalCosmeticName(type, name) {
    const list = COSMETIC_CATALOG[type] || [];
    const key = normalizeCosmeticKey(name);
    return list.find(item => normalizeCosmeticKey(item) === key) || null;
}

function cosmeticApiAliasCandidates(value) {
    const raw = String(value || '').trim();
    if (!raw) return [];

    const aliases = [];
    const add = (next) => {
        if (next && next !== raw && !aliases.includes(next)) aliases.push(next);
    };

    add(raw.replace(/\blighting\b/gi, 'lightning'));
    add(raw.replace(/lighting/gi, 'lightning'));

    return aliases;
}

function canonicalCosmeticNameFromApiId(type, value) {
    const raw = String(value || '').trim();
    if (!raw) return null;
    const key = normalizeCosmeticKey(raw);
    if (!key || key.includes('random')) return null;

    const prefixesByType = {
        beddestroy: ['beddestroy', 'beddestruction', 'bedbreak'],
        finalkill: ['killeffect', 'kill effect', 'finalkill', 'finalkilleffect'],
        woodskin: ['woodskin', 'wood skin', 'woodtype', 'wood type']
    };
    const prefixes = prefixesByType[type] || [];
    let cleaned = raw;
    prefixes.forEach((prefix) => {
        cleaned = cleaned.replace(new RegExp(`^${prefix.replace(/\s+/g, '[_\\s-]*')}[_\\s-]*`, 'i'), '');
    });
    cleaned = cleaned.replace(/^active[_\s-]*/i, '');

    const candidates = [
        cleaned,
        cleaned.replace(/_/g, ' '),
        cleaned.replace(/-/g, ' '),
        key,
        key.endsWith('s') ? key.slice(0, -1) : key,
        ...cosmeticApiAliasCandidates(cleaned),
        ...cosmeticApiAliasCandidates(cleaned.replace(/_/g, ' ')),
        ...cosmeticApiAliasCandidates(cleaned.replace(/-/g, ' ')),
        ...cosmeticApiAliasCandidates(key)
    ].filter(Boolean);

    const list = COSMETIC_CATALOG[type] || [];
    for (const item of list) {
        const itemKey = normalizeCosmeticKey(item);
        if (candidates.some(candidate => {
            const candidateKey = normalizeCosmeticKey(candidate);
            return candidateKey === itemKey
                || (candidateKey.endsWith('s') && candidateKey.slice(0, -1) === itemKey);
        })) {
            return item;
        }
    }

    return null;
}

function canonicalWoodSkinNameFromApiId(value) {
    const raw = String(value || '').trim();
    if (!raw) return null;
    const cleaned = raw
        .replace(/^wood\s*skin[_\s-]*/i, '')
        .replace(/^woodskin[_\s-]*/i, '')
        .replace(/^active[_\s-]*/i, '');
    const key = normalizeCosmeticKey(cleaned);
    const apiMap = {
        oak: 'Oak Plank',
        darkoak: 'Dark Oak Plank',
        acacia: 'Acacia Plank',
        jungle: 'Jungle Plank',
        birch: 'Birch Plank',
        spruce: 'Spruce Plank',
        oaklog: 'Oak Log',
        darkoaklog: 'Dark Oak Log',
        acacialog: 'Acacia Log',
        junglelog: 'Jungle Log',
        birchlog: 'Birch Log',
        sprucelog: 'Spruce Log'
    };
    return apiMap[key]
        || canonicalCosmeticName('woodskin', cleaned)
        || canonicalCosmeticNameFromApiId('woodskin', raw);
}

function createCosmeticCommands({ sendChat }) {
    function sendCosmeticList(client, type = 'all') {
        const types = type === 'all' ? ['beddestroy', 'finalkill', 'woodskin'] : [type];
        types.forEach((listType) => {
            const list = COSMETIC_CATALOG[listType] || [];
            if (!list.length) return;
            sendChat(client, `§6§lSupported ${cosmeticTypeLabel(listType)} Cosmetics`);
            for (let i = 0; i < list.length; i += 4) {
                sendChat(client, `§7- §f${list.slice(i, i + 4).join('§7, §f')}`);
            }
        });
    }
    return { sendCosmeticList };
}

module.exports = {
    COSMETIC_CATEGORIES,
    BED_DESTROY_EFFECTS,
    FINAL_KILL_EFFECTS,
    WOOD_SKINS,
    WOOD_SKIN_BY_ITEM,
    COSMETIC_CATALOG,
    normalizeCosmeticKey,
    normalizeCosmeticType,
    cosmeticTypeLabel,
    canonicalCosmeticName,
    cosmeticApiAliasCandidates,
    canonicalCosmeticNameFromApiId,
    canonicalWoodSkinNameFromApiId,
    createCosmeticCommands
};
