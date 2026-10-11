'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { BEDWARS_TAB_PHASES, normalizeBedwarsTabSettings } = require('../../src/session/bedwarsTabSettings');

// Run the launcher's production selection handlers with controlled DOM inputs.
const html = fs.readFileSync(path.resolve(__dirname, '../../launcher.html'), 'utf8');
const groups = {
    'tab-resource-types': ['diamond', 'emerald'],
    'tab-phase-types': BEDWARS_TAB_PHASES.map(phase => phase.id)
};
const inputs = Object.fromEntries(Object.entries(groups).map(([key, values]) => [key, values.map(value => ({ value, checked: true, dataset: {} }))]));
const listeners = {};
const masters = {};
for (const name of ['tabResourcesEnabled', 'tabPhasesEnabled']) {
    masters[name] = { checked: name === 'tabResourcesEnabled', addEventListener: (event, callback) => { listeners[name] = callback; } };
}
let paints = 0, saves = 0;
const context = vm.createContext({
    normalizeBedwarsTabSettings, ids: masters,
    document: {
        querySelectorAll: selector => {
            const key = selector.match(/^#([^ ]+)/)[1];
            return selector.includes(':checked') ? inputs[key].filter(input => input.checked) : inputs[key];
        },
        querySelector: () => null,
        getElementById: key => ({ addEventListener: (event, callback) => { listeners[key] = callback; } })
    },
    renderTabStatsEditor: () => { paints++; },
    scheduleFeatureAutoSave: () => { saves++; }
});
const checkedFields = html.slice(html.indexOf('        function checkedSessionFields('), html.indexOf('        function setCheckedSessionFields('));
const handlers = html.slice(html.indexOf('        function collectBedwarsTabSettings('), html.indexOf('        function effectiveSessionRecapFields('));
vm.runInContext(checkedFields + handlers, context);
const snapshot = () => JSON.parse(JSON.stringify(context.collectBedwarsTabSettings()));
inputs['tab-resource-types'][0].checked = false;
listeners['tab-resource-types']();
assert.deepStrictEqual(snapshot().tabResourceTypes, ['emerald']);
assert.strictEqual(snapshot().tabResourcesEnabled, true);
inputs['tab-resource-types'][1].checked = false;
listeners['tab-resource-types']();
assert.strictEqual(masters.tabResourcesEnabled.checked, false);
assert.deepStrictEqual(snapshot().tabResourceTypes, []);
masters.tabResourcesEnabled.checked = true;
listeners.tabResourcesEnabled();
assert.deepStrictEqual(snapshot().tabResourceTypes, ['diamond', 'emerald']);
masters.tabResourcesEnabled.checked = false;
listeners.tabResourcesEnabled();
assert.deepStrictEqual(snapshot().tabResourceTypes, ['diamond', 'emerald'], 'master off retains the chosen resources');
assert.strictEqual(snapshot().tabResourcesEnabled, false);
inputs['tab-phase-types'].forEach(input => { input.checked = ['gameend', 'diamond2'].includes(input.value); });
listeners['tab-phase-types']();
assert.strictEqual(snapshot().tabPhasesEnabled, true);
assert.deepStrictEqual(snapshot().tabPhaseTypes, ['diamond2', 'gameend']);
inputs['tab-phase-types'].forEach(input => { input.checked = false; });
listeners['tab-phase-types']();
assert.strictEqual(snapshot().tabPhasesEnabled, false);
assert.deepStrictEqual(snapshot().tabPhaseTypes, []);
masters.tabPhasesEnabled.checked = true;
listeners.tabPhasesEnabled();
assert.strictEqual(snapshot().tabPhaseTypes.length, 8);
assert.strictEqual(paints, 7, 'every change repaints immediately');
assert.strictEqual(saves, 7, 'every change schedules persistence');
assert.strictEqual((html.match(/\.\.\.collectBedwarsTabSettings\(\)/g) || []).length, 2, 'both settings collectors include the controls');
assert(html.includes("setCheckedSessionFields('tab-phase-types', bedwarsTab.tabPhaseTypes)"), 'refresh restores saved selections');
console.log('BedWars Tab launcher live selection controls passed.');
