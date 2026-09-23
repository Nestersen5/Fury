'use strict';

// Pure data-shape helpers for surfacing the Hypixel-API "active cosmetics"
// fields from a Bedwars profile. extractActiveBedwarsCosmetics calls into
// the kill-message canonicalizer (lives in killMessages.js) which depends on
// runtime-loaded DENICK_KILL_MESSAGE_NAMES, so this module is a thin
// factory that receives that function. Everything else is pure.

const { titleCaseWords } = require('../util/text.js');
const {
    normalizeCosmeticKey,
    canonicalCosmeticNameFromApiId,
    canonicalWoodSkinNameFromApiId
} = require('./catalog.js');

function readFirstString(...values) {
    for (const value of values) {
        if (typeof value === 'string' && value.trim()) return value.trim();
    }
    return '';
}

const ACTIVE_BEDWARS_COSMETIC_FIELD_LABELS = {
    activeBedDestroy: 'Bed Destroy',
    active_bed_destroy: 'Bed Destroy',
    activeBedDestroyEffect: 'Bed Destroy',
    active_bed_destroy_effect: 'Bed Destroy',
    activeKillEffect: 'Final Kill Effect',
    active_kill_effect: 'Final Kill Effect',
    activeFinalKillEffect: 'Final Kill Effect',
    active_final_kill_effect: 'Final Kill Effect',
    activeWoodType: 'Wood Skin',
    active_wood_type: 'Wood Skin',
    activeWoodSkin: 'Wood Skin',
    active_wood_skin: 'Wood Skin',
    killMessage: 'Kill Message',
    kill_message: 'Kill Message',
    activeKillMessage: 'Kill Message',
    active_kill_message: 'Kill Message',
    activeProjectileTrail: 'Projectile Trail',
    active_projectile_trail: 'Projectile Trail',
    activeVictoryDance: 'Victory Dance',
    active_victory_dance: 'Victory Dance',
    activeDeathCry: 'Death Cry',
    active_death_cry: 'Death Cry',
    activeIslandTopper: 'Island Topper',
    active_island_topper: 'Island Topper',
    activeNPCSkin: 'Shopkeeper Skin',
    active_npc_skin: 'Shopkeeper Skin',
    activeShopkeeperSkin: 'Shopkeeper Skin',
    active_shopkeeper_skin: 'Shopkeeper Skin',
    activeSpray: 'Spray',
    active_spray: 'Spray',
    activeGlyph: 'Glyph',
    active_glyph: 'Glyph'
};

function humanizeApiCosmeticIdentifier(value) {
    const raw = String(value || '').trim();
    if (!raw) return '';
    return titleCaseWords(raw
        .replace(/^active[_\s-]*/i, '')
        .replace(/[_-]+/g, ' ')
        .replace(/\s+/g, ' ')
        .trim());
}

function stringifyApiCosmeticValue(value) {
    if (value === null || value === undefined) return '';
    if (typeof value === 'string') return value.trim();
    if (typeof value === 'number' || typeof value === 'boolean') return String(value);
    if (Array.isArray(value)) {
        return value
            .map(item => stringifyApiCosmeticValue(item))
            .filter(Boolean)
            .join(', ');
    }
    try {
        const serialized = JSON.stringify(value);
        return serialized && serialized.length > 90 ? `${serialized.slice(0, 87)}...` : (serialized || '');
    } catch (e) {
        return String(value || '').trim();
    }
}

function activeBedwarsCosmeticFieldLabel(field) {
    const raw = String(field || '').trim();
    if (ACTIVE_BEDWARS_COSMETIC_FIELD_LABELS[raw]) return ACTIVE_BEDWARS_COSMETIC_FIELD_LABELS[raw];
    const withoutActive = raw.replace(/^active[_\s-]*/i, '');
    return humanizeApiCosmeticIdentifier(withoutActive || raw);
}

function isLikelyActiveBedwarsCosmeticField(field, value) {
    const raw = String(field || '').trim();
    if (!raw) return false;
    if (ACTIVE_BEDWARS_COSMETIC_FIELD_LABELS[raw]) return true;
    if (/^kill_?message$/i.test(raw)) return true;
    if (!/^active/i.test(raw)) return false;
    if (value && typeof value === 'object' && !Array.isArray(value)) return false;
    return Boolean(stringifyApiCosmeticValue(value));
}

