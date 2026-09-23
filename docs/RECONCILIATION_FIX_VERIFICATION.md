> Historical verification record: NameMC and its separately bundled browser have since been removed. Browser-specific checks below describe the earlier build. Current packaging rejects those payloads.

# F7 / launcher-history reconciliation implementation

Decision: **KEEP BOTH**, for the scoped reconciliation fixes. Existing release acceptance limitations (including native macOS and Windows system shutdown) remain outstanding. No release, dependency, storage-root, browser-package, signing or update changes were made.

## Defect 1: older publications replacing accepted memory

SessionStore previously let JsonFileCache reload an older own publication between its rename and acknowledgement. That could overwrite a newer accepted mutation and still produce a clean F7 acknowledgement.

SessionStore now holds accepted memory while dirty or awaiting a publication acknowledgement. Its flush is awaitable and serializes this owner's publications through their callbacks. Each successful receipt is associated with the semantic revision captured when that snapshot was queued. A subsequent shutdown flush joins the older write, then publishes the latest accepted state before the shared writer seals admission. The proxy awaits these owner flushes before jsonWriter.drain(). Final verification checks that no accepted generation remains dirty/pending and the last publication is still present.

External detection remains active when the store is idle. If external content conflicts with unsaved local changes, the save is refused, local memory is retained and the external file is untouched. The shutdown is unclean; there is no silent merge. Retained memory is not a new recovery file and will not survive a later forced process exit. This task does not introduce conflict-recovery formats or UI.

## Defect 2: acknowledging the wrong publication

For SessionStore's opted-in writes, atomic_file captures a versioned publication receipt from the completed temporary file **before rename**. It contains device, inode/file identity, size and nanosecond mtime. Rename preserves these fields; ctime is deliberately excluded because rename changes it on some platforms.

The worker returns this receipt only after successful rename. Existing jsonWriter request IDs associate the receipt with the correct callback; that callback captures the corresponding SessionStore revision. markWritten(receipt) adopts this known stamp without stat'ing the current destination. If an external publisher already replaced the destination, its different identity remains detectable on the next idle file check. No receipt/write ID is added to persisted JSON.

Failed writes never mark a publication. Missing receipts fail persistence. Ordinary successful writes retain memory/game identity and do not produce an external reload or false semantic revision. Final shutdown verification rejects a differing/missing final publication rather than claiming clean completion.

Other atomic-file callers and caches retain their existing behavior: publication capture and stronger cache stamps are opt-in for this owner.

## Defect 3: old proxy health responses

getProxyHealth captures the exact child object owned by Main before issuing HTTP. After receiving the response, it checks that Main still owns that same child and that the child has not exited. Failed checks return no health result **before** the history receiver is called. Both full and unchanged replies are fenced. The first request to the replacement child is accepted normally.

This reuses F7's existing child ownership. It does not combine SessionStore revisions, proxy projection epochs, Main request tickets, compact response revisions or shutdown request IDs. Standalone-proxy polling when Main owns no child retains its existing behavior.

## Deterministic concurrency verification

`node --test tests/session/test_history_reconciliation.js`: **9 tests passed**.

| Scenario | Result |
| --- | --- |
| A queues; B accepted; A publishes; file check; A acknowledges | B remains current; no false revision; final flush persists B |
| External B publishes between own A publication and acknowledgement | B loads on the next idle check and advances revision |
| Own write without interference through actual worker | No reload/revision; final publication verifies; sealed admission rejects new writes |
| Failed or missing-receipt acknowledgement | No successful mark; accepted memory retained; verification fails |
| External replacement after final write during F7 drain | FAILED/persistence; never clean |
| External edit while local state is dirty | No destructive save; disk and memory left separate; failure explicit |
| External replacement after A while newer local B is dirty | No second publication/merge; final verification fails |
| Old full/unchanged reply after proxy replacement | Discarded before receiver mutation; new child's first reply accepted |
| History projection after writes | Changed game gets new identity; unchanged revision continues using fast path |

`node tests/integration/test_history_reconciliation_integration.js`: actual proxy, health route, production JSON writer/atomic writes, IPC supervisor, synthetic data and isolated ports. A temporary worker adapter controls acknowledgement delivery and injects the write failure; production modules are not replaced on disk.

