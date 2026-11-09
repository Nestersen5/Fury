'use strict';
const assert = require('assert'), fs = require('fs'), path = require('path');

// Exercises Design A's limit sliders through real pointer and keyboard input
// in the isolated launcher: curved positions, track presses, thumb drags,
// Shift fine control, Escape, keyboard steps, typed values, disabled state,
// autosave/reload, the Animations setting, themes and narrow layouts.
const SLIDERS = [['min-fkdr', 100, 'scan'], ['min-stars', 5000, 'scan'], ['min-sw-kdr', 100, 'scan'], ['min-sw-wlr', 20, 'scan'], ['min-sw-level', 200, 'scan'], ['auto-dodge-min-fkdr', 100, 'gameplay'], ['auto-dodge-min-stars', 5000, 'gameplay']];

module.exports = async function ({ page, output }) {
    const report = { checks: [], measurements: {} };
    const pass = text => { report.checks.push(text); console.log(`PASS ${text}`); };
    const settle = async () => {
        await page.waitForFunction('!featureSaveTimer && !featureSaveInFlight && !settingsSaveInFlight && !refreshInFlight');
        await page.evaluate(async () => { await ordinarySaveChain; await refresh(); });
    };
    const openScan = async () => {
        await page.evaluate(() => { activatePage('settings'); activateSettingsSubpage('scan', false); });
        if (await page.evaluate('ids.scanMode.value') !== 'threats') { await page.locator('[data-scan-mode="threats"]').click(); await settle(); }
    };
    const openDodge = async () => {
        await page.evaluate(() => { activatePage('settings'); activateSettingsSubpage('gameplay', false); });
        if (!await page.$eval('#auto-dodge-stat-threats', node => node.checked)) { await page.locator('label:has(#auto-dodge-stat-threats)').click(); await settle(); }
    };
    const setFull = motion => page.evaluate(m => { document.documentElement.dataset.motion = m; }, motion);
    // Geometry of one slider, read from the rendered thumb and fill.
    const geometry = id => page.$eval(`#design-a-${id}-range`, slider => {
        const control = slider.closest('.da-range-control'), box = control.getBoundingClientRect();
        const thumb = control.querySelector('.da-range-thumb').getBoundingClientRect(), fill = control.querySelector('.da-range-fill').getBoundingClientRect();
        const number = document.getElementById(slider.id.replace(/^design-a-|-range$/g, ''));
        return { left: box.left, width: box.width, y: box.top + box.height / 2, thumbX: thumb.left + thumb.width / 2, thumbWidth: control.querySelector('.da-range-thumb').offsetWidth, fillEnd: fill.right,
            p: Number(getComputedStyle(control).getPropertyValue('--da-p')), value: number.value, sliderValue: slider.value, max: Number(slider.max), min: Number(slider.min), step: slider.step,
            active: document.activeElement === slider, classes: control.className };
    });
    const typeValue = async (id, value) => {
        await page.$eval(`#${id}`, (node, v) => { node.focus(); node.value = v; node.dispatchEvent(new Event('input', { bubbles: true })); node.dispatchEvent(new Event('change', { bubbles: true })); node.blur(); }, String(value));
    };
    const trackEvents = id => page.$eval(`#${id}`, node => {
        window.__sliderEvents = { input: 0, change: 0 };
        if (!node.__sliderCounted) { node.__sliderCounted = true; node.addEventListener('input', () => window.__sliderEvents.input++); node.addEventListener('change', () => window.__sliderEvents.change++); }
    });
    const events = () => page.evaluate('({...window.__sliderEvents})');
    const waitStill = () => page.evaluate(() => new Promise(resolve => setTimeout(resolve, 320)));

    await openScan();
    await setFull('full');
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));

    // 1. Every visible limit has one enhanced slider tied to its number field.
    for (const [id, ceiling, category] of SLIDERS) {
        if (category === 'gameplay') await openDodge(); else await openScan();
        const shape = await page.$eval(`#${id}`, (number, ceiling) => {
            const label = number.closest('label.da-limit'), controls = label.querySelectorAll('.da-range-control'), slider = label.querySelector('.da-range-control > input.da-range');
            return { controls: controls.length, label: slider.getAttribute('aria-label'), min: slider.min, step: slider.step, max: Number(slider.max), value: Number(slider.value), number: Number(number.value), ceiling, hiddenThumb: label.querySelector('.da-range-thumb').getAttribute('aria-hidden') };
        }, ceiling);
        assert.strictEqual(shape.controls, 1, id);
        assert.ok(shape.label && shape.hiddenThumb === 'true', `${id} keeps one labelled native slider`);
        assert.strictEqual(shape.max, Math.max(ceiling, shape.number), `${id} max`);
        assert.strictEqual(shape.value, shape.number, `${id} value`);
    }
    pass('All seven limit sliders keep a labelled native range bound to their number field');

    // 2. Rendered thumb and fill follow the curved position at both ends and in between.
    await openScan();
    const original = { fkdr: await page.$eval('#min-fkdr', n => n.value), stars: await page.$eval('#min-stars', n => n.value) };
    for (const value of [0, 1, 4, 10, 37.5, 100]) {
        await typeValue('min-fkdr', value); await waitStill();
        const g = await geometry('min-fkdr');
        const expected = (value / 100) ** (1 / 2.5);
        assert.ok(Math.abs(g.p - expected) < 0.001, `curve at ${value}: ${g.p}`);
        const travel = g.width - g.thumbWidth, center = g.left + g.thumbWidth / 2 + travel * expected;
        assert.ok(Math.abs(g.thumbX - center) < 1.5, `thumb at ${value}: ${g.thumbX} vs ${center}`);
        assert.ok(Math.abs(g.fillEnd - center) < 1.5, `fill at ${value}: ${g.fillEnd} vs ${center}`);
    }
    pass('Thumb and fill share the curved position from 0 to the ceiling');

    // 3. Pressing the track glides there, keeps focus on the slider and saves once.
    await typeValue('min-fkdr', 2); await settle(); await waitStill();
    await trackEvents('min-fkdr');
    let g = await geometry('min-fkdr');
    const travel = g.width - g.thumbWidth, xAt = t => g.left + g.thumbWidth / 2 + travel * t;
    await page.mouse.click(xAt(0.4), g.y);
    let after = await geometry('min-fkdr');
    assert.ok(after.active, 'track press focuses the slider rather than the number field');
    report.measurements.focusRingAfterPointerPress = await page.$eval('#design-a-min-fkdr-range', n => n.matches(':focus-visible'));
    assert.ok(Math.abs(Number(after.value) - 100 * 0.4 ** 2.5) <= 0.5, `track press value ${after.value}`);
    assert.deepStrictEqual(await events(), { input: 1, change: 1 });
    await page.screenshot({ path: path.join(output, 'glide-midway.png'), clip: { x: g.left - 30, y: g.y - 80, width: g.width + 60, height: 120 } });
    await waitStill();
    after = await geometry('min-fkdr');
    assert.ok(Math.abs(after.thumbX - xAt(after.p)) < 1.5);
    await settle();
    pass(`Pressing the track at 40% sets FKDR ${after.value}, focuses the slider and fires one change`);

    // 4. Thumb drag keeps the grab offset; Shift drag is ten times finer.
    const drag = async ({ id, distance, shift = false, escape = false, steps = 20 }) => {
        await trackEvents(id);
        const start = await geometry(id), before = Number(start.value);
        await page.mouse.move(start.thumbX + 3, start.y);
        await page.mouse.down();
        const pressed = await geometry(id);
        assert.strictEqual(pressed.value, start.value, 'pressing the thumb does not jump');
        assert.ok(pressed.classes.includes('is-active'));
        if (shift) await page.keyboard.down('Shift');
        await page.mouse.move(start.thumbX + 3 + distance, start.y, { steps });
        const during = await geometry(id), duringMax = during.max;
        if (shift) assert.ok(during.classes.includes('is-fine'), 'fine mode is shown while Shift is held');
        assert.ok(during.classes.includes('is-dragging'));
        assert.ok(await page.$eval(`#${id}`, n => n.closest('.da-limit').classList.contains('is-adjusting')), 'the value highlights during a drag');
        const midEvents = await events();
        if (escape) await page.keyboard.press('Escape');
        if (shift) await page.keyboard.up('Shift');
        await page.mouse.up();
        const end = await geometry(id);
        assert.ok(!/is-(active|dragging|fine)/.test(end.classes));
        return { before, during: Number(during.value), duringMax, after: Number(end.value), midEvents, events: await events() };
    };
    await typeValue('min-fkdr', 2); await settle();
    const normal = await drag({ id: 'min-fkdr', distance: 40 });
    assert.ok(normal.after > normal.before && normal.midEvents.change === 0 && normal.events.change === 1 && normal.events.input >= 2, JSON.stringify(normal));
    await settle();
    await typeValue('min-fkdr', 2); await settle();
    const fine = await drag({ id: 'min-fkdr', distance: 40, shift: true });
    assert.ok(fine.after > fine.before && fine.events.change === 1, JSON.stringify(fine));
    const ratio = (normal.after - normal.before) / (fine.after - fine.before);
    assert.ok(ratio > 6, `fine ratio ${ratio}`);
    report.measurements.fkdrDrag40px = { normal: [normal.before, normal.after], fine: [fine.before, fine.after] };
    pass(`A 40px drag from FKDR 2 gives ${normal.after}; with Shift it gives ${fine.after}`);
    await settle();

    // Before: one pixel covered 0.23 FKDR across the whole linear 0-100 track.
    g = await geometry('min-fkdr');
    const pxPerTenth = value => 0.1 / (100 * 2.5 * ((value / 100) ** (1 / 2.5)) ** 1.5 / (g.width - g.thumbWidth));
    report.measurements.pxPerTenthFkdr = { before: (g.width - g.thumbWidth) / 1000, at2: pxPerTenth(2), at5: pxPerTenth(5), at10: pxPerTenth(10), fineAt5: pxPerTenth(5) * 10 };

    // 5. Escape cancels a drag: the starting value returns and one change
    // closes the edit, so autosave does not stay on "Editing…".
    await typeValue('min-fkdr', 3); await settle();
    const cancelled = await drag({ id: 'min-fkdr', distance: 60, escape: true });
    assert.ok(cancelled.during > 3 && cancelled.after === 3 && cancelled.events.change === 1, JSON.stringify(cancelled));
    await settle();
    assert.ok(await page.evaluate("!settingsSaveStates.has('min-fkdr') && !ordinaryDrafts.size && state.settings.scan.minFkdr === 3"), 'a cancelled drag leaves FKDR 3 saved and no edit open');
    // The same for a feature-owned limit, which keeps its own drafts.
    await openDodge();
    await typeValue('auto-dodge-min-fkdr', 3); await settle();
    const cancelledDodge = await drag({ id: 'auto-dodge-min-fkdr', distance: 60, escape: true });
    assert.ok(cancelledDodge.after === 3 && cancelledDodge.events.change === 1, JSON.stringify(cancelledDodge));
    await settle();
    assert.ok(await page.evaluate("!settingsSaveStates.has('auto-dodge-min-fkdr') && !featureDrafts.has(ids.autoDodgeMinFkdr) && state.settings.features.autoDodgeMinFkdr === 3"), 'a cancelled Auto Dodge drag leaves no edit open');
    await openScan();
    pass('Escape returns a drag to its starting value and closes the edit in both settings owners');

    // 6. Stars drags land on round numbers; Shift reaches single stars.
    await typeValue('min-stars', 400); await settle();
    const stars = await drag({ id: 'min-stars', distance: 120, steps: 30 });
    assert.ok(stars.after > 400 && stars.after % 5 === 0, JSON.stringify(stars));
    await settle();
    const starsFine = await drag({ id: 'min-stars', distance: 7, shift: true, steps: 7 });
    assert.ok(starsFine.after > stars.after && starsFine.after - stars.after < 20, JSON.stringify(starsFine));
    report.measurements.stars = { quickDrag: [stars.before, stars.after], fineDrag: [starsFine.before, starsFine.after] };
    pass(`Stars drag 400 -> ${stars.after}; a 7px Shift drag adds ${starsFine.after - stars.after}`);
    await settle();

    // 7. Keyboard: arrows step, Shift+arrows ten steps, Page keys a tenth of the track, Home/End.
    await typeValue('min-fkdr', 4); await settle();
    await page.focus('#min-fkdr'); await page.keyboard.press('Tab');
    assert.ok(await page.$eval('#design-a-min-fkdr-range', n => document.activeElement === n && n.matches(':focus-visible')), 'Tab reaches the slider after its value');
    const key = async (name, shift) => { await trackEvents('min-fkdr'); if (shift) await page.keyboard.down('Shift'); await page.keyboard.press(name); if (shift) await page.keyboard.up('Shift'); return { value: await page.$eval('#min-fkdr', n => n.value), events: await events() }; };
    let k = await key('ArrowRight'); assert.strictEqual(k.value, '4.1'); assert.strictEqual(k.events.change, 1);
    k = await key('ArrowLeft'); assert.strictEqual(k.value, '4');
    k = await key('ArrowRight', true); assert.strictEqual(k.value, '5'); assert.deepStrictEqual(k.events, { input: 1, change: 1 });
    k = await key('ArrowDown', true); assert.strictEqual(k.value, '4');
    const pages = [];
    for (let i = 0; i < 3; i++) pages.push((await key('PageUp')).value);
    assert.ok(pages.every((v, i) => Number(v) > (i ? Number(pages[i - 1]) : 4)), pages.join());
    k = await key('PageDown'); assert.ok(Number(k.value) < Number(pages[2]));
    k = await key('End'); assert.strictEqual(k.value, '100');
    k = await key('Home'); assert.strictEqual(k.value, '0');
    k = await key('Home'); assert.strictEqual(k.events.change, 0, 'no save when the value cannot move');
    await page.screenshot({ path: path.join(output, 'focus-visible.png'), clip: { x: g.left - 30, y: g.y - 80, width: g.width + 60, height: 120 } });
    report.measurements.pageUpFrom4 = pages;
    pass(`Keyboard: arrows 0.1, Shift+arrows 1, Page Up 4 -> ${pages.join(' -> ')}, Home/End`);
    await settle();

    // 8. A typed value above the ceiling extends the scale; a drag keeps that scale until release.
    await typeValue('min-fkdr', 150); await settle(); await waitStill();
    g = await geometry('min-fkdr');
    assert.strictEqual(g.max, 150); assert.ok(Math.abs(g.p - 1) < 0.001);
    const down = await drag({ id: 'min-fkdr', distance: -120 });
    assert.ok(down.after < 100 && down.duringMax === 150, JSON.stringify(down));
    g = await geometry('min-fkdr');
    assert.strictEqual(g.max, 100, 'the ceiling returns after release');
    pass(`Typed FKDR 150 extends the slider; dragging back gives ${down.after} and restores the 100 ceiling`);
    await settle();

    // 9. Disabled sliders ignore input and show their state.
    await page.$eval('#min-fkdr', n => { n.disabled = true; n.dispatchEvent(new Event('change')); });
    g = await geometry('min-fkdr');
    assert.ok(g.classes.includes('is-disabled'));
    await trackEvents('min-fkdr');
    await page.mouse.click(g.left + g.width * 0.8, g.y);
    assert.deepStrictEqual(await events(), { input: 0, change: 0 });
    await page.$eval('#min-fkdr', n => { n.disabled = false; n.dispatchEvent(new Event('change')); });
    pass('Disabled sliders ignore presses');

    // 10. Auto Dodge sliders use the same behavior and save through features.
    await openDodge();
    await typeValue('auto-dodge-min-fkdr', 3); await settle();
    const dodge = await drag({ id: 'auto-dodge-min-fkdr', distance: 30 });
    assert.ok(dodge.after > 3 && dodge.events.change === 1, JSON.stringify(dodge));
    await settle();

    // 11. Values survive autosave and a full reload.
    await openScan();
    await typeValue('min-fkdr', 2); await settle();
    await drag({ id: 'min-fkdr', distance: 25 }); await settle();
    const saved = { fkdr: await page.$eval('#min-fkdr', n => n.value), stars: await page.$eval('#min-stars', n => n.value), dodge: await page.$eval('#auto-dodge-min-fkdr', n => n.value) };
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForFunction('typeof furyDesign !== "undefined" && state?.viewedAccount');
    await openScan();
    assert.deepStrictEqual({ fkdr: await page.$eval('#min-fkdr', n => n.value), stars: await page.$eval('#min-stars', n => n.value), dodge: await page.$eval('#auto-dodge-min-fkdr', n => n.value) }, saved);
    g = await geometry('min-fkdr');
    assert.ok(Math.abs(g.p - (Number(saved.fkdr) / 100) ** 0.4) < 0.001);
    pass(`Auto Dodge drag saved ${dodge.after}; FKDR ${saved.fkdr}, Stars ${saved.stars} and Auto Dodge FKDR ${saved.dodge} survive reload`);

    // 12. The Animations setting controls the glide; reduced motion is instant.
    const motion = await page.evaluate(() => {
        const control = document.querySelector('.da-range-control'), read = () => getComputedStyle(control).transitionDuration;
        const previous = document.documentElement.dataset.motion;
        document.documentElement.dataset.motion = 'full'; const full = read();
        document.documentElement.dataset.motion = 'reduced'; const reduced = read();
        document.documentElement.dataset.motion = previous; return { full, reduced };
    });
    assert.strictEqual(motion.full, '0.22s'); assert.ok(parseFloat(motion.reduced) < 0.001, motion.reduced);
    pass('Glides follow the Animations setting');

    // 13. Rendered states in both themes at normal and narrow widths.
    await setFull('full');
    for (const theme of ['dark', 'light']) {
        await page.evaluate(t => NesterTheme.apply(t, false), theme);
        for (const width of [1440, 1040]) {
            await page.setViewport({ width, height: 900, deviceScaleFactor: 1 });
            for (const [open, selector, name] of [[openScan, '.share-threshold-panel', 'scan'], [openDodge, '.ds-dodge-limits', 'dodge']]) {
                await open();
                const host = await page.$(selector);
                await host.evaluate(n => n.scrollIntoView({ block: 'center' }));
                assert.ok(await page.$eval('[data-settings-subpage].active', pane => pane.scrollWidth <= pane.clientWidth), 'sliders fit the page');
                await waitStill();
                await host.screenshot({ path: path.join(output, `${name}-${theme}-${width}.png`) });
            }
            if (theme === 'dark' && width === 1440) {
                await page.setViewport({ width, height: 900, deviceScaleFactor: 2 });
                await openScan();
                g = await geometry('min-stars');
                const look = () => page.$eval('#design-a-min-stars-range', slider => {
                    const thumb = getComputedStyle(slider.parentElement.querySelector('.da-range-thumb'));
                    return { scale: thumb.scale, shadow: thumb.boxShadow, number: getComputedStyle(document.getElementById('min-stars')).backgroundColor };
                });
                await page.mouse.move(g.thumbX, g.y); await waitStill();
                const clip = { x: g.left - 30, y: g.y - 90, width: g.width + 60, height: 130 };
                const hover = await look();
                assert.strictEqual(hover.scale, '1.08'); assert.strictEqual(hover.number, 'rgba(0, 0, 0, 0)', 'hovering the slider leaves the number field plain');
                await page.screenshot({ path: path.join(output, 'state-hover.png'), clip });
                await page.mouse.down(); await page.mouse.move(g.thumbX + 30, g.y, { steps: 6 }); await waitStill();
                assert.strictEqual((await look()).scale, '1.16', 'pressed thumb style wins over hover');
                await page.screenshot({ path: path.join(output, 'state-dragging.png'), clip });
                await page.keyboard.down('Shift'); await page.mouse.move(g.thumbX + 40, g.y, { steps: 4 }); await waitStill();
                assert.strictEqual((await look()).scale, '0.9', 'fine thumb style wins over pressed');
                await page.screenshot({ path: path.join(output, 'state-fine.png'), clip });
                await page.keyboard.press('Escape'); await page.keyboard.up('Shift'); await page.mouse.up();
                const numberBox = await page.$eval('#min-stars', n => { const r = n.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; });
                await page.mouse.move(numberBox.x, numberBox.y); await waitStill();
                assert.notStrictEqual((await look()).number, 'rgba(0, 0, 0, 0)', 'hovering the number shows it can be typed in');
                await page.screenshot({ path: path.join(output, 'state-number-hover.png'), clip });
                await page.mouse.move(5, 5);
                await page.setViewport({ width, height: 900, deviceScaleFactor: 1 });
            }
        }
    }
    await page.setViewport({ width: 1440, height: 900, deviceScaleFactor: 1 });
    await page.evaluate(() => NesterTheme.apply('dark', false));
    pass('Rendered dark/light sliders at 1440px and 1040px, plus hover, drag and fine states');

    // 14. Drag cost: the same 60-move drag on the previous native slider
    // (rebuilt from its original code and CSS on the same field) and the new one.
    const session = await page.target().createCDPSession();
    await session.send('Performance.enable');
    const metrics = async () => Object.fromEntries((await session.send('Performance.getMetrics')).metrics.map(m => [m.name, m.value]));
    const thumbPoint = selector => page.$eval(selector, s => {
        const control = s.closest('.da-range-control');
        if (control) { const t = control.querySelector('.da-range-thumb').getBoundingClientRect(); return { x: t.left + t.width / 2, y: t.top + t.height / 2 }; }
        const r = s.getBoundingClientRect(), p = (s.value - s.min) / (s.max - s.min);
        return { x: r.left + 11 + (r.width - 22) * p, y: r.top + r.height / 2 };
    });
    const measure = async selector => {
        await typeValue('min-fkdr', 2); await settle(); await waitStill();
        const at = await thumbPoint(selector);
        await page.mouse.move(at.x, at.y); await page.mouse.down();
        const a = await metrics(), startValue = await page.$eval('#min-fkdr', n => n.value);
        await page.mouse.move(at.x + 180, at.y, { steps: 60 });
        const b = await metrics(), endValue = await page.$eval('#min-fkdr', n => n.value);
        await page.mouse.up(); await settle();
        return { values: [startValue, endValue], layouts: b.LayoutCount - a.LayoutCount, styles: b.RecalcStyleCount - a.RecalcStyleCount, layoutMs: +((b.LayoutDuration - a.LayoutDuration) * 1000).toFixed(2), styleMs: +((b.RecalcStyleDuration - a.RecalcStyleDuration) * 1000).toFixed(2), scriptMs: +((b.ScriptDuration - a.ScriptDuration) * 1000).toFixed(2), taskMs: +((b.TaskDuration - a.TaskDuration) * 1000).toFixed(2) };
    };
    await openScan();
    const installLegacy = () => page.evaluate(() => {
        const input = document.getElementById('min-fkdr'), label = input.closest('label'), ceiling = 100, control = label.querySelector('.da-range-control');
        const style = document.createElement('style');
        style.textContent = `#fury-design-a .legacy-range { grid-column:1/-1!important;width:100%!important;min-height:8px!important;height:8px!important;margin:3px 0!important;padding:0!important;border:0!important;appearance:none!important;border-radius:6px!important;background:linear-gradient(to right,var(--fury-gold) var(--da-progress),color-mix(in srgb,var(--fury-text) 12%,transparent) var(--da-progress))!important;cursor:pointer; }
#fury-design-a .legacy-range::-webkit-slider-thumb { appearance:none;width:22px;height:22px;background:white;border-radius:50%;border:0; }`;
        document.head.append(style);
        const slider = document.createElement('input'); slider.className = 'legacy-range'; slider.type = 'range'; slider.id = 'legacy-range';
        slider.min = input.min || '0'; slider.step = input.step || '1'; control.hidden = true; label.append(slider);
        let previous = '';
        function sync() { const signature = `${input.value}:${input.disabled}`; if (signature === previous) return; previous = signature; const value = Number(input.value) || 0; slider.max = String(Math.max(ceiling, value)); if (slider.value !== input.value) slider.value = input.value; slider.disabled = input.disabled; slider.style.setProperty('--da-progress', `${(value - Number(slider.min)) / (Number(slider.max) - Number(slider.min) || 1) * 100}%`); }
        slider.addEventListener('input', () => { input.value = slider.value; input.dispatchEvent(new Event('input', { bubbles: true })); sync(); });
        slider.addEventListener('change', () => input.dispatchEvent(new Event('change', { bubbles: true })));
        input.addEventListener('input', sync); input.addEventListener('change', sync); sync();
        window.__removeLegacyRange = () => { input.removeEventListener('input', sync); input.removeEventListener('change', sync); slider.remove(); style.remove(); control.hidden = false; };
    });
    // Interleave the runs so warm-up and garbage collection affect both alike.
    const before = [], afterRuns = [];
    for (let run = 0; run < 7; run++) {
        await installLegacy(); before.push(await measure('#legacy-range'));
        await page.evaluate(() => window.__removeLegacyRange()); afterRuns.push(await measure('#design-a-min-fkdr-range'));
    }
    const median = (runs, key) => { const sorted = runs.map(r => r[key]).sort((a, b) => a - b); return sorted[sorted.length >> 1]; };
    const summary = runs => Object.fromEntries(['layouts', 'styles', 'layoutMs', 'styleMs', 'scriptMs', 'taskMs'].map(key => [key, median(runs, key)]));
    report.measurements.drag60 = { before, after: afterRuns, medianBefore: summary(before), medianAfter: summary(afterRuns) };
    console.log('DRAG60 median before', JSON.stringify(summary(before)), before[0].values.join('->'));
    console.log('DRAG60 median after ', JSON.stringify(summary(afterRuns)), afterRuns[0].values.join('->'));

    await typeValue('min-fkdr', original.fkdr); await typeValue('min-stars', original.stars); await settle();
    assert.deepStrictEqual(errors, []);
    fs.writeFileSync(path.join(output, 'VERIFICATION.json'), JSON.stringify(report, null, 2));
    console.log('MEASUREMENTS', JSON.stringify(report.measurements));
};
