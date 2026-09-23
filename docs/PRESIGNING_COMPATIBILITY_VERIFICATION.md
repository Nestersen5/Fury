> Historical verification record: NameMC and its separately bundled browser have since been removed. Browser-specific checks and blockers below describe the earlier build, not current releases.

# Bounded pre-signing compatibility verification

Date: 2026-09-20. Recommendation: **PARTIAL KEEP**.

## Implementation inventory

| Files | Responsibility |
| --- | --- |
| `src/bootstrap/launcherInstance.js`, `launcher.js` | Electron profile lock after safe migration/userData initialization and before mutable owners; secondary restore/show/focus and clean exit; hold until actual process exit. Also recognize bracketed IPv6 localhost in the existing local Cosmetic Search decision. |
| `src/net/loopback.js`, `proxy.js` | Explicit IPv4 loopback Minecraft listener plus IPv6 loopback sockets delivered to the same protocol owner. Register both with existing shutdown resource ownership. Abort pending bind during quiescence. |
| `src/net/cosmeticBind.js`, `cosmetic_search_api.js` | Desktop loopback enforcement; explicit standalone IP bind opt-in; same HTTP handler and existing bounded resource cleanup. |
| `package.json`, `package-lock.json` | Node engines `^22.12.0 || ^24.0.0`; focused compatibility/native-instance test commands. No dependency, Electron or build-target changes. |
| `.github/workflows/test.yml` | Node 22.x/24.x Windows/Linux compatibility matrix; run focused compatibility checks. |
| `.github/workflows/portable-macos.yml`, `.github/workflows/macos-screenshots.yml` | Pin build-tool Node to 22.23.2; Mac package workflow includes compatibility checks. Architecture/artifact/signing settings unchanged. |
| `README.md`, `.env.example`, `docs/COSMETIC_SEARCH_API.md`, `docs/DESKTOP_COMPATIBILITY.md` | Maintainer/runtime policy, standalone opt-in, intentional Mac lifecycle and native acceptance checklist. |
| `tests/platform/test_launcher_instance.js`, `tests/platform/test_launcher_instance_native.js`, `tests/platform/test_desktop_listeners.js` | Maintained unit, native Electron ownership, real network/proxy/service and outbound fixture tests. |

## Single instance

The unchanged Windows migration bootstrap runs first. The existing data-root
initialization and Electron userData assignment follow. Only then does Main
request its lock, before loading settings/accounts and starting services.
No pre-migration canonical directory creation was introduced. A secondary
returns immediately after `app.exit(0)`, without loading mutable owners.
The primary never explicitly releases its lock during the F7 drain.

Native Electron 42.1.0 tests passed simultaneous launches from two separate
application directories labelled installed/extracted, rapid double launch,
minimized restore/show, contention during quiescence, independent explicit
test profiles, relaunch after exit, and recovery after hard process exit.
These are native lock tests, not newly installed/signed artifact tests.
Focus invocation is verified; OS foreground-stealing policy can still govern
which window becomes foreground. A launch during primary shutdown exits;
it does not cancel shutdown or queue automatic restart.

## Listener and cloud policy

| Service | Before | After |
| --- | --- | --- |
| Minecraft direct/failover | Unspecified host, wildcard; diagnostics explicitly IPv4 loopback | `127.0.0.1` and `::1`, same Minecraft server owner |
| Desktop Cosmetic Search | `0.0.0.0` | `127.0.0.1` and `::1`, same Express handler |
| Standalone Cosmetic Search | `0.0.0.0` default | Loopback default; explicit `COSMETIC_SEARCH_BIND_HOST` IP opt-in |
| Health | `127.0.0.1` | Unchanged |

Launcher-owned service identity forces loopback even with an inherited remote
bind request. Explicit standalone `0.0.0.0` was tested successfully. Invalid
hostnames are rejected; localhost maps to the two loopback listeners. IPv6
unavailability is diagnosed and leaves IPv4 available. Bind conflicts surface
through the existing server error path.

Native tests exercised real Minecraft status on both routes through IPv4,
localhost and IPv6; local HTTP connectivity; refusal through both available
non-loopback IPv4 interfaces; active IPv6 socket cleanup; listener closure and
immediate restart. Non-loopback checks originated on this host, not a second
physical LAN device. Explicit standalone remote bind accepted those same
interface addresses. Test services used isolated synthetic data.

