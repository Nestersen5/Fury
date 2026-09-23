> Historical verification record: NameMC and its separately bundled browser have since been removed. Browser-specific checks below describe the earlier build. Current packaging rejects those payloads.

# Six-artifact packaging verification

Decision: **PARTIAL KEEP**. The Windows pair was built and verified, including
native extracted-ZIP execution. Both Mac architectures now have ZIP/DMG
packaging and native CI verification paths, but neither Mac job was executed in
this Windows environment. No artifacts were published.

## Artifacts and sizes

Version: **1.0.7**. Actual Windows outputs are in:

`%TEMP%ury-six-artifacts-<run>elease` on the build machine (local artifacts, not published releases)

| Artifact | Result | Actual bytes | MiB |
| --- | --- | ---: | ---: |
| `Fury-Setup-1.0.7-win-x64.exe` | Generated, payload verified | 268,841,506 | 256.39 |
| `Fury-Portable-1.0.7-win-x64.zip` | Generated, native runtime verified | 368,611,470 | 351.54 |
| `Fury-1.0.7-mac-x64.dmg` | NOT GENERATED; native Mac required | — | — |
| `Fury-Portable-1.0.7-mac-x64.zip` | NOT GENERATED in this task | — | — |
| `Fury-1.0.7-mac-arm64.dmg` | NOT GENERATED; native Mac required | — | — |
| `Fury-Portable-1.0.7-mac-arm64.zip` | NOT GENERATED in this task | — | — |

Unpacked Windows application: **1,256,960,942 bytes** (1,198.73 MiB), 8,840 file/link
entries. Browser files: 432,272,765 bytes plus the 198-byte manifest. The ZIP is
consistent with the prototype's approximately 368.6 MB estimate; no recurring
self-extraction occurs. No size optimization or runtime dependency change was
made.

## Shared payload architecture

Windows packaging prepares the browser once, builds NSIS and `win-unpacked`,
then creates the ZIP with `--prepackaged` using that exact directory. Sequential
execution includes NSIS's application helper in both payloads. The verifier
extracts the installer without running it, extracts the ZIP, and compares both
against the staged directory. All 8,840 entries matched.

Payload inventory SHA-256:
`d596c08ea8020bed07c85bbb853b987414c0d3c026fbca7981e3261d96c07636`

Both containers passed current-source verification for **232 runtime files**:
`0034cd2a47e251e5ccab7c786e67085be6b6533e2acdc71d65440164395d04ad`

Mac packaging requests ZIP and DMG together for each CPU, using one generated
`Fury.app` per architecture. Verification extracts the ZIP, mounts the DMG
read-only, and compares all files, executable bits and contained symlinks. It
also checks the Applications link, bundle ID, Mach-O code and existing signature
consistency. These checks are implemented but **NOT EXECUTED natively here**.

## Windows portable and F7

The actual ZIP was extracted under a path containing spaces. A temporary ACL
denied application-tree writes and an explicit write probe confirmed the deny.
The app ran from a different working directory, with synthetic data, an empty
Puppeteer cache and a PATH without system Node/npm. Main's external-browser
opening and real Microsoft authentication entry points were blocked before
production Main executed. Offline Minecraft and navigation fixtures replaced
external collaborators only in test memory/preloads.

Passed:

- Packaged launcher launch, real proxy Start/Stop and immediate Stop → Start.
- Matching clean shutdown acknowledgement and actual old-process exit.
- Pending session/game persistence through Quit and subsequent relaunch.
- Accepted recording output exists, contains the existing footer, and is closed.
- Active bundled Chrome cancellation, process exit and temporary-profile removal.
- Account-specific compact HistoryResponse and revision-aware detail behavior.
- Current source/browser verification and unchanged application-resource hashes.
- Empty Puppeteer cache after execution; no owned service/browser processes left.

Final run measurements (including test-driving overhead):

| Scenario | Time |
| --- | ---: |
| Extracted launcher ready | 1,246–1,864 ms |
| Stop → replacement start invocation completed | 452 ms |
| Pending-history Quit | 619 ms |
| Recording + active NameMC + pending-history Quit | 1,033 ms |
| Account/history Quit | 627 ms |

The Stop/Start timing does not include the subsequent replacement health-ready
poll; that readiness assertion also passed. Healthy Quit did not wait for the
full graceful deadline. The prototype's rejected 87–95-second self-extracting
EXE path is not configured.

