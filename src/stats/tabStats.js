'use strict';

function shouldRenderNickedBedwarsStars(fields = []) {
    if (!Array.isArray(fields)) return false;
    const starsIndex = fields.indexOf('stars');
    const nameIndex = fields.indexOf('name');
    return starsIndex >= 0 && nameIndex >= 0 && starsIndex < nameIndex;
}

function buildNickedBedwarsTabColumns(fields, starText, identityText) {
    if (!shouldRenderNickedBedwarsStars(fields)) return [];

    return fields.map(field => {
        if (field === 'stars') return { field, text: starText };
        if (field === 'name') return { field, text: identityText };
        return null;
    }).filter(Boolean);
}

function positivePing(value) {
    if (value === null || value === undefined || value === '') return null;
    const ping = Number(value);
    return Number.isFinite(ping) && ping > 0 ? ping : null;
}

// Tab ping is Aurora only - the same average /stats and nametags show, taken
// from the data already attached to the stats profile. The server's live
// latency is ignored. No value means no column - never "-1ms".
function resolveTabPing(auroraPing = null) {
    return positivePing(auroraPing?.avgPing);
}

module.exports = {
    shouldRenderNickedBedwarsStars,
    buildNickedBedwarsTabColumns,
    resolveTabPing
};
