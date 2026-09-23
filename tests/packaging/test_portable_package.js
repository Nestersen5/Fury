'use strict';
const REPOSITORY_ROOT = require('path').resolve(__dirname, '../..');

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const minimatchModule = require('minimatch');
const match = minimatchModule.minimatch || minimatchModule;
const config = require('../../package.json');
const { parseArchitectures } = require('../../scripts/package_macos.js');

function included(file) {
    const patterns = config.build.files;
    return patterns.filter(pattern => !pattern.startsWith('!')).some(pattern => match(file, pattern, { dot: true }))
        && !patterns.filter(pattern => pattern.startsWith('!')).some(pattern => match(file, pattern.slice(1), { dot: true }));
}

for (const file of ['launcher.js', 'proxy.js', 'cosmetic_search_api.js',
    'launcher.html', 'src/launcher/styles/launcher_theme.css', 'src/launcher/renderer/launcher_theme.js', 'src/launcher/styles/launcher_accessibility.css', 'src/launcher/renderer/launcher_overlay_board.js', 'src/launcher/styles/launcher_overlay_board.css',
    'src/launcher/renderer/launcher_redesign.js', 'src/launcher/renderer/launcher_redesign_pages.js', 'src/launcher/renderer/launcher_redesign_nicks.js', 'src/launcher/styles/launcher_redesign.css', 'src/launcher/renderer/launcher_session_card.js', 'src/launcher/launcher_auth_worker.js',
    'assets/session-card-font.png', 'assets/default-skin.png', 'src/accounts/launcherAccounts.js',
    'src/launcher/renderer/launcher_account_skin.js', 'src/accounts/skinCache.js', 'assets/fury-server-icon.png', 'assets/fury-icon.ico',
    'src/launcher/renderer/launcher_settings_refinement.js', 'src/launcher/styles/launcher_settings_refinement.css',
    'src/launcher/renderer/launcher_windows_design.js', 'src/launcher/styles/launcher_windows_design.css',
    'src/launcher/renderer/launcher_onboarding.js', 'src/launcher/styles/launcher_onboarding.css', 'src/launcher/renderer/launcher_ingame_appearance.js', 'src/launcher/styles/launcher_ingame_appearance.css',
    'src/launcher/renderer/launcher_cosmetic_picker.js', 'src/launcher/renderer/launcher_segmented_controls.js', 'assets/ingame-night.png', 'assets/session-card-symbols.png',
    'src/menu/fixtures/hotbar-menu.json', 'src/menu/fixtures/quickbuy-menus.json',
    'src/launcher/renderer/launcher_windows_settings.js', 'src/launcher/styles/launcher_windows_settings.css', 'src/launcher/renderer/launcher_windows_usability.js',
    'src/session/localTracking.js', 'src/session/queueTime.js', 'src/reminders/rememberedAccount.js',
    'src/storage/json_writer_worker.js', 'assets/fury-icon.png', 'assets/kill-message-patterns.json',
    'src/launcher/renderer/launcher_updates.js', 'src/updates/updateNotifications.js', 'src/updates/releaseConfig.js',
    'src/launcher/renderer/launcher_calendar_stats.js', 'src/launcher/renderer/launcher_denick_format.js',
    'src/launcher/renderer/launcher_profile_summary.js', 'src/launcher/renderer/launcher_shutdown.js',
    'src/storage/atomic_file.js', 'src/storage/json_file_cache.js',
    'src/util/bounded_ttl_map.js', 'src/util/fast_queue.js', 'src/util/in_flight_deduper.js',
    'src/overlay/chat_overlay_annotation.js', 'src/cosmetics/cosmetic_name_catalog.js',
    'src/denick/denick_history_index.js', 'src/denick/skin_denicker.js', 'src/net/session/pregame_chat.js',
    'src/storage/runtimePaths.js']) {
    assert(included(file), `Runtime feature asset excluded: ${file}`);
    assert(fs.existsSync(path.join(REPOSITORY_ROOT, file)), `Missing runtime file: ${file}`);
}
for (const file of ['.env', '.env.local', 'statmod_key.txt', 'friend_aliases.json', 'session_data.json',
    'denicked.json', 'encounter_data.json', 'auth_tokens/account.json', 'launcher_data/profiles.json',
    'recordings/private/packets.jsonl', 'features_config.json', 'backups/proxy.js', 'tmp/private.js',
    'cosmetic_search_cache.json', 'src/cosmetics/effect_library.json',
    'tests/storage/test_runtime_paths.js', 'fury-hud-demo/main.js', 'statmod-overlay/node_modules/electron/index.js']) {
    assert(!included(file), `Private/development data would be packaged: ${file}`);
}
assert.deepStrictEqual(parseArchitectures([]), ['arm64']);
assert.deepStrictEqual(parseArchitectures(['--all']), ['arm64', 'x64']);
assert.deepStrictEqual(parseArchitectures(['--arch', 'arm64']), ['arm64']);
assert.deepStrictEqual(parseArchitectures(['--arch', 'x64']), ['x64']);
assert.throws(() => parseArchitectures(['--arch', 'ia32']), /Usage/);
assert.strictEqual(config.build.mac.identity, '-', 'Apple Silicon app needs ad-hoc signing');
assert.strictEqual(config.build.mac.hardenedRuntime, false, 'Ad-hoc app must allow the pre-signed Electron frameworks');
assert(!(config.build.mac.extraResources || []).some(resource => resource.to === 'browser'));
assert(!config.dependencies['active-win'] && !config.dependencies['node-window-manager'], 'Unused native dependencies must not require toolchains');
// A working older launcher must not pass as the current release. Exercise the
// parity check against missing, changed and accidentally retained runtime files.
const { verifySources, runtimeFiles } = require('../../scripts/verify_packaged_sources');
// Runtime JSON imports must ship too: a development checkout can hide missing
// release assets, including the Quick Buy and hotbar preview catalogs.
for (const file of runtimeFiles(REPOSITORY_ROOT, config).filter(file => file.endsWith('.js') || file.endsWith('.html'))) {
    const source = fs.readFileSync(path.join(REPOSITORY_ROOT, file), 'utf8');
    for (const match of source.matchAll(/require\(\s*(['"])(\.{1,2}\/[^'"]+\.json)\1\s*\)/g)) {
        const dependency = path.relative(REPOSITORY_ROOT, path.resolve(path.dirname(path.join(REPOSITORY_ROOT, file)), match[2])).split(path.sep).join('/');
        assert(included(dependency), `${file} requires an excluded release asset: ${dependency}`);
        assert(fs.existsSync(path.join(REPOSITORY_ROOT, dependency)), `Missing required release asset: ${dependency}`);
    }
}
const os = require('os');
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'fury-source-parity-'));
try {
    const source = path.join(temporary, 'source'), packaged = path.join(temporary, 'app');
    for (const directory of [source, packaged]) {
        fs.mkdirSync(directory);
        fs.writeFileSync(path.join(directory, 'package.json'), JSON.stringify({ name: 'fury-test', version: '1.0.4',
            main: 'launcher.js', dependencies: {}, build: { files: ['*.js', '*.css', 'package.json', '!test_*.js'] } }));
        fs.writeFileSync(path.join(directory, 'launcher.js'), 'current launcher');
        fs.writeFileSync(path.join(directory, 'launcher.css'), 'current styles');
    }
    fs.writeFileSync(path.join(source, 'test_private.js'), 'not runtime');
    assert.strictEqual(verifySources(source, packaged).runtimeFileCount, 2);
    fs.writeFileSync(path.join(packaged, 'launcher.css'), 'old styles');
    assert.throws(() => verifySources(source, packaged), /differs from current source: launcher.css/);
    fs.unlinkSync(path.join(packaged, 'launcher.css'));
    assert.throws(() => verifySources(source, packaged), /ENOENT/);
    fs.copyFileSync(path.join(source, 'launcher.css'), path.join(packaged, 'launcher.css'));
    fs.writeFileSync(path.join(packaged, 'fury_hud.js'), 'retired');
    assert.throws(() => verifySources(source, packaged), /Retired desktop HUD/);
} finally {
    assert.strictEqual(path.dirname(temporary), path.resolve(os.tmpdir()));
    assert(path.basename(temporary).startsWith('fury-source-parity-'));
    fs.rmSync(temporary, { recursive: true, force: true });
}
console.log('Portable packaging checks passed.');
