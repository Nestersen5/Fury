'use strict';
const assert = require('assert/strict'), fs = require('fs'), os = require('os'), path = require('path');
const { createReleaseExperience } = require('../../src/updates/releaseExperience');
const { destinations } = require('../../src/updates/releaseDestinations');

(async () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'fury-discovery-'));
    const statePath = path.join(directory, 'state.json');
    const services = [];
    const create = (installedVersion = '1.1.4', options = {}) => {
        const service = createReleaseExperience({ installedVersion, statePath, isPackaged: true, updates: { check: async () => null }, ...options });
        services.push(service); return service;
    };
    const seed = value => fs.writeFileSync(statePath, JSON.stringify(value));
    try {
        let service = create();
        assert.deepEqual((await service.notes()).discovery.pending, [], 'A new install has no tags');
        service.dispose();
        seed({ lastVersion: '1.1.0', seen: ['1.1.0'] });
        service = create();
        await service.check();
        let notes = await service.notes();
        assert.deepEqual(notes.releases.map(entry => entry.version), ['1.1.4', '1.1.3', '1.1.2', '1.1.1', '1.1.0']);
        const monthly = destinations.find(item => item.control === 'share-tags-monthly-fkdr').id;
        assert(notes.discovery.pending.includes(monthly));
        assert(notes.discovery.pending.includes('1.1.1:session-average-game-time'), 'Skipped releases contribute tags');
        assert(!notes.discovery.pending.includes('1.1.0:quick-maths-enabled'), 'Existing settings are not new');
        assert.equal(await service.markSeen({ version: '1.1.3', settings: [monthly] }), null, 'Reject stale renderer version');
        assert.equal(await service.markSeen({ version: '1.1.4', settings: ['unknown'] }), null);
        assert.equal(await service.markSeen({ version: '1.1.4', readVersion: '9.9.9' }), null);
        await service.dismiss('1.1.4');
        assert.deepEqual((await service.notes()).readVersions, [], 'Dismissing a card does not mark releases or settings read');
        await service.markSeen({ version: '1.1.4', readVersion: '1.1.3', category: 'scan' });
        notes = await service.notes();
        assert.deepEqual(notes.readVersions, ['1.1.3']);
        assert(!notes.unreadVersions.includes('1.1.3') && notes.unreadVersions.includes('1.1.2'), 'Reading one version retains others');
        assert.deepEqual(notes.discovery.seen, [], 'Visiting a category does not consume hidden settings');
        await service.markSeen({ version: '1.1.4', settings: [monthly] });
        await service.flush(); service.dispose();
        service = create(); notes = await service.notes();
        assert(notes.discovery.seen.includes(monthly), 'Read settings persist across restarts');
        assert(notes.discovery.visited.includes('scan'));
        assert(notes.readVersions.includes('1.1.3'));
        service.dispose();
        service = create('1.1.5'); notes = await service.notes();
        assert.deepEqual(notes.discovery.pending, [], 'Next installed version expires old tags');
        assert(notes.unreadVersions.includes('1.1.2'), 'Unopened version dots survive the next upgrade'); service.dispose();
        seed({ lastVersion: '1.1.3', seen: [] });
        service = create('1.1.4', { updates: { check: async () => ({ version: '9.0.0' }) }, read: async () => ({ schemaVersion: 1, releases: [{ version: '9.0.0', features: ['<b>Plain text</b>'], improvements: [], fixes: [] }] }) });
        await service.check(); notes = await service.notes();
        assert.equal(notes.releases[0].version, '9.0.0');
        assert(notes.releases.some(entry => entry.version === '1.1.0'), 'A latest-only remote feed retains bundled history');
        assert(notes.discovery.pending.every(id => id.startsWith('1.1.4:')), 'Available future releases cannot tag settings');
        await service.markSeen({ version: '1.1.4', readVersion: '9.0.0' }); service.dispose();
        seed({ lastVersion: '1.1.3', seen: [] });
        service = create('1.1.4', { isPackaged: false, env: {} });
        assert.deepEqual((await service.notes()).discovery.pending, [], 'Source runs do not invent an upgrade'); service.dispose();
        seed({ lastVersion: '1.1.3', seen: [] }); service = create(); await service.notes();
        fs.unlinkSync(statePath); fs.mkdirSync(statePath);
        await assert.rejects(service.markSeen({ version: '1.1.4', settings: [monthly] }));
        assert(!(await service.notes()).discovery.seen.includes(monthly), 'Failed saves do not consume unseen settings');
        fs.rmdirSync(statePath);
        await service.markSeen({ version: '1.1.4', settings: [monthly] });
        assert(JSON.parse(fs.readFileSync(statePath)).discovery.seen.includes(monthly), 'Failed saves can retry markers');
        console.log('Release discovery: new/legacy installs, skipped versions, read vs dismissal, restart, expiry, future notes, validation and save retry passed.');
    } finally {
        for (const service of services) { service.dispose(); await service.flush().catch(() => {}); }
        fs.rmSync(directory, { recursive: true, force: true });
    }
})().catch(error => { console.error(error); process.exitCode = 1; });