## Storage and migration

Runtime code is unchanged. Tests still establish Windows `%APPDATA%\Fury`
through Electron's app-data path and `launcher_data` beneath it; all packaged
Mac modes resolve to `~/Library/Application Support/Fury`. Development and
absolute overrides retain their existing behavior. Artifact type is not a
storage selector.

The native tests deliberately used an absolute isolated `FURY_DATA_DIR`. They
did not exercise the current user's real canonical profile. Consequently,
default-path installed/portable interoperability is supported by unchanged
source and path tests, **not claimed as native default-profile acceptance**.
No disposable account/VM was available.

`build/installer.nsh` and the complete accepted storage/migration implementation
remain unchanged. The new ZIP does not execute NSIS hooks. Any existing safe
runtime migration/discovery behavior remains owned by the accepted runtime.
The actual production-identity NSIS executable was extracted, not installed;
the registered real Fury installation and real data were left untouched.

## Browser

Windows contains Chrome for Testing **148.0.7778.97 win64**, complete resources,
DLLs, locales and notices. Both application payloads passed the existing F3
manifest/resolver and full browser fingerprint verification:

`fb8e3a703d2d102b99a7e80050ee932980c55859393cbc3e64c97fdde6ef2b05`

A separate success fixture ran through the packaged Electron/Node executable
and production NameMC parser. Browser launch was 1,025 ms, full fixture lookup
1,960 ms and browser close 294 ms. The expected synthetic name history was
returned; Chrome exited and its temporary profile was removed. This proves the
bundled-browser execution path, not the live NameMC site's availability or
anti-bot acceptance.

Mac browser preparation/resolution is unchanged: x64 selects the approved
Intel browser and arm64 the approved ARM browser. Native inclusion, launch and
cleanup must pass the corresponding Mac jobs before acceptance.

## Mac x64 and Mac arm64

Both architectures are configured for the exact requested ZIP and DMG names,
without a universal build or PKG. The DMG uses the canonical app icon, a simple
white background and an Applications link.

The workflow uses separate `macos-15-intel` and `macos-15` runners and fails if
the running Node architecture differs from the target. It verifies both
containers, runs the extracted ZIP, mounts/copies the DMG to an
Applications-equivalent path containing spaces, runs that copy, and checks
bundle hashes/signatures again. Existing UI verification remains, with its
real-auth subtest explicitly skipped in packaging CI and mocked onboarding
coverage retained.

**NOT TESTED here:** either native Mac build, mount/copy/launch, Intel runtime,
ARM runtime, Finder presentation or Gatekeeper. No workflow was dispatched.

## Branding and package hygiene

Canonical production assets remain `assets/fury-icon.ico` for Windows app/NSIS
and `assets/fury-icon.png` for Mac. No assets were regenerated or substituted.

The existing runtime allowlist is unchanged. Source and hygiene checks in both
actual Windows payloads exclude user settings/accounts/tokens/history,
recordings, secrets, migration recovery, tests, prototypes and benchmark output.
Required runtime source/assets and browser resources are present. Dependencies
are pruned by electron-builder; the complete application inventory is compared
across containers. No synthetic data was bundled into an artifact.

## Tests and protected architecture

All **17 selected regression scripts passed**, run from the isolated build
snapshot. Complete logs and timings are retained under
[`output/six-artifacts-vFEWT9/regressions`](output/six-artifacts-vFEWT9/regressions):

```text
tests/storage/test_runtime_paths.js
tests/storage/test_windows_migration.js
tests/storage/test_windows_migration_integration.js
test_browser_runtime.js
test_windows_browser.js
test_namemc_lifecycle.js
tests/integration/test_shutdown.js
tests/integration/test_shutdown_force.js
tests/integration/test_shutdown_integration.js
tests/session/test_history_reconciliation.js
tests/integration/test_history_reconciliation_integration.js
tests/session/test_history_response.js
tests/session/test_launcher_history_cache.js
tests/accounts/test_launcher_accounts.js
tests/packaging/test_portable_package.js
tests/packaging/test_release_hygiene.js
tests/release/test_release_artifacts.js
```

The new packaging tests cover names/targets, sequential shared staging,
payload drift/additions/removals, escaping junctions/links, private files,
metadata and builder schema. POSIX executable-bit/link branches require Mac CI.
Both workflow YAML files parse. Runtime/migration, F7, reconciliation, browser
preparation, account/history modules and branding remain byte-for-byte unchanged
against the task baseline. Package dependencies, allowlist, app ID and existing
signing/NSIS behavior settings also match their baseline.

