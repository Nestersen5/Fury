'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { scenarios } = require('../../scripts/test_support/denick_scenarios');
const { runExample } = require('../../scripts/denick_examples');

test('example IDs are unique', () => assert.equal(new Set(scenarios.map(scenario => scenario.id)).size, scenarios.length));
for (const scenario of scenarios) {
    test(`${scenario.id}: ${scenario.title}`, async () => { await runExample(scenario); });
}
