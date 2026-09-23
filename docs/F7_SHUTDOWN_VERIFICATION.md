> Historical verification record: NameMC and its separately bundled browser have since been removed. Browser-specific checks below describe the earlier build. Current packaging rejects those payloads.

# F7 bounded graceful shutdown

Decision: **PARTIAL KEEP**. Implemented and verified on this Windows host with
isolated synthetic data. Native Windows logoff/shutdown and native macOS
acceptance remain outstanding. No dependencies were installed and no release
artifacts were built or modified.

## Implementation and ownership

| Production file | Responsibility |
| --- | --- |
| `src/bootstrap/shutdown.js` (new) | Shared three-second deadline, phases, duplicate-request coalescing, versioned service IPC, explicit failed/forced outcomes. |
| `src/bootstrap/childShutdown.js` (new) | Per-child identity/request validation; completion plus actual exit; up to one second of owned-process cleanup; registered NameMC profile cleanup. |
| `src/bootstrap/shutdownResources.js` (new) | Accepted-work retention, listener/socket ownership, upstream authentication tracking and late-connect fencing. |
| `launcher.js` | IPC-enabled service spawn, identity-safe exit handlers, Stop/Start serialization, Quit/restart coordinator, accepted-save drain, staged authentication cancellation/join, Windows query-session-end hook. |
| `launcher_shutdown.js` (new), `launcher.html` | Renderer acknowledgement after accepted save queues/debounces drain; freeze new interactions; preserve draft/revision semantics; report forced Stop. |
| `proxy.js` | Quiesce packet/command/listener admission, cancel connection work, drain durable owners and authentication, close listeners and workers in order. |
| `cosmetic_search_api.js` | Reject new work, abort outstanding optional Aurora requests, close owned listener/sockets. |
| `src/health/httpServer.js` | Shutdown admission gate and ownership of accepted asynchronous session actions; bind policy unchanged. |
| `src/storage/jsonWriter.js` | Track every accepted write, including writes without callbacks; await acknowledgements, seal admission, reference while draining, detect failures/unexpected exit, terminate last. |
| `src/session/sessionStore.js`, `src/profiles/profileStore.js` | Strict, pending-only debounce flushes. |
| `src/session/sessionTracker.js`, `src/session/localTracking.js` | Preserve observed delayed game ends using existing pending-verification records; retain already-running initial baselines; fence late snapshots and detach. |
| `src/recorder/packetRecorder.js` | Retain completion promises after removal from active recordings; await footer, stream finish and close; propagate recording failures. |
| `src/menu/quickBuy.js` | Cancel menu work, retain and await accepted preset/backup writes, propagate persistence failures. |
| `src/cosmetics/effectLibrary.js` | Serialize existing asynchronous saves and drain accepted user-recorded state/preferences. |
| `anticheat/manager.js`, `anticheat/worker.js` | Admission fence, consume queued batches and worker responses, persist final evidence/feedback, then terminate worker. |
| `namemc_grabber.js` | Active lookup cancellation, late-launch rejection/close, awaited profile removal, resource registration for bounded fallback. Browser selection and fingerprint unchanged. |

Clips, aliases and other already-accepted JSON writes use the shared writer
barrier; their persisted formats and owning implementations were not changed.
Disposable caches and diagnostic logs do not introduce mandatory shutdown waits.

## Contract

Normal service shutdown follows RUNNING -> QUIESCING -> DRAINING -> CLOSING ->
ACKNOWLEDGED -> EXITED. Main sends version 1, a unique service-instance identity,
request ID, reason and absolute deadline over the existing spawned child's new
Node IPC channel. Progress phases are allowlisted. Clean Stop requires both a
matching persistence/resource acknowledgement and an observed zero-status exit.

Duplicate requests share one operation. Start awaits the previous Stop and
rechecks application quitting before spawning. Old-child exit/error handlers
cannot clear a replacement child. Restart/relaunch is not automatic after an
unclean result. Forced Stop is exposed as unclean; forced Quit exits nonzero.

The budget is three seconds of graceful work plus at most one second of forced
cleanup, using absolute deadlines rather than stacked owner timeouts. Healthy
work has no minimum wait. A non-timeout cleanup failure does not prevent other
owners from attempting their mandatory drains, but the result remains failed.
Timeout logs identify the phase without payloads or credential contents.

## Verification

All checks used temporary data roots or synthetic fixtures. No real accounts,
tokens, game history or production installation were exercised.

- `node --test tests/integration/test_shutdown.js`: **25/25**. Includes phase/deadline behavior,
  service identity and duplicate requests, delayed JSON writes, write failure,
  unexpected zero-status writer exit, pending session debounce/game ends,
  initial-baseline and late-snapshot races, recording footer/delayed stream and
  failure, cosmetic saves, stale acknowledgements, forced fallback, listener
  reuse, NameMC cancellation/late launch, renderer save barrier, anti-cheat
  fence/feedback and unexpected worker exit. The late authentication test also
  uses the actual minecraft-protocol continuation with synthetic Authflow output.
