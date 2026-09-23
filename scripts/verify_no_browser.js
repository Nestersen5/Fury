'use strict';

// Release gate: Electron's Chromium runtime is required, but Fury no longer
// distributes a separate automation browser or its production dependencies.
const assert = require('assert/strict');
const fs = require('fs');
const path = require('path');

function assertNoBrowserPayload(application) {
    function walk(directory) {
        for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
            const file = path.join(directory, entry.name);
            const relative = path.relative(application, file).split(path.sep).join('/');
            assert(!/(^|\/)resources\/browser(\/|$)/i.test(relative), `Removed browser resource: ${relative}`);
            assert(!/(^|\/)(?:browser-manifest\.json|namemc_grabber\.js|chrome\.exe|chromium\.exe|headless_shell(?:\.exe)?|chrome-headless-shell(?:\.exe)?|(?:Google Chrome(?: for Testing)?|Chromium)\.app)$/i.test(relative), `Removed browser payload: ${relative}`);
            assert(!/widevine/i.test(entry.name), `Unexpected Widevine payload: ${relative}`);
            assert(!/(^|\/)node_modules\/(?:puppeteer(?:-core|-extra(?:-plugin(?:-stealth|-user-data-dir|-user-preferences)?)?)?|@puppeteer\/browsers|cheerio)(\/|$)/i.test(relative), `Removed production dependency: ${relative}`);
            // Native Mac frameworks contain internal links. Their validity is
            // checked by the shared payload verifier; don't traverse them twice.
            if (entry.isDirectory() && !entry.isSymbolicLink()) walk(file);
        }
    }
    walk(application);
    return { separateBrowser: false, productionPuppeteer: false };
}

module.exports = context => assertNoBrowserPayload(context.appOutDir);
module.exports.assertNoBrowserPayload = assertNoBrowserPayload;
