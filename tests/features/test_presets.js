const assert = require('assert');
const os = require('os');
const path = require('path');
const { defaults } = require('../../app_config.js');

const {
    createProfileStore,
    normalizePresetName,
    filterPresetSettings,
    unknownPresetKeys,
    diffSettings,
    splitByNamespace,
    namespaceForKey,
    normalizeStore,
    PRESET_SETTING_KEYS,
    EXCLUDED_KEYS,
    describeProfileSettings,
    profileSettingLabel,
    missingProfileSettingKeys,
    builtInProfiles
} = require('../../src/profiles/profileStore.js');
const {
    renderPresetList,
    renderPresetDiff,
    renderPresetApplied,
    renderPresetStatus,
    settingLabel,
    formatValue
} = require('../../src/profiles/presetRender.js');

function tempFile(name) {
    return path.join(os.tmpdir(), `nester_test_${name}_${process.pid}.json`);
}

function makeStore(overrides = {}) {
    const writes = [];
    const store = createProfileStore({
        profileFile: tempFile('presets'),
        writeJsonOffThread: (file, value) => writes.push(value),
        saveDelayMs: 0,
        now: () => 1000,
        ...overrides
    });
    return { store, writes };
}

function fakeClient() {
    const lines = [];
    const commands = [];
    return {
        lines,
        text: () => lines.join('\n'),
        clicks: () => commands.join('\n'),
        write: (packet, payload) => {
            if (packet !== 'chat') return;
            const parsed = JSON.parse(payload.message);
            const flatten = (node) => {
                if (typeof node === 'string') return node;
                if (Array.isArray(node)) return node.map(flatten).join('');
                if (!node || typeof node !== 'object') return '';
                if (node.clickEvent?.action === 'run_command') commands.push(node.clickEvent.value);
                return `${node.text || ''}${(node.extra || []).map(flatten).join('')}`;
            };
            lines.push(flatten(parsed));
        }
    };
}

// The realistic case from the request: playing with friends means no share
// and no auto dodge.
const FRIENDS_SETTINGS = {
    shareTagsAuto: false,
    autoDodgeEnabled: false,
    scanMode: 'off',
    nametagOverlayEnabled: false
};

const SWEAT_SETTINGS = {
    shareTagsAuto: true,
    autoDodgeEnabled: true,
    scanMode: 'threats',
    nametagOverlayEnabled: true,
    minFkdr: 4
};

// --- naming ----------------------------------------------------------------

{
    assert.strictEqual(normalizePresetName('Friends'), 'friends');
    assert.strictEqual(normalizePresetName('  My Setup!  '), 'my-setup');
    assert.strictEqual(normalizePresetName('a'.repeat(50)).length, 24, 'names are length-capped');
    assert.strictEqual(normalizePresetName('!!!'), '', 'names with no usable chars are rejected');
    assert.strictEqual(normalizePresetName(null), '');
}

// --- allowlist -------------------------------------------------------------

{
    const filtered = filterPresetSettings({
        ...FRIENDS_SETTINGS,
        hypixelKey: 'secret',
        apiKillSwitchEnabled: true,
        autoGamblerEnabled: true,
        autoPartyDodgeEnabled: true,
        autoPartyDodgeWindowMs: 40,
        totallyMadeUp: 1,
        nested: { a: 1 }
    });

    assert.strictEqual(filtered.shareTagsAuto, false, 'allowlisted keys survive');
    assert.strictEqual(filtered.scanMode, 'off');
    assert.strictEqual(filtered.hypixelKey, undefined, 'secrets never enter a preset');
    assert.strictEqual(filtered.apiKillSwitchEnabled, undefined, 'safety switches are excluded');
    assert.strictEqual(filtered.autoGamblerEnabled, undefined, 'startup-reset settings are excluded');
    assert.strictEqual(filtered.autoPartyDodgeEnabled, undefined, 'party dodge is not profile-managed');
    assert.strictEqual(filtered.autoPartyDodgeWindowMs, undefined, 'party dodge timing is not profile-managed');
    assert.strictEqual(filtered.totallyMadeUp, undefined, 'unknown keys are dropped');
    assert.strictEqual(filtered.nested, undefined, 'non-primitives are dropped');

    const arrays = filterPresetSettings({ tabStatsBedwarsFields: ['name', 'stars'], chatTriggers: ['1/2', '2/2'] });
    assert.deepStrictEqual(arrays.tabStatsBedwarsFields, ['name', 'stars'], 'profile field lists round-trip safely');
    assert.deepStrictEqual(arrays.chatTriggers, ['1/2', '2/2'], 'chat trigger setup can be carried by a profile');

    const partyOverview = filterPresetSettings({ partyOverviewEnabled: false });
    assert.strictEqual(partyOverview.partyOverviewEnabled, false, 'Party Overview is carried by profiles');

    const missing = missingProfileSettingKeys({ tabStatsEnabled: true });
    assert.ok(missing.includes('autoDodgeEnabled'), 'older profiles report newly managed settings they do not carry');
    assert.ok(missing.includes('partyOverviewEnabled'), 'older profiles report a missing Party Overview setting');
    assert.ok(!missing.includes('tabStatsEnabled'), 'present settings are not reported as missing');
}

