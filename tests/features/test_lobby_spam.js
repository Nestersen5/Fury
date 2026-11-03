'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createLobbySpam, lobbyKeyForSidebar, publicMessage, MAX_PLAYERS } = require('../../src/chat/lobbySpam');
const { normalizeLobbySpamSettings } = require('../../src/chat/lobbySpamSettings');
const { extractText } = require('../../features/minecraft_chat');

function fixture(options = {}) {
    let at = 100000, location = 'l12a', settings = { lobbySpamEnabled: true, lobbySpamSensitivity: 'balanced' };
    const notices = [];
    const detector = createLobbySpam({ getSettings: () => settings, getLobbyKey: () => location,
        isOwnName: name => name.toLowerCase() === 'myself', isKnownPlayer: name => name !== 'Notice',
        sendChat: value => notices.push(value), now: () => at, ...options });
    return { ...detector, notices, tick: value => { at += value; }, location: value => { location = value; },
        settings: value => { settings = { ...settings, ...value }; detector.syncSettings(); },
        packet: (text = 'Join my party for bedwars!', name = 'Spammer', position = 0) => ({
            message: JSON.stringify({ text: `[MVP+] ${name}: ${text}`, color: 'green',
                clickEvent: { action: 'suggest_command', value: '/msg Spammer ' }, hoverEvent: { action: 'show_text', value: 'Player' } }), position
        }) };
}
const hasMute = packet => Boolean(packet && JSON.parse(packet.message).extra?.some(part => part.text === ' [Mute]'));

test('default off and bounded sensitivity normalization', () => {
    assert.deepEqual(normalizeLobbySpamSettings(), { lobbySpamEnabled: false, lobbySpamSensitivity: 'balanced' });
    assert.deepEqual(normalizeLobbySpamSettings({ lobbySpamEnabled: 'true', lobbySpamSensitivity: 'invalid' }),
        { lobbySpamEnabled: false, lobbySpamSensitivity: 'balanced' });
    const f = fixture({ getLobbyKey() { throw Error('Disabled path must do no lobby work'); } });
    f.settings({ lobbySpamEnabled: false });
    const packet = f.packet(); assert.equal(f.rewriteClientbound(packet), packet);
});

test('positive evidence accepts every lobby kind; pregame, games, replay and unknown fail closed', () => {
    for (const title of ['MAIN LOBBY', 'BED WARS', 'SKYWARS', 'DUELS', 'ARCADE', 'TNT GAMES', 'PROTOTYPE']) {
        for (const id of ['L12A', 'lobby23', 'L1']) {
            assert.equal(lobbyKeyForSidebar([title, `§711/02/26 §8${id}`, 'www.hypixel.net']), id.toLowerCase());
        }
    }
    assert.equal(lobbyKeyForSidebar(['11/02/26 L1😀2A']), 'l12a');
    for (const id of ['mini123A', 'mega12A', 'm12A', 'unknown']) assert.equal(lobbyKeyForSidebar([`11/02/26 ${id}`]), null);
    for (const line of ['Waiting...', 'Starting in 5s', 'Players: 8/16', 'Spectating', 'Game Over']) {
        assert.equal(lobbyKeyForSidebar(['11/02/26 L12A', line]), null);
    }
    for (const flags of [{ gameActive: true }, { pregame: true }, { replay: true }]) {
        assert.equal(lobbyKeyForSidebar(['11/02/26 L12A'], flags), null);
    }
    assert.equal(lobbyKeyForSidebar(['BED WARS', 'Level: 100', 'Progress: 10%']), null);
});

test('only public player messages, preserving rank and level formats', () => {
    assert.equal(publicMessage({ text: '[123✫] [MVP++] Spammer: Hello there!' }).sender, 'Spammer');
    for (const text of ['Party > [MVP+] Spammer: Hello!', 'Guild > Spammer: Hello!', 'Officer > Spammer: Hello!',
        'Team > Spammer: Hello!', 'From [MVP+] Spammer: Hello!', 'To Spammer: Hello!', 'Party Leader: Spammer',
        'You received a message: hello', '[NPC] Delivery Man: Hello']) assert.equal(publicMessage({ text }), null, text);
});

