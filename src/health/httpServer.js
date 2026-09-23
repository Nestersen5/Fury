'use strict';

// Health/status HTTP server extracted from proxy.js. Exposes the launcher
// API: /health snapshot, /overlay/player/* manual overlay,
// /settings-changed reload trigger.
//
// All collaborators are injected because nearly every feature flag the
// payload reports lives behind a getter on proxy.js (the lets get reassigned
// by loadFeatureConfig). Pass getters/snapshots, not raw values.

const express = require('express');
const { buildSettingsAnnouncements } = require('./settingsAnnouncements');
const { normalizeAccount, sameAccount } = require('../accounts/launcherAccounts');

// getSessionHistory returns either the history itself or the proxy cache's
// { revision, history, unchanged }. Only the latter carries a revision, and
// an unchanged reply leaves the history to the launcher's own copy.
function sessionHistoryReply(result) {
    if (!result || typeof result.revision !== 'string') return { sessionHistory: result || null };
    return result.unchanged
        ? { sessionHistory: null, sessionHistoryRevision: result.revision, sessionHistoryUnchanged: true }
        : { sessionHistory: result.history, sessionHistoryRevision: result.revision };
}

function createHealthServer(deps) {
    const {
        state,
        proxyStartTime,
        chatTriggerManager,
        globalCache,
        auroraPingCache,
        getActiveUser,
        getKeys,
        getServerConfigs,
        getLastScanSummary,
        getSessionHistory = () => null,
        removeSession = null,
        removeDenickMapping = null,
        getEnderDustReminderStatus = () => null,
        getSlumberDailyRewardsReminderStatus = () => null,
        getGamblerGeorgeReminderStatus = () => null,
        getFeatures,
        getFeatureCompareSnapshot,
        getApplyLiveFeatureSettings,
        reportOverlayUiVisible,
        proxyHealthSnapshot,
        getHypixelApiUsageSnapshot,
        getUrchinRateLimitSnapshot,
        hasHypixelApiKeyConfigured,
        getPlayerDataWithNickDetection,
        buildOverlayPlayerRow,
        sendChat,
        sendActionBar = null,
        reloadConfig,
        resetUrchinLookupState,
        logger = console
    } = deps;

    function isLocalRequest(req) {
        const address = String(req.socket?.remoteAddress || req.ip || '');
        return address === '127.0.0.1'
            || address === '::1'
            || address === '::ffff:127.0.0.1'
            || address.endsWith(':127.0.0.1');
    }

    function validateSessionAccount(req, res, activeUser) {
        if (!isLocalRequest(req)) {
            res.status(403).json({ ok: false, error: 'Use the local launcher to manage sessions.' });
            return false;
        }
        if (req.body?.account && !sameAccount(req.body.account, { name: activeUser?.name, uuid: activeUser?.client?.uuid || activeUser?.uuid })) {
            res.status(409).json({ ok: false, error: 'Connect the selected account in Minecraft before changing its live session.' });
            return false;
        }
        return true;
    }

    function start(port) {
        const app = express();
        app.use((req, res, next) => deps.isClosing?.() ? res.status(503).json({ error: 'Fury is stopping.' }) : next());
        app.use(express.json());

        app.get('/health', (req, res) => {
            if (typeof reportOverlayUiVisible === 'function') {
                reportOverlayUiVisible(String(req.query.overlayVisible || '') === '1');
            }
            const activeUser = getActiveUser();
            const keys = getKeys();
            const serverConfigs = getServerConfigs();
            const includeSessionHistory = String(req.query.includeSessions || '') === '1';
            let account = null;
            try { account = normalizeAccount(JSON.parse(req.query.sessionAccount || 'null')); } catch {}
            const knownSessionRevision = typeof req.query.sessionRevision === 'string' ? req.query.sessionRevision : null;
            const sessionReply = includeSessionHistory
                ? sessionHistoryReply(getSessionHistory(account, 'sessionAccount' in req.query, knownSessionRevision))
                : { sessionHistory: null };
            res.json({
                ok: true,
                uptimeSeconds: Math.floor((Date.now() - proxyStartTime) / 1000),
                connectionReady: Boolean(activeUser?.upstreamReady),
                connectedAccount: activeUser?.name || null,
                connectedUuid: activeUser?.client?.uuid || activeUser?.uuid || null,
                cacheSize: globalCache.size,
                scanMode: state.scanMode,
                threatConfig: state.threatConfig,
                chatTriggers: chatTriggerManager.getTriggers(),
                proxyHealth: proxyHealthSnapshot(),
                hypixelUsage: getHypixelApiUsageSnapshot(),
                urchinUsage: getUrchinRateLimitSnapshot(),
                features: getFeatures(),
                reminders: {
                    enderDust: getEnderDustReminderStatus(),
                    slumberDailyRewards: getSlumberDailyRewardsReminderStatus(),
                    gamblerGeorge: getGamblerGeorgeReminderStatus()
                },
                liveGame: activeUser?.getLiveGameState ? activeUser.getLiveGameState() : {
                    connected: Boolean(activeUser),
                    account: activeUser?.name || null,
                    gameActive: false,
                    bedwarsPregameActive: false,
                    pregameChatPlayerCount: 0,
                    currentGamemode: null,
                    gameStartTime: null,
                    myTeam: null,
                    rosterCount: 0,
                    lobbyCount: 0,
                    tabStatsActive: false,
                    scanActive: false,
                    overlayPlayers: [],
                    detectedNickedPlayers: [],
                    denickedPlayers: [],
                    pendingAutoDenicks: []
                },
                apiKeys: {
                    hypixel: hasHypixelApiKeyConfigured(),
                    urchin: Boolean(keys.urchin),
                    aurora: Boolean(keys.aurora),
                    seraph: Boolean(keys.seraph)
                },
                ports: {
                    proxy: serverConfigs.map(({ port: serverPort, host, name }) => ({ port: serverPort, host, name })),
                    health: port
                },
                lastScan: getLastScanSummary(),
                // Session snapshots are intentionally left out of the normal
                // health poll. The launcher asks for this compact projection
                // only while its Session History page is open.
                ...sessionReply
            });
        });

        app.post('/session/start', async (req, res) => {
            const activeUser = getActiveUser();
            if (!validateSessionAccount(req, res, activeUser)) return;
            if (!activeUser?.startNewSession) {
                res.status(409).json({ ok: false, error: 'Connect a Minecraft account before starting a session.' });
                return;
            }
            try {
                const session = await (deps.trackDurableWork || (work => work))(activeUser.startNewSession());
                res.json({ ok: Boolean(session), sessionId: session?.id || session || null });
            } catch (error) {
                res.status(500).json({ ok: false, error: error?.message || 'Could not start a new session.' });
            }
        });

        app.post('/session/end', async (req, res) => {
            const activeUser = getActiveUser();
            if (!validateSessionAccount(req, res, activeUser)) return;
            if (!activeUser?.endCurrentSession) {
                res.status(409).json({ ok: false, error: 'No connected session is available.' });
                return;
            }
            try {
                const sessionId = await (deps.trackDurableWork || (work => work))(activeUser.endCurrentSession());
                if (!sessionId) {
                    res.status(409).json({ ok: false, error: 'There is no active session to end.' });
                    return;
                }
                res.json({ ok: true, sessionId });
            } catch (error) {
                res.status(500).json({ ok: false, error: error?.message || 'Could not end the current session.' });
            }
        });

        app.delete('/session/:id', (req, res) => {
            if (!isLocalRequest(req)) {
                res.status(403).json({ ok: false, error: 'Saved sessions can only be removed from the local launcher.' });
                return;
            }
            if (typeof removeSession !== 'function') {
                res.status(503).json({ ok: false, error: 'Session storage is unavailable.' });
                return;
            }
            const account = normalizeAccount(req.body?.account);
            if (req.body?.account && !account) return res.status(400).json({ ok: false, error: 'Invalid account.' });
            const result = removeSession(String(req.params.id || ''), account);
            if (!result?.removed) {
                const active = result?.reason === 'active';
                res.status(active ? 409 : 404).json({
                    ok: false,
                    error: active ? 'End the active session before removing it.' : 'That saved session no longer exists.'
                });
                return;
            }
            res.json({ ok: true, sessionId: result.session?.id || req.params.id });
        });

        app.delete('/denick/:realIGN/:nick', (req, res) => {
            if (!isLocalRequest(req)) {
                res.status(403).json({ ok: false, error: 'Saved nick mappings can only be removed from the local launcher.' });
                return;
            }
            const realIGN = String(req.params.realIGN || '').trim();
            const nick = String(req.params.nick || '').trim();
            if (!/^[A-Za-z0-9_]{3,16}$/.test(realIGN) || !/^[A-Za-z0-9_]{3,16}$/.test(nick)) {
                res.status(400).json({ ok: false, error: 'Invalid saved nickname mapping.' });
                return;
            }
            if (typeof removeDenickMapping !== 'function') {
                res.status(503).json({ ok: false, error: 'Nickname storage is unavailable.' });
                return;
            }
            const result = removeDenickMapping(realIGN, nick);
            if (!result?.removed) {
                res.status(404).json({ ok: false, error: 'That saved nickname mapping no longer exists.' });
                return;
            }
            res.json({ ok: true, realIGN, nick, removedPlayer: Boolean(result.removedPlayer) });
        });

        app.post('/reminders/ender-dust/check', async (req, res) => {
            if (!isLocalRequest(req)) {
                res.status(403).json({ ok: false, error: 'This reminder check is available only from the local launcher.' });
                return;
            }
            const activeUser = getActiveUser();
            if (!activeUser?.checkEnderDustReminder) {
                res.status(409).json({ ok: false, error: 'Connect your Minecraft account before checking Ender Dust.' });
                return;
            }
            try {
                const reminder = await activeUser.checkEnderDustReminder();
                res.json({ ok: true, reminder });
            } catch (error) {
                res.status(500).json({ ok: false, error: error?.message || 'Could not check Ender Dust.' });
            }
        });

        app.get('/overlay/player/:name', async (req, res) => {
            const name = String(req.params.name || '').trim();
            const mode = String(req.query.mode || 'BEDWARS').toUpperCase() === 'SKYWARS' ? 'SKYWARS' : 'BEDWARS';
            if (!/^[A-Za-z0-9_]{3,16}$/.test(name)) {
                res.status(400).json({ ok: false, error: 'Invalid Minecraft username.' });
                return;
            }

            try {
                const activeUser = getActiveUser();
                if (activeUser?.getOverlayPlayerData) {
                    const player = await activeUser.getOverlayPlayerData(name, mode, 'manual');
                    if (player?.lookupFailed) {
                        res.status(502).json({ ok: false, error: player.lookupErrorMessage || player.status || 'Stats lookup failed.' });
                        return;
                    }
                    if (player?.isNicked || !player?.stats || Object.keys(player.stats).length === 0) {
                        res.status(404).json({ ok: false, error: 'No stats available for this player.' });
                        return;
                    }
                    res.json({ ok: true, player });
                    return;
                }

                const profile = await getPlayerDataWithNickDetection(name, { forceRefresh: true });
                const player = buildOverlayPlayerRow(name, profile, { mode, source: 'manual' });
                if (player?.lookupFailed) {
                    res.status(502).json({ ok: false, error: player.lookupErrorMessage || player.status || 'Stats lookup failed.' });
                    return;
                }
                if (player?.isNicked || !player?.stats || Object.keys(player.stats).length === 0) {
                    res.status(404).json({ ok: false, error: 'No stats available for this player.' });
                    return;
                }
                res.json({ ok: true, player });
            } catch (e) {
                res.status(500).json({ ok: false, error: e.message || 'Overlay lookup failed.' });
            }
        });

        app.delete('/overlay/player/:name', (req, res) => {
            const name = String(req.params.name || '').trim();
            const mode = String(req.query.mode || 'BEDWARS').toUpperCase() === 'SKYWARS' ? 'SKYWARS' : 'BEDWARS';
            if (!/^[A-Za-z0-9_]{3,16}$/.test(name)) {
                res.status(400).json({ ok: false, error: 'Invalid Minecraft username.' });
                return;
            }

            const activeUser = getActiveUser();
            if (activeUser?.removeManualOverlayPlayer) {
                const removed = activeUser.removeManualOverlayPlayer(name, mode);
                res.json({ ok: true, removed });
                return;
            }

            res.json({ ok: true, removed: false });
        });

        app.delete('/overlay/players', (req, res) => {
            const mode = String(req.query.mode || 'BEDWARS').toUpperCase() === 'SKYWARS' ? 'SKYWARS' : 'BEDWARS';
            const source = String(req.query.source || 'manual');
            const sourceKey = source.toLowerCase().replace(/[\s_-]+/g, '');
            let removed = 0;

            const activeUser = getActiveUser();
            if (activeUser?.clearManualOverlayPlayersBySource) {
                removed += activeUser.clearManualOverlayPlayersBySource(source, mode, 'launcher');
            }

            if (['live', 'game', 'gamerows', 'gamestart', 'gamestarting', 'roster', 'all'].includes(sourceKey)) {
                if (activeUser?.suppressLiveOverlayRowsForCurrentGame) {
                    removed += activeUser.suppressLiveOverlayRowsForCurrentGame(mode);
                }
            }

            res.json({ ok: true, removed });
        });

        app.post('/settings-changed', (req, res) => {
            const changes = Array.isArray(req.body?.changes) ? req.body.changes : [];
            const silent = Boolean(req.body?.silent);
            const requestedProfile = req.body?.profile && typeof req.body.profile === 'object' ? req.body.profile : null;
            const profileLabel = String(requestedProfile?.label || '').trim().slice(0, 40);
            const oldCompare = getFeatureCompareSnapshot();
            const oldKeys = { ...getKeys() };

            reloadConfig();

            const newKeys = getKeys();
            if (['hypixel', 'urchin', 'aurora', 'seraph'].some(key => oldKeys[key] !== newKeys[key])) {
                globalCache.clear();
                resetUrchinLookupState();
                auroraPingCache.clear();
            }

            const newCompare = getFeatureCompareSnapshot();
            const liveFeatureSettingsChanged = JSON.stringify(oldCompare) !== JSON.stringify(newCompare);
            const applyLiveFeatureSettings = getApplyLiveFeatureSettings();
            if (liveFeatureSettingsChanged && applyLiveFeatureSettings) {
                applyLiveFeatureSettings();
            }

            const activeUser = getActiveUser();
            if (activeUser?.client && !silent) {
                const announcements = buildSettingsAnnouncements(changes, profileLabel);
                if (profileLabel && announcements.length) {
                    sendActionBar?.(activeUser.client, announcements[0]);
                }
                announcements.forEach(message => sendChat(activeUser.client, message));
            }

            res.json({
                ok: true,
                applied: Boolean(liveFeatureSettingsChanged && applyLiveFeatureSettings),
                runtime: newCompare
            });
        });

        return app.listen(port, '127.0.0.1', () => {
            logger.log(`[Health] Status API listening on http://127.0.0.1:${port}/health`);
        }).on('error', (err) => {
            logger.error(`[Health] Could not start status API on port ${port}: ${err.message}`);
        });
    }

    return { start, isLocalRequest };
}

module.exports = { createHealthServer };