{
    // Every excluded key must genuinely be absent from the allowlist, or the
    // exclusion is a lie.
    const allowlisted = new Set([...PRESET_SETTING_KEYS.features, ...PRESET_SETTING_KEYS.scan]);
    EXCLUDED_KEYS.forEach((key) => {
        assert(!allowlisted.has(key), `${key} is both excluded and allowlisted`);
    });
}

{
    assert.deepStrictEqual(unknownPresetKeys({ shareTagsAuto: true, bogus: 1 }), ['bogus']);
    assert.deepStrictEqual(unknownPresetKeys({}), []);
    assert.strictEqual(namespaceForKey('shareTagsAuto'), 'features');
    assert.strictEqual(namespaceForKey('minFkdr'), 'scan');
    assert.strictEqual(namespaceForKey('nope'), null);
}

{
    const split = splitByNamespace(SWEAT_SETTINGS);
    assert.strictEqual(split.features.shareTagsAuto, true);
    assert.strictEqual(split.scan.scanMode, 'threats');
    assert.strictEqual(split.scan.minFkdr, 4);
    assert.strictEqual(split.features.minFkdr, undefined, 'scan keys do not leak into features');
}

{
    const description = describeProfileSettings({
        tabStatsEnabled: true,
        autoDodgeEnabled: true,
        autoDodgeTaggedPlayers: true,
        autoDodgeNickedPlayers: true,
        scanMode: 'threats',
        minFkdr: 3,
        minStars: 700
    });
    assert.ok(description.enabled.includes('Tab stats'));
    assert.ok(description.enabled.includes('Auto Dodge'));
    assert.ok(description.configured.some(value => value.includes('Threat scanning')));
    assert.strictEqual(profileSettingLabel('minFkdr'), 'Minimum FKDR');

    const partyDescription = describeProfileSettings({ partyOverviewEnabled: false });
    assert.strictEqual(partyDescription.partyOverview, false, 'profile summaries expose the Party Overview state');
}

// --- diffing ---------------------------------------------------------------

{
    const changes = diffSettings(SWEAT_SETTINGS, FRIENDS_SETTINGS);
    const keys = changes.map(change => change.key);
    assert.deepStrictEqual(keys, ['autoDodgeEnabled', 'nametagOverlayEnabled', 'scanMode', 'shareTagsAuto'].sort());
    const dodge = changes.find(change => change.key === 'autoDodgeEnabled');
    assert.strictEqual(dodge.from, true);
    assert.strictEqual(dodge.to, false);

    assert.deepStrictEqual(diffSettings(FRIENDS_SETTINGS, FRIENDS_SETTINGS), [], 'identical settings diff empty');
    assert.deepStrictEqual(diffSettings({}, {}), []);
    // Keys absent from current still count as changes.
    assert.strictEqual(diffSettings({}, { shareTagsAuto: false }).length, 1);
}

// --- store CRUD ------------------------------------------------------------

{
    const { store, writes } = makeStore();
    const saved = store.save('Friends', { ...FRIENDS_SETTINGS, hypixelKey: 'secret' });

    assert.strictEqual(saved.name, 'friends', 'name is normalized on save');
    assert.strictEqual(saved.settings.hypixelKey, undefined, 'save filters through the allowlist');
    assert.strictEqual(writes.length, 1);
    assert.strictEqual(store.size(), 1);
    assert.strictEqual(store.get('FRIENDS').name, 'friends', 'lookup is case-insensitive');
    assert.strictEqual(store.get('nope'), null);

    // Persisted payload drops the runtime index.
    assert.strictEqual(writes[writes.length - 1].byName, undefined);
    assert.ok(Array.isArray(writes[writes.length - 1].presets));
}

{
    const { store } = makeStore();
    store.save('friends', FRIENDS_SETTINGS, { label: 'With Friends' });
    const updated = store.save('friends', SWEAT_SETTINGS);

    assert.strictEqual(store.size(), 1, 'saving the same name overwrites');
    assert.strictEqual(updated.label, 'With Friends', 'label is preserved across overwrite');
    assert.strictEqual(updated.settings.autoDodgeEnabled, true, 'settings are replaced');
}