test('balanced offers a single action on the third repeat and preserves the original component', () => {
    const f = fixture(), packet = f.packet(), before = JSON.parse(packet.message);
    assert.equal(f.rewriteClientbound(packet), packet); f.tick(1000);
    assert.equal(f.rewriteClientbound(packet), packet); f.tick(1000);
    const result = f.rewriteClientbound(packet);
    assert(hasMute(result)); assert.deepEqual(JSON.parse(result.message).extra[0], before);
    assert.equal(packet.message, JSON.stringify(before));
    const button = JSON.parse(result.message).extra[1];
    assert.equal(button.clickEvent.value, '/lobbyspam mute Spammer');
    assert.match(button.hoverEvent.value, /3 repeated/);
    assert.equal(f.rewriteClientbound(packet), packet, 'no repeated offers');
    f.tick(60000); f.rewriteClientbound(packet); f.rewriteClientbound(packet);
    assert(hasMute(f.rewriteClientbound(packet)), 'fresh repetition after cooldown offers again');
});

test('conversation, short game phrases, other senders and old repeats do not count', () => {
    const f = fixture();
    for (const text of ['Anyone playing doubles?', 'I won my last match.', 'How are you doing?', 'gg', 'gg', 'gg']) {
        assert(!hasMute(f.rewriteClientbound(f.packet(text))));
    }
    for (const name of ['PlayerOne', 'PlayerTwo', 'PlayerThree', 'Myself', 'Notice']) assert(!hasMute(f.rewriteClientbound(f.packet('Hello there!', name))));
    f.rewriteClientbound(f.packet()); f.tick(16000);
    assert(!hasMute(f.rewriteClientbound(f.packet()))); assert(!hasMute(f.rewriteClientbound(f.packet())));
});

test('sensitivity changes reset evidence and catch very similar longer messages', () => {
    const f = fixture();
    for (const value of ['Join my party for doubles please!', 'Join my party for doubles please!!']) assert(!hasMute(f.rewriteClientbound(f.packet(value))));
    assert(hasMute(f.rewriteClientbound(f.packet('Join my party for doubles please!!!'))));
    f.settings({ lobbySpamSensitivity: 'low' });
    for (let i = 0; i < 4; i++) assert(!hasMute(f.rewriteClientbound(f.packet())));
    assert(hasMute(f.rewriteClientbound(f.packet())));
    f.settings({ lobbySpamSensitivity: 'high' });
    f.rewriteClientbound(f.packet()); f.tick(20000); f.rewriteClientbound(f.packet());
    assert(hasMute(f.rewriteClientbound(f.packet())));
});

test('local mute only hides public lobby chat; undo, clear, disable and disconnect work', () => {
    const f = fixture(), packet = f.packet();
    f.command(['mute', 'Spammer']);
    assert.match(extractText(f.notices[0]), /until disconnect/);
    assert.equal(f.notices[0].extra[1].clickEvent.value, '/lobbyspam unmute Spammer');
    assert.equal(f.rewriteClientbound(packet), null);
    for (const position of [1, 2]) { const p = f.packet(undefined, undefined, position); assert.equal(f.rewriteClientbound(p), p); }
    for (const prefix of ['Party > ', 'Guild > ', 'From ']) {
        const p = { message: JSON.stringify({ text: `${prefix}Spammer: Join my party for bedwars!` }), position: 0 };
        assert.equal(f.rewriteClientbound(p), p);
    }
    f.location(null); assert.equal(f.rewriteClientbound(packet), packet);
    f.location('l12a'); assert.equal(f.rewriteClientbound(packet), null, 'mutes survive lobby/world changes');
    f.settings({ lobbySpamEnabled: false }); assert.equal(f.rewriteClientbound(packet), packet);
    f.settings({ lobbySpamEnabled: true }); assert.equal(f.rewriteClientbound(packet), null);
    f.command(['UNMUTE', 'sPaMmEr']); assert.equal(f.rewriteClientbound(packet), packet);
    f.manage('mute', 'Spammer'); f.manage('clear'); assert.equal(f.snapshot().mutedCount, 0);
    f.manage('mute', 'Spammer'); const id = f.snapshot().sessionId; f.dispose();
    assert.equal(f.snapshot().mutedCount, 0); assert.equal(f.manage('mute', 'Spammer').ok, false);
    const next = fixture(); assert.notEqual(next.snapshot().sessionId, id); assert.equal(next.rewriteClientbound(packet), packet);
});

