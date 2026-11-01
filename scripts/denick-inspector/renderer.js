'use strict';

const $ = id => document.getElementById(id);
const settingNames = ['lookupRange', 'lookupLimit', 'verifyLimit', 'verifyFinalsBehind', 'verifyFinalsAhead', 'verifyBedsBehind', 'verifyBedsAhead', 'singleStatFallbackRange', 'bedsGapAllowancePercent', 'candidateMode'];
let report = null, defaults = null, busy = false;
const selected = new Set();
const count = value => value === undefined || value === null ? '—' : Number(value).toLocaleString('en-US');
const delta = value => value === null || value === undefined ? '—' : `${value > 0 ? '+' : ''}${count(value)}`;
function date(value) {
    if (!value) return 'date not provided';
    const numeric = Number(value);
    const parsed = new Date(Number.isFinite(numeric) ? numeric < 1e12 ? numeric * 1000 : numeric : value);
    return Number.isNaN(parsed.getTime()) ? String(value) : parsed.toLocaleString();
}
function node(tag, text, className) {
    const element = document.createElement(tag);
    if (text !== undefined) element.textContent = text;
    if (className) element.className = className;
    return element;
}
function payload() {
    const settings = Object.fromEntries(settingNames.map(name => [name, name === 'candidateMode' ? $(name).value : Number($(name).value)]));
    return { targets: { finals: $('finals').value.trim(), beds: $('beds').value.trim() }, settings,
        force: $('force').checked, budget: Number($('budget').value), names: [...selected] };
}
function status(message, error = false) {
    $('status').textContent = message;
    $('status').classList.toggle('error', error);
}
function showInfo(data) {
    if (!data) return;
    if (data.defaults) defaults = data.defaults;
    if (data.configured) $('connection').textContent = `${data.fixture ? 'OFFLINE FIXTURE · ' : ''}Aurora key: ${data.configured.aurora ? 'configured' : 'missing'} · Hypixel key: ${data.configured.hypixel ? 'configured' : 'missing'}${data.directory ? ` · ${data.directory}` : ''}`;
    if (data.usage) $('usage').textContent = `Requests this session · Aurora ${data.usage.aurora} · Minecraft ${data.usage.mojang} · Hypixel ${data.usage.hypixel} · Cache hits ${data.usage.cacheHits}`;
}
async function perform(action, message, body = payload()) {
    if (busy) return;
    busy = true;
    document.body.setAttribute('aria-busy', 'true');
    document.querySelectorAll('button,input,select').forEach(element => { element.disabled = true; });
    $('stop').disabled = false;
    status(message);
    try {
        const response = await window.inspector.action(action, body);
        if (!response.ok) { showInfo(response.info); throw new Error(response.error); }
        const data = response.data;
        showInfo(data);
        if (['fetch', 'analyze', 'verify'].includes(action)) { report = data; render(); }
        if (action === 'fetch') status('Aurora lists loaded. Select candidates to verify, or re-analyze with different rules.');
        if (action === 'analyze') status('Re-analyzed cached data. No API requests sent.');
        if (action === 'verify') {
            const errors = data.checks.filter(check => check.status === 'error');
            const budgeted = data.checks.filter(check => check.status === 'budget').length;
            status(errors.length ? errors[0].message : `Verification complete · ${data.freshProfiles} fresh profile check(s)${budgeted ? ` · ${budgeted} skipped by budget` : ''}.`, Boolean(errors.length));
        }
        if (action === 'player') {
            $('finals').value = data.player.finals;
            $('beds').value = data.player.beds;
            status(`Loaded ${data.player.name}: ${count(data.player.finals)} finals, ${count(data.player.beds)} beds · ${data.fromCache ? 'cached' : 'live Hypixel'} · ${date(data.timestamp)}. Fetch Aurora lists next.`);
        }
        if (action === 'folder') {
            report = null; selected.clear(); $('results').hidden = true;
            status('Data folder selected. No API requests sent.');
        }
        if (action === 'export') status(data.saved ? 'Report saved. No API keys are included.' : 'Export cancelled.');
        return data;
    } catch (error) { status(error.message || 'The action failed.', true); }
    finally {
        busy = false;
        document.body.removeAttribute('aria-busy');
        document.querySelectorAll('button,input,select').forEach(element => { element.disabled = false; });
        $('export').disabled = !report;
        $('verify').disabled = !report?.rows.length;
        $('stop').disabled = true;
    }
}
function render() {
    $('results').hidden = false;
    $('outcome').textContent = report.outcome;
    $('mode').textContent = report.experimental ? 'Experiment · Fury settings unchanged' : 'Current proxy rules';
    $('coverage').textContent = report.coverageNote || '';
    $('stale').hidden = !report.stale;
    $('stale').textContent = `Cached lists were fetched for ${Object.entries(report.discoveryTargets || {}).map(([stat, value]) => `${count(value)} ${stat}`).join(' and ')}. Counts, search range or candidate limit have changed; fetch Aurora again to update discovery.`;
    const table = $('candidates');
    table.replaceChildren();
    const currentNames = new Set(report.rows.map(row => row.name.toLowerCase()));
    for (const name of selected) if (!currentNames.has(name)) selected.delete(name);
    const referenceSelect = $('aurora-reference');
    const previousReference = referenceSelect.value;
    referenceSelect.replaceChildren();
    const enteredOption = node('option', 'Entered counts'); enteredOption.value = '@detected'; referenceSelect.append(enteredOption);
    for (const row of report.rows) {
        const option = node('option', row.name); option.value = row.name.toLowerCase(); referenceSelect.append(option);
    }
    referenceSelect.value = currentNames.has(previousReference) ? previousReference : '@detected';
    const referenceRow = report.rows.find(row => row.name.toLowerCase() === referenceSelect.value);
    const referenceLabel = referenceRow ? referenceRow.name : 'entered counts';
    const reference = referenceRow ? { finals: referenceRow.aurora.finals?.value, beds: referenceRow.aurora.beds?.value } : report.targets;
    const differences = [];
    for (const row of report.rows) {
        const tr = node('tr');
        const choice = node('td'), checkbox = node('input');
        checkbox.type = 'checkbox'; checkbox.checked = selected.has(row.name.toLowerCase());
        checkbox.setAttribute('aria-label', `Verify ${row.name}`);
        checkbox.addEventListener('change', () => { if (checkbox.checked) selected.add(row.name.toLowerCase()); else selected.delete(row.name.toLowerCase()); });
        choice.append(checkbox); tr.append(choice);
        const identity = node('td', row.name);
        identity.append(node('span', row.sources.join(' + ') + (row.position ? ` · verification position ${row.position}` : ''), 'sub'));
        tr.append(identity);
        for (const stat of ['finals', 'beds']) {
            const cell = node('td', count(row.aurora[stat]?.value));
            if (row.aurora[stat]) cell.append(node('span', `#${row.aurora[stat].position} · ${date(row.aurora[stat].lastUpdated)}`, 'sub'));
            tr.append(cell);
        }
        const auroraDeltas = Object.fromEntries(['finals', 'beds'].map(stat => {
            const value = row.aurora[stat]?.value, baseline = reference[stat];
            return [stat, Number.isFinite(value) && Number.isFinite(baseline) ? value - baseline : null];
        }));
        differences.push({ name: row.name, ...auroraDeltas });
        const auroraComparison = node('td', `${delta(auroraDeltas.finals)} / ${delta(auroraDeltas.beds)}`, 'aurora-comparison');
        auroraComparison.append(node('span', `vs ${referenceLabel}`, 'sub'));
        tr.append(auroraComparison);
        for (const stat of ['finals', 'beds']) {
            const cell = node('td', count(row.profile?.[stat]));
            if (row.profile) cell.append(node('span', `checked ${date(row.profile.fetchedAt)}`, 'sub'));
            tr.append(cell);
        }
        tr.append(node('td', `${delta(row.deltas?.finals)} / ${delta(row.deltas?.beds)}`));
        const verdict = node('td', row.proxyStatus, row.status);
        if (row.priority) verdict.append(node('span', `Priority: ${row.priority.reason}; known difference ${count(row.priority.score)}`, 'sub'));
        verdict.append(node('span', row.chatStatus, 'sub'));
        if (row.cachedVerdict) verdict.append(node('span', `Cached comparison: ${row.cachedVerdict}`, 'sub'));
        tr.append(verdict); table.append(tr);
    }
    report.auroraComparison = { reference: referenceSelect.value, referenceLabel, differences };
    if (!report.rows.length) { const tr = node('tr'), cell = node('td', 'No players returned by these Aurora searches.'); cell.colSpan = 9; tr.append(cell); table.append(tr); }
    $('checks').textContent = (report.checks || []).map(check => `${check.name}: ${check.status}${check.fromCache ? ' (cache)' : ''}${check.message ? ` — ${check.message}` : ''}`).join(' · ');
    $('discovery-lists').replaceChildren();
    for (const list of report.lists) {
        $('discovery-lists').append(node('p', `${list.stat}: requested max ${list.requestedMax}, returned ${list.rows.length} · ${list.fromCache ? 'cached response' : 'live response'} · fetched ${date(list.fetchedAt)}`));
        $('discovery-lists').append(node('pre', JSON.stringify(list.rows, null, 2)));
    }
    $('trace').textContent = JSON.stringify({ events: report.events, result: report.result }, null, 2);
}
function selectRows(predicate) {
    selected.clear();
    for (const row of report?.rows || []) if (predicate(row)) selected.add(row.name.toLowerCase());
    if (report) render();
}
$('fetch').addEventListener('click', () => { selected.clear(); perform('fetch', 'Fetching Aurora lists. No Hypixel verification will be sent.'); });
$('stop').addEventListener('click', () => { window.inspector.action('cancel'); $('stop').disabled = true; status('Stopping current requests…'); });
$('analyze').addEventListener('click', () => perform('analyze', 'Re-analyzing cached lists and profiles…'));
$('verify').addEventListener('click', () => perform('verify', `Verifying ${selected.size} selected player(s), with a budget of ${$('budget').value} fresh profiles…`));
$('load-player').addEventListener('click', () => perform('player', 'Fetching this player’s Hypixel counts…', { name: $('player').value, force: $('force').checked }));
$('folder').addEventListener('click', () => perform('folder', 'Choosing a Fury data folder…', {}));
$('export').addEventListener('click', () => perform('export', 'Saving report…', report));
$('defaults').addEventListener('click', () => {
    for (const name of settingNames) $(name).value = defaults?.[name] ?? '';
    status('Current proxy rules restored in this inspector. Click Re-analyze to apply; no requests sent.');
});
$('select-all').addEventListener('click', () => selectRows(() => true));
$('select-none').addEventListener('click', () => selectRows(() => false));
$('aurora-reference').addEventListener('change', render);
$('select-considered').addEventListener('click', () => {
    let remaining = Number($('budget').value);
    selectRows(row => row.considered && row.position <= Number($('verifyLimit').value) && !row.profile && remaining-- > 0);
});
perform('info', 'Reading local configuration…', {}).then(() => {
    for (const name of settingNames) if (defaults?.[name] !== undefined) $(name).value = defaults[name];
    status('Ready. No API requests sent. Load a player or enter counts, then fetch Aurora lists.');
});
