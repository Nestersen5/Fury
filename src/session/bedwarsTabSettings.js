'use strict';

const MINUTE_MS = 60000;
const BEDWARS_TAB_PHASES = [
    { id: 'diamond2', label: 'Diamond II', color: 'aqua', pattern: /^diamond ii$/i, atMs: 6 * MINUTE_MS, spanMs: 6 * MINUTE_MS },
    { id: 'emerald2', label: 'Emerald II', color: 'green', pattern: /^emerald ii$/i, atMs: 12 * MINUTE_MS, spanMs: 6 * MINUTE_MS },
    { id: 'diamond3', label: 'Diamond III', color: 'aqua', pattern: /^diamond iii$/i, atMs: 18 * MINUTE_MS, spanMs: 6 * MINUTE_MS },
    { id: 'emerald3', label: 'Emerald III', color: 'green', pattern: /^emerald iii$/i, atMs: 24 * MINUTE_MS, spanMs: 6 * MINUTE_MS },
    { id: 'bedgone', label: 'Bed Gone', color: 'yellow', pattern: /^bed (?:gone|destruction)$/i, atMs: 30 * MINUTE_MS, spanMs: 6 * MINUTE_MS },
    { id: 'suddendeath', label: 'Sudden Death', color: 'gold', pattern: /^sudden death$/i, atMs: 40 * MINUTE_MS, spanMs: 10 * MINUTE_MS },
    { id: 'dragons', label: 'Dragons', color: 'red', pattern: /^(?:more )?dragons?$/i, atMs: 45 * MINUTE_MS, spanMs: 5 * MINUTE_MS },
    { id: 'gameend', label: 'Game End', color: 'red', pattern: /^game end$/i, atMs: 50 * MINUTE_MS, spanMs: 5 * MINUTE_MS }
];
const RESOURCE_TYPES = ['diamond', 'emerald'];
const PHASE_IDS = BEDWARS_TAB_PHASES.map(phase => phase.id);
const BEDWARS_TAB_DEFAULTS = {
    tabResourcesEnabled: true,
    tabResourceTypes: RESOURCE_TYPES,
    tabPhasesEnabled: false,
    tabPhaseTypes: PHASE_IDS
};

function normalizeBedwarsTabSettings(settings = {}) {
    const select = (value, allowed) => allowed.filter(id => !Array.isArray(value) || value.includes(id));
    const resources = select(settings.tabResourceTypes, RESOURCE_TYPES);
    const phases = select(settings.tabPhaseTypes, PHASE_IDS);
    return {
        tabResourcesEnabled: resources.length > 0 && settings.tabResourcesEnabled !== false,
        tabResourceTypes: resources,
        tabPhasesEnabled: phases.length > 0 && settings.tabPhasesEnabled === true,
        tabPhaseTypes: phases
    };
}

module.exports = { BEDWARS_TAB_PHASES, BEDWARS_TAB_DEFAULTS, normalizeBedwarsTabSettings };
