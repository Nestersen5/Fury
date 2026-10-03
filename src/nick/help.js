'use strict';

const { createUsage } = require('../../features/chat_controller');

function showNickRollHelp(sendChat) {
    const help = createUsage(sendChat, 'Nick Reroller', 'Configure matching in the launcher > Nick Reroller.');
    help.command('/nickroll start', 'Start searching.');
    help.command('/nickroll stop', 'Stop searching.');
    help.command('/nickroll status', 'Show progress and the latest candidate.');
    help.command('/nickroll words', 'View saved words and groups.');
}

function showNickRollWords(sendChat, settings) {
    const help = createUsage(sendChat, 'Nick Reroller · Word matches', 'Match anywhere in a name, ignoring case.');
    help.section('Any word — one is enough');
    if (!settings.words.length) help.detail('No individual words saved.');
    // Keep large lists readable without putting every word on one chat line.
    for (let index = 0; index < settings.words.length; index += 4) {
        help.detail(settings.words.slice(index, index + 4).join(', '));
    }
    help.section('Groups — every word in one group');
    if (!settings.wordGroups.length) help.detail('No word groups saved.');
    settings.wordGroups.forEach((group, index) => {
        help.field(`Group ${index + 1}`, group.slice(0, 4).join(' + '));
        if (group.length > 4) help.detail(`+ ${group.slice(4).join(' + ')}`);
    });
    help.note('Word matches stop rolling even when name filters do not match.');
    help.detail('Edit words in the launcher > Nick Reroller.');
}

module.exports = { showNickRollHelp, showNickRollWords };
