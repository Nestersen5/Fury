# Fury local anticheat lab: completed campaign

The lab performed **3,500 validated real-gameplay trials across 35 supported
scenarios**, 100 per scenario: 50 calibration and 50 held out. The frozen candidate
reduced held-out false flags from **76/550 legitimate trials (13.82%) to 0/550**.
It also reduced detection from **59/999 effect-expected trials (5.91%) to 29/999
(2.90%)**. This is a false-positive reduction with a substantial sensitivity cost,
not broad detection coverage or proof of a zero real-world false-positive rate.

Telly remains unsupported, Auto Tool is audited but not implemented, and exact
equivalence to the original client is unverified. No original Vape code, binary,
build script, bootstrap, authentication, updater or injection component was run.
The source identity called “Stasis” was not found; Blink is the explicitly
identified candidate mechanism used in this lab.

## Evidence and experimental method

The authoritative results are in
[`output/anticheat-lab/final-analysis-v2/`](../../output/anticheat-lab/final-analysis-v2/).
Earlier exploratory scores, excluded runs and failed pilots remain intact.

- [Summary and per-trial scoring references](../../output/anticheat-lab/final-analysis-v2/summary.json).
- [Frozen detector manifest](../../output/anticheat-lab/final-analysis-v2/candidate/manifest.json).
- [All 35 scenario results](SCENARIO_RESULTS.md).
- [Detailed static source audit](SOURCE_AUDIT.md) and [setup/run commands](README.md).
- [Independent client and lab tooling](../../scripts/development/anticheat_lab/).
- [Raw recordings, ground truth, server logs and run snapshots](../../output/anticheat-lab/runs/).

Each of the nine `*-v1-evidence.json` files verifies the frozen specification,
unique trial IDs, raw observer capture hash, Fury recording hash, ground-truth
hash, successful gameplay validity checks, actual server tick measurements, and
realized actor/observer transport measurements. All nine are complete with no
validation errors. These are 100 varied trials per scenario, **not** 100 for every
parameter combination.

The actor and opponent joined a hash-verified official vanilla 1.8.9 server on
localhost. A separate observer connected through the real Fury proxy and used
its normal recorder. An ordinary sidebar activated Fury's existing Bed Wars
game gate; it did not emulate Hypixel's server mechanics. Real accepted movement,
placements, swings, damage and projectile effects were checked as appropriate.
Only observer packets entered detectors. Actor queues/input decisions and server
tick instrumentation supplied labels and validity evidence, never detector input.

The campaigns contain **674,734 selected raw observer packets and 691,224 Fury
records**, covering 26,772 seconds (7.44 hours) of aggregate active gameplay across
concurrent workers. Measured trial-median server intervals ranged from 46.87 to
110.46ms; actor upstream delay medians ranged from 0 to 203ms and observer downstream
delay medians from 0 to 131ms. Full requested/actual delay, jitter, stall and tick
distributions are retained. These are measured conditions, not nominal TPS claims.
See [environment summary](../../output/anticheat-lab/final-analysis-v2/environment-summary.json).

Plans separated calibration/evaluation seeds and network/tick combinations before
scoring. The final candidate was frozen only after calibration review; held-out
verdicts were then evaluated twice for determinism. No detector changes followed
held-out evaluation. The held-out mix intentionally stresses latency and tick
variation; its distribution differs from calibration and is not a player census.

## Before and after

| Population | Calibration baseline → candidate | Held out baseline → candidate |
|---|---:|---:|
| Legitimate: any false flag | 78/550 → 0/550 | 76/550 → 0/550 |
| Effect-expected enabled behavior: any detection | 62/999 → 35/999 | 59/999 → 29/999 |
| Enabled no-effect boundaries: any flag | 0/201 → 0/201 | 0/201 → 0/201 |

“Effect expected” identifies an enabled, applicable behavior; it does not assert
that the observer can distinguish it from legitimate play. No-op settings are
separate from positive detection denominators. False negatives remain extensive:
**970/999 held-out effect-expected cases were unflagged** by the candidate.

| Module / mode | Supported gameplay trials, both splits | Held-out detection before → after, effect-expected cases |
|---|---:|---:|
| Scaffold Legit | 100 | 0/50 → 0/50 |
| Scaffold GodBridge cardinal | 100 | 0/50 → 0/50 |
| Scaffold GodBridge turns | 100 | 0/50 → 0/50 |
| BlockHit Manual | 100 | 0/36 → 0/36 |
| BlockHit Predict | 100 | 0/45 → 0/45 |
| BlockHit Auto alone | 100 | No applicable effect; 50/50 held-out no-op cases unflagged |
| BlockHit Auto + independently implemented Normal clicker | 100 | 0/45 → 0/45 |
| BlockHit Lag | 100 | 31/40 → 8/40 |
| Timer | 100 | 0/45 → 0/45 |
| Auto Clicker Normal / Extra / Extra+ | 100 each | 0/50 → 0/50 each |
| Fast Place All | 100 | 0/39 → 0/39 |
| Fast Place Blocks | 100 | 0/20 → 0/20 |
| Fast Place Projectiles | 100 | 0/19 → 0/19 |
| Blink: eight type/direction/send combinations | 100 each | 21/360 → 21/360 combined |
| Blink movement while sneaking | 100 | 7/50 → 0/50 |

