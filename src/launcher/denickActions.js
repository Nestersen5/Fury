'use strict';

const { createDenickHistory } = require('../denick/history');
const { writeFileAtomic } = require('../storage/atomic_file');
const validName = value => /^[A-Za-z0-9_]{3,16}$/.test(value);

function createLauncherDenickActions({ historyFile, axios, getPort, proxyRunning }) {
    let pending = Promise.resolve();
    function run(kind, entry = {}) {
        const action = pending.then(async () => {
            const nick = String(entry.nick || '').trim(), realIGN = String(entry.realIGN || '').trim();
            if (!validName(nick) || !validName(realIGN)) throw new Error('Use valid Minecraft names, 3-16 characters.');
            if (kind === 'add' && nick.toLowerCase() === realIGN.toLowerCase()) throw new Error('Nick and real IGN must be different.');
            const base = `http://127.0.0.1:${getPort()}/denick`;
            try {
                const response = kind === 'add'
                    ? await axios.post(base, { nick, realIGN }, { timeout: 8000 })
                    : await axios.delete(`${base}/${encodeURIComponent(realIGN)}/${encodeURIComponent(nick)}`, { timeout: 8000 });
                return response.data;
            } catch (error) {
                // A timeout/reset can mean the proxy committed but the reply was
                // lost. Never turn that into a competing disk write.
                if (error.code !== 'ECONNREFUSED' || proxyRunning()) {
                    throw new Error(error.response?.data?.error || 'Could not update the saved mapping. Wait for the proxy to be ready and try again.');
                }
            }
            const store = createDenickHistory({
                historyFile,
                writeJsonOffThread: (file, players, label, callback, options) => {
                    writeFileAtomic(file, JSON.stringify(players), 'utf8', options)
                        .then(receipt => callback(null, receipt), error => callback(error.message));
                }
            });
            const result = kind === 'add'
                ? store.appendDenickHistory({ nick, realIGN, method: 'manual', account: 'launcher' })
                : store.removeDenickMapping(realIGN, nick);
            await store.flush({ strict: true });
            if (kind === 'remove' && !result.removed) return { ok: false, error: 'That saved nickname mapping no longer exists.' };
            return { ...result, ok: true };
        });
        pending = action.catch(() => {});
        return action;
    }
    return { add: entry => run('add', entry), remove: entry => run('remove', entry), idle: () => pending };
}
module.exports = { createLauncherDenickActions };