| Native case | Latest result | Duration |
| --- | --- | ---: |
| Older publication visible; newer memory accepted; real one-second file-check interval; Stop joins delayed acknowledgement | Exact newer game/account/pending state persisted; matching clean acknowledgement and exit | 156 ms |
| External replacement before acknowledgement | Unclean, forced persistence outcome; external file preserved; no clean acknowledgement | 3,124 ms |
| Writer failure | Unclean, forced persistence outcome; prior file preserved; no clean acknowledgement | 3,117 ms |

Durations include an intentional 120 ms acknowledgement gate. All three scenarios also overlap a health request with Stop, verify listener ports can be rebound, and verify the owned child has exited.

## F7 and history verification

All 25 cases in `node --test tests/integration/test_shutdown.js` passed, including writer error/exit-zero, debounce/pending game-end preservation, recording drains, authentication, NameMC, listener closure, renderer saves, anti-cheat, stale identity and forced fallback.

The current Electron launcher integration harness was executed with only its `restart` and `pending-quit` scenarios selected in a temporary runner. Latest results:

- Pending-history Quit: **255 ms**, exact pending synthetic data preserved.
- Stop to immediate replacement spawn: **97 ms**, matching clean acknowledgement plus old-child exit required; stale old exit cannot clear replacement.
- Subsequent Quit while replacement starts: **1,080 ms**, clean.

The actual proxy polling workload also stopped cleanly during polling in **25.5 ms**. The HTTP request failed promptly into the existing fallback in 3.4 ms, rather than waiting for the 800 ms timeout.

Passed existing scripts:

```text
tests/storage/test_atomic_file.js
tests/session/test_launcher_history_cache.js
tests/session/test_history_response.js
tests/session/test_launcher_session_history.js
tests/accounts/test_launcher_accounts.js
tests/session/test_session_tracker.js
tests/session/test_session_enhancements.js
tests/session/test_session_game_events.js
tests/session/test_empty_session_cleanup.js
tests/session/test_local_session_tracking.js
tests/session/test_local_stats_expansion.js
tests/session/test_team_elimination_save.js
tests/session/test_calendar_stats.js
tests/storage/test_runtime_paths.js
tests/storage/test_windows_migration.js
test_browser_runtime.js
test_windows_browser.js
test_namemc_lifecycle.js
```

The reconciliation's 288 clock/account/limit/coverage differential comparisons were repeated against current source and passed. Clock advancement and processed-game WeakMap implementations were not edited. Compact contract tests cover schema/allowlists, negotiation, account ownership, deletion, mutation invalidation, detail lookup, stale responses and bounded snapshot retention. Ten changed/new implementation/test files passed Node syntax checks.

## Performance

Same synthetic reconciliation workload: 70 sessions, 1,147 games, 25,860 uniquely normalized events; 5,189,443-byte raw fixture. Windows x64, Node 22.13.1. Actual proxy HTTP route and current Main getProxyHealth with its 800 ms timeout. Main timing covers JSON parsing and receiver work, not complete launcherState/renderer work. Unchanged and changed rows are medians of five and three requests; clock-only follows an actual 5.2-second wait. External/restart rows are individual observations.

| Workload | Before proxy build/cache | After | Before round trip | After | After payload |
| --- | ---: | ---: | ---: | ---: | ---: |
| Unchanged | 0.053 ms | 0.051 ms | 1.74 ms | 1.78 ms | 5,415 bytes |
| Clock-only | 0.164 ms | 0.161 ms | 3.49 ms | 3.17 ms | 5,415 bytes |
| Changed game | 7.96 ms | 6.68 ms | 130.18 ms | 116.35 ms | about 11.02 MB |
| External change | 213.18 ms | 123.43 ms | 497.30 ms | 336.05 ms | about 11.02 MB |
| Post-F7 restart | 145.25 ms | 137.32 ms | 390.96 ms | 363.35 ms | about 11.02 MB |

Uncached projection median: **248.90 ms before, 236.93 ms after**. No ordinary poll timed out or used fallback. These changes preserve the performance benefit; lower times are not claimed as a new optimization because timings vary with machine/GC conditions.

After-change Main JSON parse medians: unchanged 0.042 ms, changed 41.69 ms. Clock-only parsing 0.057 ms; external 41.98 ms; restart 42.98 ms. Receiver work normally remains sub-millisecond. Process CPU accounting is too coarse to interpret individual sub-millisecond cache hits reliably.

Retained projection-cache increment after forced GC: **11,455,264 bytes before, 11,455,952 bytes after**. Thirty update/rebuild cycles added approximately 115 KB afterward, with no full-history accumulation observed. Whole-proxy cold-history heap growth includes source normalization and was about 19.08 MB both times.

