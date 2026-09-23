const REPOSITORY_ROOT = require('path').resolve(__dirname, '../..');
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = REPOSITORY_ROOT;

function read(relativePath) {
    return fs.readFileSync(path.join(root, relativePath), 'utf8');
}

function expectFile(relativePath) {
    assert(fs.existsSync(path.join(root, relativePath)), `Expected ${relativePath} to exist`);
}

expectFile('.gitignore');
expectFile('.env.example');
expectFile('docs/RELEASE_ARTIFACTS.md');
expectFile(path.join('assets', 'fury-icon.ico'));

const gitignore = read('.gitignore');
[
    'auth_tokens/',
    'launcher_data/',
    'packet_logs/',
    'statmod_key.txt',
    'features_config.json',
    'scan_config.json',
    'server_config.json',
    'session_data.json',
    'encounter_data.json',
    'presets.json',
    '*.env',
    '.env.*',
    '!.env.example',
    // Agent-local settings, signing material and private deployment overrides
    // must stay out of Git, including the future public repository.
    '.claude/',
    '*.pem',
    '*.p12',
    '*.pfx',
    '*.keystore',
    '*.local.json',
    '**/wrangler.local.*',
].forEach(pattern => {
    assert(gitignore.includes(pattern), `.gitignore should ignore ${pattern}`);
});

const envExample = read('.env.example');
[
    'COSMETIC_SEARCH_PORT',
    'COSMETIC_SEARCH_TOKEN'
].forEach(name => {
    assert(envExample.includes(name), `.env.example should document ${name}`);
});

const privateCosmeticSearchIp = ['92', '5', '52', '168'].join('.');
[
    'launcher.js',
    'proxy.js',
    'docs/COSMETIC_SEARCH_API.md',
    '.env.example'
].forEach(relativePath => {
    assert(!read(relativePath).includes(privateCosmeticSearchIp), `${relativePath} should not contain a private cosmetic-search IP`);
});

for (const source of ['launcher.js', 'proxy.js']) {
    assert(read(source).includes('localCosmeticSearchUrl()'), `${source} must use the local Cosmetic Search address`);
    assert(!read(source).includes('COSMETIC_SEARCH_API_URL'), `${source} must not select a hosted Cosmetic Search URL`);
}
assert(
    read('package.json').includes('node tests/packaging/test_release_hygiene.js'),
    'npm test should include release hygiene checks'
);

assert(
    !read('package.json').includes('!node_modules/minecraft-data/minecraft-data/data/bedrock/**'),
    'release builds must include minecraft-data Bedrock feature definitions required at runtime'
);

assert(
    read('package.json').includes('"icon": "assets/fury-icon.ico"')
        && read('package.json').includes('"installerIcon": "assets/fury-icon.ico"')
        && read('package.json').includes('"uninstallerIcon": "assets/fury-icon.ico"'),
    'the Windows app and installer must use the packaged Fury icon'
);
assert(
    read('launcher.js').includes("const APP_ICON_PATH = path.join(__dirname, 'assets', 'fury-icon.ico');"),
    'the development launcher windows must use the Fury icon too'
);

// Public source excludes deployment-owned website and tracker files.
for (const excluded of ['AGENTS.md', '.agents', 'website', 'cloudflare/download-stats']) {
    assert(!fs.existsSync(path.join(root, excluded)), `Public source must exclude ${excluded}`);
}

// Developer-specific sign-in fixtures stay out of the repository; packaged
// builds pin nothing at all.
assert(
    read('launcher.js').includes('FURY_DEV_PINNED_ACCOUNTS'),
    'pinned development accounts must come from the environment, not a committed list'
);
assert(
    read('.env.example').includes('FURY_DEV_PINNED_ACCOUNTS'),
    '.env.example should document FURY_DEV_PINNED_ACCOUNTS'
);

console.log('Release hygiene checks passed.');
