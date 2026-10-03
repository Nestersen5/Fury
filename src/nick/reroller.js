'use strict';

const { randomBytes } = require('crypto');
const { describeBook } = require('../menu/bookContent');
const { normalizeSettings, matchReason } = require('./settings');
const { createNickPacing } = require('./pacing');
const { showNickRollHelp, showNickRollWords } = require('./help');
const { createUsage } = require('../../features/chat_controller');
const { extractText } = require('../../features/minecraft_chat');

function classifyBook(item) {
    let book;
    try { book = describeBook(item); } catch { return null; }
    if (!book || book.truncated) return null;
    const actions = book.actions.filter(a => a.action === 'run_command' && typeof a.value === 'string').map(a => a.value);
    const accept = actions.find(a => /^\/nick actuallyset [A-Za-z0-9_]{3,16} respawn$/.test(a));
    if (accept && actions.includes('/nick help setrandom')) return { stage: 'candidate', name: accept.split(' ')[2], accept };
    if (actions.includes('/nick help rank NONE')) return { stage: 'rank', actions };
    if (actions.includes('/nick help skin random')) return { stage: 'skin', actions };
    if (actions.includes('/nick help setrandom')) return { stage: 'name', actions };
    return null;
}

function createNickReroller({ sendCommand, sendChat, getSettings, playSound = () => {}, canStart = () => null,
    now = Date.now, setTimer = setTimeout, clearTimer = clearTimeout, timeoutMs = 15000, random = Math.random }) {
    let run = null, candidate = null, selected = 0, disposed = false;
    const books = new Map();
    const pacing = createNickPacing();
    let rolls = 0, started = 0, acceptance = null;
    let lastPause = null;
    let alertTimer = null;
    function silenceAlert() { clearTimer(alertTimer); alertTimer = null; }
    function matchAlert() {
        silenceAlert();
        let remaining = 12;
        const pulse = () => {
            alertTimer = null;
            if (disposed) return;
            playSound({ name: 'note.pling', volume: 1, pitch: 90 });
            if (--remaining > 0) {
                alertTimer = setTimer(pulse, 60);
                alertTimer?.unref?.();
            }
        };
        pulse();
    }
    const say = text => sendChat(`§b§lNick Reroller §8» §7${text}`);
    const token = () => randomBytes(8).toString('hex');
    const settings = () => normalizeSettings(getSettings());
    function clearWork() {
        silenceAlert();
        if (run) { clearTimer(run.timer); run.abort.abort(); }
        run = null;
        acceptance?.abort(); acceptance = null;
        books.clear();
    }
    function stop(reason, invalidate = false) {
        const busy = !!run || !!acceptance;
        clearWork();
        if (invalidate) candidate = null;
        if (busy && !disposed) say(reason);
    }
    function retryOrStop(reason) {
        if (!run || disposed) return;
        if (run.retried) {
            stop(`${reason} Retry failed; stopped. Use /nickroll start to try again manually.`, true);
            return;
        }
        const config = run.config;
        // Replace the owner so a late queue receipt cannot advance the retry.
        clearWork();
        candidate = null;
        const owner = run = { config, abort: new AbortController(), stage: 'retry-wait', timer: null, retried: true };
        say(`${reason} Retrying setup once in 10 seconds. /nickroll stop to cancel.`);
        owner.timer = setTimer(() => {
            if (run !== owner) return;
            request('/nick help start', 'rank', 0);
        }, 10000);
    }
    function result() {
        if (!candidate) return;
        sendChat({ text: `§b§lNick Reroller §8» §f${candidate.name} §7after ${rolls} rolls. ${candidate.reason ? candidate.reason + '. ' : ''}`, extra: [
            { text: '§a[Use Name]', clickEvent: { action: 'run_command', value: `/nickroll use ${candidate.token}` }, hoverEvent: { action: 'show_text', value: 'Apply this nickname' } },
            { text: ' §b[Roll Again]', clickEvent: { action: 'run_command', value: `/nickroll again ${candidate.token}` } }
        ] });
    }
    function request(command, stage, delay) {
        const owner = run;
        const extra = owner.config.adaptive && delay > 0 ? Math.floor(random() * 201) : 0;
        lastPause = { total: delay + extra, extra };
        owner.stage = 'delay';
        clearTimer(owner.timer);
        owner.timer = setTimer(() => {
            if (run !== owner) return;
            const blocked = canStart();
            if (blocked) { stop(blocked, true); return; }
            candidate = null; books.clear();
            owner.stage = 'queued';
            const queuedAt = now();
            owner.timer = setTimer(() => retryOrStop('Command or book response timed out.'), timeoutMs);
            Promise.resolve(sendCommand(command, { signal: owner.abort.signal, priority: 80 })).then(sent => {
                if (run !== owner) return;
                if (!sent?.sent) {
                    if (sent?.reason === 'send-failed') retryOrStop('Could not send the command.');
                    else stop(`Command was not sent (${sent?.reason || 'unavailable'}).`, true);
                    return;
                }
                owner.stage = stage;
                owner.sentAt = Number.isFinite(sent.sentAt) ? sent.sentAt : now();
                owner.queueWait = Math.max(0, owner.sentAt - queuedAt);
                clearTimer(owner.timer);
                owner.timer = setTimer(() => retryOrStop('Book response timed out.'), timeoutMs);
            }).catch(() => { if (run === owner) retryOrStop('Could not send the command.'); });
        }, lastPause.total);
    }
    function start(again = false) {
        if (disposed) return;
        if (run || acceptance) { say('Already busy. Use /nickroll stop first.'); return; }
        const config = settings();
        const blocked = canStart();
        if (blocked) { say(blocked); return; }
        silenceAlert();
        candidate = null; rolls = 0; started = now();
        run = { config, abort: new AbortController(), stage: 'delay', timer: null, retried: false };
        pacing.begin(config.delay);
        say(`Rolling for filters${config.ogEnabled ? ', OG repeated letters' : ''}, or your word lists. Stop: §f/nickroll stop`);
        request(again ? '/nick help setrandom' : '/nick help start', again ? 'candidate' : 'rank', again ? pacing.delay(config.delay, config.adaptive) : 0);
    }
    function observeServer(data, meta) {
        if (disposed) return false;
        const name = meta.name;
        if (['login', 'respawn', 'kick_disconnect', 'open_window'].includes(name)) {
            stop('Stopped: connection, world, or menu changed.', true); selected = 0; return false;
        }
        if (name === 'held_item_slot') selected = data.slot;
        if (acceptance && canStart()) stop('Stopped: another game or menu operation started.', true);
        if (!run) return false;
        if (canStart()) { stop('Stopped: another game or menu operation started.', true); return false; }
        if (name === 'chat') {
            let component = data.message;
            try { if (typeof component === 'string') component = JSON.parse(component); } catch { /* Plain text is also valid. */ }
            const message = extractText(component).trim();
            if (/^(?:You are sending commands too fast|Please slow down|You must wait .+ before (?:using|executing|sending) (?:this |another )?command)/i.test(message)) {
                if (run) {
                    pacing.cooldown(run.config.delay);
                    stop(`Cooldown received. Stopped; next start uses at least ${pacing.delay(run.config.delay, run.config.adaptive)}ms after responses.`, true);
                }
                return false;
            }
            if (/too fast|slow down|wait .*before|nickname.*(?:limit|cannot|can't)|(?:cannot|can't|not allowed|must have).*nick|nick.*(?:permission|available)|Unknown command/i.test(message)) stop('Server rejected or limited the request. See its message.', true);
            return false;
        }
        if (!['rank', 'skin', 'name', 'candidate'].includes(run.stage)) return false;
        if (name === 'set_slot' && data.windowId === 0 && data.slot >= 36 && data.slot <= 44) books.set(data.slot, classifyBook(data.item));
        if (name === 'window_items' && data.windowId === 0) for (let slot = 36; slot <= 44; slot++) books.set(slot, classifyBook(data.items?.[slot]));
        if (name !== 'custom_payload' || data.channel !== 'MC|BOpen') return false;
        const book = books.get(36 + selected);
        books.clear();
        if (!book || book.stage !== run.stage) { retryOrStop('Unexpected book response.'); return false; }
        clearTimer(run.timer);
        const config = run.config;
        // Measure only successful generated-name responses, not setup books or
        // queue contention. Sampling begins at the queue's actual send receipt.
        if (book.stage === 'candidate') pacing.observe(now() - run.sentAt, run.queueWait, config.adaptive);
        const delay = pacing.delay(config.delay, config.adaptive);
        if (book.stage === 'rank') {
            const command = `/nick help rank ${config.rank}`;
            if (!book.actions.includes(command)) { stop('Selected rank was not offered.', true); return false; }
            request(command, 'skin', delay);
        } else if (book.stage === 'skin') {
            const command = config.skin === 'previous'
                ? book.actions.find(action => /^\/nick help skin [A-Z0-9_]{1,64}$/.test(action))
                : `/nick help skin ${config.skin}`;
            if (!command) { stop('No previous skin was offered. Choose a preset in Hypixel\'s /nick menu first, or select Random skin in the launcher.', true); return false; }
            request(command, 'name', delay);
        } else if (book.stage === 'name') request('/nick help setrandom', 'candidate', delay);
        else {
            rolls++;
            candidate = { name: book.name, command: book.accept, token: token(), reason: matchReason(book.name, config) };
            if (candidate.reason) { clearWork(); result(); matchAlert(); }
            else {
                say(`Roll #${rolls}: §f${book.name}§7.`);
                request('/nick help setrandom', 'candidate', delay);
            }
        }
        return true;
    }
    function observeCommand(message) {
        if (/^\/(?:nick|unnick)(?:\s|$)/i.test(message)) stop('Stopped: manual nickname command.', true);
        if (/^\/(?:quickbuy|qb|hotbar|hb|quickbuyandhotbar|qbahb|kmlog)(?:\s|$)/i.test(message)) stop('Stopped: another menu operation requested.', true);
    }
    function command(args) {
        const sub = (args[1] || 'help').toLowerCase();
        if (sub === 'start') return start();
        if (sub === 'stop') { stop('Stopped.'); result(); return; }
        if (sub === 'status') {
            const help = createUsage(sendChat, 'Nick Reroller · Status', 'Current search progress.');
            help.field('State', run ? `Rolling: ${run.stage}` : 'Stopped');
            help.field('Rolls', String(rolls));
            help.field('Elapsed', `${started ? Math.floor((now() - started) / 1000) : 0}s`);
            help.field('Candidate', candidate?.name || 'None');
            return;
        }
        if (sub === 'words' && !args[2]) {
            showNickRollWords(sendChat, settings());
            return;
        }
        if (sub === 'use' || sub === 'again') {
            if (run || acceptance || !candidate || args[2] !== candidate.token) { say('This action is stale. Use the latest result.'); return; }
            if (sub === 'again') return start(true);
            silenceAlert();
            const blocked = canStart();
            if (blocked) { stop(blocked, true); say(blocked); return; }
            const chosen = candidate;
            candidate = null;
            const abort = acceptance = new AbortController();
            Promise.resolve(sendCommand(chosen.command, { signal: abort.signal, priority: 20 })).then(sent => {
                if (acceptance !== abort || disposed) return;
                acceptance = null;
                say(sent?.sent ? `Acceptance sent for §f${chosen.name}§7. Check Hypixel's confirmation.` : 'Acceptance was not sent.');
            }).catch(() => { if (acceptance === abort) { acceptance = null; say('Acceptance failed.'); } });
            return;
        }
        showNickRollHelp(sendChat);
    }
    return { command, observeServer, observeCommand, observeClient(data, meta) {
        if (meta.name === 'held_item_slot') selected = data.slotId;
    }, dispose() { disposed = true; stop('', true); },
        isBusy: () => !!run || !!acceptance };
}

module.exports = { createNickReroller, classifyBook };
