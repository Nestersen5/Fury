'use strict';

const { extractText, stripAnsi } = require('../../features/minecraft_chat');
const { decodeTitle, describeItem } = require('../menu/menuMonitor');
const { normalizeSettings } = require('./settings');
const { ID, parsePage, pageUrl, claimUrl, cookieHeader } = require('./page');
const text = require('./text');

const PREFIX = '§6§lDaily Reward §8» ';
const LINK_TEXT = 'Click the link to visit our website and claim your reward: ';
const OWN_LINK = /^\n*Click the link to visit our website and claim your reward: https:\/\/(?:rewards\.)?hypixel\.net\/claim-reward\/([0-9a-f]{8})\n*$/;
const OFFICIAL_URL = /^https:\/\/(?:rewards\.)?hypixel\.net\/claim-reward\/([0-9a-f]{8})$/;
const SHARED_URL = /(?<![A-Za-z0-9.\-])(?:https?:\/\/)?(?:www\.|rewards\.)?hypixel\.net\/claim-reward\/([0-9a-f]{8})(?![A-Za-z0-9])/g;
const RANKS = new Set(['VIP', 'VIP+', 'MVP', 'MVP+', 'MVP++', 'YOUTUBE', 'HELPER', 'MOD', 'GM', 'ADMIN',
    'OWNER', 'STAFF', 'MOJANG', 'EVENTS', 'PIG+++', 'INNIT', 'ዞ']);
const visible = value => stripAnsi(String(value || ''));
const plain = value => ({ text: value });
function button(label, color, action, value, hover, bold = false) {
    return { text: label, color, bold, italic: false, underlined: false, strikethrough: false, obfuscated: false,
        clickEvent: { action, value }, hoverEvent: { action: 'show_text', value: hover } };
}

function actionsMatch(root, id) {
    const todo = [root];
    for (let count = 0; todo.length; count++) {
        if (count >= 512) return false;
        const node = todo.pop();
        if (Array.isArray(node)) { todo.push(...node); continue; }
        if (!node || typeof node !== 'object') continue;
        if (Object.hasOwn(node, 'clickEvent')) {
            const click = node.clickEvent;
            if (click?.action !== 'open_url' || typeof click.value !== 'string'
                || OFFICIAL_URL.exec(click.value)?.[1] !== id) return false;
        }
        if (node.extra) todo.push(node.extra);
        if (node.with) todo.push(node.with);
    }
    return true;
}

function findSharedLink(line) {
    if (!line.includes('claim-reward/')) return null;
    line = visible(line);
    if (line.startsWith(LINK_TEXT)) return null;
    const colon = line.indexOf(': ');
    if (colon <= 0) return null;
    SHARED_URL.lastIndex = colon + 2;
    const match = SHARED_URL.exec(line);
    if (!match) return null;
    const tokens = line.slice(0, colon).trim().split(/ +/);
    while (tokens.length && /^\[.+\]$/.test(tokens.at(-1))) tokens.pop();
    const name = tokens.pop(), rank = /^\[(.+)\]$/.exec(tokens.pop() || '')?.[1];
    return /^[A-Za-z0-9_]{1,16}$/.test(name || '') && RANKS.has(rank) ? { id: match[1], name, rank } : null;
}

