'use strict';
const assert = require('assert/strict');
const fs = require('fs'), os = require('os'), path = require('path');
const { assertNoBrowserPayload } = require('../../scripts/verify_no_browser');
const { PROXY_COMMANDS } = require('../../features/command_completion');
const { HELP_SECTIONS } = require('../../features/help_command');
const pkg = require('../../package.json');

for (const command of ['/history', '/name', '/nh']) {
    assert(!PROXY_COMMANDS.includes(command), `Removed command still advertised: ${command}`);
    assert(!HELP_SECTIONS.some(section => section.entries.some(entry => entry.command?.trim() === command)));
}
assert(PROXY_COMMANDS.includes('/session'), 'Unrelated session functionality must remain');
for (const name of ['puppeteer', 'puppeteer-extra', 'puppeteer-extra-plugin-stealth', '@puppeteer/browsers', 'cheerio']) {
    assert(!pkg.dependencies[name], `Browser-only production dependency: ${name}`);
}
assert(pkg.devDependencies.puppeteer, 'Unrelated launcher verification retains its development driver');
assert.equal(pkg.build.afterPack, 'scripts/verify_no_browser.js');
for (const platform of ['win', 'mac']) assert(!(pkg.build[platform].extraResources || []).some(entry => entry.to === 'browser'));

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'fury-no-browser-'));
try {
    // Electron's runtime and resource names must not be mistaken for a second browser.
    for (const name of ['Fury.exe', 'chrome_100_percent.pak', 'chrome_200_percent.pak', 'resources/app/launcher.js']) {
        const file = path.join(root, name); fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, 'fixture');
    }
    assertNoBrowserPayload(root);
    for (const name of ['resources/browser', 'Contents/Resources/browser', 'resources/app/node_modules/puppeteer',
        'resources/app/node_modules/puppeteer-core', 'resources/app/node_modules/@puppeteer/browsers',
        'resources/app/node_modules/puppeteer-extra-plugin-stealth', 'resources/app/node_modules/cheerio',
        'resources/app/namemc_grabber.js', 'other/browser-manifest.json', 'other/chrome.exe',
        'other/Chromium.app', 'other/WidevineCdm']) {
        const file = path.join(root, name); fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, 'forbidden fixture');
        assert.throws(() => assertNoBrowserPayload(root), /Removed|Widevine/); fs.unlinkSync(file);
    }
    assertNoBrowserPayload(root);
    console.log('Removed commands, dependency ownership and browser-free package gates passed.');
} finally {
    assert.equal(path.dirname(root), path.resolve(os.tmpdir()));
    assert(path.basename(root).startsWith('fury-no-browser-'));
    fs.rmSync(root, { recursive: true, force: true });
}