// --- first-class profiles --------------------------------------------------

{
    const { store } = makeStore();
    const builtins = store.listProfiles();
    assert.deepStrictEqual(builtins.map(profile => profile.name), ['super-sweaty', 'normal-sweaty', 'chill', '4v4-tickets-grinding']);
    assert.ok(builtins.every(profile => profile.readOnly && profile.source === 'builtin'), 'curated profiles are read-only built-ins');
    assert.ok(builtins.every(profile => profile.missingSettingKeys.length === 0), 'built-ins include every current profile setting');
    assert.strictEqual(builtins.find(profile => profile.name === 'chill').label, 'Chill & Friends');
    assert.strictEqual(builtins.find(profile => profile.name === 'normal-sweaty').label, 'Normal Sweaty (Recommended)');
    const normalSweaty = builtins.find(profile => profile.name === 'normal-sweaty');
    const releaseBaseline = filterPresetSettings({
        ...defaults.features,
        ...defaults.scan,
        chatTriggers: defaults.chatTriggers.triggers
    });
    assert.deepStrictEqual(
        normalSweaty.settings,
        releaseBaseline,
        'Normal Sweaty must preserve every safe setting from the shipped release baseline'
    );
    assert.strictEqual(store.getActive(), 'normal-sweaty', 'fresh installs must begin with Normal Sweaty selected');
    assert.ok(store.save('balanced', FRIENDS_SETTINGS), 'former built-in names are available for custom profiles');
    assert.strictEqual(store.setActive('balanced', { source: 'test' }), 'balanced');
    assert.strictEqual(store.getLastApplied().source, 'test', 'profile applications record an event for the launcher');
    assert.strictEqual(store.get('balanced').readOnly, false, 'new profiles remain editable custom profiles');
}

{
    const builtins = builtInProfiles();
    const { store } = makeStore();
    const shipped = builtins.find(profile => profile.name === 'chill');
    const promoted = {
        name: shipped.name,
        label: shipped.label,
        settings: shipped.settings
    };
    const normalized = normalizeStore({ active: shipped.name, presets: [promoted] }, 10, builtins);
    assert.strictEqual(normalized.presets.length, 0, 'a matching former custom profile is absorbed by its built-in');
    assert.strictEqual(normalized.active, shipped.name, 'promotion preserves the active profile selection');
    assert.strictEqual(store.get('chill').source, 'builtin');
}

{
    const { store, writes } = makeStore();
    store.setActive('chill');
    assert.strictEqual(store.remove('chill'), true, 'built-ins can be removed locally');
    assert.strictEqual(store.get('chill'), null, 'removed built-ins no longer resolve');
    assert.ok(!store.listProfiles().some(profile => profile.name === 'chill'), 'removed built-ins disappear from the launcher list');
    assert.strictEqual(store.getActive(), null, 'removing an active built-in clears the active selection');
    assert.deepStrictEqual(writes[writes.length - 1].deletedBuiltins, ['chill'], 'the local built-in deletion persists as a tombstone');
    assert.strictEqual(store.remove('chill'), false, 'removing the same built-in twice is a no-op');
}

{
    const { store } = makeStore();
    store.save('friends', { ...FRIENDS_SETTINGS, tabStatsBedwarsFields: ['name', 'stars'] }, { label: 'With Friends' });
    const exported = store.exportProfile('friends');
    assert.strictEqual(exported.format, 'fury-profile');
    assert.strictEqual(exported.profile.boundModes.length, 0, 'machine-specific mode binds are not exported');

    const imported = store.importProfile({
        ...exported,
        profile: { ...exported.profile, name: 'imported-friends' }
    });
    assert.strictEqual(imported.ok, true);
    assert.deepStrictEqual(store.get('imported-friends').settings.tabStatsBedwarsFields, ['name', 'stars']);
    assert.strictEqual(store.importProfile(exported).conflict, true, 'imports never silently overwrite a custom profile');
}

{
    const { store } = makeStore();
    assert.strictEqual(store.save('!!!', FRIENDS_SETTINGS), null, 'unusable names are refused');
    assert.strictEqual(store.size(), 0);
}

{
    const { store } = makeStore({ maxPresets: 2 });
    assert.ok(store.save('a', FRIENDS_SETTINGS));
    assert.ok(store.save('b', FRIENDS_SETTINGS));
    assert.strictEqual(store.save('c', FRIENDS_SETTINGS), null, 'new presets stop at the cap');
    assert.ok(store.save('a', SWEAT_SETTINGS), 'overwriting an existing preset still works at the cap');
    assert.strictEqual(store.size(), 2);
}

