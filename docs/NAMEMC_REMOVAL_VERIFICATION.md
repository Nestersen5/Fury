# NameMC removal verification

Verified on Windows x64, 2026-09-20. Decision: **PARTIAL KEEP**. Removal and native Windows package verification passed; native Mac builds/runtime and existing release acceptance remain outstanding.

## Feature and dependency ownership

Removed NameMC username-history lookup, `/history`, `/name`, `/nh`, their help/completion entries, the Fury intel-menu entry and the player-stat Names link. Unrelated game/session history, account operations and player statistics remain.

NameMC was the sole production consumer of Puppeteer, puppeteer-extra, stealth, Cheerio and the prepared browser. Removed the grabber, browser preparation/download, resolver, manifest/fingerprint verification, resource configuration, browser-only tests and browser-specific F7 ownership/profile cleanup. No replacement lookup was introduced. Old local caches/build outputs were not deleted or migrated.

Puppeteer 24.43.1 remains **development-only** because existing non-NameMC launcher/UI, screenshot and packaged-runtime tests connect to Electron DevTools. puppeteer-core and @puppeteer/browsers are also development-only transitive dependencies. None is in the packaged production dependency tree. puppeteer-extra, stealth and Cheerio are absent from the lockfile; npm removed 43 packages. No production browser download remains. CI's PUPPETEER_SKIP_DOWNLOAD remains appropriate for these development tests.

Electron and its embedded Chromium runtime remain necessary application content. This removal does not remove Electron's licenses, components or security maintenance obligations.

## Files and responsibilities

- `proxy.js`: removed lazy NameMC loading, lookup command routing, menu entry and lookup cancellation/drain owner.
- `features/command_completion.js`, `features/help_command.js`, `features/minecraft_chat.js`, `src/stats/render/general.js`: removed NameMC presentation and discovery paths.
- `launcher.js`: removed the bundled-browser environment flag sent to packaged services; existing single-instance behavior retained.
- `src/bootstrap/childShutdown.js`: removed only NameMC profile/resource IPC and orphan-browser cleanup. General request/instance identity, acknowledgement plus exit, force-tree termination and shared bounded shutdown remain.
- `package.json`, `package-lock.json`: remove production browser dependencies/resources; keep Puppeteer as a development dependency; replace the browser afterPack hook with the negative payload gate. Remove obsolete browser scripts while retaining broader tests.
- `scripts/package_windows.js`, `scripts/package_macos.js`: remove preparation before packaging; keep the shared Windows payload and architecture-specific Mac ZIP/DMG pairs.
- `scripts/verify_no_browser.js` (new): reject separate browser resources, manifest/grabber, Chrome/Chromium executables/apps, Widevine and removed production dependencies. Electron's own Chromium resource files remain permitted.
- `scripts/release_artifacts.js`, `scripts/verify_release_pair.js`: enforce browser absence during source/content/parity verification; retain Electron architecture checks, contained links, native executable-mode checks and payload comparison.
- `tests/packaging/test_no_browser_payload.js` (new): command/dependency ownership and Windows/Mac negative payload cases.
- `tests/integration/test_shutdown.js`, `tests/integration/test_shutdown_force.js`, `tests/integration/test_shutdown_integration.js`, `tests/integration/test_shutdown_launcher.js`: remove exclusively NameMC cases, retain other shutdown tests. The launcher test now blocks shell.openExternal in its test-only bootstrap: even synthetic device-code events otherwise invoke the production browser-opening path. No production authentication change.
- `scripts/smoke_packaged_app.js`, `scripts/verify_packaged_runtime.js`, `tests/packaging/test_portable_package.js`: remove browser requirements while retaining proxy, history, accounts, recordings, launch and package checks.
- `docs/PORTABLE_MAC.md`, `docs/RELEASE_ARTIFACTS.md`, `docs/PUBLIC_RELEASE_CHECKLIST.md`: update current release expectations. Prior verification reports receive an explicit historical-browser notice.

Deleted: `namemc_grabber.js`, `src/bootstrap/browserRuntime.js`, `scripts/prepare_browser.js`, `scripts/verify_browser_bundle.js`, `scripts/verify_windows_browser_package.js`, `test_browser_runtime.js`, `test_windows_browser.js`, `test_namemc_lifecycle.js`, `docs/WINDOWS_BUNDLED_BROWSER.md`.

## Test results

All 20 focused scripts passed:

```text
tests/integration/test_shutdown.js (23 cases)
tests/integration/test_shutdown_force.js
tests/integration/test_shutdown_integration.js
tests/session/test_history_reconciliation.js
tests/integration/test_history_reconciliation_integration.js
tests/session/test_launcher_history_cache.js
tests/session/test_history_response.js
tests/session/test_launcher_session_history.js
tests/accounts/test_launcher_accounts.js
tests/accounts/test_account_skins.js
tests/accounts/test_launcher_account_http.js
tests/storage/test_runtime_paths.js
tests/storage/test_windows_migration.js
tests/storage/test_windows_migration_integration.js
tests/platform/test_launcher_instance.js
tests/platform/test_desktop_listeners.js
tests/features/test_help_command.js
tests/features/test_command_completion.js
tests/launcher/test_command_surface.js
tests/launcher/test_launcher_dependencies.js
```

Also passed:

