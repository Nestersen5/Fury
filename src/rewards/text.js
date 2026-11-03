'use strict';

// Same names and semantic rarity colors as the injectable's RewardText.
const GAMES = { WALLS3: 'Mega Walls', QUAKECRAFT: 'Quakecraft', WALLS: 'Walls', PAINTBALL: 'Paintball',
    SURVIVAL_GAMES: 'Blitz SG', TNTGAMES: 'TNT Games', VAMPIREZ: 'VampireZ', ARCADE: 'Arcade', ARENA: 'Arena',
    UHC: 'UHC', MCGO: 'Cops and Crims', BATTLEGROUND: 'Warlords', SUPER_SMASH: 'Smash Heroes',
    GINGERBREAD: 'Turbo Kart Racers', SKYWARS: 'SkyWars', TRUE_COMBAT: 'CrazyWalls', SPEEDUHC: 'Speed UHC',
    BEDWARS: 'Bed Wars', BUILD_BATTLE: 'Build Battle', MURDER_MYSTERY: 'Murder Mystery', DUELS: 'Duels', LEGACY: 'Classic' };
const VANITY = { suit_treasure: 'Treasure Hunter Suit', emote_moustache: 'Moustache Emote', taunt_treasure: 'Dig for Treasure Gesture' };
const TOKENS = new Set(['BEDWARS', 'MURDER_MYSTERY', 'DUELS', 'TNTGAMES', 'BUILD_BATTLE']);
const words = value => String(value || '').toLowerCase().split(/[_\s]+/).filter(Boolean).map(word => word[0].toUpperCase() + word.slice(1)).join(' ');
const game = value => GAMES[value] || (value ? words(value) : 'Unknown');
const rarity = value => value[0] + value.slice(1).toLowerCase();
const color = value => ({ RARE: 'blue', EPIC: 'dark_purple', LEGENDARY: 'gold' })[value] || 'white';
const legacy = value => ({ RARE: '§9', EPIC: '§5', LEGENDARY: '§6' })[value] || '§f';
const amount = value => value.toLocaleString('en-US');

function name(row) {
    switch (row.type) {
    case 'coins': return `${game(row.gameType)} ${TOKENS.has(row.gameType) ? 'Tokens' : 'Coins'}`;
    case 'tokens': return `${game(row.gameType)} Tokens`;
    case 'dust': return 'Mystery Dust';
    case 'experience': return 'Hypixel EXP';
    case 'souls': return 'SkyWars Souls';
    case 'mystery_box': return 'Mystery Box';
    case 'gift_box': return 'Gift Box';
    case 'adsense_token': return 'Reward Token';
    case 'housing_package': return row.key ? words(row.key.replace('specialoccasion_reward_card_skull_', '')) : 'Housing Item';
    case 'add_vanity':
        if (!row.key) return 'Cosmetic';
        if (row.key.includes('suit')) {
            const suit = row.key.replace(/_[a-z]+$/, '');
            return `${(VANITY[suit] || words(suit)).replace(' Suit', '')} ${words(row.key.replace(/^.*_([a-z]+)$/, '$1'))}`;
        }
        return VANITY[row.key] || words(row.key);
    default: return words(row.type);
    }
}

function description(row) {
    switch (row.type) {
    case 'coins': return `${TOKENS.has(row.gameType) ? 'In-game tokens' : 'In-game Coins'} for ${game(row.gameType)}`;
    case 'tokens': return `In-game tokens for ${game(row.gameType)}`;
    case 'dust': return 'Used to craft cosmetic items';
    case 'experience': return 'Used to increase your Hypixel Level';
    case 'souls': return 'Used with the SkyWars Soul Well';
    case 'mystery_box': return 'Open to unlock cosmetic items!';
    case 'gift_box': return 'Send a Mystery Box to your friends!';
    case 'adsense_token': return 'Each token gives you 1 more go at drawing Reward Cards';
    case 'housing_package': return '1 of 6 unique Housing Blocks in this set';
    case 'add_vanity': return row.key?.includes('suit') ? '1 of 4 unique cosmetic suit parts'
        : row.key?.includes('emote') ? 'A unique animated Emote item'
            : row.key?.includes('taunt') ? 'A unique animated Gesture item' : 'Cosmetic item';
    default: return `Reward type ${row.type}`;
    }
}

const summary = row => `${rarity(row.rarity)} ${name(row)}${row.amount >= 0 ? ` x${amount(row.amount)}` : ''}`;
const hover = row => `${legacy(row.rarity)}§l${rarity(row.rarity)} ${name(row)}\n§7${description(row)}${row.amount >= 0 ? `\n§7Amount: §f${amount(row.amount)}` : ''}\n\n§eClick to claim this card.`;

module.exports = { name, description, rarity, color, legacy, amount, summary, hover };