{
    const { store } = makeStore();
    store.save('friends', FRIENDS_SETTINGS);
    store.setActive('friends');
    assert.strictEqual(store.getActive(), 'friends');

    assert.strictEqual(store.remove('friends'), true);
    assert.strictEqual(store.getActive(), null, 'deleting the active preset clears active');
    assert.strictEqual(store.remove('friends'), false, 'deleting twice is a no-op');
}

{
    const { store } = makeStore();
    store.save('friends', FRIENDS_SETTINGS);
    assert.strictEqual(store.setActive('nope'), null, 'cannot activate a missing preset');
}

// --- mode binding ----------------------------------------------------------

{
    const { store } = makeStore();
    store.save('friends', FRIENDS_SETTINGS);
    store.save('sweat', SWEAT_SETTINGS);

    store.bind('friends', 'bedwars');
    assert.deepStrictEqual(store.get('friends').boundModes, ['BEDWARS'], 'modes are upper-cased');
    assert.strictEqual(store.findByMode('BEDWARS').name, 'friends');
    assert.strictEqual(store.findByMode('SKYWARS'), null);

    // A mode belongs to exactly one preset — rebinding steals it.
    store.bind('sweat', 'BEDWARS');
    assert.strictEqual(store.findByMode('BEDWARS').name, 'sweat');
    assert.deepStrictEqual(store.get('friends').boundModes, [], 'the old owner loses the binding');

    store.unbind('sweat');
    assert.strictEqual(store.findByMode('BEDWARS'), null);
    assert.strictEqual(store.bind('missing', 'BEDWARS'), null);
}

{
    const { store } = makeStore();
    store.save('a', FRIENDS_SETTINGS);
    store.bind('a', 'BEDWARS');
    store.bind('a', 'SKYWARS');
    assert.deepStrictEqual(store.get('a').boundModes, ['BEDWARS', 'SKYWARS'], 'a preset can hold several modes');
    store.unbind('a', 'BEDWARS');
    assert.deepStrictEqual(store.get('a').boundModes, ['SKYWARS'], 'unbinding one mode keeps the rest');
}

// --- store-level diff ------------------------------------------------------

{
    const { store } = makeStore();
    store.save('friends', FRIENDS_SETTINGS);
    const changes = store.diff('friends', SWEAT_SETTINGS);
    assert.strictEqual(changes.length, 4);
    assert.strictEqual(store.diff('missing', SWEAT_SETTINGS), null);
    assert.deepStrictEqual(store.diff('friends', FRIENDS_SETTINGS), [], 'no drift, no diff');
}

// --- corrupt / legacy input ------------------------------------------------

{
    assert.deepStrictEqual(normalizeStore(null, 10).presets, []);
    assert.deepStrictEqual(normalizeStore({ presets: 'nope' }, 10).presets, []);

    // Object-keyed form (name -> preset) is accepted alongside the array form.
    const fromObject = normalizeStore({
        active: 'friends',
        presets: { friends: { settings: FRIENDS_SETTINGS } }
    }, 10);
    assert.strictEqual(fromObject.presets.length, 1);
    assert.strictEqual(fromObject.presets[0].name, 'friends');
    assert.strictEqual(fromObject.active, 'friends');

    // An active name pointing at a deleted preset is dropped.
    assert.strictEqual(normalizeStore({ active: 'ghost', presets: [] }, 10).active, null);

    const migratedCollision = normalizeStore({
        active: 'balanced',
        presets: [{ name: 'balanced', settings: FRIENDS_SETTINGS }]
    }, 10, ['balanced']);
    assert.strictEqual(migratedCollision.presets[0].name, 'balanced-custom', 'legacy custom profiles do not overwrite built-ins');
    assert.strictEqual(migratedCollision.active, 'balanced-custom', 'the migrated custom profile stays active');

    // A preset written by a newer build loads, minus the keys we don't know.
    const forward = normalizeStore({
        presets: [{ name: 'future', settings: { shareTagsAuto: false, someNewSetting: true } }]
    }, 10);
    assert.strictEqual(forward.presets[0].settings.shareTagsAuto, false);
    assert.strictEqual(forward.presets[0].settings.someNewSetting, undefined);
}

// --- rendering -------------------------------------------------------------

