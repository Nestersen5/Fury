const fs = require('fs');
const { dataPath } = require('./src/storage/runtimePaths.js');

const DEBUG_LOG_FILE = dataPath('statmod_debug.log');
let DEBUG_MODE = false;
let debugBuffer = [];
const MAX_DEBUG_BUFFER = 1000;

function setDebugMode(val) { DEBUG_MODE = val; }
function getDebugMode() { return DEBUG_MODE; }

function debugLog(category, message, data = {}) {
    if (!DEBUG_MODE) return;
    const timestamp = new Date().toISOString();
    const logEntry = { timestamp, category, message, data };
    
    const colors = {
        'PLAYER_ADD': '\x1b[32m', 'PLAYER_REMOVE': '\x1b[31m', 'TEAM_PACKET': '\x1b[36m',
        'TEAM_ASSIGN': '\x1b[35m', 'SELF_TEAM': '\x1b[33m', 'SCAN_START': '\x1b[34m',
        'ERROR': '\x1b[91m', 'GAME_EVENT': '\x1b[93m'
    };
    
    console.log(`${colors[category] || '\x1b[37m'}[${timestamp}] [${category}] ${message}\x1b[0m`);
    if (Object.keys(data).length > 0) console.log(JSON.stringify(data, null, 2));

    debugBuffer.push(logEntry);
    if (debugBuffer.length > MAX_DEBUG_BUFFER) debugBuffer.shift();
}

function writeDebugToFile() {
    try {
        const important = ['PLAYER_ADD', 'TEAM_ASSIGN', 'SELF_TEAM', 'GAME_EVENT', 'ERROR'];
        const filtered = debugBuffer.filter(e => important.includes(e.category));
        const content = filtered.map(e => `[${e.timestamp}] [${e.category}] ${e.message}\n${JSON.stringify(e.data, null, 2)}\n---`).join('\n');
        fs.writeFileSync(DEBUG_LOG_FILE, content, 'utf8');
        return filtered.length;
    } catch (e) { console.error(e); return 0; }
}

module.exports = { debugLog, writeDebugToFile, setDebugMode, getDebugMode, debugBuffer };