Mocked production Main, proxy command and vendor-client calls verified the
unchanged cloud API URLs, parameters, synthetic-token forwarding and response
handling. No authenticated cloud or Microsoft requests were made.

## Node and regression results

Official Windows Node archives for 22.23.2 and 24.21.0 were checked against
their vendor SHA-256 files. Separate temporary source copies completed clean
`npm ci --no-audit --no-fund` installs. Puppeteer download was disabled for
installation; browser preparation remains the release workflow's owner.
The repository's installed dependencies and system Node were not changed.

27 selected test scripts passed per Node version (54 final script results):
instance/listener compatibility; runtime paths; Windows migration and native
migration integration; browser resolution/distribution validation/NameMC
lifecycle; shutdown unit, proxy integration and force fallback; reconciliation
unit/native integration; compact HistoryResponse, history cache/projection;
launcher/account/skin/HTTP isolation; authentication guards; session tracking;
release artifacts/portable/hygiene; proxy health and Minecraft team integration.
The final compatibility suites were rerun after adding active IPv6 connection
cleanup coverage and passed on both versions.

One parallel Node 22 migration run conservatively aborted at reinstall with
`WRITERS_UNVERIFIABLE`. Its isolated rerun passed every executable case,
including Chromium localStorage/cookie/profile preservation. Process churn is
a plausible cause, not a proven root cause. No guard was weakened. Actual
alternate-owner ACL verification still reported unavailable privilege.

Native current Main/renderer integration used a temporary test-only bootstrap
with external browser/real-auth fencing. The unrelated staged-auth scenario
was excluded; no production authentication code was modified.

| Actual launcher scenario | Time |
| --- | ---: |
| Idle Quit | 109 ms |
| Window close with accepted renderer save | 258 ms |
| Stop to immediate replacement start | 235 ms |
| Quit after restart | 1,096 ms |
| Pending-history Quit | 260 ms |
| Recording Quit | 733 ms |
| Hung persistence | 3,203 ms, forced/unclean |
| Quit during restart | 471 ms |

Persisted synthetic history, recording footer, renderer save and child-exit
assertions passed. No full general `npm test` or remote CI run is claimed here;
the focused suites cover this change and protected contracts. Native Mac
execution was unavailable.

## Protected architecture and artifacts

Before/after hashes confirm 38 selected storage, session, account, browser,
shutdown/supervisor and release-script files remain identical. Package build,
dependency and devDependency objects are identical; lockfile changes only add
the root engines declaration. Existing branding assets and packaging targets
remain unchanged. An unrelated concurrent reminder-file edit was preserved.

All six distributions continue to share the same platform/profile behavior:
Windows `%APPDATA%\Fury` and macOS `~/Library/Application Support/Fury`, with
the existing `launcher_data` profile. Absolute overrides retain their existing
semantics. No artifact-specific root or resolver was introduced. New runtime
helpers match the existing `src/**/*.js` package allowlist; test scripts remain
excluded. Pairing/package-hygiene tests passed. No artifacts were rebuilt: old
ZIP/NSIS downloads do not contain these changes and must be regenerated for a
future signing candidate.

## Remaining acceptance and release blockers

- Native Intel and Apple Silicon lifecycle/lock/network tests, including paired
  DMG/ZIP launch, close button, Cmd+W/Cmd+Q, Hide/minimize, Dock and relaunch.
- Windows actual installed/ZIP contention under UAC, alternate credentials,
  protected locations, redirected profiles and other deferred F1/F2 environment
  cases. No disposable elevated environment was available.
- A regenerated packaged candidate with the new files, including installer/ZIP
  contention. This task tested current source/native Electron rather than all
  rebuilt release containers.
- Chrome for Testing redistribution/licensing confirmation remains unresolved;
  this task neither changed the browser nor reached a new legal conclusion.
- Production signing/notarization and distribution trust remain outstanding.
  Nothing was signed, published or deployed.

The intentional Mac policy is documented, not redesigned: closing Fury stops
the proxy and quits; Minimize/Hide keeps it running. Existing F7 sequencing and
macOS close-versus-quit code remain unchanged.

Final process inspection found no remaining test-owned Node/Electron/Fury/
Chrome processes. No real Fury credentials or profile were used.

Local test receipts are in `output/presigning-compatibility/`; temporary clean
install workspaces and detailed per-test logs remain under
`%TEMP%/fury-presigning-45tVXU` for inspection.
