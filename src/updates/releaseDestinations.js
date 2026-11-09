'use strict';

// Reviewed local routes. Remote notes cannot supply selectors or navigation.
const destinations = [
    ['1.1.0', 'features', 0, 'nickroll', 'Nick Reroller', null],
    ['1.1.0', 'features', 1, 'anticheat', 'AntiCheat', 'anticheat-scaffold-enabled'],
    ['1.1.0', 'features', 2, 'gameplay', 'Automation', 'quick-maths-enabled'],
    ['1.1.1', 'features', 0, 'sessions', 'Sessions', 'session-average-game-time'],
    ['1.1.2', 'features', 1, 'anticheat', 'AntiCheat', 'anticheat-party-broadcast-enabled'],
    ['1.1.3', 'features', 1, 'denick', 'Nicknames', null],
    ['1.1.3', 'improvements', 6, 'gameplay', 'Automation', 'auto-dodge-leave-mode', 'updated'],
    ['1.1.3', 'improvements', 7, 'api', 'API keys', null],
    ['1.1.3', 'improvements', 8, 'network', 'Connection', null],
    ['1.1.4', 'features', 0, 'overlay', 'Chat', 'lobby-spam-enabled'],
    ['1.1.4', 'features', 3, 'display', 'In-game appearance', 'bedwars-lobby-scoreboard-style'],
    ['1.1.4', 'features', 3, 'display', 'In-game appearance', 'bedwars-lobby-scoreboard-decimals'],
    ['1.1.4', 'features', 4, 'scan', 'Scanning', 'share-tags-monthly-fkdr'],
    ['1.1.4', 'features', 5, 'scan', 'Scanning', 'share-tags-team-summary', 'updated']
].map(([version, group, index, category, label, control, kind = 'new']) => ({
    id: `${version}:${control || category}`, version, group, index, category, label, control, kind
}));
const destinationFor = (version, group, index) => destinations.find(item => item.version === version && item.group === group && item.index === index);
module.exports = { destinations, destinationFor };
