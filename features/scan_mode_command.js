'use strict';

function createDefaultThreatConfig() {
    return {
        minFkdr: 3.0,
        minStars: 1000,
        minSkywarsKdr: 2.0,
        minSkywarsWlr: 1.0,
        minSkywarsLevel: 10,
        countTags: true
    };
}

function normalizeScanMode(value, fallback = 'threats') {
    const mode = String(value || '').toLowerCase();
    if (mode === 'all' || mode === 'a') return 'all';
    if (mode === 'threats' || mode === 'threat' || mode === 't') return 'threats';
    if (mode === 'off' || mode === 'o') return 'off';
    return fallback;
}

function createScanModeCommandHandler(options = {}) {
    const sendChat = typeof options.sendChat === 'function' ? options.sendChat : () => {};
    const getState = typeof options.getState === 'function'
        ? options.getState
        : () => ({ scanMode: 'threats', threatConfig: createDefaultThreatConfig() });
    const setScanMode = typeof options.setScanMode === 'function' ? options.setScanMode : () => {};
    const updateThreatConfig = typeof options.updateThreatConfig === 'function' ? options.updateThreatConfig : () => {};
    const saveScanConfig = typeof options.saveScanConfig === 'function' ? options.saveScanConfig : () => {};

    function save() {
        saveScanConfig();
    }

    function showStatus(client) {
        const { scanMode, threatConfig } = getState();
        const modeColor = scanMode === 'all' ? '\u00a7a' : scanMode === 'threats' ? '\u00a74' : '\u00a7c';
        const modeText = scanMode === 'all' ? 'ALL PLAYERS' : scanMode === 'threats' ? 'THREATS ONLY' : 'OFF';

        sendChat(client, '\u00a76\u00a7m========================================');
        sendChat(client, '\u00a76\u00a7lScan Settings');
        sendChat(client, `\u00a7e Mode: ${modeColor}${modeText}\u00a7r`);
        sendChat(client, `\u00a7e Min FKDR: \u00a76${threatConfig.minFkdr}`);
        sendChat(client, `\u00a7e Min Stars: \u00a76${threatConfig.minStars}`);
        sendChat(client, `\u00a7e SkyWars KDR: \u00a76${threatConfig.minSkywarsKdr} \u00a78| \u00a7eWLR: \u00a76${threatConfig.minSkywarsWlr} \u00a78| \u00a7eLevel: \u00a76${threatConfig.minSkywarsLevel}`);
        sendChat(client, '\u00a7e Tagged Players: \u00a7aalways threats\u00a7r');
        sendChat(client, '\u00a76\u00a7m========================================');
    }

    function handleScanModeCommand(client, args) {
        if (args.length === 1) {
            showStatus(client);
            return;
        }

        const subCmd = String(args[1] || '').toLowerCase();
        if (subCmd === 'all' || subCmd === 'a') {
            if (args.length === 2) {
                setScanMode('all');
                save();
                sendChat(client, '\u00a76Scan mode set to: \u00a7a\u00a7lALL PLAYERS\u00a7r');
                return;
            }
        }

        if (subCmd === 'threats' || subCmd === 'threat' || subCmd === 't') {
            if (args.length === 2) {
                setScanMode('threats');
                save();
                sendChat(client, '\u00a76Scan mode set to: \u00a74\u00a7lTHREATS ONLY\u00a7r');
                return;
            }

            if (args.length >= 4) {
                const threatType = String(args[2] || '').toLowerCase();

                if (threatType === 'fkdr') {
                    const value = parseFloat(args[3]);
                    if (Number.isNaN(value)) {
                        sendChat(client, '\u00a7cInvalid FKDR value');
                        return;
                    }
                    updateThreatConfig({ minFkdr: value });
                    save();
                    sendChat(client, `\u00a76Min FKDR threat level set to: \u00a7e${value}`);
                    return;
                }

                if (threatType === 'tag') {
                    updateThreatConfig({ countTags: true });
                    save();
                    sendChat(client, '\u00a77Tagged players always count as threats.');
                    return;
                }

                if (threatType === 'star' || threatType === 'stars') {
                    const value = parseInt(args[3], 10);
                    if (Number.isNaN(value)) {
                        sendChat(client, '\u00a7cInvalid star value');
                        return;
                    }
                    updateThreatConfig({ minStars: value });
                    save();
                    sendChat(client, `\u00a76Min star threat level set to: \u00a7e${value}`);
                    return;
                }

                if (threatType === 'swkdr' || threatType === 'skywarskdr' || threatType === 'kdr') {
                    const value = parseFloat(args[3]);
                    if (Number.isNaN(value)) {
                        sendChat(client, '\u00a7cInvalid SkyWars KDR value');
                        return;
                    }
                    updateThreatConfig({ minSkywarsKdr: value });
                    save();
                    sendChat(client, `\u00a76Min SkyWars KDR threat level set to: \u00a7e${value}`);
                    return;
                }

                if (threatType === 'swwlr' || threatType === 'skywarswlr' || threatType === 'wlr') {
                    const value = parseFloat(args[3]);
                    if (Number.isNaN(value)) {
                        sendChat(client, '\u00a7cInvalid SkyWars WLR value');
                        return;
                    }
                    updateThreatConfig({ minSkywarsWlr: value });
                    save();
                    sendChat(client, `\u00a76Min SkyWars WLR threat level set to: \u00a7e${value}`);
                    return;
                }

                if (threatType === 'swlevel' || threatType === 'skywarslevel') {
                    const value = parseInt(args[3], 10);
                    if (Number.isNaN(value)) {
                        sendChat(client, '\u00a7cInvalid SkyWars level value');
                        return;
                    }
                    updateThreatConfig({ minSkywarsLevel: value });
                    save();
                    sendChat(client, `\u00a76Min SkyWars level threat level set to: \u00a7e${value}`);
                    return;
                }

                sendChat(client, `\u00a7cUnknown threat config: ${threatType}`);
                return;
            }
        }

        if (subCmd === 'off' || subCmd === 'o') {
            if (args.length === 2) {
                setScanMode('off');
                save();
                sendChat(client, '\u00a76Scan mode set to: \u00a7c\u00a7lOFF\u00a7r');
                return;
            }
        }

        sendChat(client, '\u00a76Usage: \u00a7e/overlay all/threats/off \u00a76or \u00a7e/overlay threat [fkdr/star/kdr/wlr/swlevel] [value]');
    }

    return handleScanModeCommand;
}

module.exports = {
    createDefaultThreatConfig,
    createScanModeCommandHandler,
    normalizeScanMode
};
