'use strict';

// Stats lookup orchestration: error classification, nick-detection
// retry, fallback profile shaping, and the runStatsLookupCommand
// wrapper that the per-game render commands all share.
//
// getPlayerData is still defined inside proxy.js (will move into
// src/stats/fetch.js next), so the host injects a `getPlayerData`
// callback rather than this module pulling it directly.

const { sendChat } = require('../../features/minecraft_chat.js');

function createStatsLookup({ getPlayerData, makeUrchinData, makePingData } = {}) {
    if (typeof getPlayerData !== 'function') throw new Error('createStatsLookup requires getPlayerData');
    if (typeof makeUrchinData !== 'function') throw new Error('createStatsLookup requires makeUrchinData');
    if (typeof makePingData !== 'function') throw new Error('createStatsLookup requires makePingData');

    function classifyPlayerLookupError(error, stage = 'hypixel') {
        if (error?.hypixelApiUnavailable) {
            return {
                error: true,
                errorType: error.hypixelApiErrorType || 'hypixel_all_keys_unavailable',
                message: error.hypixelApiReason || 'No healthy Hypixel API key is available.'
            };
        }
        const status = error?.response?.status;
        const body = error?.response?.data;
        const bodyText = typeof body === 'string'
            ? body
            : [body?.cause, body?.reason, body?.message, JSON.stringify(body || {})].filter(Boolean).join(' ');
        const clean = bodyText.toLowerCase();

        if (stage === 'mojang' || status === 204 || status === 404) {
            return { error: true, errorType: 'player_not_found', message: 'Player was not found.' };
        }

        if (status === 401 || status === 403 || clean.includes('invalid api key') || clean.includes('api key')) {
            return { error: true, errorType: 'hypixel_key_failed', message: 'Hypixel API key is invalid, expired, or revoked.' };
        }

        if (status === 429) {
            return { error: true, errorType: 'hypixel_rate_limited', message: 'Hypixel API is rate limited.' };
        }

        if (status >= 500) {
            return { error: true, errorType: 'hypixel_api_error', message: 'Hypixel API is unavailable.' };
        }

        return { error: true, errorType: 'lookup_failed', message: 'Player lookup failed.' };
    }

    function makeFallbackPlayerProfile(name, options = {}) {
        return {
            data: {
                player: {
                    displayname: name,
                    achievements: { bedwars_level: 0 },
                    stats: {
                        Bedwars: { final_kills_bedwars: 0, final_deaths_bedwars: 1 },
                        SkyWars: {}
                    },
                    packageRank: 'NORMAL'
                },
                urchin: makeUrchinData(),
                ping: makePingData({
                    ok: false,
                    requestStatus: 'not_checked',
                    error: 'No ping lookup was available.'
                }),
                seraph: null,
                status: options.status || '§7Unknown',
                isNicked: Boolean(options.isNicked),
                lookupFailed: Boolean(options.lookupFailed),
                lookupErrorType: options.errorType || '',
                lookupErrorMessage: options.message || ''
            },
            fromCache: false
        };
    }

    function isNickedLookupMiss(profile) {
        return !profile || (profile.error && ['player_not_found', 'hypixel_player_missing'].includes(profile.errorType));
    }

    function sendPlayerLookupError(client, target, result) {
        const errorType = result?.errorType || 'lookup_failed';
        if (errorType === 'hypixel_key_failed') {
            return sendChat(client, `§cHypixel API key is invalid/expired. Update it with §e/apikey hypixel <key>§c.`);
        }
        if (errorType === 'hypixel_rate_limited') {
            return sendChat(client, '§cHypixel API is rate limited. Try again in a bit.');
        }
        if (errorType === 'hypixel_all_keys_unavailable') {
            return sendChat(client, `§cBoth Hypixel API keys are unavailable: §7${result?.message || 'all keys are invalid or rate limited.'}`);
        }
        if (errorType === 'hypixel_api_error' || errorType === 'lookup_failed') {
            return sendChat(client, '§cHypixel API lookup failed. Try again later.');
        }
        if (errorType === 'hypixel_player_missing') {
            return sendChat(client, `§c${target} exists, but has no Hypixel profile data.`);
        }
        return sendChat(client, `§cPlayer not found: §f${target}`);
    }

    function profileLookupFailureReason(profile = null) {
        if (!profile) return 'No response was returned by the lookup pipeline.';
        if (profile.error) return profile.message || 'The lookup returned an error.';
        if (profile.data?.lookupFailed) return profile.data.lookupErrorMessage || profile.data.status || 'The lookup failed.';
        if (!profile.data) return 'The lookup returned no data object.';
        if (!profile.data.player) return 'The lookup returned no player object.';
        return '';
    }

    async function runStatsLookupCommand(client, commandLabel, target, renderProfile, options = {}) {
        try {
            // includeStatus triggers a second Hypixel API request (/status). Keep it
            // opt-in so stats commands stay at one request per player; only /info,
            // where the current server is the point, asks for it.
            const profile = await getPlayerData(target, { includeErrors: true, includeStatus: Boolean(options.includeStatus) });
            if (profile?.error) {
                sendPlayerLookupError(client, target, profile);
                return null;
            }

            const missingReason = profileLookupFailureReason(profile);
            if (missingReason) {
                sendChat(client, `§c${commandLabel} failed for §f${target}§c: §7${missingReason}`);
                return null;
            }

            try {
                await renderProfile(profile);
                return profile;
            } catch (renderError) {
                console.error(`[StatsCommand] ${commandLabel} render failed for ${target}:`, renderError?.stack || renderError);
                sendChat(client, `§c${commandLabel} failed for §f${target}§c: §7Could not render the stats card (${renderError?.message || 'unknown error'}).`);
                return null;
            }
        } catch (error) {
            const classified = classifyPlayerLookupError(error, 'hypixel');
            console.error(`[StatsCommand] ${commandLabel} lookup failed for ${target}: ${classified.message}`, error?.stack || error);
            if (classified?.error) {
                sendPlayerLookupError(client, target, classified);
            } else {
                sendChat(client, `§c${commandLabel} failed for §f${target}§c: §7${error?.message || 'Unexpected lookup error.'}`);
            }
            return null;
        }
    }

    async function getPlayerDataWithNickDetection(name, options = {}) {
        const profile = await getPlayerData(name, { includeErrors: true, ...options });

        if (profile && profile.data && profile.data.player) {
            return { data: { ...profile.data, isNicked: false }, fromCache: profile.fromCache };
        }

        if (isNickedLookupMiss(profile)) {
            await new Promise(resolve => setTimeout(resolve, 300));
            const retryProfile = await getPlayerData(name, { includeErrors: true, ...options });

            if (retryProfile && retryProfile.data && retryProfile.data.player) {
                return { data: { ...retryProfile.data, isNicked: false }, fromCache: retryProfile.fromCache };
            }

            if (isNickedLookupMiss(retryProfile)) {
                return {
                    data: {
                        player: {
                            displayname: name,
                            achievements: { bedwars_level: 0 },
                            stats: { Bedwars: { final_kills_bedwars: 0, final_deaths_bedwars: 1 } },
                            packageRank: 'NORMAL'
                        },
                        urchin: makeUrchinData(),
                        ping: makePingData({
                            ok: false,
                            requestStatus: 'not_checked',
                            error: 'No ping lookup was available.'
                        }),
                        status: '§cNicked Account',
                        isNicked: true
                    },
                    fromCache: false
                };
            }

            return makeFallbackPlayerProfile(name, {
                lookupFailed: true,
                errorType: retryProfile?.errorType || 'lookup_failed',
                message: retryProfile?.message || 'Player lookup failed.',
                status: '§cAPI Lookup Failed'
            });
        }

        if (profile?.error) {
            return makeFallbackPlayerProfile(name, {
                lookupFailed: true,
                errorType: profile.errorType,
                message: profile.message,
                status: '§cAPI Lookup Failed'
            });
        }

        return { data: { ...profile.data, isNicked: false }, fromCache: profile?.fromCache };
    }

    return {
        classifyPlayerLookupError,
        makeFallbackPlayerProfile,
        isNickedLookupMiss,
        sendPlayerLookupError,
        profileLookupFailureReason,
        runStatsLookupCommand,
        getPlayerDataWithNickDetection
    };
}

module.exports = { createStatsLookup };
