'use strict';

const { stripAnsi } = require('./minecraft_chat');

const NUMBER = '[+-]?\\d+(?:\\.\\d+)?';
const QUESTION = new RegExp(`^QUICK MATHS!\\s*(${NUMBER})\\s*([+*/x×÷−-])\\s*(${NUMBER})\\s*=\\s*\\?`, 'i');
const OPTIONS = new RegExp(`^(?:\\s*\\[${NUMBER}\\]){2,}\\s*(?:\\(Click\\))?\\s*$`, 'i');
const CHALLENGE_LIFETIME_MS = 10_000;

// Read only visible components, retaining inherited clicks across split labels.
// Hover text and translated player-chat payloads are never challenge input.
function visibleSpans(component, inherited = null, spans = []) {
    if (Array.isArray(component)) {
        component.forEach(part => visibleSpans(part, inherited, spans));
    } else if (typeof component === 'string') {
        spans.push({ text: stripAnsi(component), click: inherited });
    } else if (component && typeof component === 'object' && !component.translate) {
        const click = component.clickEvent === undefined ? inherited : component.clickEvent;
        if (component.text !== undefined) spans.push({ text: stripAnsi(String(component.text)), click });
        if (Array.isArray(component.extra)) visibleSpans(component.extra, click, spans);
    }
    return spans;
}

function solveQuestion(match) {
    const left = Number(match[1]), right = Number(match[3]);
    let answer;
    switch (match[2].toLowerCase()) {
        case '+': answer = left + right; break;
        case '-': case '−': answer = left - right; break;
        case '*': case 'x': case '×': answer = left * right; break;
        case '/': case '÷': answer = right === 0 ? NaN : left / right; break;
    }
    return Number.isFinite(answer) && Math.abs(answer) <= Number.MAX_SAFE_INTEGER ? answer : null;
}

function answerChoices(spans) {
    const text = spans.map(span => span.text).join('');
    const choices = [];
    for (const match of text.matchAll(new RegExp(`\\[(${NUMBER})\\]`, 'g'))) {
        let offset = 0;
        const commands = new Set();
        for (const span of spans) {
            const end = offset + span.text.length;
            // Brackets may have no click; every character of the number must.
            if (span.text.length && end > match.index + 1 && offset < match.index + match[0].length - 1) {
                const click = span.click;
                commands.add(click?.action === 'run_command' && typeof click.value === 'string'
                    && /^\/[^\s/][^\r\n\u0000-\u001f]*$/.test(click.value) && click.value.length <= 256
                    ? click.value : null);
            }
            offset = end;
        }
        if (commands.size === 1 && !commands.has(null)) {
            choices.push({ answer: Number(match[1]), command: [...commands][0] });
        }
    }
    return choices;
}

