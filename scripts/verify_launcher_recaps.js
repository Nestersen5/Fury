'use strict';

// Invoked by verify_launcher_redesign --focus recaps, with an isolated profile.
const assert = require('assert');
const fs = require('fs');
const path = require('path');

module.exports = async function verify({ page, output, profile }) {
    await page.evaluate("activatePage('settings');activateSettingsSubpage('sessions',false)");
    assert.equal(await page.$$eval('#session-recap-style, .fury-recap-tabs', nodes => nodes.length), 0);
    const ready = text => page.waitForFunction(expected => {
        const canvas = document.querySelector('#session-recap-preview canvas');
        return canvas && canvas.getAttribute('aria-label').includes(expected);
    }, {}, text);
    const saved = () => page.waitForFunction('!featureSaveTimer && !featureSaveInFlight');
    const read = () => JSON.parse(fs.readFileSync(path.join(profile, 'features_config.json'), 'utf8'));
    const capture = async name => {
        // Capture the actual rendered bitmap so transient save notifications
        // cannot cover the artifact, while retaining its original pixel size.
        const data = await page.$eval('#session-recap-preview canvas', canvas => canvas.toDataURL('image/png'));
        fs.writeFileSync(path.join(output, `${name}.png`), Buffer.from(data.split(',')[1], 'base64'));
    };
    await ready('SESSION 6W / 2L');
    await ready('Solos   Map: Airshow');
    assert(await page.$$eval('#session-recap-fields input', inputs => inputs.every(input => input.closest('label').checkVisibility())));
    assert.deepEqual(await page.$$eval('#session-recap-fields input', inputs => inputs.map(input => input.value)),
        require('../src/session/settings').SESSION_RECAP_FIELDS);
    await page.$eval('#session-goal-games', input => {
        input.value = '10';
        input.dispatchEvent(new Event('input', { bubbles: true }));
        input.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await ready('SESSION 6W / 2L   FKDR 4.00   GAMES 8/10');
    await saved();
    assert.equal(read().sessionGoalGames, 10);
    assert.equal(read().sessionRecapStyle, 'scoreboard');
    for (const target of [8, 20, 10]) {
        await page.$eval('#session-goal-games', (input, value) => {
            input.value = String(value);
            input.dispatchEvent(new Event('input', { bubbles: true }));
            input.dispatchEvent(new Event('change', { bubbles: true }));
        }, target);
        await ready(`GAMES 8/${target}`);
        await saved();
        assert.equal(read().sessionGoalGames, target, 'A completed target can be raised without resetting session progress');
    }
    const geometry = await page.evaluate(async () => {
        const { loadBitmapFont } = require('./src/launcher/renderer/launcher_session_card');
        const { chatCharWidth } = require('./src/stats/recapScoreboard');
        const font = await loadBitmapFont();
        const mismatches = [];
        for (let code = 32; code < 127; code++) {
            if (font.widths[code] + 1 !== chatCharWidth(String.fromCharCode(code))) mismatches.push(code);
        }
        const canvas = document.querySelector('#session-recap-preview canvas');
        return { width: canvas.width, height: canvas.height, mismatches,
            cssWidth: canvas.getBoundingClientRect().width, smoothing: canvas.getContext('2d').imageSmoothingEnabled };
    });
    assert.deepEqual(geometry, { width: 648, height: 98, mismatches: [], cssWidth: 648, smoothing: false });
    await capture('recap-session-and-goal');

    const toggle = async value => {
        await page.focus(`#session-recap-fields input[value="${value}"]`);
        await page.keyboard.press('Space');
        await saved();
    };
    for (const field of ['session_wins', 'session_losses', 'session_ratio']) await toggle(field);
    await ready('GAMES GOAL 8/10 [||||||||--]');
    assert(!read().sessionRecapFields.some(field => field.startsWith('session_')));
    await capture('recap-goal-only');
    await toggle('goals');
    await page.waitForFunction('document.querySelector("#session-recap-preview canvas")?.height === 80');
    assert(!read().sessionRecapFields.includes('goals'));
    assert(!await page.$eval('#session-games-goal-field', field => field.checkVisibility()));
    await capture('recap-game-only');
    await page.evaluate('refresh()');
    await page.waitForFunction('!refreshInFlight');
    assert(!await page.$eval('#session-recap-fields input[value="goals"]', input => input.checked));
    for (const field of ['session_wins', 'session_losses', 'session_ratio']) await toggle(field);
    await ready('SESSION 6W / 2L');
    assert(!await page.$eval('#session-recap-preview canvas', canvas => canvas.getAttribute('aria-label').includes('GAMES')));
    await capture('recap-session-only');
    await toggle('goals');
    await ready('GAMES 8/10');
    const absent = text => page.waitForFunction(expected => {
        const canvas = document.querySelector('#session-recap-preview canvas');
        return canvas && !canvas.getAttribute('aria-label').includes(expected);
    }, {}, text);
    for (const [field, text] of [['header', 'RECAP'], ['result', 'VICTORY'], ['duration', '11m 06s'],
        ['map', 'Map: Airshow'], ['mode', 'Solos'], ['finals', 'FINALS'], ['beds', 'BEDS'],
        ['kills', 'KILLS'], ['deaths', 'DEATHS'], ['session_wins', '6W'], ['session_losses', '2L'],
        ['session_ratio', 'FKDR']]) {
        await toggle(field);
        await absent(text);
        assert(!read().sessionRecapFields.includes(field));
        await page.evaluate('refresh()');
        await page.waitForFunction('!refreshInFlight');
        assert(!await page.$eval(`#session-recap-fields input[value="${field}"]`, input => input.checked));
        await toggle(field);
        await ready(text);
    }
    for (const [field, text] of [['final_deaths', 'FINAL KILLED'], ['beds_lost', 'BED LOST'],
        ['stars', 'STARS'], ['session_games', 'PLAYED 8']]) {
        await toggle(field);
        await ready(text);
    }
    await capture('recap-all-bedwars-fields');
    await (await page.$('.session-recap-designer')).screenshot({ path: path.join(output, 'recap-settings.png') });
    const selected = read().sessionRecapFields;
    for (const field of selected) await toggle(field);
    await page.waitForFunction(() => !document.querySelector('#session-recap-preview canvas'));
    assert.deepEqual(read().sessionRecapFields, []);
    await page.evaluate('refresh()');
    await page.waitForFunction('!refreshInFlight');
    assert.equal(await page.$$eval('#session-recap-fields input:checked', inputs => inputs.length), 0);
    assert(await page.$eval('#session-recap-preview', el => el.textContent.includes('Select information')));
    for (const field of require('../src/session/settings').SESSION_DEFAULTS.sessionRecapFields) await toggle(field);
    await ready('GAMES 8/10');
    await page.$eval('#game-recap-enabled', input => {
        input.checked = false; input.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await saved();
    assert(await page.$eval('#session-recap-preview', el => !el.querySelector('canvas') && el.textContent.includes('disabled')));
    await page.$eval('#game-recap-enabled', input => {
        input.checked = true; input.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await ready('GAMES 8/10');
    await saved();
    await page.setViewport({ width: 1100, height: 760, deviceScaleFactor: 1 });
    assert(await page.$eval('#session-recap-preview', el => {
        const canvas = el.querySelector('canvas');
        return canvas.width === canvas.getBoundingClientRect().width
            && ['auto', 'scroll'].includes(getComputedStyle(el).overflowX);
    }), 'Narrow layouts scroll the exact pixel preview instead of stretching glyphs');
    await capture('recap-minimum-width');
    console.log('PASS Recap bitmap widths, all field toggles, empty selection, keyboard input, persistence, refresh, disabled state and narrow layout');
};
