'use strict';

const { createFeatureStatus } = require('./feature_panel.js');
const chat = require('./chat_controller.js');

const ENABLED_ACTIONS = new Set(['on', 'enable', 'enabled', 'true']);
const DISABLED_ACTIONS = new Set(['off', 'disable', 'disabled', 'false']);
const STATUS_ACTIONS = new Set(['', 'status', 'info']);

function createApiKillSwitchCommandHandler({
    getEnabled = () => false,
    setEnabled = () => {},
    sendChat = () => {}
} = {}) {
    return function handleApiKillSwitchCommand(client, args = []) {
        const action = String(args[1] || 'status').trim().toLowerCase();
        const enabled = Boolean(getEnabled());

        if (STATUS_ACTIONS.has(action)) {
            const panel = createFeatureStatus({ client, sendChat, title: 'API access', section: 'system' });
            panel.open();
            panel.valueRow('Requests', enabled ? 'PAUSED' : 'ACTIVE', { color: enabled ? 'gray' : 'green' });
            panel.row([chat.text(enabled ? 'External API requests are paused.' : 'External API requests are allowed.')]);
            panel.row([chat.text('Local launcher and proxy traffic stays available.')]);
            panel.row([
                ...panel.action(enabled ? 'Resume' : 'Pause', enabled ? '/apikill off' : '/apikill on',
                    enabled ? 'Allow external API requests.' : 'Pause external API requests.'),
                chat.text(' '), ...panel.action('API keys', '/apikey view', 'View saved API keys.'),
                chat.text(' '), ...panel.action('Usage', '/apikey usage', 'View request usage.')
            ]);
            panel.close();
            return true;
        }

        let nextEnabled;
        if (ENABLED_ACTIONS.has(action)) nextEnabled = true;
        else if (DISABLED_ACTIONS.has(action)) nextEnabled = false;
        else if (action === 'toggle') nextEnabled = !enabled;
        else {
            sendChat(client, '§cUsage: /apikill on|off|toggle|status');
            return false;
        }

        if (nextEnabled === enabled) {
            sendChat(client, `§6[API Kill Switch] §7Already ${enabled ? '§cON' : '§aOFF'}§7.`);
            return true;
        }

        setEnabled(nextEnabled);
        sendChat(client, nextEnabled
            ? '§6[API Kill Switch] §cEnabled. §7External API requests are now blocked.'
            : '§6[API Kill Switch] §aDisabled. §7External API requests can run again.');
        return true;
    };
}

module.exports = {
    createApiKillSwitchCommandHandler
};