function createQuickMathsSession(options = {}) {
    const {
        isEnabled = () => false, isPlayState = () => true, sendCommand = () => {},
        random = Math.random, now = Date.now,
        setTimeout: setTimer = setTimeout, clearTimeout: clearTimer = clearTimeout
    } = options;
    let challenge = null;
    let expiryTimer = null, answerTimer = null;
    let dead = false, spectator = false, respawning = false;
    let dimension = null;
    let pausedAt = null, pausedMs = 0;
    const activeNow = () => (pausedAt === null ? now() : pausedAt) - pausedMs;

    function clearTimers() {
        if (expiryTimer !== null) clearTimer(expiryTimer);
        if (answerTimer !== null) clearTimer(answerTimer);
        expiryTimer = answerTimer = null;
    }

    function reset() {
        clearTimers();
        challenge?.controller?.abort();
        challenge = null;
    }

    function schedule() {
        clearTimers();
        if (!challenge || pausedAt !== null) return;
        const current = challenge;
        // A busy command queue must not push an automatic answer past 9s.
        // The extra millisecond includes the exact 9000ms boundary.
        const expiresAt = current.command && !current.completed
            ? Math.min(current.expiresAt, current.answerDeadline + 1) : current.expiresAt;
        if (activeNow() >= expiresAt) { reset(); return; }
        expiryTimer = setTimer(() => { if (challenge === current) reset(); }, expiresAt - activeNow());
        expiryTimer?.unref?.();
        if (!current.command || current.completed || current.pending) return;
        answerTimer = setTimer(() => {
            answerTimer = null;
            if (challenge !== current || pausedAt !== null || !isEnabled() || !isPlayState()
                || activeNow() > current.answerDeadline || activeNow() >= current.expiresAt) return;
            current.controller = new AbortController();
            current.pending = true;
            const settled = result => {
                if (challenge !== current) return;
                current.pending = false;
                // Only an explicitly cancelled queue entry can be resumed. An
                // already-sent command must never be repeated after a death.
                current.completed = current.completed || result?.reason !== 'cancelled';
                if (!current.completed) schedule();
            };
            const result = sendCommand(current.command, { signal: current.controller.signal, priority: 25 });
            if (result && typeof result.then === 'function') result.then(settled, () => settled());
            else settled(result);
        }, Math.max(0, current.answerAt - activeNow()));
        answerTimer?.unref?.();
    }

    function syncPause() {
        const paused = dead || spectator || respawning;
        if (paused === (pausedAt !== null)) return;
        if (paused) {
            pausedAt = now();
            clearTimers();
            challenge?.controller?.abort();
        } else {
            pausedMs += now() - pausedAt;
            pausedAt = null;
            schedule();
        }
    }

    function setGameMode(mode) {
        if (!Number.isInteger(mode) || mode < 0 || mode > 3) return;
        if (spectator && mode !== 3) dead = respawning = false;
        spectator = mode === 3;
        syncPause();
    }

    function observeServer(data = {}, meta = {}) {
        if (meta.name === 'login') {
            reset();
            dead = spectator = respawning = false;
            pausedAt = null; pausedMs = 0;
            dimension = data.dimension ?? null;
            setGameMode(Number(data.gameMode) & 7);
            return;
        }
        if (meta.name === 'respawn') {
            // A same-world death respawn continues the challenge; a transfer
            // or ordinary world replacement must still discard the old answer.
            const mode = data.gamemode;
            const sameWorld = dimension !== null && data.dimension === dimension;
            if (pausedAt === null || !sameWorld || !Number.isInteger(mode)) reset();
            dimension = data.dimension ?? null;
            dead = respawning = false;
            setGameMode(mode);
            syncPause();
            return;
        }
        if (meta.name === 'update_health' && Number.isFinite(data.health)) {
            dead = data.health <= 0;
            syncPause();
            return;
        }
        if (meta.name === 'game_state_change' && Number(data.reason) === 3) {
            setGameMode(data.gameMode);
            return;
        }
        if (meta.name === 'player_info' && [0, 1, 'add_player', 'update_game_mode', 'update_gamemode'].includes(data.action)) {
            const own = data.data?.find(player => options.isOwnUuid?.(player.uuid));
            if (own) setGameMode(own.gamemode);
            return;
        }
        const enabled = isEnabled();
        if (!enabled && challenge) reset();
        // Keep respawn state current while disabled, without parsing ordinary
        // chat packets when there is no death countdown to finish.
        if (!enabled && !respawning && meta.name !== 'title') return;
        // Fury's upstream and downstream connections use Minecraft 1.8.9.
        const isTitle = meta.name === 'title' && (data.action === 0 || data.action === 1);
        if ((!isTitle && meta.name !== 'chat') || Number(data.position) === 2 || !isPlayState()) return;
        let component = isTitle ? data.text : data.message;
        if (typeof component === 'string') {
            try { component = JSON.parse(component); } catch { return; }
        }
        const spans = visibleSpans(component);
        const text = spans.map(span => span.text).join('').trim();
        if (/^(?:YOU DIED!|You will respawn in \d+(?:\.\d+)? seconds?!)$/i.test(text)) {
            respawning = true; syncPause(); return;
        }
        if (/^(?:You have respawned!|RESPAWNED!)$/i.test(text)) {
            dead = respawning = false; syncPause(); return;
        }
        if (isTitle || !enabled) return;
        if (challenge && activeNow() >= challenge.expiresAt) reset();
        if (/^(?:QUICK MATHS!\s*)?(?:Correct!|Incorrect!|Wrong answer!|You ran out of time!|Time(?:'s| is) up!)$/i.test(text)) {
            reset();
            return;
        }
        const question = text.match(QUESTION);
        let choicesText = text;
        if (question) {
            choicesText = text.slice(question[0].length).trim();
            if (choicesText && !OPTIONS.test(choicesText)) return;
            const answer = solveQuestion(question);
            if (answer === null) { reset(); return; }
            const signature = question[0];
            if (!challenge || challenge.signature !== signature) {
                reset();
                const startedAt = activeNow();
                challenge = { signature, answer, expiresAt: startedAt + CHALLENGE_LIFETIME_MS,
                    answerAt: startedAt + 8000 + Math.floor(Math.max(0, Math.min(1, random())) * 1000),
                    answerDeadline: startedAt + 9000,
                    scheduled: false, commands: new Set(), pending: false, completed: false };
                schedule();
            }
        }
        if (!challenge || challenge.scheduled || !OPTIONS.test(choicesText)) return;
        const choices = answerChoices(spans);
        const correct = choices.filter(choice => choice.answer === challenge.answer
            || (!Number.isInteger(choice.answer) && !Number.isInteger(challenge.answer)
                && Math.abs(choice.answer - challenge.answer) <= Number.EPSILON * Math.abs(challenge.answer)));
        if (correct.length !== 1) return;
        challenge.commands = new Set(choices.map(choice => choice.command));
        challenge.scheduled = true;
        challenge.command = correct[0].command;
        schedule();
    }

    function observeCommand(command) {
        if (challenge?.commands.has(String(command).trim())) {
            // Keep this challenge marked answered until it expires, so repeated
            // question/options packets cannot arm it again after a manual click.
            challenge.completed = true;
            challenge.controller?.abort();
            schedule();
        }
    }

    return { observeServer, observeCommand, reset };
}

module.exports = { createQuickMathsSession };
