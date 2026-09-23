'use strict';

// Duels scan runner. Looks up the current duel's opponent(s) and prints, per
// opponent, the stats for the exact mode being played plus — when the family
// has more than one variation (e.g. Classic 1v1 / 2v2) — the family-combined
// "overall" line. Rosters are tiny (1–4 enemies) so we fetch them all at once
// rather than the batched pacing the Bedwars/SkyWars scan needs.
//
// All collaborators are injected; nothing here reaches into proxy.js state
// directly except the shared `state` (for scanMode) passed in.

const { getDuelsRatioColor, getWinrateColor, getDuelsWinstreakColor } = require('../stats/colors.js');

function createDuelsScanRunner(deps) {
    const {
        state,
        sendChat,
        getPlayerDataWithNickDetection,
        getUrchinBatchRaw,
        playerLookupKey,
        collectDuelsStats,
        collectDuelsFamilyStats,
        formatInt,
        getInteractiveTags,
        isLikelyBot,
        getRankedName,
        setLastScanSummary
    } = deps;

    function statLine(label, labelColor, stats) {
        const wlrC = getDuelsRatioColor(stats.wlr);
        const kdrC = getDuelsRatioColor(stats.kdr);
        const wrC = getWinrateColor(stats.winrate);
        const bestC = getDuelsWinstreakColor(stats.bestWs);
        const winrate = `${(stats.winrate * 100).toFixed(1)}%`;
        return {
            text: `   ${labelColor}${label}  `,
            extra: [
                { text: `§8|  §7WLR ${wlrC}${stats.wlr.toFixed(2)}  ` },
                { text: `§8·  §7KDR ${kdrC}${stats.kdr.toFixed(2)}  ` },
                { text: `§8·  §7WR ${wrC}${winrate}  ` },
                { text: `§8·  §7W §a${formatInt(stats.wins)}  ` },
                { text: `§8·  §7WS §e${formatInt(stats.currentWs)}§7/${bestC}${formatInt(stats.bestWs)}` }
            ]
        };
    }

    async function performDuelsScan(client, { opponents = [], modeDef, isStillActive } = {}) {
        const stillActive = typeof isStillActive === 'function' ? isStillActive : () => true;

        if (state.scanMode === 'off') {
            setLastScanSummary?.({ at: new Date().toISOString(), candidates: opponents.length, results: 0, mode: state.scanMode, message: 'Scan mode is off' });
            return false;
        }
        if (!modeDef) {
            sendChat(client, '§cCould not determine the duel mode yet — try /scan again in a moment.');
            return false;
        }
        const names = Array.from(new Set(opponents.filter(Boolean)));
        if (names.length === 0) {
            sendChat(client, '§cNo duel opponents detected yet.');
            return false;
        }

        sendChat(client, `§d§lDuels §8» §7Analyzing §f${names.length} §7opponent${names.length === 1 ? '' : 's'} §8(§d${modeDef.label}§8)...`);

        const urchinBatch = await getUrchinBatchRaw(names);
        if (!stillActive()) return false;

        const lookups = await Promise.allSettled(names.map(name =>
            getPlayerDataWithNickDetection(name, {
                urchinOverride: urchinBatch.get(playerLookupKey(name)) || null,
                apiPriority: 'game'
            })
        ));
        if (!stillActive()) return false;

        const results = lookups.map((res, idx) => ({ name: names[idx], res }));

        // Blank spacer where a section header would otherwise go.
        sendChat(client, '§r ');

        let printed = 0;
        for (const { name, res } of results) {
            if (res.status !== 'fulfilled' || !res.value) {
                sendChat(client, ` §8» §6[FAIL] §f${name} §7- §cHypixel API lookup failed`);
                continue;
            }
            const data = res.value.data;
            if (data.lookupFailed) {
                sendChat(client, ` §8» §6[FAIL] §f${name} §7- §c${data.lookupErrorMessage || 'Hypixel API lookup failed'}`);
                continue;
            }
            if (data.isNicked && !isLikelyBot(name)) {
                sendChat(client, ` §8» §c[NICKED] §f${name} §a✔`);
                continue;
            }

            const p = data.player || {};
            const duels = p.stats?.Duels || {};
            const displayName = getRankedName ? getRankedName(p) : (p.displayname || name);

            const header = {
                text: ` §d● ${displayName}§r `,
                extra: []
            };
            const tags = getInteractiveTags(data.urchin, data.seraph, name);
            if (tags && tags.length) header.extra.push(...tags);
            sendChat(client, header);

            const modeStats = collectDuelsStats(duels, modeDef);
            sendChat(client, statLine(modeDef.label, '§f', modeStats));

            const family = collectDuelsFamilyStats(duels, modeDef.family);
            if (family.modeCount > 1) {
                sendChat(client, statLine(`${modeDef.family} §8(all)`, '§7', family));
            }
            printed += 1;
        }

        sendChat(client, '§r ');
        setLastScanSummary?.({ at: new Date().toISOString(), candidates: names.length, results: printed, mode: state.scanMode, message: 'Duels scan completed', gameMode: 'DUELS' });
        return true;
    }

    return { performDuelsScan };
}

module.exports = { createDuelsScanRunner };