The other 1,100 trials are legitimate controls: movement/potions, clicking,
ordinary blockhitting, long defensive blocking, held/manual placement,
sneak bridging, jump/combat with and without sneak, and preexisting/later-update
ladders. In held-out evaluation the baseline false flags were 29/50 preexisting
ladder cases, 33/50 later-update ladder cases, 13/50 defensive blockhit cases and
1/50 ordinary jump/combat case. All other legitimate groups were already unflagged.
The candidate flags none of these 550 held-out controls.

The eight Blink combinations are Movement/All packets × Outgoing/Both directions
× Manual/Automatic send. Held-out detections are 6/50 movement-outgoing-manual,
4/40 movement-outgoing-auto, 6/50 movement-both-manual, 4/40 movement-both-auto,
1/50 all-both-manual, and zero in the other three. All are **possible Stasis**,
never confirmed. All-packet buffering can resemble transport stalls; this result
does not establish that its single positive is a unique cheat signature.

BlockHit Lag's confirmed held-out detections decrease from 27/40 to 8/40.
Conditional median first-flag time changes from **2,491ms to 6,294ms**. Across all
detected effect-expected cases, conditional median first-flag time changes from
4,285ms to 6,294ms. These compare different detected subsets; they are not a paired
latency estimate for every cheat. Unflagged cases have no finite time to flag.
Trial timing summaries use the upper middle sample when the detected count is even.

Recorded-clip evaluations cold-start detector state from the context in each
recording. An ongoing live session may already have timing/context history.
Actual callback probes separately validate the live path:

- Final defensive-blockhit pattern probe: six ordinary cases unflagged; normal
  Lag confirmed at 5,498ms. 3,090 combat inputs and two resets reproduce the actual
  callbacks exactly. Its detector logic matches the final Autoblock logic; the
  snapshot differs in explanatory comments and predates the later Stasis guard.
- Final ladder probe: both legitimate cases unflagged; 506 inputs and two resets
  match continuous replay from that process's source snapshot.
- [Final grounded/Blink probe](../../output/anticheat-lab/final-analysis-v2/grounded-blink-live-verification.json):
  two legitimate cases unflagged; airborne movement Blink possible at 6,253ms.
  All 928 inputs and two resets match continuous replay of the final source.

## Production changes and their cost in sensitivity

Changes are confined to `src/detect/detectorShared.js`, `stasisDetector.js` and
`autoblockDetector.js`. Scaffold detector bytes match the original dirty-tree
baseline. Proxy, recorder and recording-analysis bytes also match their initial
snapshot. No launcher, production authentication, account handling, application
dependency or packaging changes were made by this lab work. Preexisting unrelated
working-tree changes were preserved; no release was built or published.

**Stasis:** shared conversion forwards already-supported time and multi-block
record shapes. A bounded, deduplicated 512-entry climbable cache now consumes
multi-block context and removes replaced blocks. Bulk updates are not counted as
multiple player actions. Sneaking during a gap vetoes the ambiguous ladder case,
including when release metadata arrives before movement. Explicit grounded state
also vetoes a gap: calibration found ordinary jumps with reconstructed Y=63.90625
despite `onGround=true`. Unknown ground state remains unknown. An unreliable false
ground flag alone still does not prove airborne state.

These guards deliberately miss sneaking Blink and some grounded/ambiguous queue
boundaries. Calibration primary-Blink detections decrease from 23/360 to 18/360;
held-out primary-Blink detections stay 21/360. Sneaking Blink decreases from 7/50
to 0/50 in each split. The detector remains possible-only. Missing initial-world
collision context and server-specific ground semantics remain limitations.

**Autoblock:** swings require two fresh world-age intervals of 40..60ms/tick.
Unknown, slow, stale or bursty timing clears candidate evidence. A verdict waits
for the next clock update to validate the interval containing the actions. At
least 80% of sampled sword swings must show sustained blocking without a relayed
release, in addition to the existing sample/span and heuristic tier thresholds.
The score is not presented as a validated probability of innocence.

The timing and sustained-pattern requirements remove legal release/re-block
aliasing under slow ticks and jitter, while sacrificing Lag detection under those
same conditions. No generic detector was added for ordinary-looking Manual,
Predict, Auto, click cadence, Timer, Fast Place or supported Scaffold behavior:
this dataset did not establish a reliable unique observer signature. Zero
detections are reported as misses, not proof that such behavior is undetectable.

## Source fidelity, supported cases and exclusions

The [audit](SOURCE_AUDIT.md) traces recovered module identities, settings/defaults,
hooks, event ordering, helper dependencies, calculations, randomization, state and
packet effects with source line references. The supplied extracted project lacked
the needed Java source tree; the nearby source archive was read as inert text.
Its SHA-256 is
`1a61abd0af77f9c82851cfdcc000c9db04db6a525d59f5619612dec52c4b171e`.
Only 2,913 Java source files were extracted to `.java.txt`; no archive binaries or
tools were executed. Trusted vanilla reference source was also read as text.