{
    assert.strictEqual(settingLabel('autoDodgeEnabled'), 'Auto Dodge');
    assert.strictEqual(settingLabel('unmappedKey'), 'unmappedKey', 'unmapped keys fall back to the raw name');
    assert.ok(formatValue(true).includes('on'));
    assert.ok(formatValue(false).includes('off'));
    assert.ok(formatValue(undefined).includes('unset'));
    assert.ok(formatValue('threats').includes('threats'));
}

{
    const client = fakeClient();
    assert.strictEqual(renderPresetList(client, [], null), false);
    assert.ok(client.text().includes('/preset save'), 'the empty list teaches the save command');
}

{
    const { store } = makeStore();
    store.save('friends', FRIENDS_SETTINGS, { label: 'With Friends' });
    store.save('sweat', SWEAT_SETTINGS);
    store.bind('sweat', 'BEDWARS');

    const client = fakeClient();
    assert.strictEqual(renderPresetList(client, store.list(), 'friends'), true);
    const text = client.text();
    assert.ok(text.includes('With Friends'), 'labels render');
    assert.ok(text.includes('BEDWARS'), 'bound modes render');
    assert.ok(text.includes('▶'), 'the active preset is marked');
    assert.deepStrictEqual(client.clicks(), '', 'profile lists are read-only');
}

{
    const { store } = makeStore();
    store.save('legacy', { ...FRIENDS_SETTINGS, partyOverviewEnabled: true });
    const legacy = store.save('old-profile', FRIENDS_SETTINGS);
    assert.strictEqual(legacy.missingSettingKeys, undefined, 'saved return stays a plain profile record');
    const oldProfile = store.get('old-profile');
    assert.ok(oldProfile.missingSettingKeys.includes('partyOverviewEnabled'), 'profile lookup exposes missing Party Overview');

    const client = fakeClient();
    renderPresetList(client, store.listProfiles(), null);
    assert.ok(client.text().includes('Party Overview'), 'profile list names the missing Party Overview setting');

    const diffClient = fakeClient();
    renderPresetDiff(diffClient, oldProfile, [{ key: 'shareTagsAuto', from: true, to: false }]);
    assert.ok(diffClient.text().includes('Party Overview'), 'profile diff repeats missing Party Overview configuration');

    const appliedClient = fakeClient();
    renderPresetApplied(appliedClient, oldProfile, { changes: [], skipped: [] });
    assert.ok(appliedClient.text().includes('Party Overview'), 'profile apply repeats missing Party Overview configuration');
}

{
    const { store } = makeStore();
    store.save('friends', FRIENDS_SETTINGS);

    const client = fakeClient();
    assert.strictEqual(renderPresetDiff(client, store.get('friends'), store.diff('friends', SWEAT_SETTINGS)), true);
    const text = client.text();
    assert.ok(text.includes('Auto Dodge'), 'diff uses friendly labels');
    assert.ok(text.includes('on') && text.includes('off'), 'diff shows both sides');
    assert.deepStrictEqual(client.clicks(), '', 'profile diffs do not offer controls');

    const clean = fakeClient();
    assert.strictEqual(renderPresetDiff(clean, store.get('friends'), []), false);
    assert.ok(clean.text().includes('already applied'));
}

{
    const { store } = makeStore();
    store.save('friends', FRIENDS_SETTINGS, { label: 'With Friends' });

    const client = fakeClient();
    renderPresetApplied(client, store.get('friends'), {
        changes: diffSettings(SWEAT_SETTINGS, FRIENDS_SETTINGS),
        skipped: ['nametagOverlayEnabled']
    });
    const text = client.text();
    assert.ok(text.includes('Applied'));
    assert.ok(text.includes('With Friends'));
    assert.ok(text.includes('skipped'), 'locked settings are reported');
    assert.ok(text.includes('locked on your plan'));

    const auto = fakeClient();
    renderPresetApplied(auto, store.get('friends'), { changes: [], skipped: [], reason: 'mode_bind' });
    assert.ok(auto.text().includes('(auto)'), 'auto-applied presets are marked as such');
}

{
    const { store } = makeStore();
    store.save('friends', FRIENDS_SETTINGS);

    const none = fakeClient();
    assert.strictEqual(renderPresetStatus(none, null, []), false);
    assert.ok(none.text().includes('No profile active'));

    const clean = fakeClient();
    renderPresetStatus(clean, store.get('friends'), []);
    assert.ok(clean.text().includes('match this preset'));

    const drifted = fakeClient();
    renderPresetStatus(drifted, store.get('friends'), store.diff('friends', SWEAT_SETTINGS));
    assert.ok(drifted.text().includes('unsaved change'), 'drift is surfaced');
    assert.deepStrictEqual(drifted.clicks(), '', 'profile status is read-only');
}

console.log('test_presets.js: all assertions passed');
