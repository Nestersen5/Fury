'use strict';

const { normalizeSettings, validate, hasFilters } = require('../../nick/settings');

function mount({ document, invoke }) {
    const form = document.getElementById('nickroll-form');
    const field = (name, title, control, hint = '') => `<label for="nickroll-${name}">${title}${control.replace('<input ', `<input id="nickroll-${name}" name="${name}" `).replace('<select>', `<select id="nickroll-${name}" name="${name}">`).replace('<textarea ', `<textarea id="nickroll-${name}" name="${name}" `)}${hint ? `<small>${hint}</small>` : ''}</label>`;
    const number = (name, title, min, max, hint) => field(name, title, `<input type="number" min="${min}" max="${max}" required>`, hint);
    const select = (name, title, entries, hint) => field(name, title, `<select>${entries.map(([value, label]) => `<option value="${value}">${label}</option>`).join('')}</select>`, hint);
    const ruleOptions = [['any', 'Allowed'], ['exclude', 'Excluded'], ['require', 'At least one required']];
    form.innerHTML = `<fieldset id="nickroll-controls" disabled>
        <section class="panel"><h3>Matching</h3><p class="note">OG and word matches bypass name filters.</p>
        <div class="feature-card"><div><h3>Include OG names</h3><small>Repeated-letter names, e.g. Cooool or Shhh.</small></div><div class="feature-toggle"><label class="switch"><input name="ogEnabled" type="checkbox" aria-label="Include OG names"><span class="switch-track"></span><span class="switch-thumb"></span><span class="switch-label">ON</span></label></div></div></section>
        <section class="panel"><h3>Name filters</h3><p class="note">All active filters must match.</p>
        <div class="nickroll-filter-options">${['Length', 'Characters', 'Rules'].map(label => `<label class="fury-chip"><input type="checkbox" name="enable${label}" aria-controls="nickroll-${label.toLowerCase()}-fields"><span class="fury-chip-label">${label}</span></label>`).join('')}</div>
        <fieldset id="nickroll-length-fields" class="nickroll-grid nickroll-filter-fields" hidden disabled>
        <legend>Length</legend>${number('min', 'Minimum length', 3, 16)}${number('max', 'Maximum length', 3, 16)}
        </fieldset>
        <fieldset id="nickroll-characters-fields" class="nickroll-grid nickroll-filter-fields" hidden disabled>
        <legend>Characters</legend>${select('digits', 'Numbers', ruleOptions)}${select('underscores', 'Underscores', ruleOptions)}
        </fieldset>
        <fieldset id="nickroll-rules-fields" class="nickroll-grid nickroll-filter-fields" hidden disabled>
        <legend>Rules</legend>${['prefix', 'suffix', 'contains'].map((key, i) => field(key, ['Starts with', 'Ends with', 'Contains words'][i], '<input type="text" maxlength="16" pattern="[a-zA-Z0-9_]*" placeholder="No restriction">')).join('')}
        </fieldset></section>
        <section class="panel"><h3>Word matches</h3><div class="nickroll-grid">
        <div class="nickroll-word-editor"><label for="nickroll-words-entry">Any of these words</label><div class="nickroll-tokens" data-tokens="words" role="list" aria-label="Saved words"></div><input type="hidden" name="words"><input id="nickroll-words-entry" data-token-entry="words" placeholder="Add a word" autocomplete="off"><small>Press Enter or comma to add.</small></div>
        <div class="nickroll-word-editor"><label for="nickroll-groups-entry">All words in a group</label><div class="nickroll-tokens" data-tokens="wordGroups" role="list" aria-label="Saved word groups"></div><input type="hidden" name="wordGroups"><input id="nickroll-groups-entry" data-token-entry="wordGroups" placeholder="fresh head" autocomplete="off"><small>Separate words with spaces. Enter adds the group.</small></div>
        </div></section>
        <section class="panel"><h3>Rank &amp; skin</h3><div class="nickroll-grid">
        ${select('rank', 'Nickname rank', [['NONE', 'No rank'], ['VIP', 'VIP'], ['VIP_PLUS', 'VIP+'], ['MVP', 'MVP'], ['MVP_PLUS', 'MVP+']])}
        ${select('skinMode', 'Skin', [['random', 'Random Hypixel preset'], ['actual', 'Your current skin'], ['previous', 'Previously selected preset']])}
        </div></section>
        <p id="nickroll-skin-hint" class="note" hidden>Choose a preset in Hypixel's /nick menu first.</p>
        </fieldset><p id="nickroll-save-status" class="note" role="status" aria-live="polite">Loading settings…</p>`;
    const controls = form.querySelector('fieldset'), status = form.querySelector('[role="status"]');
    const input = name => form.elements.namedItem(name);
    let latest = null, key = '', dirty = false, saving = false;
    let timer = null, inFlight = null, revision = 0, attempted = -1, saveFailure = null;
    const filterGroups = {
        Length: { min: 3, max: 16 },
        Characters: { digits: 'any', underscores: 'any' },
        Rules: { prefix: '', suffix: '', contains: '' }
    };
    function syncGroup(name, reset = false) {
        const enabled = input(`enable${name}`).checked;
        const fields = form.querySelector(`#nickroll-${name.toLowerCase()}-fields`);
        fields.hidden = !enabled; fields.disabled = !enabled;
        if (!enabled && reset) for (const [key, value] of Object.entries(filterGroups[name])) input(key).value = value;
    }
    const splitWords = value => [...new Set(value.toLowerCase().split(/[\s,]+/).filter(Boolean))];
    const tokenEntries = [...form.querySelectorAll('[data-token-entry]')];
    function tokens(name) {
        return name === 'words' ? splitWords(input(name).value)
            : input(name).value.split(/\r?\n/).filter(Boolean).map(splitWords);
    }
    function setTokens(name, values) {
        input(name).value = name === 'words' ? values.join(', ') : values.map(group => group.join(' ')).join('\n');
        renderTokens(name);
    }
    function renderTokens(name) {
        const list = form.querySelector(`[data-tokens="${name}"]`);
        list.replaceChildren();
        tokens(name).forEach((value, index) => {
            const label = Array.isArray(value) ? value.join(' + ') : value;
            const chip = document.createElement('span'); chip.className = 'nickroll-token'; chip.setAttribute('role', 'listitem');
            const text = document.createElement('span'); text.textContent = label;
            const remove = document.createElement('button'); remove.type = 'button'; remove.textContent = '\u00d7';
            remove.setAttribute('aria-label', `Remove ${label}`);
            remove.addEventListener('click', () => {
                const values = tokens(name); values.splice(index, 1); setTokens(name, values);
                const buttons = list.querySelectorAll('button');
                (buttons[Math.min(index, buttons.length - 1)] || form.querySelector(`[data-token-entry="${name}"]`)).focus();
                schedule({ type: 'change', target: input(name) });
            });
            chip.append(text, remove); list.append(chip);
        });
    }
    function commitTokens(entry) {
        if (!entry.value.trim()) return true;
        const name = entry.dataset.tokenEntry, added = splitWords(entry.value), values = tokens(name);
        const next = name === 'words' ? [...new Set([...values, ...added])]
            : values.some(group => group.length === added.length && group.every(word => added.includes(word))) ? values : [...values, added];
        try { validate({ ...latest, [name]: next }); }
        catch (error) { entry.setCustomValidity(error.message); status.textContent = error.message; return false; }
        entry.setCustomValidity(''); entry.value = ''; setTokens(name, next);
        schedule({ type: 'change', target: input(name) });
        return true;
    }
    tokenEntries.forEach(entry => {
        entry.addEventListener('input', event => { event.stopPropagation(); entry.setCustomValidity(''); });
        entry.addEventListener('change', event => event.stopPropagation());
        entry.addEventListener('keydown', event => {
            if (!event.isComposing && (event.key === 'Enter' || (event.key === ',' && entry.dataset.tokenEntry === 'words'))) {
                event.preventDefault(); commitTokens(entry);
            }
        });
        entry.addEventListener('focusout', () => commitTokens(entry));
    });
    function syncSkin() {
        if (input('rank').dataset.rank !== input('rank').value) {
            input('rank').dataset.rank = input('rank').value;
            input('rank').dispatchEvent(new Event('select-display-change'));
        }
        form.querySelector('#nickroll-skin-hint').hidden = input('skinMode').value !== 'previous';
        form.querySelector('.switch-label').textContent = input('ogEnabled').checked ? 'ON' : 'OFF';
    }
    function fill(settings) {
        for (const name of ['min', 'max', 'digits', 'underscores', 'prefix', 'suffix', 'contains', 'rank']) input(name).value = settings[name];
        input('ogEnabled').checked = settings.ogEnabled;
        for (const [name, defaults] of Object.entries(filterGroups)) {
            input(`enable${name}`).checked = Object.entries(defaults).some(([key, value]) => settings[key] !== value);
            syncGroup(name);
        }
        input('words').value = settings.words.join(', ');
        input('wordGroups').value = settings.wordGroups.map(group => group.join(' ')).join('\n');
        renderTokens('words'); renderTokens('wordGroups');
        const skin = input('skinMode');
        skin.querySelector('[data-legacy]')?.remove();
        if (!['random', 'actual', 'previous'].includes(settings.skin)) {
            const option = document.createElement('option');
            option.value = settings.skin; option.textContent = `Saved preset (${settings.skin})`; option.dataset.legacy = 'true'; skin.append(option);
        }
        skin.value = settings.skin;
        skin.dispatchEvent(new Event('select-display-change'));
        syncSkin();
    }
    function schedule(event) {
        for (const name of Object.keys(filterGroups)) if (event.target === input(`enable${name}`)) syncGroup(name, true);
        dirty = true; revision++;
        status.textContent = 'Unsaved changes';
        syncSkin();
        clearTimeout(timer);
        const immediate = event.type === 'change' || event.target.type === 'checkbox' || event.target.tagName === 'SELECT';
        if (immediate) { timer = null; void save(); }
        else timer = setTimeout(() => { timer = null; void save(); }, 500);
    }
    form.addEventListener('input', schedule);
    form.addEventListener('change', schedule);
    form.addEventListener('focusout', () => {
        if (timer) { clearTimeout(timer); timer = null; void save(); }
    });
    form.addEventListener('submit', event => { event.preventDefault(); clearTimeout(timer); timer = null; void save(); });
    function save() {
        if (inFlight) return inFlight.then(() => dirty && revision !== attempted ? save() : undefined);
        if (!latest || !dirty) return Promise.resolve();
        attempted = revision;
        if (!form.checkValidity()) {
            status.textContent = `Not saved: ${form.querySelector(':invalid')?.validationMessage || 'Check the highlighted fields.'}`;
            return Promise.resolve();
        }
        inFlight = persist();
        return inFlight.finally(() => { inFlight = null; });
    }
    async function persist() {
        const savedRevision = revision;
        const words = value => [...new Set(value.toLowerCase().split(/[\s,]+/).filter(Boolean))];
        try {
            const next = { ...latest };
            for (const name of ['min', 'max']) next[name] = Number(input(name).value);
            for (const name of ['digits', 'underscores', 'prefix', 'suffix', 'contains']) next[name] = input(name).value.trim().toLowerCase();
            next.rank = input('rank').value;
            next.ogEnabled = input('ogEnabled').checked;
            next.adaptive = true;
            next.skin = input('skinMode').value;
            next.words = words(input('words').value);
            next.wordGroups = input('wordGroups').value.split(/\r?\n/).filter(line => line.trim()).map(words);
            validate(next);
            if (JSON.stringify(next) === key) { dirty = false; saveFailure = null; status.textContent = 'Saved.'; return; }
            saving = true; status.textContent = 'Saving…';
            await invoke('settings:save-features', { features: { nickRoll: next } });
            latest = next; key = JSON.stringify(next); dirty = revision !== savedRevision; saveFailure = null;
            if (dirty) { status.textContent = 'Unsaved changes'; return; }
            status.textContent = !next.ogEnabled && !next.words.length && !next.wordGroups.length && !hasFilters(next)
                ? 'Saved. No matching rules are enabled; rolling will not stop for a name until you enable a rule.'
                : 'Saved. These settings will be used on your next run.';
        } catch (error) {
            if (saving) saveFailure = error;
            status.textContent = `Could not save: ${error.message}`;
        }
        finally { saving = false; controls.disabled = !latest; }
    }
    return { async flush() {
        tokenEntries.forEach(commitTokens);
        clearTimeout(timer); timer = null;
        await save();
        if (saveFailure) throw saveFailure;
    }, update(state) {
        if (!state.settings?.features) return;
        latest = normalizeSettings(state.settings.features.nickRoll);
        const nextKey = JSON.stringify(latest);
        if (!saving && !dirty && !tokenEntries.some(entry => entry.value) && key !== nextKey) { key = nextKey; fill(latest); controls.disabled = false; status.textContent = ''; }
    } };
}

module.exports = { mount };
