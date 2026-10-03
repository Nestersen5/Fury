'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const puppeteer = require('puppeteer');
const { cleanEnvironment, unusedPorts, startChild, stopChild, assertRunning, eventually, uiTestArguments } = require('./smoke_packaged_app');
const target = require('./launcher_verification_target').verificationTarget('launcher-nickroll');

(async () => {
    const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'fury-nickroll-check-'));
    const [debugPort, cosmeticPort, blockedPort] = await unusedPorts(3);
    const env = cleanEnvironment(profile, target.resources, cosmeticPort, blockedPort);
    if (!target.packaged) env.NODE_BINARY = process.execPath;
    const child = startChild(target.executable, [
        ...target.args, ...uiTestArguments(),
        `--remote-debugging-port=${debugPort}`,
        '--remote-debugging-address=127.0.0.1',
        `--proxy-server=${env.HTTPS_PROXY}`
    ], env, 'Nick Reroller launcher verification');
    let browser;
    try {
        browser = await eventually(async () => {
            assertRunning(child);
            return puppeteer.connect({ browserURL: `http://127.0.0.1:${debugPort}`, defaultViewport: null });
        }, 'Connecting launcher');
        const page = await eventually(async () => {
            const found = (await browser.pages()).find(candidate => candidate.url().endsWith('/launcher.html'));
            assert(found);
            return found;
        }, 'Opening launcher');
        await page.evaluate(async () => {
            const doc = document.implementation.createHTMLDocument('Autosave test');
            doc.body.innerHTML = '<form id="nickroll-form"></form>';
            const { DEFAULTS } = require('./src/nick/settings');
            const { mount } = require('./src/launcher/renderer/launcher_nickroll');
            const writes = [];
            let release, fail = false;
            const ui = mount({ document: doc, invoke: async (_, payload) => {
                writes.push(payload.features.nickRoll);
                if (fail) throw new Error('Fixture save failure');
                await new Promise(resolve => { release = resolve; });
            } });
            const assert = require('assert');
            const form = doc.getElementById('nickroll-form');
            const input = name => form.elements.namedItem(name);
            const edit = (name, value, type = 'input') => {
                if (typeof value === 'boolean') input(name).checked = value;
                else input(name).value = value;
                input(name).dispatchEvent(new Event(type, { bubbles: true }));
            };
            const tick = () => new Promise(resolve => setTimeout(resolve, 0));
            ui.update({ settings: { features: { nickRoll: DEFAULTS } } });
            assert.equal(form.querySelector('button[type=submit]'), null);
            assert(doc.getElementById('nickroll-rules-fields').hidden);
            edit('enableRules', true, 'change'); await tick();
            assert(!doc.getElementById('nickroll-rules-fields').hidden);
            edit('prefix', 'c'); edit('prefix', 'ca'); edit('prefix', 'cat');
            assert.equal(writes.length, 0, 'Typing is debounced');
            await new Promise(resolve => setTimeout(resolve, 550));
            assert.equal(writes.length, 1);
            assert.equal(writes[0].prefix, 'cat');
            edit('ogEnabled', false, 'change');
            release(); await tick();
            assert.equal(writes.length, 2, 'A change during a save is queued');
            assert.equal(writes[1].ogEnabled, false);
            assert.equal(writes[1].prefix, 'cat');
            release(); await ui.flush();
            edit('enableLength', true, 'change'); await tick();
            input('min').value = '15'; edit('max', '4', 'change');
            await ui.flush();
            assert.equal(writes.length, 2, 'Invalid combination is not saved');
            ui.update({ settings: { features: { nickRoll: DEFAULTS } } });
            assert.equal(input('max').value, '4', 'Refresh preserves invalid drafts');
            input('min').value = '3'; edit('max', '16');
            edit('prefix', 'dog');
            const closing = ui.flush();
            assert.equal(writes.length, 3, 'Closing flushes pending typing');
            release(); await closing;
            fail = true; edit('prefix', 'fox', 'change');
            await tick();
            assert(doc.getElementById('nickroll-save-status').textContent.includes('Fixture save failure'));
            assert.equal(input('prefix').value, 'fox');

            const chipDoc = document.implementation.createHTMLDocument('Chip test');
            chipDoc.body.innerHTML = '<form id="nickroll-form"></form>';
            const saved = [];
            const chips = mount({ document: chipDoc, invoke: async (_, payload) => saved.push(payload.features.nickRoll) });
            chips.update({ settings: { features: { nickRoll: { ...DEFAULTS, prefix: 'cat' } } } });
            const chipForm = chipDoc.getElementById('nickroll-form');
            assert(chipForm.elements.enableRules.checked, 'Existing filters are revealed');
            const add = (name, text) => {
                const entry = chipDoc.querySelector(`[data-token-entry="${name}"]`);
                entry.value = text; entry.dispatchEvent(new Event('input', { bubbles: true }));
                entry.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
            };
            add('words', 'Moon, cat'); await chips.flush();
            assert.deepEqual(saved.at(-1).words, ['moon', 'cat']);
            assert.equal(chipDoc.querySelectorAll('[data-tokens="words"] button').length, 2);
            add('wordGroups', 'blue moon'); await chips.flush();
            assert.deepEqual(saved.at(-1).wordGroups, [['fresh', 'head'], ['blue', 'moon']]);
            add('wordGroups', 'moon blue'); await chips.flush();
            assert.equal(saved.at(-1).wordGroups.length, 2, 'Duplicate group is not added');
            add('wordGroups', 'alone'); await chips.flush();
            assert.equal(saved.at(-1).wordGroups.length, 2, 'Invalid group is not saved');
            const entry = chipDoc.querySelector('[data-token-entry="wordGroups"]');
            entry.value = ''; entry.dispatchEvent(new Event('input', { bubbles: true }));
            chipDoc.querySelector('[data-tokens="words"] button').click(); await chips.flush();
            assert.deepEqual(saved.at(-1).words, ['cat']);
            chipForm.elements.enableRules.checked = false;
            chipForm.elements.enableRules.dispatchEvent(new Event('change', { bubbles: true }));
            await chips.flush();
            assert.equal(saved.at(-1).prefix, '');
            assert(chipDoc.getElementById('nickroll-rules-fields').hidden);

        });
        console.log('PASS focused nickroll autosave');
    } finally {
        if (browser) await browser.disconnect();
        await stopChild(child);
    }
})().catch(error => { console.error(error); process.exitCode = 1; });
