'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { BEDWARS_TAB_PHASES, normalizeBedwarsTabSettings } = require('../../src/session/bedwarsTabSettings');
const { getBedwarsGeneratorStats, appendGeneratorRowToFooter, componentText } = require('../../src/session/bedwarsGeneratorSchedule');

assert.deepStrictEqual(normalizeBedwarsTabSettings().tabResourceTypes, ['diamond', 'emerald']);
assert.strictEqual(normalizeBedwarsTabSettings().tabPhasesEnabled, false);
assert.deepStrictEqual(normalizeBedwarsTabSettings({ tabResourceTypes: ['emerald', 'invalid', 'diamond', 'diamond'] }).tabResourceTypes, ['diamond', 'emerald']);
assert.strictEqual(normalizeBedwarsTabSettings({ tabResourceTypes: [] }).tabResourcesEnabled, false);
assert.strictEqual(normalizeBedwarsTabSettings({ tabPhasesEnabled: true, tabPhaseTypes: [] }).tabPhasesEnabled, false);

const footer = JSON.stringify({ text: 'Kills: 0 Final Kills: 0 Beds Broken: 0\nStore', color: 'gold' });
const elapsedMs = 199000;
const stats = getBedwarsGeneratorStats(elapsedMs);
const show = settings => componentText(appendGeneratorRowToFooter(footer, stats, { settings, elapsedMs }));
const phaseOnly = { tabResourcesEnabled: false, tabPhasesEnabled: true };
assert.strictEqual(show({ tabResourcesEnabled: false, tabPhasesEnabled: false }), componentText(footer));
assert.strictEqual(show({ tabResourceTypes: ['diamond'] }), 'Kills: 0 Final Kills: 0 Beds Broken: 0\n\nDiamonds (2): 7\nStore');
assert.strictEqual(show({ tabResourceTypes: ['emerald'] }), 'Kills: 0 Final Kills: 0 Beds Broken: 0\n\nEmeralds (1): 3\nStore');
assert.strictEqual(show({ ...phaseOnly, tabPhaseTypes: ['gameend', 'diamond2', 'emerald3', 'diamond2', 'invalid'] }),
    'Kills: 0 Final Kills: 0 Beds Broken: 0\n\nDiamond II: 2:41  |  Emerald III: 20:41\nGame End: 46:41\nStore');
const all = show({ tabPhasesEnabled: true });
assert(all.includes('Emeralds (1): 3  Diamonds (2): 7\n\nDiamond II: 2:41'));
assert(all.includes('Diamond II: 2:41  |  Emerald II: 8:41\nDiamond III: 14:41  |  Emerald III: 20:41'));
assert(all.includes('Bed Gone: 26:41  |  Sudden Death: 36:41\nDragons: 41:41  |  Game End: 46:41'));
assert(!show({ tabResourcesEnabled: false, tabPhaseTypes: [] }).includes('\n\n'));
for (const phase of BEDWARS_TAB_PHASES) {
    const past = appendGeneratorRowToFooter(footer, stats, { settings: { ...phaseOnly, tabPhaseTypes: [phase.id] }, elapsedMs: phase.atMs });
    assert.strictEqual(past, footer, 'completed phase disappears without empty rows');
}
const noNewline = componentText(appendGeneratorRowToFooter('Beds Broken: 0', stats, { settings: { tabResourceTypes: ['emerald'] } }));
assert.strictEqual(noNewline, 'Beds Broken: 0\n\nEmeralds (1): 3');

// Round-trip through the real feature whitelist using isolated runtime data.
const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'fury-bedwars-tab-'));
const previousDir = process.env.FURY_DATA_DIR;
try {
    process.env.FURY_DATA_DIR = directory;
    const config = require('../../app_config');
    const input = { ...config.defaults.features, tabResourcesEnabled: false, tabResourceTypes: ['emerald'], tabPhasesEnabled: true, tabPhaseTypes: ['gameend', 'diamond2'] };
    config.saveFeatureSettings(input);
    const saved = config.loadFeatureSettings();
    assert.deepStrictEqual(normalizeBedwarsTabSettings(saved), normalizeBedwarsTabSettings(input));
    const { createConfigLoader } = require('../../src/bootstrap/config');
    const parsed = createConfigLoader({ loadFeatureSettings: () => saved, clampDodgeDelay: value => value, state: {}, logger: { log() {} } }).parseFeatureConfig();
    assert.deepStrictEqual(normalizeBedwarsTabSettings(parsed), normalizeBedwarsTabSettings(input));
    const { filterPresetSettings, unknownPresetKeys } = require('../../src/profiles/profileStore');
    const profile = normalizeBedwarsTabSettings(input);
    assert.deepStrictEqual(filterPresetSettings(profile), profile);
    assert.deepStrictEqual(unknownPresetKeys(profile), []);
    config.saveFeatureSettings({ ...saved, tabResourceTypes: [], tabPhaseTypes: [] });
    const empty = config.loadFeatureSettings();
    assert.strictEqual(empty.tabResourcesEnabled, false);
    assert.strictEqual(empty.tabPhasesEnabled, false);
    assert.deepStrictEqual(empty.tabResourceTypes, []);
    assert.deepStrictEqual(empty.tabPhaseTypes, []);
} finally {
    if (previousDir === undefined) delete process.env.FURY_DATA_DIR;
    else process.env.FURY_DATA_DIR = previousDir;
    assert(directory.startsWith(path.resolve(os.tmpdir()) + path.sep)
        && path.basename(directory).startsWith('fury-bedwars-tab-'));
    fs.rmSync(directory, { recursive: true, force: true });
}

console.log('BedWars Tab selection, spacing, phase order and persistence tests passed.');