function createActiveCosmetics({ canonicalKillMessageNameFromApiId }) {
    function extractActiveBedwarsCosmetics(profileData = {}) {
        const player = profileData.player || profileData;
        const bw = player?.stats?.Bedwars || player?.stats?.BedWars || {};
        const rawBedDestroy = readFirstString(
            bw.activeBedDestroy,
            bw.active_bed_destroy,
            bw.activeBedDestroyEffect,
            player.activeBedDestroy,
            player.active_bed_destroy
        );
        const rawFinalKill = readFirstString(
            bw.activeKillEffect,
            bw.active_kill_effect,
            bw.activeFinalKillEffect,
            bw.active_final_kill_effect,
            player.activeKillEffect,
            player.active_kill_effect
        );
        const rawWoodSkin = readFirstString(
            bw.activeWoodType,
            bw.active_wood_type,
            bw.activeWoodSkin,
            bw.active_wood_skin,
            player.activeWoodType,
            player.active_wood_type,
            player.activeWoodSkin,
            player.active_wood_skin
        );
        const rawKillMessage = readFirstString(
            bw.killMessage,
            bw.activeKillMessage,
            bw.active_kill_message,
            player.killMessage,
            player.activeKillMessage,
            player.active_kill_message
        );

        return {
            beddestroy: canonicalCosmeticNameFromApiId('beddestroy', rawBedDestroy),
            finalkill: canonicalCosmeticNameFromApiId('finalkill', rawFinalKill),
            woodskin: canonicalWoodSkinNameFromApiId(rawWoodSkin),
            killmessage: canonicalKillMessageNameFromApiId(rawKillMessage),
            raw: {
                activeBedDestroy: rawBedDestroy,
                activeKillEffect: rawFinalKill,
                activeWoodType: rawWoodSkin,
                killMessage: rawKillMessage
            }
        };
    }

    function collectActiveBedwarsCosmeticFields(profileData = {}) {
        const player = profileData.player || profileData;
        const bw = player?.stats?.Bedwars || player?.stats?.BedWars || {};
        const extracted = extractActiveBedwarsCosmetics(profileData);
        const rows = [];
        const seenLabels = new Set();

        const addRow = (field, label, rawValue, displayName, known = false) => {
            const raw = stringifyApiCosmeticValue(rawValue);
            const value = displayName || humanizeApiCosmeticIdentifier(raw);
            if (!raw && !value) return;
            const labelKey = normalizeCosmeticKey(label || field);
            if (seenLabels.has(labelKey)) return;
            seenLabels.add(labelKey);
            rows.push({
                field,
                label: label || activeBedwarsCosmeticFieldLabel(field),
                value,
                raw,
                known
            });
        };

        addRow('activeBedDestroy', 'Bed Destroy', extracted.raw.activeBedDestroy, extracted.beddestroy, true);
        addRow('activeKillEffect', 'Final Kill Effect', extracted.raw.activeKillEffect, extracted.finalkill, true);
        addRow('activeWoodType', 'Wood Skin', extracted.raw.activeWoodType, extracted.woodskin, true);
        addRow('killMessage', 'Kill Message', extracted.raw.killMessage, extracted.killmessage, true);

        Object.entries(bw || {})
            .filter(([field, value]) => isLikelyActiveBedwarsCosmeticField(field, value))
            .sort(([a], [b]) => activeBedwarsCosmeticFieldLabel(a).localeCompare(activeBedwarsCosmeticFieldLabel(b)))
            .forEach(([field, value]) => {
                addRow(field, activeBedwarsCosmeticFieldLabel(field), value, null, false);
            });

        return rows;
    }

    return {
        extractActiveBedwarsCosmetics,
        collectActiveBedwarsCosmeticFields
    };
}

module.exports = {
    humanizeApiCosmeticIdentifier,
    stringifyApiCosmeticValue,
    activeBedwarsCosmeticFieldLabel,
    isLikelyActiveBedwarsCosmeticField,
    createActiveCosmetics
};
