'use strict';

const assert = require('assert');
const {
    DAILY_REWARD_TIME_ZONE,
    SUPPORTED_DAILY_NPC_NAMES,
    getDailyRewardResetWindow,
    extractSlumberDailyRewards,
    calculateDailyRewardStatuses,
    createSlumberDailyRewardsReminder
} = require('../../features/slumber_daily_rewards_reminder.js');

const beforeSummerReset = Date.UTC(2025, 6, 1, 3, 0, 0); // 23:00 EDT / 05:00 Poland
const afterWinterReset = Date.UTC(2025, 10, 15, 6, 0, 0); // 01:00 EST / 07:00 Poland
const summerWindow = getDailyRewardResetWindow(beforeSummerReset);
assert.strictEqual(DAILY_REWARD_TIME_ZONE, 'America/New_York');
assert.strictEqual(SUPPORTED_DAILY_NPC_NAMES.size, 11, 'only the selected Slumber daily NPCs should be tracked');
assert.strictEqual(summerWindow.nextResetAt, Date.UTC(2025, 6, 1, 4, 0, 0), 'summer reset must be midnight EDT / 06:00 in Poland');
assert.strictEqual(summerWindow.currentResetAt, Date.UTC(2025, 5, 30, 4, 0, 0), 'the previous midnight Eastern reset must remain active before the new reset');

const winterWindow = getDailyRewardResetWindow(afterWinterReset);
assert.strictEqual(winterWindow.currentResetAt, Date.UTC(2025, 10, 15, 5, 0, 0), 'winter reset must be midnight EST / 06:00 in Poland');
assert.strictEqual(winterWindow.nextResetAt, Date.UTC(2025, 10, 16, 5, 0, 0), 'the next reset must follow the current Eastern calendar day');

function playerPayload(lastCompleted) {
    return {
        player: {
            displayname: 'FuryUser',
            stats: {
                Bedwars: {
                    slumber: {
                        quest: { lastCompleted }
                    }
                }
            }
        }
    };
}

const extracted = extractSlumberDailyRewards(playerPayload({
    npc_arcade_player: Date.UTC(2025, 10, 14, 5, 0, 0),
    npc_general_daku: String(Date.UTC(2025, 10, 15, 5, 30, 0) / 1000),
    gambler_george: Date.UTC(2025, 10, 15, 5, 0, 0)
}));
assert.strictEqual(extracted.profileName, 'FuryUser');
assert.deepStrictEqual(extracted.rewards.map(reward => reward.npc), ['Npc Arcade Player', 'Npc General Daku']);
assert.strictEqual(extracted.rewards[1].lastCompletedAt, Date.UTC(2025, 10, 15, 5, 30, 0), 'second timestamps should normalize to milliseconds');
assert.strictEqual(extractSlumberDailyRewards({ player: {} }), null, 'missing quest data should not create fake NPC rewards');

const statuses = calculateDailyRewardStatuses(extracted.rewards, afterWinterReset).rewards;
assert.strictEqual(statuses.find(reward => reward.npc === 'Npc Arcade Player').available, true, 'a reward completed before the current reset is ready');
const generalDaku = statuses.find(reward => reward.npc === 'Npc General Daku');
assert.strictEqual(generalDaku.available, false, 'a reward completed after the current reset must wait for the next reset');
assert.strictEqual(generalDaku.remainingText, '23h 0m');

async function run() {
    let enabled = true;
    let now = afterWinterReset;
    const notices = [];
    const reminder = createSlumberDailyRewardsReminder({
        getEnabled: () => enabled,
        isApiAvailable: () => true,
        getOwnUuid: async () => '0123456789abcdef0123456789abcdef',
        fetchPlayer: async () => playerPayload({
            npc_arcade_player: Date.UTC(2025, 10, 14, 5, 0, 0),
            npc_general_daku: Date.UTC(2025, 10, 15, 5, 30, 0),
            gambler_george: Date.UTC(2025, 10, 15, 5, 0, 0)
        }),
        sendChat: message => notices.push(message),
        logger: { warn() {} },
        now: () => now
    });

    await reminder.checkNow();
    assert.strictEqual(reminder.getStatus().readyCount, 1);

    reminder.onGameplayMilestone();
    assert.strictEqual(notices.length, 1, 'a ready NPC should announce at the next gameplay milestone');
    assert(notices[0].includes('Npc Arcade Player'));
    reminder.onGameplayMilestone();
    assert.strictEqual(notices.length, 1, 'the same reset must not announce repeatedly');

    await reminder.checkNow({ manual: true });
    assert.strictEqual(notices.length, 4, 'manual status should show one compact status line per selected NPC');
    assert(notices[1].includes('Slumber NPC daily reward status'));
    assert(notices[2].includes('READY'));
    assert(notices[3].includes('COMPLETED'));
assert(notices[3].includes('23h 0m'));
assert(notices[3].includes('left'));

    enabled = false;
    now += 24 * 60 * 60 * 1000;
    reminder.onGameplayMilestone();
    assert.strictEqual(notices.length, 4, 'disabled reminders must not announce at milestones');
    console.log('Slumber NPC daily reward reminder tests passed.');
}

run().catch(error => {
    console.error(error);
    process.exitCode = 1;
});
