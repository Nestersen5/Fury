'use strict';

const fs = require('fs');
const { writeFileAtomic } = require('../storage/atomic_file');
const chat = require('../../features/chat_controller');

const NOTICE_INTROS = Object.freeze({
    updating: 'Updating your saved nicks in the background so they stay linked after name changes.',
    paused: 'Saved nick checks are paused while API requests are off.',
    retrying: 'Some saved nick checks could not finish. Fury will retry in the background.',
    restart: 'Some saved nick checks could not finish. Restart Fury to try again.',
    stopped: 'Start the proxy to update your saved nicks so they stay linked after name changes.',
    unavailable: 'Saved nick checks are waiting for the proxy to respond.'
});

function migrationNoticeText(state) {
    const intro = Object.hasOwn(NOTICE_INTROS, state) ? NOTICE_INTROS[state] : '';
    return intro ? `${intro} Some real names and scan stats may be unavailable until checks finish. You can keep playing.` : '';
}

// Proxy-owned notification preference. It never changes the saved matches or
// feature settings, and only the explicit chat action writes it.
function createDenickMigrationNotice({ file, getStatus, sendChat, track = work => work,
    write = writeFileAtomic }) {
    let dismissed = false, chain = Promise.resolve();
    try { dismissed = JSON.parse(fs.readFileSync(file, 'utf8'))?.dismissed === true; } catch {}

    function notify(client) {
        if (dismissed) return;
        const status = getStatus();
        if (!status?.pendingCount) return;
        const message = migrationNoticeText(status.state);
        if (!message) return;
        sendChat(client, chat.line([
            chat.text('\u00a7b[Denick] '), chat.text(message), chat.text('\n'),
            chat.action("[Don't show again]", '/denick notice off',
                'Hide this game-start reminder, including after restarting Fury. Saved nick checks will continue.')
        ]));
    }

    async function command(client, value) {
        const action = String(value || '').toLowerCase();
        if (!['off', 'on'].includes(action)) {
            sendChat(client, '\u00a77Usage: \u00a7f/denick notice on|off');
            return;
        }
        const next = action === 'off';
        const work = chain.then(async () => {
            await write(file, JSON.stringify({ dismissed: next }));
            dismissed = next;
        });
        chain = work.catch(() => {});
        track(chain);
        try {
            await work;
            sendChat(client, next
                ? '\u00a7b[Denick] \u00a77Game-start reminders hidden. Saved nick checks will continue. \u00a7f/denick notice on \u00a77shows reminders again.'
                : '\u00a7b[Denick] \u00a77Game-start reminders enabled while saved nick checks are pending.');
        } catch {
            sendChat(client, '\u00a7b[Denick] \u00a7cCould not save your reminder choice. Please try again.');
        }
    }
    return { notify, command };
}

module.exports = { migrationNoticeText, createDenickMigrationNotice };
