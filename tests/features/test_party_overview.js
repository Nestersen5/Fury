'use strict';
const REPOSITORY_ROOT = require('path').resolve(__dirname, '../..');

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const {
    classifyPartyOverview,
    parseUrchinTags,
    parseSeraphTag,
    summarizePartyOverview
} = require('../../src/party/overview.js');

const reportTooltip = 'Cheating (Added by Watcher 2026-08-11) - Reach and velocity evidence';
const cautionTooltip = 'Caution (Added by Mod 2026-08-10) THIS TAG DOES NOT MEAN THE PLAYER IS CHEATING! - Replay shows unusual bridge timing';

const report = classifyPartyOverview({
    data: {
        player: { displayname: 'ReportPlayer' },
        urchin: { ok: true, rawTags: [{ tooltip: reportTooltip }] }
    }
});
assert.strictEqual(report.state, 'flagged');
assert.strictEqual(report.reports.length, 1);
assert.strictEqual(report.reports[0].exactReason, 'Reach and velocity evidence');

const caution = classifyPartyOverview({
    data: {
        player: { displayname: 'CautionPlayer' },
        urchin: { ok: true, rawTags: [{ tooltip: cautionTooltip }] }
    }
});
assert.strictEqual(caution.state, 'caution', 'A caution must not be classified as a provider report.');
assert.strictEqual(caution.cautions.length, 1);
assert(caution.cautions[0].exactReason.includes('Replay shows unusual bridge timing'), 'Caution output must preserve the provider reason.');

const serviceNotice = classifyPartyOverview({
    data: {
        player: { displayname: 'NoticePlayer' },
        urchin: {
            ok: true,
            rawTags: [{
                tooltip: 'Caution (Added by Unknown 2026-07-22) - Notice for the developer of this service: the Urchin API is deprecated and shuts down on July 31. Blacklist tags are no longer being updated. Migrate to the new API - docs: https://api.urchin.gg'
            }]
        }
    }
});
assert.strictEqual(serviceNotice.state, 'notice', 'A service notice must never flag the player.');
assert.strictEqual(serviceNotice.reports.length, 0);

const seraph = parseSeraphTag({
    tagged: true,
    report_type: 'Fallback',
    tooltip: 'Velocity: Consistent abnormal knockback (2026-08-11 by Auditor)'
});
assert.strictEqual(seraph.value, 'Velocity');
assert.strictEqual(seraph.addedBy, 'Auditor');
assert.strictEqual(seraph.when, '2026-08-11');
assert.strictEqual(seraph.exactReason, 'Consistent abnormal knockback');

const failed = classifyPartyOverview({
    data: {
        player: { displayname: 'UnknownPlayer' },
        urchin: { ok: false, requestStatus: 'rate_limited', error: 'Urchin API is rate limited.' }
    }
});
assert.strictEqual(failed.state, 'unknown');
assert.strictEqual(failed.reason, 'Urchin API is rate limited.');

assert.deepStrictEqual(
    summarizePartyOverview([
        { verdict: report }, { verdict: caution }, { verdict: serviceNotice }, { verdict: failed },
        { verdict: { state: 'clear' } }, { verdict: { state: 'nicked' } }
    ]),
    { flagged: 1, caution: 1, clear: 1, nicked: 1, unknown: 1, notice: 1 }
);

assert.strictEqual(parseUrchinTags({ rawTags: [{ tooltip: reportTooltip }, { tooltip: reportTooltip }] }).length, 1, 'Duplicate provider tags should render once.');

const proxySource = fs.readFileSync(path.join(REPOSITORY_ROOT, 'proxy.js'), 'utf8');
assert(!proxySource.includes('Local-only: no party, all-chat, or server message was sent.'), 'Party Overview must not print the local-only diagnostic.');
assert(proxySource.includes("sendChat(client, '§r ');"), 'Party Overview output should be framed by an empty chat line.');
assert(proxySource.includes('getOverlayRankNameColor(player)'), 'Party Overview player names should use Hypixel rank colours.');
assert(proxySource.includes('monthlyFkdr') && proxySource.includes('monthlyWlr'), 'Party Overview should include monthly ratio data when available.');
assert(proxySource.includes('formatBedwarsPrestige(stats.stars ?? 0)'), 'Party Overview should render BedWars level with its coloured prestige icon.');
assert(!proxySource.includes('§fStars: §b${stats.stars ??'), 'Party Overview should not render the raw Stars label/value pair.');
assert(/function partyOverviewTagColor\(tag = \{\}\)[\s\S]*seraph[\s\S]*'dark_aqua'[\s\S]*'light_purple'/.test(proxySource), 'Party Overview should color Seraph dark aqua and Urchin pink.');

console.log('party overview tests passed');
