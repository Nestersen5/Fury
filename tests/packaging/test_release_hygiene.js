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
expectFile('docs/PUBLIC_RELEASE_CHECKLIST.md');
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
    'COSMETIC_SEARCH_API_URL',
    'COSMETIC_SEARCH_TOKEN'
].forEach(name => {
    assert(envExample.includes(name), `.env.example should document ${name}`);
});

const checklist = read('docs/PUBLIC_RELEASE_CHECKLIST.md');
[
    'npm test',
    'without registration',
    'Microsoft authentication'
].forEach(text => {
    assert(checklist.includes(text), `PUBLIC_RELEASE_CHECKLIST.md should mention ${text}`);
});

const privateCosmeticSearchIp = ['92', '5', '52', '168'].join('.');
[
    'launcher.js',
    'proxy.js',
    'docs/COSMETIC_SEARCH_API.md',
    '.env.example',
    'docs/PUBLIC_RELEASE_CHECKLIST.md'
].forEach(relativePath => {
    assert(!read(relativePath).includes(privateCosmeticSearchIp), `${relativePath} should not contain a private cosmetic-search IP`);
});

assert(
    read('launcher.js').includes("process.env.COSMETIC_SEARCH_API_URL || 'http://127.0.0.1:3210'"),
    'launcher cosmetic search should default to localhost and allow env override'
);
assert(
    read('proxy.js').includes("process.env.COSMETIC_SEARCH_API_URL || 'http://127.0.0.1:3210'"),
    'proxy cosmetic search should default to localhost and allow env override'
);
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

// The Cloudflare account identifier belongs in CLOUDFLARE_ACCOUNT_ID, never in
// committed configuration. The D1 database_id stays: Wrangler needs it to
// resolve the binding, and it is inert without the account and a token.
const wrangler = JSON.parse(read(path.join('cloudflare', 'download-stats', 'wrangler.json')));
assert(!('account_id' in wrangler), 'wrangler.json must not commit a Cloudflare account identifier');
assert(
    read(path.join('cloudflare', 'download-stats', 'README.md')).includes('CLOUDFLARE_ACCOUNT_ID'),
    'the tracker README must document where the Cloudflare account identifier comes from'
);

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