## Release metadata and evidence

[`release-metadata.json`](output/six-artifacts-vFEWT9/release-metadata.json)
contains all six local slots. Each has version, OS, architecture, distribution,
format and filename. The Windows files have actual byte sizes and SHA-256;
unbuilt Mac entries have `available: false`, null size and null SHA-256. No URLs
are fabricated.

- NSIS SHA-256: `661d197165232f3dcc3dafab691f122c2a4107afab18e4036dcb0ffe924eb519`
- ZIP SHA-256: `1d94ea61e5dc467a41c04308a548222b4149f318e92f75eb3ff9f7cb501337af`
- [Paired payload evidence](output/six-artifacts-vFEWT9/PAIR-win-x64.json)
- [Native ZIP evidence](output/six-artifacts-vFEWT9/WINDOWS-RUNTIME.json)
- [Packaged browser success](output/six-artifacts-vFEWT9/PACKAGED-BROWSER-SUCCESS.json)
- [Exact current-source hashes](output/six-artifacts-vFEWT9/CURRENT-SOURCE-VERIFICATION.json)

## Files changed in this task

| File | Responsibility |
| --- | --- |
| `package.json` | Six container targets/names, DMG layout, packaging test command |
| `scripts/package_windows.js` | Sequential NSIS/ZIP from one app; verification and metadata |
| `scripts/package_macos.js` | Per-CPU ZIP/DMG from one app; verification and metadata |
| `scripts/release_artifacts.js` | Matrix, hashes, content/hygiene checks and local metadata |
| `scripts/verify_release_pair.js` | Safe container extraction/mounting and full payload parity |
| `scripts/verify_windows_portable.js` | Actual ZIP extraction and native acceptance orchestration |
| `scripts/test_packaged_readonly.ps1` | Temporary test-only write-deny ACL and restoration |
| `scripts/verify_packaged_runtime.js` | Cross-platform isolated launcher/proxy/F7/browser/account harness |
| `scripts/verify_macos_dmg.js` | Native mount/copy/runtime/immutability verification |
| `tests/release/test_release_artifacts.js` | Packaging regression checks |
| `test_windows_browser.js` | Assert NSIS + ZIP targets with existing browser contract |
| `.github/workflows/portable-macos.yml` | Native per-CPU jobs, both containers, pair/runtime reports |
| `.github/workflows/macos-screenshots.yml` | Updated referenced workflow description |
| `scripts/verify_launcher_redesign.js` | Packaging-CI opt-out for existing real-auth subtest |
| `docs/RELEASE_ARTIFACTS.md` | Build, verification, metadata and trust instructions |
| `docs/PORTABLE_MAC.md` | Both architectures and ZIP/DMG usage; accurate trust/test boundaries |
| `PACKAGING_VERIFICATION.md` | This report |
| `output/six-artifacts-vFEWT9/` | Generated evidence; excluded from application payloads |

No production application logic, installer migration hook, persistence format,
browser implementation or signing/notarization configuration was changed.

## Signing boundary and remaining acceptance

The generated Windows NSIS and `Fury.exe` both report **NotSigned**. Existing
Mac ad-hoc settings remain unchanged. Packaging passed where tested; **public
distribution trust has not passed**. Production signing/notarization, nested
code trust, Gatekeeper, SmartScreen and security-software acceptance remain a
separate approved phase. No signatures/security settings were weakened to run
the tests.

Remaining **NOT TESTED** items:

- Native Intel and ARM Mac builds and all ZIP/DMG runtime/visual checks.
- Fresh Windows VM, default canonical profile interoperability and replacing a
  deployed portable ZIP while retaining that real default profile.
- Actual NSIS install/upgrade/uninstall, Program Files, UAC/HKLM and alternate
  administrator scenarios; the real registered installation was protected.
- Redirected AppData, another volume, live credentials and live NameMC service.
- Security/antivirus environments and native OS shutdown/logoff behavior.
- Public signatures/notarization/trust and later publishing/download mapping.

Retain the packaging changes and Windows verification evidence. Complete the
native Mac jobs and remaining isolated Windows acceptance before promoting all
six artifacts to a public release. **PARTIAL KEEP**.