The independent headless client uses pinned development-only Mineflayer tooling,
an independently implemented game/input clock, source-derived behavior adapters,
and seeded Java-compatible random streams. A trusted-JDK standard-library
reference checked 3,600 RNG results across six seeds. The JDK also builds the lab's
own server tick agent, which instruments only the hash-pinned official server.

Scaffold covers stone-only Legit edge delay and GodBridge cardinal/turn variants,
activation counts, sensitivity/render cadence, inventory counts and pitch/sneak
gates. All 100 cardinal trials accepted 14..25 automatic placements and stayed
above the platform threshold. All 100 turn trials accepted 5..25; two fell below
the starting platform. There were 41 caught source-listener exceptions, retained
as ground truth, following the audited nullable recovery anchor/event catch.
Successful placements and exercised turns do not imply original-client fidelity.

Telly has a separate source-derived implementation and retained real gameplay
pilots, but corrected movement/sprint/event-order experiments were not reliably
stable. One later eight-case pilot bridged successfully; seven fell or produced
insufficient effects. It is **not admitted to the 100-trial supported campaign**.
Unrecovered native patches, exact float/collision behavior and render scheduling
prevent an equivalence claim. No original binary was run to resolve that gap.

Other explicit exclusions/limits:

- Non-stone Scaffold whitelist/blacklist shapes, slabs and complex blocks;
  GUI/mining clicker paths; flight, mounts, death/respawn and unrelated modules.
- Predict's unverified native tracker enable path; the visible initialization
  is used and documented. Auto alone has no independent use generator; its
  paired-clicker scenario is labeled as that dependency, not a separate hidden input.
- Original entropy, OS input timing, native dispatch/injection, authentication,
  updater and original-client runtime equivalence.
- Auto Tool is optional and only statically audited. No coverage is claimed.
- Forty early Clicker-worker jitter trials used incorrect floating-point
  rounding; all forty were explicitly excluded and rerun with the same frozen
  IDs/settings. Original artifacts and hashed exclusion selection remain.
- Two GodBridge workers terminated on an omitted source exception boundary.
  Their 78 completed valid outcomes remain; two interrupted partial trials do
  not count and were rerun after the audited catch behavior was implemented.
  Diagnosed interruption manifests retain the partial artifacts.
- Setup failures, Telly pilots and verification probes are preserved separately
  and never inflate the 3,500-trial count. Earlier workers lack a production-startup
  snapshot; final baseline/candidate paired replay is the authoritative comparison.
  Later live probes include their exact startup source snapshots.

## Historical recordings and verification

All 27 available historical files were replayed with the appropriate live/replay
gates: 585,012 records, two unresolved targets excluded from rates, unknown labels
excluded. Both versions flag **0/12 resolved legitimate recordings** and detect
**4/9 labeled Scaffold recordings**. These files were already used by the existing
detectors, may share sessions/players, and are not a fresh held-out population.

The independent behavior, environment and Scaffold checks, real observer regression
checks, existing combat/Scaffold tests and RNG reference check passed. After the
last grounded-state change, observer/combat/Scaffold tests were rerun successfully.
Logs are under `output/anticheat-lab/final-checks/` and `final-checks-v2/`.
Permanent [real-recording fixtures](../../tests/features/fixtures/anticheat_lab/README.md)
include ladder, slow-tick/jitter blockhitting, grounded jump/combat, Lag and airborne
Blink cases, with diagnostic ablations that are not counted as extra gameplay.

## Measured processing cost

All owned live labs were stopped before measurement. Both snapshots processed
identical immutable data with three warm-ups and nine alternating-order passes;
explicit GC and parsing occur outside timing. Host/user processes were preserved.

| Measured path | Input count | Baseline median wall | Candidate median wall | Change |
|---|---:|---:|---:|---:|
| All three detectors, compact records; 3,500 trials + 27 historical files | 1,276,236 | 781.10ms | 786.07ms | +0.64% |
| Shared conversion + both combat detectors, raw selected trial packets | 674,734 | 105.88ms | 109.44ms | +3.36% |

Median process CPU was 1,000ms → 1,046ms for compact replay and 187ms → 187ms
for raw-combat processing. Wall p95 was 1,173.16ms → 949.54ms and 125.41ms →
126.64ms respectively; host/GC variation makes these tail differences unsuitable
as an improvement claim. [Record benchmark](../../output/anticheat-lab/final-analysis-v2/performance-records.json)
and [raw-combat benchmark](../../output/anticheat-lab/final-analysis-v2/performance-raw-combat.json)
retain every sample and source hash.

These measure detector work, not end-to-end proxy latency, parsing, network,
renderer or IPC responsiveness. Raw-combat mode excludes Scaffold and uncaptured
packet types. Heap deltas include allocation/GC noise and are not peak memory.
No speculative performance refactoring was added.

The deliverable is the reproducible local lab, actual labeled evidence, narrow
false-positive fixes and explicit remaining misses. Human-population accuracy,
Hypixel-specific behavior, complete Telly fidelity and detection of every module
remain unestablished. All cheating tests stayed on the local server.
