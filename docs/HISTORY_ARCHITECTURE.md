# Fury session-history architecture

This is the durable record of how Fury's session-history path is shaped and why.
It consolidates the concurrency-architecture decision, the compact
`HistoryResponse` contract and the one shipped projection optimization. The
measurement directories those investigations produced were generated output and
have been removed; the conclusions that constrain future work live here.

Current source and tests are authoritative for the exact mechanism.
`src/session/historyResponse.js` owns the contract and `tests/session/test_history_response.js`
is its executable specification. Read both before changing anything below.

## Concurrency decision

Investigation date 2026-09-19, on Electron 42.1.0 / Chromium 148 / Node 24.
The decision was to **shrink the response before adding parallelism**, and it
still governs.

| Question | Decision |
|---|---|
| Move history computation off Electron main? | Yes for the persisted-history path, including large-file parsing/normalization and delta preparation — not just the final function. Live projection runs in the proxy, not main; that path needs its own source adapter. |
| Move history computation off the renderer? | Calendar aggregation is eligible. `buildLauncherSessionHistory` is not renderer work. Remove full-object fingerprints via revisions rather than offloading them. DOM and canvas/card presentation stay in the renderer. |
| Shrink the response before more parallelism? | **Yes.** Another worker returning the full object would keep the renderer problem and add communication cost. |
| Would one persistent worker suffice? | Likely, at the observed polling rate, with bounded queues and revision caches. A synchronous history job can still delay a calendar job in the same worker. It cannot solve drag/resize jank. |
| Electron utility process instead? | Not on current evidence. `worker_threads` is the right starting point for this trusted JavaScript computation. |
| What cannot benefit from workers? | Drag/control synchronization, forced style/layout, resize invalidation, DOM mutation and paint, overlay geometry fitting. |

**Explicitly unchanged, and not to be reopened casually:** the accepted history
algorithm and cache; native refresh cadence; ordinary scrolling, hover and
animation durations; retention, statistics and account semantics. No worker
pool, no per-request workers, no shared memory, no blanket virtualization, no
FPS cap. The rejected preparation-reuse prototype stays rejected.

## Compact `HistoryResponse` contract

`state:get` negotiates with a numeric `historyContract: 1`. **Unknown, absent or
differently typed versions receive the original full response** — that fallback
is the compatibility guarantee and must not be removed. The mounted redesigned
renderer opts in; its legacy fallback retains full fields.

Envelope:

```js
{
  version: 1,
  revision: { epoch, generation, accountKey },
  history: { sessions, calendarSessions }
}
```

**Explicit allowlists, not filters.** Session: `id`, `uuid`, `name`,
`startedAt`, `lastSeen`, `endedAt`, `active`, `durationMs`, `modes`, plus
compact `games`. Game: `id`, `mode`, `verificationStatus`, `result`,
`opponents`. All nested mode/card statistics are preserved.

`calendarSessions` is retained **exactly**, including its fallback session/card
fields and sessions outside the detail limit, because `launcher_calendar_stats.js`
still performs the original calculation over it.

Removed from the initial response: top-level account/summary/live/goal/trend/
settings projections (the renderer already has global account and settings
state), and full per-game events, roster, stats, opponent details and
reconciliation. Those remain available through revision-bound detail requests.

Consumers of the allowlisted fields: `src/launcher/renderer/launcher_redesign.js` session rows,
deletion controls and recent-session display; `launcher_session_card.js` cards;
the settings card preview; and the mode/result/opponent filters in
`launcher.html`. Adding a field to the allowlist means adding a consumer —
the payload size is part of the contract.

### Revisions, staleness and invalidation

- Revision is a random process **epoch** plus a globally monotonic
  **generation**. Generation advances at request start and on invalidation.
  There is no content fingerprint and no preparation-reuse eligibility scan.
- Each live renderer owns **at most one** latest full snapshot. New publication
  replaces it; account/session mutations and observed history/settings changes
  clear it; renderer destruction releases the scope. There is no multi-revision
  cache and no renderer detail cache.
- Requests capture a ticket **before** asynchronous health work. Publication
  rejects superseded tickets and requests that completed during a mutation.
  Mutations invalidate before and after — **including failed mutations** —
  across every registered scope.
- The renderer captures its local scope before requesting state and tracks a
  generation floor from invalidations. Old account scopes, old generations and
  explicitly stale server responses are discarded. A discard must not tear down
  the queued refresh loop.
- External `session_data.json` writes invalidate snapshots through the existing
  directory watcher. Revisions represent **published snapshots**, not
  transactional versions of every game packet; watcher delivery and poll
  freshness are not atomic filesystem guarantees.

### Why the shape matters

Measured on a 12,754,805-byte history fixture (83 sessions, representative
account 70 sessions / 1,147 games / 25,860 events), the live compact envelope
was **1,211,336 bytes against 12,300,971 full — a 90.15% reduction**. Full
per-game events alone had accounted for 8.123 MB. The paired production
experiment showed sender blocking down ~84%, retained renderer heap down ~76%,
and long renderer refresh tasks going from every refresh to none.

Calendar switching and main-process computation were **not** fixed by this
change and remain the known bottlenecks. Do not describe the compact contract
as solving them.

## Shipped projection optimization

One optimization was implemented from the broader benchmark campaign: reuse of
the second event normalization **within a single `compactGame` invocation**.

- Scope ends in `finally`; no cache survives the projection.
- No cache between games, between detail/calendar projections, or between
  history builds.
- Zero timestamps use the original uncached path.
- Both normalization stages, all attribution passes and callback ordering
  remain intact.

Measured history-build medians: 397.62 ms → 261.40 ms on Electron/Node 24
(34.3%), 474.50 ms → 345.02 ms on Node 22 (27.3%), paired against saved
pre-change source. `scripts/benchmarks/README.md` owns the harness; re-running
it regenerates results under the ignored `output/` directory.

Absolute times depend on V8, GC, system load and dataset. No overall
application speedup is claimed.
