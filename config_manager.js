const { loadAllSettings, saveScanSettings } = require('./app_config.js');

function loadAllConfigs() {
    const settings = loadAllSettings();
    return {
        keys: settings.keys,
        keyMeta: settings.keyMeta,
        scan: settings.scan,
        features: settings.features,
        chatTriggers: settings.chatTriggers,
        server: settings.server
    };
}

function saveScanConfig(config) {
    saveScanSettings(config);
}

module.exports = { loadAllConfigs, saveScanConfig };