- `node tests/integration/test_shutdown_integration.js`: actual proxy, IPC, workers and Minecraft
  sockets: idle Stop, pending session Stop, recording Stop, bundled-Chrome
  cancellation. Exact pending history/footer checked; repeated startup binds
  the same listener ports. Native Chrome exits and its profile is removed.
- `node tests/integration/test_shutdown_launcher.js`: actual current launcher Main and renderer
  under Electron, with test-only instrumentation in a temporary bootstrap:
  idle Quit, window close with pending accent save, Stop -> immediate Start,
  stale old-child exit, pending-history Quit, staged-auth Quit, recording Quit,
  hung-persistence forced Quit, Quit during a pending restart, and NameMC Quit.
  Owned service/auth-worker PIDs are checked after exit. Staged authentication
  does not promote and its staging directory is removed. No actual Microsoft
  authentication is attempted.
- `node tests/integration/test_shutdown_force.js`: deliberately hung drain with a real bundled
  Chrome process. With a 300 ms test grace budget, forced termination and profile
  removal completed in **458 ms total**, returned unclean, and left the owned
  browser PID absent.

For native browser cases, set `FURY_TEST_BROWSER_RESOURCES` to an existing
verified Fury `resources` directory containing `browser`. This only reads the
browser distribution; it does not package anything. Without this environment
variable the optional native browser cases are omitted; mocked NameMC cases
still run. Use an appropriate platform/architecture browser when testing macOS.

Twenty-one existing regression scripts also passed: runtime paths, Windows
migration and migration integration, history response, launcher history cache,
local session tracking, session tracker, team-elimination save, launcher
accounts, connection authentication, profiles, clips, aliases, all three F3
browser/NameMC scripts, Quick Buy, hotbar, anti-cheat, packet recorder and
cosmetic effects.

## Measured shutdown timings

Latest native Electron run, measured through the actual process exit event:

| Scenario | Time |
| --- | ---: |
| Idle application Quit | 119 ms |
| Window close with accepted pending launcher save | 249 ms |
| Quit with pending session/history data | 278 ms |
| Quit during recording | 704 ms |
| Quit during NameMC navigation | 856 ms |
| Quit during staged sign-in | 140 ms |
| Stop -> safe replacement spawn | 103 ms |
| Quit while replacement process is still starting | 1,016 ms |
| Quit arriving during Stop/Start | 315 ms |
| Hung persistence, full production budget | 3,232 ms; forced/nonzero exit |

Separate real-proxy runs measured approximately 373-530 ms idle Stop,
517-858 ms pending-session Stop, 408-622 ms recording Stop, and 705 ms NameMC
Stop. These full-process measurements include worker startup/exit and Electron
or browser costs; they are not directly comparable to the much smaller isolated
prototype's idle coordinator measurement. Healthy runs stayed below the grace
budget without sleeping until its expiry. Safe replacement spawn is distinct
from completing the new proxy's startup.

## Protected architectures

Byte comparisons against the pre-F7 source snapshot confirm no changes to
`package.json`, `package-lock.json`, runtime path resolution, Windows migration
and bootstrap, browser resolver/preparation/package verification, Windows/macOS
packaging scripts, compact history responses and launcher history receiver,
account catalog/isolation, auth-cache promotion and account-removal modules.
Related behavioral regressions passed as listed above.

The reused F3 distribution still contains **308 files**, **432,272,765 bytes**,
with content fingerprint
`fb8e3a703d2d102b99a7e80050ee932980c55859393cbc3e64c97fdde6ef2b05`.
No browser launch fingerprint, storage roots, persisted formats, bind addresses,
release targets, signing, notarization or update behavior changed. macOS
close-versus-quit policy is unchanged; only shutdown coordination is added.

## Remaining acceptance

- Native Windows query-session-end/logoff/system shutdown: hook implemented,
  but no real logoff/shutdown was attempted in this non-disposable environment.
- Native macOS Intel/ARM normal and forced shutdown, browser process-group
  cleanup and existing window-close behavior.
- Real Microsoft refresh and account behavior under actual network failure;
  only isolated staged sign-in and synthetic refresh continuations were used.
- Representative large histories/recordings, slow storage and security software
  to validate whether the initial three-second budget needs adjustment.
- A future packaged F7 build. This task ran current production source under
  Electron and reused the existing F3 browser resource; it did not build a new
  release or clear previous unrelated release-acceptance limitations.

Normal graceful shutdown does not promise durability after hard termination,
process crash or power loss. Atomic JSON behavior remains as before; a recording
failure preserves available partial output and produces an unclean result,
not a claim that its footer completed.