// One instance per proxied account/connection. The shared menu monitor remains
// the inventory owner; we observe real clicks and never synthesize item clicks.
function createDailyRewards({ transport, menuMonitor, sendUpstream, sendClient, sendChat,
    getSettings = () => ({}), saveSettings = () => {}, isCurrent = () => true,
    isApiPaused = () => false, now = Date.now, autoPick = rows => require('./autoPick').choose(rows) }) {
    let disposed = false, own = null, shared = null, windowId = null, click = null, bookAt = null;
    let worker = Promise.resolve();
    const senders = new Map(), handled = new Map();
    const settings = () => normalizeSettings(getSettings());
    const say = line => { if (!disposed && isCurrent()) sendChat(typeof line === 'string' ? PREFIX + line : line); };
    const rich = parts => say({ text: '', extra: parts });
    const owned = claim => !disposed && isCurrent() && (claim === own || claim === shared);
    const live = claim => owned(claim) && settings().enabled && (!claim.sender || settings().others) && !isApiPaused();
    const remember = (map, key, value) => {
        map.delete(key); map.set(key, value);
        if (map.size > 64) map.delete(map.keys().next().value);
    };
    const whose = claim => claim.sender ? `${claim.sender}'s ` : '';

    function clearClaim(claim) {
        claim?.abort.abort();
        if (claim) { claim.cookie = ''; claim.page = null; }
    }
    function reset() {
        clearClaim(own); clearClaim(shared);
        own = shared = null; windowId = click = bookAt = null;
        senders.clear(); handled.clear();
    }
    function syncSettings() {
        if (!settings().enabled || isApiPaused()) { reset(); return; }
        if (!settings().others) { clearClaim(shared); shared = null; senders.clear(); }
    }
    function finish(claim, outcome, message, browser = false) {
        if (!owned(claim)) return;
        claim.state = 'done'; claim.outcome = outcome; claim.cookie = ''; claim.page = null;
        remember(handled, claim.id, outcome);
        if (browser) rich([plain(PREFIX + message + ' '), button('[Open link]', 'aqua', 'open_url', pageUrl(claim.id), '§7Open the reward page in your browser.')]);
        else say(message);
    }
    function submit(claim, step) {
        // At most one own and one shared offer can be busy. Network operations
        // are serialized like the injectable's bounded worker, without retries.
        worker = worker.then(async () => {
            if (!live(claim)) return;
            try { await step(); }
            catch { finish(claim, 'Request failed; result unknown', '§cThe reward request failed. Check the page before trying again.', !claim.sender); }
        });
    }

    function closeDelivery() {
        if (windowId == null || menuMonitor.getWindow()?.windowId !== windowId) return;
        const id = windowId;
        windowId = null;
        menuMonitor.setHold(false);
        sendUpstream('close_window', { windowId: id });
        menuMonitor.observeClientPacket({ windowId: id }, { name: 'close_window' });
        sendClient('close_window', { windowId: id });
    }

    function picker(claim, autoFallback = false) {
        if (!live(claim) || claim.state !== 'ready') return;
        const page = claim.page;
        say(`§fPick one of ${claim.sender ? claim.sender + "'s" : "today's"} cards §8· §7Streak §f${page.streakScore} §8(best ${page.streakHigh})`);
        if (autoFallback) say('§7Your auto-pick model has no clear winner among these cards, so you pick.');
        page.rewards.forEach((row, index) => {
            const command = `/dailyreward claim ${claim.id} ${index + 1}`, hover = text.hover(row);
            rich([plain(`§8 ${index + 1}. `), button(text.rarity(row.rarity) + ' ', text.color(row.rarity), 'run_command', command, hover, true),
                button(text.name(row), 'white', 'run_command', command, hover),
                button(row.amount >= 0 ? ` x${text.amount(row.amount)}` : '', 'gray', 'run_command', command, hover),
                plain('  '), button('[CLAIM]', 'green', 'run_command', command, hover, true)]);
        });
        rich([plain('§8 '), button('[Open in browser]', 'dark_gray', 'open_url', pageUrl(claim.id), '§7Open this reward page in your browser instead.')]);
    }

    function start(id, sender = null) {
        if (isApiPaused()) { say('§eReward requests are paused by /apikill.'); return; }
        const existing = own?.id === id ? own : shared?.id === id ? shared : null;
        if (existing) {
            if (existing.state === 'ready') picker(existing);
            else say(`§7Already ${existing.state === 'fetching' || existing.state === 'claiming' ? 'working on this link' : 'handled this link: ' + existing.outcome}.`);
            return;
        }
        if (handled.has(id)) { say(`§7Already handled this link: ${handled.get(id)}.`); return; }
        const previous = sender ? shared : own;
        if (previous && ['fetching', 'claiming'].includes(previous.state)) { say('§7Still working on the previous reward link. Try again in a moment.'); return; }
        clearClaim(previous);
        const claim = { id, sender, state: 'fetching', outcome: 'Loading cards', abort: new AbortController(), page: null, cookie: '' };
        if (sender) shared = claim; else own = claim;
        say(`§7Loading ${sender ? sender + "'s" : "today's"} reward cards…`);
        submit(claim, async () => {
            let response, page;
            try {
                response = await transport.get(pageUrl(id), { signal: claim.abort.signal });
                if (!live(claim)) return;
                if (response.status !== 200) throw new Error('Reward site refused the page');
                page = parsePage(response.body, id);
            } catch {
                if (live(claim)) finish(claim, 'Page could not be read', `§c${sender ? whose(claim) + 'reward page could not be read. Cancelled.' : 'The reward page could not be read. Open the link yourself:'}`, !sender);
                return;
            }
            if (page.expired) { finish(claim, 'Link expired or already claimed', '§cThis reward link has expired or was already claimed.'); return; }
            if (!page.skippable) {
                finish(claim, 'Ad cannot be skipped', sender ? `§e${whose(claim)}link cannot skip the ad, so Fury cancelled it.`
                    : '§eThis account cannot skip the ad, so open this reward in your browser:', !sender);
                return;
            }
            claim.page = page; claim.cookie = cookieHeader(response.cookies);
            claim.state = 'ready'; claim.outcome = 'Waiting for your choice';
            const autoMode = !sender && settings().mode === 'auto';
            let choice = -1;
            if (autoMode) { try { choice = autoPick(page.rewards); } catch { /* Manual fallback. */ } }
            if (Number.isInteger(choice) && choice >= 0 && choice < page.rewards.length) begin(claim, choice, true);
            else picker(claim, autoMode);
        });
    }

    function begin(claim, index, automatic = false) {
        if (!live(claim) || claim.state !== 'ready') return;
        const page = claim.page, row = page.rewards[index];
        if (!row) { say('§cThat card does not exist.'); return; }
        claim.state = 'claiming'; claim.outcome = 'Claiming';
        say(`§7${automatic ? 'Auto-claiming' : 'Claiming'} ${text.legacy(row.rarity)}${text.summary(row)}§7…`);
        submit(claim, async () => {
            let response;
            try { response = await transport.post(claimUrl(page, index), {
                signal: claim.abort.signal, cookie: claim.cookie, referer: pageUrl(claim.id)
            }); } catch {
                if (live(claim)) finish(claim, 'Claim request failed; result unknown', '§cThe claim request failed, so Fury cannot tell whether it went through. Check the page:', !claim.sender);
                return;
            }
            if (!live(claim)) return;
            if (response.status !== 200 || typeof response.body !== 'string' || response.body.trim() !== 'reward claimed') {
                finish(claim, 'Hypixel did not confirm the claim', `§cHypixel did not accept the claim (HTTP ${Number(response.status) || 0}). Someone may have claimed it first.`, !claim.sender);
                return;
            }
            claim.state = 'sent'; claim.sentAt = now(); claim.cookie = ''; claim.page = null;
            claim.outcome = `Claimed ${text.summary(row)}${claim.sender ? ' for ' + claim.sender : ''}`;
            remember(handled, claim.id, claim.outcome);
            say(`§aClaimed ${text.legacy(row.rarity)}${text.summary(row)}§a${claim.sender ? ' for ' + claim.sender : ''}.`);
        });
    }

    function observeClient(data, meta) {
        if (meta.name !== 'close_window' && meta.name !== 'window_click') return;
        if (disposed || !settings().enabled) return;
        if (meta.name === 'close_window') { if (windowId === data.windowId) windowId = null; return; }
        if (meta.name !== 'window_click' || windowId == null || data.windowId !== windowId) return;
        click = { id: windowId, at: now() }; bookAt = null;
        // Use the monitor's server-owned item; a client-supplied stack alone
        // cannot authorize hiding a book. The actual click still passes through.
        let item;
        try { item = menuMonitor.getWindow()?.slots.get(data.slot) || describeItem(data.item); } catch { return; }
        // Hypixel shows the website reward as "Loading..." until the menu has
        // finished filling, but still answers a click on it with the link book.
        if (/^Daily Reward(?: \(#\d{1,6}\))?$/.test(item?.plainName || '')
            && item.plainLore?.slice(0, 64).includes('Click here to get the link in chat!')
            || item?.plainName === 'Loading...' && !item.plainLore?.length) bookAt = now();
    }

    function observeServer(data, meta) {
        if (disposed) return false;
        if (meta.name === 'open_window') {
            windowId = data.windowId > 0 && visible(decodeTitle(data.windowTitle)) === 'The Delivery Man' ? data.windowId : null;
            click = bookAt = null; return false;
        }
        if (meta.name === 'close_window') { if (windowId === data.windowId) windowId = null; return false; }
        if (meta.name === 'respawn' || meta.name === 'login') { windowId = click = bookAt = null; return false; }
        if (meta.name === 'custom_payload' && data.channel === 'MC|BOpen') {
            const armed = bookAt; bookAt = null;
            if (armed == null || now() < armed || now() - armed > 3000 || !settings().enabled || isApiPaused() || !isCurrent()) return false;
            closeDelivery(); return true;
        }
        if (meta.name !== 'chat' || Number(data.position || 0) === 2 || typeof data.message !== 'string'
            || data.message.length > 8192 || !settings().enabled) return false;
        if (!data.message.includes('claim-reward/') && !data.message.includes('You have claimed a ')) return false;
        let root, line;
        try { root = JSON.parse(data.message); line = visible(extractText(root)); } catch { return false; }
        const confirmation = /^You have claimed a \[([^\]§]{1,64})\] reward card!$/.exec(line);
        if (confirmation && own?.state === 'sent' && now() - own.sentAt <= 30000) own.confirmed = confirmation[1];
        const match = OWN_LINK.exec(line);
        if (!match || !click || now() < click.at || now() - click.at > 10000 || !actionsMatch(root, match[1])) return false;
        click = null;
        closeDelivery(); start(match[1]);
        return false;
    }

    function rewriteClientbound(data, original = data) {
        if (disposed || Number(original.position || 0) === 2 || typeof original.message !== 'string'
            || original.message.length > 8192 || !original.message.includes('claim-reward/')
            || !settings().enabled || !settings().others) return data;
        let root, link;
        try { root = JSON.parse(data.message); link = findSharedLink(extractText(JSON.parse(original.message))); } catch { return data; }
        if (!link) return data;
        if (root && typeof root === 'object' && !Array.isArray(root) && root.extra != null && !Array.isArray(root.extra)) return data;
        remember(senders, link.id, link.name);
        // Wrap strings/arrays rather than dropping parts of an unusual server component.
        const copy = root && typeof root === 'object' && !Array.isArray(root) ? { ...root, extra: [...(root.extra || [])] }
            : { text: '', extra: [typeof root === 'string' ? plain(root) : { text: '', extra: root }] };
        copy.extra.push(button(' [CLAIM REWARD]', 'yellow', 'run_command', `/dailyreward open ${link.id}`,
            `§eLoad ${link.name}'s daily reward cards\n§7You pick the card; the reward goes to ${link.name}.`));
        return { ...data, message: JSON.stringify(copy) };
    }

    function command(args) {
        if (disposed || !isCurrent()) return;
        const [sub = '', value, choice] = args;
        if (sub === 'on' || sub === 'off' || sub === 'others' || sub === 'mode') {
            const next = settings();
            if (['on', 'off'].includes(sub) && args.length === 1) next.enabled = sub === 'on';
            else if (sub === 'others' && args.length === 2 && ['on', 'off'].includes(value)) next.others = value === 'on';
            else if (sub === 'mode' && args.length === 2 && ['manual', 'auto'].includes(value)) next.mode = value;
            else { say('§cUsage: /dailyreward [on|off|others on|off|mode manual|auto]'); return; }
            try {
                saveSettings(next); syncSettings();
                say(`§7Daily Reward ${next.enabled ? '§aon' : '§coff'} §8· §7Other players ${next.others ? '§aon' : '§coff'} §8· §7Mode §f${next.mode}`);
                if (sub === 'mode' && value === 'auto') say('§7Auto mode claims a card without a click only when your saved reward preferences have a clear winner. Otherwise, you pick.');
            }
            catch { say('§cDaily Reward settings could not be saved.'); }
            return;
        }
        if (sub === 'status' || !sub && own?.state !== 'ready') {
            const value = settings();
            say(`§7${value.enabled ? '§aOn' : '§cOff'} §8· §7Mode §f${value.mode} §8· §7Last: §f${own?.outcome || 'no reward link yet'}${own?.confirmed ? ` §8(Hypixel confirmed [${own.confirmed}])` : ''}`);
            say(`§7Other players' links: ${value.others ? '§aon' : '§coff'} §8· §7Last: §f${shared?.outcome || 'none'}`);
            return;
        }
        if (!settings().enabled) { say('§eDaily Reward is off. Use /dailyreward on.'); return; }
        if (isApiPaused()) { say('§eReward requests are paused by /apikill.'); return; }
        if ((!sub || sub === 'open') && args.length <= 1) {
            if (own?.state === 'ready') picker(own); else say('§7No daily reward is waiting. Click Daily Reward at the Delivery Man first.');
            return;
        }
        if (sub === 'open' && args.length === 2 && ID.test(value)) {
            if (own?.id === value) { start(value); return; }
            if (!settings().others) { say('§eOther players\' links are off. Use /dailyreward others on.'); return; }
            if (!senders.has(value) && shared?.id !== value) { say('§cUse the [CLAIM REWARD] button next to a player\'s link on this connection.'); return; }
            start(value, senders.get(value) || shared.sender); return;
        }
        if (sub === 'claim' && args.length === 3 && ID.test(value) && /^[1-3]$/.test(choice)) {
            const claim = shared?.id === value ? shared : own?.id === value ? own : null;
            if (!claim) { say('§cThat reward list is no longer current.'); return; }
            if (claim.state !== 'ready') { say(`§7${claim.state === 'claiming' ? 'Already claiming this reward' : 'This reward was already handled: ' + claim.outcome}.`); return; }
            begin(claim, Number(choice) - 1); return;
        }
        say('§7Usage: /dailyreward [status|open|on|off|others on|off|mode manual|auto]. Use [CLAIM] to pick a card.');
    }

    return { observeClient, observeServer, rewriteClientbound, command, syncSettings,
        dispose() { reset(); disposed = true; },
        // Tests can await queued HTTP work without a production polling timer.
        whenIdle: async () => { let pending; do { pending = worker; await pending; } while (pending !== worker); } };
}

module.exports = { createDailyRewards, actionsMatch, findSharedLink, PREFIX };