test('world/lobby boundaries clear detection evidence without losing mutes', () => {
    const f = fixture(), packet = f.packet();
    for (const change of [() => f.location('l13a'), () => f.resetWorld(), () => { f.location(null); f.rewriteClientbound(packet); f.location('l13a'); }]) {
        f.rewriteClientbound(packet); f.rewriteClientbound(packet); change();
        assert(!hasMute(f.rewriteClientbound(packet))); f.resetWorld();
    }
});

test('malformed chat, untrusted sender and oversized content pass through unchanged', () => {
    const f = fixture();
    for (const p of [{ message: '{', position: 0 }, { message: 'x'.repeat(8193), position: 0 },
        f.packet('a'.repeat(257)), f.packet('aaaa', 'Notice')]) {
        for (let i = 0; i < 5; i++) assert.equal(f.rewriteClientbound(p), p);
    }
    assert.equal(f.manage('mute', 'Spammer\n/ignore all').ok, false);
    assert.equal(f.manage('mute', 'Myself').ok, false);
    assert.equal(f.manage('unknown').ok, false);
    f.command(['clear', 'unexpected']); assert.match(f.notices.at(-1), /Usage/);
});

test('mute list is bounded and never silently evicts a muted player; summary excludes names', () => {
    const f = fixture();
    for (let i = 0; i < MAX_PLAYERS; i++) assert(f.manage('mute', `Player${i}`).ok);
    assert.equal(f.manage('mute', 'Overflow').ok, false);
    assert.equal(f.manage('list').players.length, MAX_PLAYERS);
    assert.equal(f.snapshot().players, undefined);
    assert.equal(f.rewriteClientbound(f.packet('Repeated text', 'Player0')), null);
});

test('real settings saves and proxy bootstrap retain preferences without persisting muted players', () => {
    const fs = require('fs'), os = require('os'), path = require('path');
    const { execFileSync } = require('child_process');
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'fury-lobby-spam-settings-'));
    try {
        execFileSync(process.execPath, ['-e', `
            const assert = require('node:assert/strict');
            const config = require('./app_config');
            const { createConfigLoader } = require('./src/bootstrap/config');
            for (const sensitivity of ['low', 'balanced', 'high']) {
                config.saveFeatureSettings({ lobbySpamEnabled: true, lobbySpamSensitivity: sensitivity });
                config.saveFeatureSettings({ quickMathsEnabled: true });
                const saved = config.loadFeatureSettings();
                assert.equal(saved.lobbySpamEnabled, true); assert.equal(saved.lobbySpamSensitivity, sensitivity);
                const parsed = createConfigLoader({ loadFeatureSettings: () => saved, clampDodgeDelay: value => value, state: {} }).parseFeatureConfig();
                assert.equal(parsed.lobbySpamEnabled, true); assert.equal(parsed.lobbySpamSensitivity, sensitivity);
                assert.equal(saved.lobbySpamMutedPlayers, undefined);
            }
            config.saveFeatureSettings({ lobbySpamEnabled: false, lobbySpamSensitivity: 'bad' });
            assert.equal(config.loadFeatureSettings().lobbySpamEnabled, false);
            assert.equal(config.loadFeatureSettings().lobbySpamSensitivity, 'balanced');
        `], { cwd: path.resolve(__dirname, '../..'), env: { ...process.env, FURY_DATA_DIR: directory }, stdio: 'pipe' });
    } finally {
        assert(path.resolve(directory).startsWith(path.resolve(os.tmpdir()) + path.sep)
            && path.basename(directory).startsWith('fury-lobby-spam-settings-'));
        fs.rmSync(directory, { recursive: true, force: true });
    }
});