Benchmark artifacts and temporary runners: `%TEMP%/fury-reconciliation-fix-<run>/` (`poll.cjs`, `poll-results.json`, `memory.json`, `clock.cjs`, `source-changes.json`, and captured pre-change source). The historical audit comparison is in `%TEMP%/fury-reconciliation-<run>/`. Neither workload uses real account data or credentials.

## Protected architectures

Captured-source comparison confirms unchanged `historyResponse.js`, `launcherSessionHistory.js`, `launcher.html`, Windows runtime-path/migration code, browser resolver/preparation, package.json and package-lock.json. No renderer payload/detail path or persistence schema/version was edited by this fix.

Windows migration's 32 cases passed, including root ownership, conflicts, interruption, account removal, changed install path and simulated old removal. macOS Application Support resolution tests passed for both architectures and artifact-independent use. Browser runtime/macOS preparation tests and 24 Windows browser cases passed. The existing browser resource independently verified all 308 files / 432,272,765 bytes with unchanged fingerprint:

`fb8e3a703d2d102b99a7e80050ee932980c55859393cbc3e64c97fdde6ef2b05`

A concurrent nick-identity change appeared in `src/session/localStats.js` and game-chat portions of `proxy.js` during this task. It was preserved, not authored or reverted here. Related local/history/elimination tests were rerun on the combined tree. The elimination test's isolated context gained its newly required identity collaborator. The unchanged-persistence-format statement above concerns this reconciliation patch, not that independent change's additional local identity field.

## Exact files changed by this task

| Production file | Responsibility |
| --- | --- |
| `src/storage/filePublication.js` (new) | Stable publication-stamp construction and reading |
| `src/storage/atomic_file.js` | Opt-in receipt captured from completed temporary file before rename |
| `json_writer_worker.js` | Forward successful publication receipt with existing write ID |
| `src/storage/jsonWriter.js` | Opt-in receipt request and callback delivery; existing drain/seal/failure semantics retained |
| `src/storage/json_file_cache.js` | Opt-in publication-aware stamps; receipt-based markWritten and explicit verification |
| `src/session/sessionStore.js` | Dirty/pending memory ownership; serialized awaitable flush; persisted-generation tracking; external-conflict and final-publication checks |
| `proxy.js` | Await owner flushes before sealing; verify SessionStore after writer drain (only this shutdown hunk belongs to this task) |
| `launcher.js` | Fence health replies using the currently owned child object |

Tests added: `tests/session/test_history_reconciliation.js`, `tests/integration/test_history_reconciliation_integration.js`.

Existing synchronous storage doubles updated to acknowledge their completed synthetic writes: `tests/session/test_launcher_history_cache.js`, `tests/session/test_empty_session_cleanup.js`, `tests/session/test_local_session_tracking.js`, `tests/session/test_local_stats_expansion.js`, `tests/session/test_session_game_events.js`, `tests/session/test_team_elimination_save.js`. The cache test now settles accepted local work before asserting a clean external reload. The elimination fixture also supplies the concurrently added identity collaborator; no nick-handling production code was modified here.

This report is `RECONCILIATION_FIX_VERIFICATION.md`.

## Remaining risks and verification limits

- No atomic cross-process compare-and-swap is claimed against an unrelated editor writing at the exact guard/rename boundary, or after final verification. There is no lock protocol shared with arbitrary external writers. Detected stable conflicts fail; no automatic merge/recovery copy is introduced.
- A deliberately in-place edit that preserves inode, size and mtime can evade metadata-based external detection. Ordinary in-place writes change mtime, and atomic replacements change file identity. Adversarial timestamp restoration is not a supported synchronization protocol.
- A dirty conflict leaves accepted changes in memory only. A later bounded forced exit cannot preserve that memory; it is explicitly reported unclean. There is no claim of successful persistence in this case.
- Native macOS filesystem/rename behavior, redirected/network profiles, unusual timestamp/filesystem behavior, Windows logoff/system shutdown, and slow-disk/security-software tail latency remain unverified. No new packaged release was built.
- Forced termination, crash and power loss remain outside graceful-shutdown guarantees. Atomic rename completion is not a new fsync durability guarantee.
- This is focused reconciliation acceptance, not acceptance of unrelated concurrently edited functionality or completion of previous release-environment verification.

Recommendation: **KEEP BOTH**.
