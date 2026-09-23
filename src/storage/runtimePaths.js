'use strict';

const fs = require('fs');
const path = require('path');

const PROJECT_ROOT = path.resolve(__dirname, '..', '..');
let initializedDirectory;

function defaultDataDir({ isPackaged, platform = process.platform, appData, projectRoot = PROJECT_ROOT }) {
    if (!isPackaged || !['win32', 'darwin'].includes(platform)) return projectRoot;
    const paths = platform === 'win32' ? path.win32 : path.posix;
    if (!appData || !paths.isAbsolute(appData)) throw new Error('Electron appData must be an absolute directory path.');
    return paths.join(appData, 'Fury');
}

function getDataDir() {
    const override = String(process.env.FURY_DATA_DIR || '').trim();
    if (override && !path.isAbsolute(override)) {
        throw new Error('FURY_DATA_DIR must be an absolute directory path.');
    }
    return override ? path.normalize(override) : PROJECT_ROOT;
}

// The launcher calls this before loading modules that declare persistent paths.
// Its child services inherit the same absolute directory through the environment.
// Standalone development keeps the existing project-relative file locations.
function initializeDataDir(defaultDirectory = PROJECT_ROOT) {
    if (!String(process.env.FURY_DATA_DIR || '').trim()) {
        if (!path.isAbsolute(defaultDirectory)) {
            throw new Error('The default Fury data directory must be absolute.');
        }
        process.env.FURY_DATA_DIR = path.normalize(defaultDirectory);
    }
    const directory = getDataDir();
    if (initializedDirectory !== directory) {
        fs.mkdirSync(directory, { recursive: true });
        initializedDirectory = directory;
    }
    process.env.FURY_DATA_DIR = directory;
    return directory;
}

function dataPath(...segments) {
    return path.join(initializeDataDir(), ...segments);
}

module.exports = { getDataDir, initializeDataDir, dataPath, defaultDataDir };
