These are unmodified Fury recordings from a local vanilla 1.8.9 server, generated
by `scripts/development/anticheat_lab/pilot_legit_ladder.js`. LabActor used ordinary
movement, sneak and empty-crosshair swing inputs; no cheat was enabled. Both
actors climbed real ladders and paused between climbs. LabObserver connected
through the production Fury proxy.

Source run: `output/anticheat-lab/runs/legit-ladder-pilot-1790413231763`.
Ground truth and raw observer packet recordings are retained there. The two
recordings preserve their original absolute timestamps and target-only labels.
The small packet JSON is the actual ladder multi-block update from that run.

The preexisting case has ladders in the initial chunk, before observer login.
The blockchange case receives a later `multi_block_change`. The baseline flagged
both as possible Stasis. Multi-block tracking supplies the latter's environment
guard. For pre-existing ladders, a conservative sneak-during-gap guard prevents
the false flag without inventing missing initial-chunk context. Movement Blink
while sneaking may also be missed; that tradeoff is explicit. Full initial-world
collision context is still absent from compact recordings.

`legit_defensive_blockhit_slowticks.jsonl` is an unmodified observer recording
from `output/anticheat-lab/runs/defensive-blockhit-pilot-v2`, originally
`2026-09-26_11-28-46_LabActor_legit_defensive_1_0_pilot.jsonl`.
SHA-256: `e41ede279c491e1d4d11745177f9d05fde5e6211d976c483ecbaf70a416dee2e`.
Ordinary sampled inputs held block for 250ms, released for 50ms, then attacked
and reblocked, with no cheat controller/buffer. The real server was configured
for minimum 90ms ticks plus seeded 10ms jitter; its actual tick log is retained.
The baseline emitted live Autoblock possible and confirmed false flags. The
observer's already-recorded world-age updates independently expose slow timing.
The regression checks the timing guard and live packet conversion without
giving client/server instrumentation to the detector.

`blockhit_lag_normal.jsonl` is the unmodified calibration recording
`blockhit-v1-worker0/fury-profile/recordings/2026-09-26_10-48-42_LabActor_blockhit_lag_c017.jsonl`.
SHA-256: `c1ef5dc0e597d941897591c4db0756b0905e28c4565f84f59a76397d5af4dcf7`.
It preserves a real positive Lag case under normal server timing. A separate
timing-removal ablation demonstrates that missing observer clock context does
not certify an Autoblock verdict; that transformed replay is not counted as an
additional gameplay trial.

`legit_defensive_blockhit_jitter.jsonl` is unmodified from
`defensive-blockhit-timing-probe/fury-profile/recordings/2026-09-26_11-40-32_LabActor_legit_defensive_2_0_pilot.jsonl`.
SHA-256: `2b28f57f8118162f7935678ea75ef54b578dd6506aa3bf6f2d3a64cd5ba6dc88`.
It used legal 250ms block/50ms release inputs with actor latency 35ms and jitter
30ms, observer latency 50ms and jitter 40ms, at normal server timing. Eight of
38 swings lacked a relayed release; a timing-only candidate emitted a possible
false flag. Actual callback instrumentation and continuous replay matched exactly.
The sustained-pattern requirement rejects this intermittent jitter case. This
calibration counterexample is retained rather than hidden by later successful runs.

`legit_jumpcombat_grounded.jsonl` is unmodified calibration trial
`legit_jumpcombat_c028`, from `blink-v1-worker2-of4`, original recording
`2026-09-26_11-53-07_LabActor_legit_jumpcombat_c028.jsonl`, SHA-256
`f442539998e5a73d0c3c1a8571112563e779ec07d01dacda0adde10ed5dce64b`.
No Blink queue was enabled. Ordinary jumps/attacks with actor 120ms/30ms jitter,
observer 30ms/10ms jitter and server minimum 55ms/10ms jitter generated a Stasis
false flag. Relative/teleport reconstruction left Y=63.90625 while the same
observer movement explicitly carried `onGround=true`. Positive grounded evidence
now vetoes that gap; unreliable `false` alone still does not prove airborne state.
Removing only grounded fields in a diagnostic replay reproduces the false flag.
Unknown ground state remains unknown rather than defaulting to grounded.

`blink_movement_positive.jsonl` preserves calibration positive
`blink_movement_outgoing_manual_c003`, `blink-v1-worker0`, original recording
`2026-09-26_11-25-14_LabActor_blink_movement_outgoing_manual_c003.jsonl`, SHA-256
`4ffaffd151d87aed0cb6624be868fd135161a35bb8d544016db1abffb7be1b55`.
It remains possible Stasis after the positive-grounded guard. These source IDs
were selected from calibration only; no held-out verdict informed this change.
