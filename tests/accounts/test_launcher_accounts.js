'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { buildAccountCatalog, createViewedAccountStore, sameAccount, sessionBelongsToAccount } = require('../../src/accounts/launcherAccounts');
const { buildLauncherSessionHistory } = require('../../src/session/launcherSessionHistory');
const { createReminderAccountStore, createRememberedReminders } = require('../../src/reminders/rememberedAccount');

(async () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'fury-viewed-accounts-'));
    try {
        const alice = { uuid: 'a'.repeat(32), name: 'Alice' };
        const bob = { uuid: 'b'.repeat(32), name: 'Bob' };
        const { promoteAuthCache } = require('../../src/accounts/authCache');
        const { createHash } = require('prismarine-auth/src/common/Util');
        const stage = path.join(directory, 'auth-stage'), authRoot = path.join(directory, 'auth');
        fs.mkdirSync(stage);fs.mkdirSync(path.join(authRoot, 'OldAlice'), { recursive: true });
        fs.writeFileSync(path.join(authRoot, 'OldAlice', 'existing.json'), '{"untouched":true}');
        for (const type of ['mca','live','xbl']) fs.writeFileSync(path.join(stage, `${createHash('OldAlice')}_${type}-cache.json`), JSON.stringify({ profile: alice }));
        fs.writeFileSync(path.join(stage, `${createHash('Bob')}_mca-cache.json`), '{"unrelated":true}');
        promoteAuthCache(stage, authRoot, 'OldAlice', 'Alice');
        assert.deepStrictEqual(fs.readdirSync(path.join(authRoot, 'Alice')).sort(), ['live','mca','xbl'].map(type => `${createHash('Alice')}_${type}-cache.json`).sort());
        assert.deepStrictEqual(JSON.parse(fs.readFileSync(path.join(authRoot, 'OldAlice', 'existing.json'))), { untouched:true });
        assert.throws(() => promoteAuthCache(stage, authRoot, 'OldAlice', '../outside'), /Invalid/);
        const catalog = buildAccountCatalog({
            sessions: [alice, bob], authAccounts: [
                { uuid: alice.uuid, username: 'Alice', profileName: 'Alice', folderExists: true, state: 'valid' },
                { uuid: alice.uuid, username: 'OldAlice', profileName: 'Alice', folderExists: true, state: 'valid' },
                { username: 'Bob', profileName: 'Bob', folderExists: true, state: 'expired' }
            ]
        });
        assert.strictEqual(catalog.length, 2, 'auth aliases do not duplicate the account picker');
        assert.strictEqual(catalog.find(a => a.name === 'Bob').uuid, bob.uuid);
        const { createRemovedAccountStore, removeAuthCaches } = require('../../src/accounts/accountRemoval');
        const removedFile = path.join(directory, 'removed.json');
        const removed = createRemovedAccountStore(removedFile);
        const authFixtures = [
            { ...alice, username: 'Alice', folderExists: true },
            { ...alice, username: 'OldAlice', folderExists: true },
            { ...bob, username: 'Bob', folderExists: true }
        ];
        fs.mkdirSync(path.join(authRoot, 'Bob'));
        fs.writeFileSync(path.join(authRoot, 'Bob', 'keep.json'), '{}');
        assert.throws(() => removeAuthCaches(authRoot, [{...alice,username:'../outside',folderExists:true}], alice), /Invalid/);
        removeAuthCaches(authRoot, authFixtures, alice);
        assert(!fs.existsSync(path.join(authRoot, 'Alice')));
        assert(!fs.existsSync(path.join(authRoot, 'OldAlice')));
        assert(fs.existsSync(path.join(authRoot, 'Bob', 'keep.json')), 'another account login stays intact');
        removed.remove(alice, authFixtures);
        assert.deepStrictEqual(removed.filter(catalog).map(a=>a.uuid), [bob.uuid]);
        assert.strictEqual(createRemovedAccountStore(removedFile).filter(buildAccountCatalog({sessions:[alice,bob],remembered:alice})).length,1,'history and reminders do not resurrect a removed account on restart');
        assert.strictEqual(removed.filter([{name:'OldAlice'}]).length,0,'expired login aliases stay removed');
        assert.strictEqual(removed.filter([{uuid:bob.uuid,name:'Alice'}]).length,1,'a transferred name is a different UUID');
        removed.restore({...alice,name:'RenamedAlice'});
        assert.strictEqual(removed.filter(catalog).length,2,'sign-in restores the UUID even after a name change');
        const selection = createViewedAccountStore(path.join(directory, 'viewed.json'));
        selection.select(alice.uuid,catalog);selection.clear();
        assert.strictEqual(selection.resolve([catalog.find(a=>a.uuid===bob.uuid)]).uuid,bob.uuid);
        selection.clear();assert.strictEqual(selection.resolve([]),null);
        selection.select(bob.uuid, catalog);
        const reminderStore = createReminderAccountStore(path.join(directory, 'reminders'));
        reminderStore.remember(alice.uuid, alice.name);
        assert.strictEqual(selection.resolve(catalog, alice).uuid, bob.uuid, 'connecting another account never replaces the viewing selection');
        assert.strictEqual(createViewedAccountStore(path.join(directory, 'viewed.json')).resolve(catalog).uuid, bob.uuid);
        assert.throws(() => selection.select('../../not-an-account', catalog));
        assert(sameAccount(alice, { uuid: alice.uuid.toUpperCase(), name: 'RenamedAlice' }));
        assert(!sessionBelongsToAccount({ uuid: bob.uuid, name: 'Alice' }, alice), 'a transferred name cannot override another UUID');
        assert(sessionBelongsToAccount({ name: 'Alice' }, alice), 'legacy name-only records are retained');

        const entry = (account, id, active = false) => ({
            session: { ...account, id, startedAt: 1000, endedAt: active ? 0 : 2000, lastSeen: 2000, games: [] }, active,
            delta: { stats: { Bedwars: { wins_bedwars: 1, games_played_bedwars: 1 } } }
        });
        const history = buildLauncherSessionHistory([
            ...Array.from({ length: 260 }, (_, i) => entry(alice, `a-${i}`, i === 0)), entry(bob, 'b-only')
        ], { account: bob, accountScoped: true, limit: 2 });
        assert.deepStrictEqual(history.sessions.map(s => s.id), ['b-only'], 'filter before the display limit');
        assert.strictEqual(history.live, null, 'another account active session is never exposed');
        assert.strictEqual(history.summary.wins, 1, 'summary is scoped too');
        assert.strictEqual(buildLauncherSessionHistory([entry(alice, 'a')], { accountScoped: true }).sessions.length, 0);
        const { normalizeStore } = require('../../src/session/sessionStore');
        const saved = (owner, id, at) => ({ ...owner, id, startedAt: at, lastSeen: at + 1000, endedAt: at + 1000,
            summary: { stats: { Bedwars: { wins_bedwars: 1 } } }, games: [{ at: at + 1000, result: 'win' }] });
        const retained = normalizeStore({ sessions: [saved(bob, 'bob-old', 1000), saved(alice, 'alice-old', 2000), saved(alice, 'alice-new', 3000)] }, 1, 250);
        assert.deepStrictEqual(retained.sessions.map(s => s.id), ['bob-old', 'alice-new'], 'retention never prunes a different account');

        reminderStore.saveGeorge(alice.uuid, { active: true, wins: 2, claimReady: true }, 'Alice');
        reminderStore.saveGeorge(bob.uuid, { active: true, wins: 1 }, 'Bob');
        const settings = { keys: { hypixel: 'test' }, features: { autoGamblerEnabled: true } };
        let completeAlice, completeBob;
        const reminders = createRememberedReminders({
            store: reminderStore, getSettings: () => settings,
            getAccount: () => selection.resolve(catalog),
            fetchPlayer: uuid => new Promise(resolve => { if (uuid === alice.uuid) completeAlice = resolve; else completeBob = resolve; })
        });
        const payload = (account, dust) => ({ player: { uuid: account.uuid, displayname: account.name,
            stats: { Bedwars: { slumber: { minion: { ender_dust: dust } } } } } });
        selection.select(alice.uuid, catalog);
        const first = reminders.refresh({ force: true });
        selection.select(bob.uuid, catalog);
        const second = reminders.refresh({ force: true });
        assert.strictEqual(reminders.getStatus().gamblerGeorge.wins, 1);
        assert.strictEqual(reminders.getStatus().enderDust.enderDust, null);
        completeBob(payload(bob, 90));
        await second;
        completeAlice(payload(alice, 280));
        const oldResponse = await first;
        assert.strictEqual(oldResponse.account.uuid, alice.uuid, 'responses retain the requested account for renderer epoch checks');
        assert.strictEqual(reminders.getStatus().enderDust.enderDust, 90, 'late Alice result cannot replace Bob');
        assert.strictEqual(reminders.getStatus().gamblerGeorge.claimReady, false);
        assert.strictEqual(reminders.getStatus(null).enderDust.enderDust, null, 'missing selection must not default to last-connected readings');
        const restarted = createReminderAccountStore(path.join(directory, 'reminders'));
        assert.strictEqual(restarted.george(alice.uuid).wins, 2);
        assert.strictEqual(restarted.george(bob.uuid).wins, 1);
        assert.strictEqual(restarted.saveGeorge('../../escape', {}, 'Invalid'), null);
        console.log('Launcher account isolation, restart, ownership and late-response tests passed.');
    } finally {
        const resolved = path.resolve(directory);
        assert.strictEqual(path.dirname(resolved), path.resolve(os.tmpdir()));
        assert(path.basename(resolved).startsWith('fury-viewed-accounts-'));
        fs.rmSync(resolved, { recursive: true, force: true });
    }
})().catch(error => { console.error(error); process.exitCode = 1; });