- `npm run test:packaging`: four scripts for browser absence, release artifacts, portable configuration and release hygiene.
- `node tests/integration/test_shutdown_launcher.js`: eight native Electron scenarios, including actual pending history, recording footer, renderer save, synthetic staged-auth cleanup and forced persistence timeout.
- `node tests/platform/test_launcher_instance_native.js`: simultaneous paired paths, rapid launch, minimized restore, shutdown ownership, explicit profiles, relaunch and stale-lock recovery.
- `node scripts/package_windows.js`: actual NSIS and ZIP, extracted payload parity, current-source comparison, negative browser gate and local six-slot release metadata.
- `node scripts/verify_windows_portable.js <new ZIP> <report>`: native extracted ZIP restart, busy recording/history and account scenarios with resource writes denied.
- Syntax checks and `git diff --check`.

History reconciliation retained exact newer-memory output and clean exit; external conflict and write failure remained explicitly FORCED, not clean. Listener tests retained IPv4/localhost/IPv6 connections, LAN rejection, standalone bind opt-in and outbound fixture behavior. No real authentication was initiated.

## F7 and packaged runtime

Native launcher times: idle Quit 101 ms; window close/save 241 ms; pending-history Quit 179 ms; recording Quit 525 ms; synthetic-auth Quit 117 ms; Stop to replacement spawn 96 ms; forced hung persistence 3,192 ms. Healthy operations did not wait for the grace deadline.

Actual portable ZIP: launch 1,171–1,341 ms; Quit approximately 412–415 ms; Stop/Start 399 ms. Tests verified exact persisted synthetic game output, recording footer, retained prior-session IDs, compact contract version 1, account isolation and detail stale guards. Application files were unchanged after execution. Working directory was separate, extraction path contained spaces, application-resource writes were denied, and child exit was verified. Final process inspection found no matching test-owned processes remaining.

Tests used an absolute isolated FURY_DATA_DIR. Electron's default appData path was inspected, but the real default Fury profile was not opened. This is not native default-profile or protected Program Files/UAC acceptance.

## Artifact parity, sizes and hashes

Both Windows containers contain the same verified application payload: 4,218 inventory entries, digest `fa4f4b50832d1809fe61108dbbe806f8116b5b34eb5103c58c70885ddb7fc608`. Required source parity covered 233 runtime files. Browser/Puppeteer/Widevine payload checks passed on staged and extracted applications.

Before is the previously produced 1.0.7 six-artifact-workflow Windows pair, not a fresh rebuild of the initial working tree. Exact differences may include intervening small source changes.

| Content | Before bytes | After bytes | Before MiB | After MiB | Reduction |
|---|---:|---:|---:|---:|---:|
| Unpacked application | 1,256,960,942 | 787,594,136 | 1,198.73 | 751.11 | 37.34% |
| Production node_modules | 448,621,243 | 411,540,084 | 427.84 | 392.48 | 8.27% |
| NSIS | 268,841,506 | 127,965,231 | 256.39 | 122.04 | 52.40% |
| Portable ZIP | 368,611,470 | 174,106,075 | 351.54 | 166.04 | 52.77% |

The old separate browser occupied 432,272,963 unpacked bytes; the new payload has no browser resource directory.

- `Fury-Setup-1.0.7-win-x64.exe`: SHA-256 `9d8579c4a435917eeb3a658aebd6e9cb9e23ca63c515f800159192ff812febb9`.
- `Fury-Portable-1.0.7-win-x64.zip`: SHA-256 `b27868769c4cd6fd915bc0946543d0ee438bf390633df4620019cb293d172243`.

Outputs and machine-readable evidence are under `%TEMP%/fury-remove-namemc-<run>/` on the build machine; artifacts, parity, runtime and release metadata are under its `release/` directory. These are local artifacts, not published releases. Fury.exe and NSIS both report NotSigned.

All six names/targets and shared-payload workflows remain. Native Mac x64/arm64 ZIP+DMG were not built on Windows. Future native builds use the negative browser gate and no browser extraResources; old Mac artifacts must be replaced, not assumed browser-free.

## Protected architecture and release scope

52 tracked/protected files were checked against the starting working tree and remained byte-for-byte unchanged, including storage/migration, installer.nsh, session/history ownership, JSON writer worker, accounts, general shutdown/resources, instance/loopback helpers, Cosmetic Search service and current workflows. Tests also verified the narrowly edited launcher/proxy integrations. Pre-existing working-tree changes were preserved.

Windows remains %APPDATA%/Fury and launcher_data; packaged Mac remains Application Support/Fury. No artifact-specific profile, cache cleanup, storage migration, schema or history redesign was added. Branding, Node 22/24 policy and six-artifact naming remain.

The removed CfT distribution no longer creates CfT redistribution, its Widevine, its additional browser codec review, its separate browser update maintenance, or nested-Chrome Mac signing work in newly generated payloads. This is an absence-of-component conclusion, not blanket legal clearance for Electron or all dependencies. New native Mac artifacts must still prove the configured absence.

Remaining acceptance: native Mac builds and Intel/ARM runtime; production signing/notarization; Windows protected-install/default-profile/UAC/all-users/alternate-admin scenarios; actual Windows OS shutdown and security-software behavior. No new installer was installed over the registered production installation. No real credentials, live Microsoft login, website, updates or publishing were used.

**PARTIAL KEEP**: keep the removal and verified Windows artifacts; complete native and distribution-trust acceptance before public release.
