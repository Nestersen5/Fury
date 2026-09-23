'use strict';

// Version 1 is an allowlist, not a copy of resources/app. Keep durable Chromium
// LevelDB *.log files: they are not disposable application logs.
const ROOT_FILES = [
    'statmod_key.txt', 'scan_config.json', 'features_config.json', 'chat_triggers.json', 'server_config.json',
    'presets.json', 'denicked.json', 'friend_aliases.json', 'session_data.json', 'game_clips.json', 'rank_book.json',
    'cosmetic_signatures.json', 'cosmetic_profiles.json', 'cosmetic_dataset.json', 'cosmetic_direct_samples.json',
    'cosmetic_model.json', 'cosmetic_model_backup.json', 'own_cosmetics.json', 'cosmetic_accuracy.json',
    'cosmetic_api_names.json', 'kill_message_patterns.json', 'cosmetic_search_cache.json',
    'anticheat_history.json', 'statmod_debug.log', 'tag_tracker.log'
];
const TREES = ['launcher_data', 'auth_tokens', 'recordings', 'packet_logs', 'diagnostics/teams', 'quickbuy_presets'];
const NESTED_FILES = ['src/cosmetics/effect_library.json', 'anticheat/population_baseline.json'];
const CHROMIUM_TRANSIENTS = new Set([
    'Cache', 'Code Cache', 'GPUCache', 'DawnCache', 'DawnGraphiteCache', 'DawnWebGPUCache',
    'ShaderCache', 'GrShaderCache', 'Crashpad', 'SingletonLock', 'SingletonCookie', 'SingletonSocket', 'LOCK', 'lockfile'
]);
function excluded(relative) {
    const parts = relative.split('/');
    if (relative === 'launcher_data/auth-staging' || relative.startsWith('launcher_data/auth-staging/')) return true;
    if (relative === 'launcher_data/skins' || relative.startsWith('launcher_data/skins/')) return true;
    if (parts[0] === 'launcher_data' && parts.some(part => CHROMIUM_TRANSIENTS.has(part))) return true;
    // Existing atomic writers use .tmp files; a failed write is not committed state.
    return parts.at(-1).endsWith('.tmp') || parts.at(-1).endsWith('.partial');
}
module.exports = { ROOT_FILES, TREES, NESTED_FILES, excluded };
