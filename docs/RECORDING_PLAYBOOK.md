# Cheat Recording Playbook

How to collect labeled packet recordings using `/recordcheat` (`/rc`), the
rolling buffer, and Hypixel replays. This guide originated with anti-cheat
calibration; the anti-cheat detectors have been removed. The recorder and
existing local recordings remain available.

Recordings land in `recordings/` as JSONL (gitignored). Every file has a
header (player, label, source, account, game mode), the full scene while
active, and a footer. Inspect any file with:

```
node scripts/development/compare_recordings.js inspect recordings/<file>.jsonl
```

## Session setup (once, at proxy start)

```
/rc buffer on 90
```

Keeps the last 90 seconds of packets in memory (no disk writes, no lag).
This is what makes reactive clipping possible - you notice cheating
*after* it happens.

## Method A - Clip (live, reactive) - your default

Someone suddenly snaps between three players / bridges impossibly fast:

```
/rc clip <player> <cheat>
```

- The file starts with the buffered ~90s that ALREADY happened
  (a `clipstart` line marks where history ends), then keeps recording live.
- If they do it again while recording: `/rc mark did it again`
- Stop when they calm down or the game ends: `/rc stop <player>`
  (disconnect auto-stops everything safely).

## Method B - Full recording (live, proactive)

Use when you suspect someone from the game start, or for legit samples:

```
/rc <player> <cheat>
/rc status            (check event counts are climbing)
/rc mark <note>       (timestamp each cheating moment you see)
/rc stop <player>
```

## Method C - Replay recording (retroactive, most precise labels)

Validated: swings (after dedup), blocking toggles, equipment, and block
changes replicate EXACTLY in replays. Best label quality because you can
rewatch and be sure.

Say the cheating is at replay time 0:20-0:31:

1. Open the replay, set **1x speed**, camera near the cheater.
2. Start ~10s early (at ~0:10): `/rc <player> <cheat> replay`
3. Keep the camera on them through the window, stop a few seconds after:
   `/rc stop <player>`
4. **One clean pass per recording** - never pause/rewind/speed-change while
   recording (rewinds re-spawn entities and duplicate events). Missed it?
   Stop, rewind, record a fresh pass. Retries are free.

Replay facts baked into the tooling:
- Replay actors are unnamed NPCs; a named placeholder idles in the sky.
  Analysis identifies your target as the entity with the smallest
  **cam dist** in `inspect` (you were following them).
- The "Playing mm:ss" action bar is recorded in chat lines, so every file
  knows exactly where the replay clock was - no manual timestamps needed.
- Swings arrive duplicated (2x) in replays; tools dedup at <25ms.

## Which source for which cheat

| Cheat            | Live | Replay | Notes |
|------------------|------|--------|-------|
| Autoblock        | yes  | yes    | blocking-flag toggles replicate exactly |
| Autoclicker/CPS  | yes  | yes    | use deduped swings in replays |
| Scaffold         | yes  | yes    | block changes replicate exactly |
| Aim-assist/switch| yes  | yes    | event-level; fine in replays |
| Bed nuker        | yes  | yes    | block ledger + chat attribution replicate |
| Blink/lag-range  | yes  | **NO** | replays re-pace movement packets - live only |

## Labeling rules

- Label the SPECIFIC cheat: `scaffold`, `autoblock`, `aimassist`, `nuker`,
  `blink`, `autoclicker`. Never just `cheater`.
- Unsure? Label what you see: `fastbridge_sus`. Promote to `scaffold` after
  a Watchdog ban / Urchin tag confirms - re-record from the replay if it
  still exists, or just rename the file.
- Add `replay` as the 4th arg for replay sources (`/rc X scaffold replay`) -
  it tags the header and filename.

## Legit samples matter just as much

The false-positive side of calibration needs data too:

- Record skilled LEGIT players: `/rc <player> legit_godbridge`,
  `legit_butterfly` (16-20 CPS clickers), `legit_blockhit`,
  `legit_highping`.
- NEVER use the quiet parts of a cheater's game as legit data - they may be
  closet-cheating quietly. Legit labels only for players you're confident
  about.
- Volume goal: many more legit player-sessions than cheater clips. Legit
  data is cheap - record every game's sweats.

## After recording - analyze every clip

```
node scripts/development/analyze_recording.js recordings/<file>.jsonl
```

Resolves the target automatically (name for live files; camera-proximity
actor for replays) and prints the per-cheat detection features:

- AUTOBLOCK: swings-while-blocking, toggle counts, block period durations
  (legit blockhit: ~100ms periods, near-zero swings during block)
- AUTOCLICKER: max 1s CPS, sustained 5s CPS, gap regularity (CV)
- SCAFFOLD: attributed placements, best 2s burst rate, movement speed
  during burst, sneak toggle rhythm
- AIM: yaw step distribution, snap counts
- MOVEMENT GAPS: freeze/teleport stats (live sources only)

Nothing is learned automatically - these numbers ARE the corpus. Keep the
files; the thresholds for the future live detectors come from comparing
these features between your legit recordings and your cheat recordings.
If the expected signal is missing (scaffold clip with no placements), the
camera was too far or the window was wrong - re-record.

For fidelity checks or manual entity identification there is also:

```
node scripts/development/compare_recordings.js inspect recordings/<file>.jsonl
node scripts/development/analyze_recording.js recordings/<file>.jsonl --id <entityId>
```

## The corpus view - calibration report

```
node scripts/development/calibration_report.js
```

Extracts features from EVERY recording and tabulates them by label, with
per-label min..max ranges. A live detector threshold must sit ABOVE the
max of every legit_* label (with margin) and BELOW the min of the cheat
label it targets. Overlapping ranges mean: collect more samples -
especially maximum-effort legit play, which is what defines the boundary.

## Command reference

| Command | Effect |
|---|---|
| `/rc buffer on [sec]` | rolling pre-capture buffer (default 60s, max 300) |
| `/rc buffer off` | disable + clear buffer |
| `/rc <player> <cheat> [replay]` | start full recording |
| `/rc clip <player> <cheat>` | dump buffer + keep recording |
| `/rc mark [note]` | timestamp a moment in all active recordings |
| `/rc status` | active recordings + buffer state |
| `/rc stop [player]` | stop one / all |
| `node scripts/development/compare_recordings.js inspect <file>` | per-entity activity + cam dist |
| `node scripts/development/compare_recordings.js <live> <replay> <player>` | fidelity diff |
