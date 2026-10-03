# Static source audit: independent Fury test client

Status: static audit recorded for the implemented subsets and unsupported paths
below; no original client has been built, loaded, or run. Missing native behavior
and the unresolved Telly fidelity boundary prevent an exact-equivalence claim.
The audited archive is `C:/Users/Admin/Desktop/vape/VapeV4.21-main source code.zip`,
SHA-256 `1a61abd0af77f9c82851cfdcc000c9db04db6a525d59f5619612dec52c4b171e`.
The lab reader copied 2,913 files under `src/main/java/` (10,888,444 bytes)
to inert `.java.txt` files under `output/anticheat-lab/source-text/`.
Other Java files, binaries, native code, resources and build scripts were not extracted.
The manifest records original entry names, byte hashes, and line counts.

All source references below are relative to `src/main/java/gg/vape/` in that archive.
They describe this recovered source, not an authenticated upstream Vape release.
The source contains both readable recovered names and unresolved/obfuscated wrapper
names. Runtime equivalence to an original client is **unverified**. Source names
and comments are hypotheses until their implementations and callees agree.

## Important identity corrections

| Requested behavior | Actual owning classes | Finding |
|---|---|---|
| Scaffold | `module/blatant/Scaffold.java`, `module/blatant/scaffold/*` | Registered modes are Legit (default), GodBridge, TellyBridge. `BlatantScaffoldMode` is registered as GodBridge. |
| BlockHit / Autoblock | `module/render/Animations.java`, `module/render/animations/*` | Despite directory/class names, this is the registered BlockHit module: Manual, Predict, Auto, Lag. |
| Stasis | No class/module with that name found | `module/blatant/Blink.java` has movement-only packet buffering that may produce Fury's Stasis signature. This is an explicit approximation of the requested name. |
| Timer | `module/blatant/Timer.java` | Changes the client game timer, not just movement speed. |
| Auto Clicker | `module/combat/LeftClicker.java`, `ClickerMod.java`, `click/ClickEngine.java`, `AutoClickerTimingState.java` | `AutoClickerInputModule` is registered as InventoryFill; it is not the combat clicker. |
| Fast Place | `module/world/FastPlace.java` | Reduces the right-click delay counter subject to held-item filtering. |
| Auto Tool | `module/utility/AutoTool.java` | Optional; swaps hotbar slots according to tool/weapon scores. |

`module/combat/BlockHit.java` is registered as **NoItemRelease**, cancelling release-use
packets. It must not silently stand in for the requested BlockHit modes.

`wrapper/impl/RayTraceResult.java:31-38` resolves `Z()` to the hit-face index.
Recovered local variables named `placementAttempts`/`enoughAttempts` in the Scaffold
classes therefore concern block faces, not click counts. On 1.8.9 face 0 is down,
1 is up, and values above 1 are horizontal sides.

## Shared Scaffold behavior

Source: `module/blatant/Scaffold.java:49-536`.

- Default mode Legit. Pitch check defaults off; threshold range 0..90 degrees,
  default 45. Block counter display defaults off and has no packet effect.
- Blacklist defaults on; includes interactable, partial, hazardous and special
  blocks (e.g. chests, TNT, panes, ice, ladders, carpet, snow). Whitelist defaults
  off with a blocks entry. Exact item filters remain part of implementation work.
- Valid material must be an ItemBlock, pass blacklist, and pass whitelist.
  Automatic modes find the first eligible hotbar slot. They try to preserve the
  original block item type when swapping after depletion. Telly additionally
  requires at least five usable hotbar blocks.
- Placement height is `floor(playerY)` when its fractional component is exactly
  0.5; otherwise `floor(playerY - 1)`. Test slabs and half-block transitions.
- Cardinal direction codes: 6 = +X, 8 = -X, 7 = +Z, 5 = -Z. Diagonals 1..4
  correspond to (+X,+Z), (-X,+Z), (-X,-Z), (+X,-Z).
- Cardinal selection uses `(normalizedYaw + 180) % 360` and 45/135/225/315 degree
  boundaries. Side changes use the cycle `[5,4,6,1,7,2,8,3]`.
- Fixed rotations use a 2..12 speed clamp, linear acceleration, remaining-angle
  clamping, and persistent controller ownership. Main helper tolerance is 0.5;
  GodBridge's local helper uses tolerance 0 and proportional axis scaling.
- Point rotations update pitch, but update yaw only when the intended face test
  passes; see `ScaffoldPointRotationController.java:31-49`. Controller interpolation,
  mouse sensitivity quantization, and movement-task lifecycle need separate fidelity
  checks before declaring GodBridge or TellyBridge fully implemented.
- GUI, physical input, shared rotation/movement/use claims and changes of material
  can interrupt operation. This lab runs one requested module at a time; it must
  model activation/release, without importing the original control infrastructure.

### Legit

Source: `module/blatant/scaffold/LegitScaffoldMode.java:25-158`,
`value/RandomValue.java` factory signatures and `getRandomValue()`.

Sneak delay is uniform in the selected interval: default 100..200 ms, allowed
0..500 ms, step 1. Require sneak defaults false. `RandomValue` arguments are
allowed minimum, default minimum, default maximum, allowed maximum: they must
not be mistaken for four settings or the effective sampling interval.

On enable, sample a delay. Before the local player's entity update, on the
client thread, reject GUI, disallowed activation state, the relevant player
movement-state guard, and a failed optional pitch check. Capture physical sneak.
Use backward/neutral input (`forward <= 0`) and grounded state. Contract the
player box by 0.2 on X/Z; offset it by current motion X/Z and -1 on Y; no world
collisions means edge sneak. Continue sneaking until the sampled delay expires
after leaving that edge, but only if delay >30 ms. Resample when beginning a
new sneak episode. Keep separate edge and stand timers. With Require sneak,
temporarily release the held sneak key while moving backward within 1,000 ms of
the last sneak; otherwise release only if physical sneak was not held. Post-tick
restores physical sneak.

This mode does **not** place blocks itself. A test must supply ordinary use-item
input separately, so it must not turn Legit into a generic automatic placer.
Observer signals are movement/rotation, sneak metadata and server-accepted block
changes, not the local key transitions themselves.

Verified obfuscated guards: `EntityLivingBase.S$src$Z$151gttj()` maps through
MEntityLivingBase.O -> S -> mapping field `a` to `isOnLadder`
(`MEntityLivingBase.java:206-207,1111-1113`). `Entity.P()` maps through
MEntity.R -> O -> `jf` to `isSneaking` (`MEntity.java:254-255,2046-2048`).
The independent Legit adapter uses actual collision shapes for the contracted
box. Its trusted physics dependency has documented differences in edge clamping
and negligible-velocity cutoffs from vanilla; no byte-identical movement claim.

### GodBridge

Source: `module/blatant/scaffold/BlatantScaffoldMode.java:38-803`.

Activation blocks range 1..4, default 2. Until activation, delegate edge safety
to `ScaffoldEdgeSneakHelper`: similar 100..200 ms sneak release, additionally
acquiring the Scaffold rotation claim at an edge and releasing it after 500 ms
clear or forward input. Automatic placement begins only after tracking actual
world block changes for the required manual placements. Reset placement tracking
on direction/material changes or geometry drift. An existing next block resets
the manual sequence rather than counting as an automatically placed block.

After activation, record material, choose the closer orientation, align to a
sub-block target using a movement task with a 40-tick limit, and lock shared
movement/use control. Keep backward input; cardinal routes also strafe depending
on the orientation. Stop movement at an edge until support is available.
Diagonal edge checks contract the collision box by 0.16, project current motion
and test at -1 Y. Cardinal checks sample at a directional -0.15 offset.

Each pre-tick requests one use-key tick only when the ray trace hits a valid
placement face. Normally require a side face (>1); while vertical motion is
outside [-0.1,0.1] or switching direction, accept any face except down. This is
not an unconditional packet spammer and does not suppress swing packets.

Cardinal rotation uses diagonal yaw bases with a 20x correction from lateral
offset; pitch is 78, then 80 after 300 ms of edge waiting. Diagonal route pitch
is 81, then 83 after 500 ms. After 800 ms stuck, select a new anchor and realign.
Movement target fractions differ by direction and reversed orientation: diagonal
routes use 0.35/0.65 pairs; cardinal routes use 0.2/0.8 pairs.

Left/right transitions change direction by one step in the eight-direction
cycle, with press and release transitions interpreted differently. Switch only
when geometry permits; temporarily reposition to within 0.15 of the new anchor,
realign yaw within 4 degrees, then resume. Stopping backward input waits for a
safe stopping position unless flying. Manual mouse displacement accumulated by
the shared recent-input helper can cancel automatic control at a sum of 10.

`computeSideOfPath` adds usable hotbar block count to Euclidean distance, truncates
the sum, and extends the path by that many blocks before taking the lateral cross
product. `RotationUtil.y:923-927` resolves the distance helper; it is not an angle.
The resulting correction therefore changes with inventory count. Preserve this
unusual dependency and exercise it explicitly.

### TellyBridge

Source: `module/blatant/scaffold/TellyBridgeScaffoldMode.java:35-553`.

Resolved shared dependencies (independent implementation in `scaffold_core.js`,
`scaffold_rotation.js`, `scaffold_godbridge.js`, `scaffold_tellybridge.js`):

- `EventBus.post:103-137` iterates `EventPriority.values()` in declaration order:
  LOWEREST, LOWEST, LOW, NORMAL, HIGH, HIGHEST. Thus RotationManager's LOWEST
  pre-tick work runs **before** the NORMAL module/task callbacks. The names do not
  imply reverse ordering. `Vape.registerListeners:584-599` registers the movement
  task manager before the module manager. Native reordering is unverified.
- `RotationManager:240-253,764-840` accumulates elapsed milliseconds, rounds to
  controller update counts, and tops up each pre-tick to `round(50*timeScale)`.
  Default sensitivity gives approximately 1,000 controller steps/second. Scale is
  the reference mouse scale divided by current sensitivity's cubic scale.
- `FixedRotationController` predicts pending integer mouse motion, wraps errors,
  adds speed/4 plus absolute-error*0.05, optionally scales axes proportionally,
  clamps to remaining mouse counts, and preserves fractional pending counts.
  The independent model explicitly rounds Java float operations. Headless render
  timing remains an equivalence limit; it uses an 8ms nominal frame callback.
- Point aim uses interpolated last-tick positions plus eye height for 1.8.9:
  `ForgeVersion.MC_1_7_10.Y()` means **greater than** 1.7.10, not equality.
  `RotationVectorMath.H:25-37` assigns literal 90 to a radians variable when
  normalized yaw error exceeds 90 degrees, then converts it to degrees. Preserve
  this recovered quirk. `RotationUtil.p:683-702` gates yaw using the floored
  previous-motion position and the relevant side of the placement block.
- GodBridge lateral correction uses `prevPosX/Z`, resolved through
  `Entity.f/R -> MEntity.E/u -> fields f/E`, registered at `MEntity:1434-1446`.
- `KeyBinding.onTick(int)` writes `pressTime` directly (`MKeyBinding:191-193`).
  Automatic placement sets one pending press; it does not increment without bound.
- `ScaffoldEdgeSneakHelper` acquires the shared rotation claim only on a grounded
  unsupported edge, and releases after 500ms supported or forward input. It saves
  the game key's prior sneak state, unlike Legit mode's physical-input restoration.
- On-foot vanilla sprint state is separate from the sprint key. The Scaffold
  adapter models forward/food/item-use/blindness/collision gates, double-tap and
  600-tick expiration from the inert trusted EntityPlayerSP reference. Earlier
  development pilots that treated the sprint key as actual sprinting are excluded.
  Pinned collision integration still differs from the original vanilla engine.

These source resolutions do not establish end-to-end equivalence. Real pilot
failures, falls, stalls and setup errors are retained and reported separately;
passing numerical tests alone never establish supported gameplay coverage.

Activation blocks range 1..4, default 2. Require right click defaults true.
Y increase range 0..3, default 1. Starts with manual placement tracking and
edge-sneak safety. After activation, move to the anchor, wait for the movement
task to finish, then enable the automatic jump/placement path.

Maintain a path, grounded/airborne history, bridge level, consecutive height
increases, and an optional transition target. On landing choose level 0 or 1
from activation, axis motion (0.1 threshold), and path-edge geometry. Rebuild
path lengths to 1, 4 or 5 according to the transition. Level 0 resets height
increase count, sets initial rotation and targets three/four blocks ahead;
level 1 targets two blocks ahead and increments height count.

The height-increase threshold is sampled when checked: for configured N>0,
15% gives N+1, 10% gives N-1, 75% gives N; N=0 always gives 0. A level transition
may request an elevated aim target and a task configured to wait for ground. The
visible `PlayerMovementTask.updateCompletion:34-54` nevertheless completes
immediately when within tolerance, even while airborne; the later ground guard
does not prevent that early return. Preserve the literal behavior. Axis
speed 0.6 is a separate transition guard; it is not the 0.1 activity threshold.

Maintain sprint. Jump at the path edge when grounded and the source's level/
sprinting condition permits: coordinate reaches 0.8 offset within 0.05. Initial
yaw bases are 230/50/320/140 for directions 6/8/7/5, with a random signed 0..4
degree offset; pitch is 85..90. A point controller aims during airborne travel.
Side aim uses lateral 0.3 and vertical 0.2 offsets; elevated aim uses 0.2 lateral
and a random 0.45..0.65 horizontal offset.

Use-key ticks require matching ray-hit block coordinates and the correct face:
up (1) only for level!=0 at path length 4, otherwise a side (>1). Paths advance
up at that special step, otherwise along the cardinal direction. Existing block
observations extend the path; missing trailing blocks prune it. Releasing the
activation keys defers reset until a safe stopping position. Exhaustion, lost
rotation claim, or manual input also resets. Task target fractions are
(0.3,0.6), (0.7,0.4), (0.4,0.3), (0.6,0.7) respectively.

## BlockHit: Manual, Predict, Auto, Lag

Source: `module/render/Animations.java:34-117` and `module/render/animations/`.
Default Manual; require mouse down true; ignore manual block true; angle 0..360,
default 90; distance 0..6, default 5. Angle/distance apply to Lag; default-target
helper for other modes uses 90 degrees and distance 5. Sword and no-GUI gates apply.

- **Manual** (`AnimationsBlockingState.java:19-102`): chance samples uniformly
  70..90% by default (allowed 0..100) and compares against another uniform 0..100
  roll per decision. A physical attack press initiates use only if not already
  blocking/using; release deadline is now+50 ms. Pre-tick releases on deadline
  or the hurt-time guard. If AutoClicker/SilentAura is enabled, this independent
  mouse/tick path is skipped; the clicker owns the paired use-key press/release.
- **Predict** (`DamageResponsiveAnimationsMode.java:23-148`): combines crosshair
  target, own/target hurt times and `AttackPacketTimingTracker`. Let E be expected
  hurt ticks = floor(mean observed attack-response delay/50). Crosshair-triggered
  use requires target hurtTime<=E+1 and lasts 50*(E+2) ms. The own-damage branch
  computes target hurtTime<=E+4, but that check is redundant in the source's
  compound Boolean expression: an already-pressed use key prevents this branch
  regardless of target hurt time. With no key pressed it checks own hurtTime
  in (0,E+3], then schedules 50*(E+2) ms; the earlier release guard further
  constrains reachable own hurt times to <=E+1.
  Tick release occurs on target loss, own hurtTime>E+1 or deadline. Living-update
  callbacks also schedule a local reset; event ordering is a fidelity prerequisite.
- **Auto** (`SwordUseMouseGuardAnimationsMode.java:18-88`): stateful predicate
  starts target streak at 1, returns true only at streak 1 while targeting an
  entity, cycles after streak 3, and resets to 1 when not targeting. Predicate
  calls have side effects; reproducing it once per arbitrary timer is incorrect.
  Integration with clicker/use hooks still needs tracing.
- **Lag** (`LegacyBlockingPacketBufferedAnimationsMode.java:31-235`): delay
  uniform 50..100 ms by default, allowed 0..500. Alternate block/release cycle
  using a target, sword, mouse and hurt-time guards. Starting a release-use
  packet claims primary action, queues the release and begins buffering.
  Subsequent eligible outgoing packets queue until a send event after the delay
  or target loss flushes them in order. The current triggering packet then
  proceeds normally. KeepAlive (`MappedClasses.VP`) bypasses this queue; cancelled,
  modified, guarded dispatches and non-owner-thread sends also bypass it. Pre-tick
  can reblock at delay-50. Flush must not be replaced with a naked timer or a
  permanently withheld release packet.

`combat/AttackPacketTimingTracker.java` maintains up to 19 recorded sub-500 ms
hit-response delays (it removes one upon reaching 20), initially uninitialized.
Full-text caller search found only `setInitialized(false)` in its static
initializer, no Java call setting it true. Under this visible caller graph,
`recordHitDelay` returns immediately and E remains zero. External/native or
reflection initialization cannot be ruled out without executing the original,
which this lab will not do. The independent client therefore uses E=0 and
records that equivalence limitation. An observer does not receive local mouse
state or the attack timing tracker.

`DamageResponsiveAnimationsMode.onLivingUpdate` sets releaseTime to now for
every living update while a sword is held; the local-player update additionally
queues a reset on PRE_TICK_EXECUTOR. `EventPreTick.fire` runs that executor before
dispatching listeners. This ordering must be preserved.

`wrapper/impl/KeyBinding.java:11-16,37-44,103-106` is not a plain field setter:
setPressed(true) calls I(), setting key state and incrementing pressTime;
setPressed(false) clears pressTime then clears key state on 1.8.9. Manual/Predict
therefore enqueue a use press when switching on. Lag's native mouse-up does not
have the same press-queue clearing semantics. `MouseInputState:20-41` dispatches
only changed button states via the native input handlers; exact OS message
arrival order is a remaining native-boundary limitation.

Auto has no autonomous use-key press in its own handlers. Its predicate is
called by LeftClicker/SilentAura click cycles and ItemMacro; its right-mouse
handler cancels a manual press under the described gate. A standalone Auto test
must not invent a block trigger. A paired Auto+LeftClicker scenario needs its
own matched LeftClicker-only control and must be labeled as a combination.

## Stasis naming and Blink packet behavior

Source: `module/blatant/Blink.java:39-277`; packet mapping references
`mapping/MappedClasses.java:842-870` and equivalent legacy mapping section.

Default direction Outgoing only; alternate Bi-directional. Default Type All;
alternate Movement only. Auto send false; send threshold range 0..100, default
50, step 1; zero disables automatic threshold flush. Visual breadcrumbs and
fake self-player default off and do not change server gameplay.

Outgoing LOW-priority callback ignores already cancelled/re-entrant/incoming
packets. In movement-only mode queue C03PacketPlayer and its movement subclasses
only; other packets continue. Increment count **before** threshold check, queue
the current packet, cancel, then flush if requested. In All mode interaction and
keepalive packets also queue. Bi-directional mode additionally queues incoming
packets and increments the same counter even when movement-only is selected:
the Type filter is in the outgoing handler, not the incoming handler.

Incoming S08PlayerPosLook flushes and, if auto send is off, disables Blink.
Certain GUI transitions also flush. Incoming threshold handling sets a pending
flush; the outgoing handler performs the drain. On before-disable, flush the
ordered queue; then clear visual state. Source queues preserve cross-direction
ordering. Legitimate transport lag delays all bytes in a TCP direction; the lab
must preserve stream order and distinguish it from selective movement choking.

Movement-only Blink is the candidate Stasis behavior. All-packet Blink may be
indistinguishable from a connection stall to this observer. No detection claim
or equivalence to a separately named Stasis module is made yet.

## Timer

Source: `module/blatant/Timer.java:11-31`; `wrapper/impl/Timer.java` and timer mapping.
Speed 0.1..2.0, default 1.07, step 0.01. Each pre-player-tick sets game timer speed
to the selected float. Tick parity toggles but is otherwise unused in this module.
Disable restores 1.0. Faithful testing needs a scaled simulation clock including
movement, animation and tick-driven actions. Multiplying movement coordinates or
sending duplicate movement packets is not equivalent. Wall-clock timers in other
modules remain wall-clock timers unless their owning code explicitly scales them.

## Auto Clicker

Source: `module/combat/LeftClicker.java:29-170`, `ClickerMod.java:123-247`,
`click/ClickEngine.java:58-214`, `click/AutoClickerTimingState.java:1-204`.

Defaults: hold to click true, trigger mode false, CPS range 6..13 (allowed 1..20),
randomization Extra, jitter false, item limitation false with swords whitelist.
Break blocks false; delay defaults 0..10 ms (allowed 0..2000); break whitelist
false with pickaxes/shovels. GUI/focus/input/control claims and optional crosshair
or item restrictions gate clicks. The input helper registered InventoryFill is
out of scope. Target combat AutoClicker is LeftClicker.

Click delay selection truncates CPS endpoints to integers. If endpoints differ,
draw uniformly from `(min,max]`, excluding min. Normal uses integer `1000/CPS`.
Extra uses a retained delay during randomly sized bursts: a 1/4 branch selects
1..5 clicks; otherwise the short-circuited 9/10 then 1/10 branch selects 5..14.
Outside a burst, a `nextInt(48) % (fast ? 6 : 10)==0` event adds 40..84 ms.
Fast phase adds 25 ms, or 50 ms with probability 1/5. Its initial configured
length is zero, so the initial call transitions immediately to a slow phase of
75..199 calls; subsequent fast lengths are 7..14. Preserve call ordering and
retained-delay accumulation, rather than substituting Gaussian click intervals.

Extra+ delegates to AutoClickerTimingState. CPS bounds are multiplied by 1.5,
clamped at >=0.5 and separated by at least 0.1. Approximate normal noise is a
sum of six uniforms, centered at 3 and scaled by 1.22474487139. Target drift is
scheduled 1,200..3,200 ms; longer target changes 30,000..90,000 ms. Target offset
is uniform +/-0.75 CPS. CPS drift is 0.25*(target-current)+0.45*noise, with 3%
additional +/-0.6. Fatigue grows 0.015 per call to a maximum 0.4; it reduces
effective CPS before clamping. Idle>=1,200 ms recovers fatigue, and has 70%
chance of a 2..5-click burst. Burst CPS multiplier is 1+0.05*(0.4+0.8*uniform).

Delay uses `1000/effectiveCps * exp(0.24*noise)` plus integer micro-jitter whose
maximum is 30..40. Noise has a 12% uniform +/-1.5 branch, a further 5% amplified
normal branch (1.4..2.0), else normal. Optional burst jitter adds 0..14 ms.
Repeated-delay chance defaults 6%, periodically changes to 3..9%, and adds -3..3
to the prior delay. A 7% event scales delay by 0.7..0.9. Pause probability is
min(0.04+0.12*fatigue+offset,0.18), adding 50..150 ms. Clamp delay to [1,INT_MAX]
and truncate to long. Time-derived salt and SplittableRandom influence results;
an independent seeded driver must disclose its entropy differences.

ClickerMod additionally waits 50 ms after activation, subtracts 5 ms from the
generated cycle, and for the reachable <=20 CPS path replaces cycles <=50 ms
with 45 ms. Hold/release split depends on delay and Java's signed remainder
`random.nextInt()%10`, not a nonnegative `nextInt(10)`. Both durations truncate
to integer milliseconds. The worker adds a 5 ms sleep after every cycle.
Worker sleep and game input sampling can quantize
the resulting packets. A cadence generator alone is not a complete client.

Jitter (`ClickEngine.java:101-122,286-313`) draws two float offsets in [-7,7)
from the **same** Java Random stream used by click timing on each button press.
The offsets are stored as doubles; step count is `(abs(horizontal)+abs(vertical))
*0.45` in double precision. Each pre-tick adds offset/steps, rounded to float,
to pending yaw/pitch while remaining steps >0. Each pre-render callback truncates
pending yaw and negated pending pitch to integers, applies the cubic mouse
sensitivity factor `(sensitivity*0.6+0.2)^3*8`, then the vanilla 0.15 rotation
factor. Pitch clamps to [-90,90]. The recovered `floor(normalized remainder)`
operation resets fractional residue to zero; it is not ordinary fractional
carry. Render cadence is therefore a behavior dependency, disclosed by the
headless adapter. Trigger deferral in ClickerMod happens after cadence and hold
RNG sampling, so rejected trigger cycles still consume those draws.

## Fast Place and optional Auto Tool

Fast Place (`module/world/FastPlace.java:21-77`): pre-tick; delay 0..4 ticks,
default 1. Held item All (default), Blocks, or Projectiles (snowballs/eggs via
item helper). Do nothing if no player or another module owns right-click use.
Only reduce the current right-click counter when it exceeds configured delay.
This does not invent a click while use input is released or while no valid
placement target exists. Offhand branches are inapplicable to 1.8.9.

Verified tick hook order: `mapping/mappings/MMinecraft.java:925-933` maps `a`
to runTick and `v` to runGameLoop on 1.8.9;
`mapping/MinecraftTickCallbackExprEditor.java:26-28` inserts the pre callback
before runTick, and the post callback after it. The trusted Forge 1.8.9 source
reference decrements rightClickDelayCounter at the beginning of runTick, before
input consumption. Thus FastPlace clamps the counter **before** that decrement:
held-use delays 0 and 1 can both request use every client tick. This reference
source is read as inert text from the existing Forge sources archive, with
hashes in `output/anticheat-lab/game-reference/manifest.json`.

Auto Tool (`module/utility/AutoTool.java:20-160`): pre-player-tick; swap weapon true,
instant weapon swap true, swap-to delay 50 ms (0..500, step 50), swap-back false,
swap-back delay 350 ms (50..1000, step 50), require attack held true, only-sneak
false. Rank hotbar tools by block strength, initial best score 1 and strict greater
comparison. Tool/enchantment helper can halve a score. Rank weapons by damage;
swords receive +0.01 tie preference. Remember original slot once. Start delay on
candidate change; entity/instant-weapon branch bypasses it. When candidate vanishes,
schedule optional return and defer further swaps until that return finishes.
Equipment changes alone do not prove automatic tool selection.

## Exception dispatch and further fidelity findings

`event/EventBus.java:103-143` dispatches each registration inside a `Throwable`
catch and continues to other listeners. This matters for GodBridge:
`BlatantScaffoldMode.java:459-472` accepts any completed `movementTask` while
`switching`, assigns nullable `pendingPos`, and computes its placement point.
The pending position is assigned only in the supported-corner branch at 525,
but recovery at 552-560 can submit a task before that branch is reached. The
visible source can therefore throw inside the listener, with partially changed
state, then continue game processing. The independent adapter initially omitted
this dispatch boundary and terminated two workers. The corrected adapter logs
the explicitly traced source exception and continues the other events; unrelated
implementation exceptions invalidate a trial. It does not invent a turn target.
Original interrupted recordings remain excluded partial artifacts; completed
earlier outcomes are retained and the interrupted specifications rerun.

Trusted vanilla reference `EntityPlayer.java:613-628` assigns jumpMovementFactor
and landMovementFactor after its superclass integrates movement.
`EntityLivingBase.java:1618-1627,1752-1762` reads those fields. The trusted headless
physics dependency instead derives movement factors from the current sprint
control. `vanilla_movement_factors.js` is an explicitly enabled experimental
pilot adapter for that one-tick difference. It is not enabled by frozen primary
campaigns and does not make their physics byte-identical to vanilla. Full float
trigonometry, collision rounding, client patches and render scheduling still differ.
Hashes of these inert references are in game-reference/movement-reference-manifest.json.

`MovementInputHelper.java:258-263` and `TellyBridgeScaffoldMode.java:152` query
the entity's actual sprint state. The adapter now reads the current entity state
for experimental Telly movement rather than an extra pre-update cached tick.
GodBridge campaign inputs never request sprint, so that distinction does not
change their branch. Telly remains a fidelity investigation until gameplay
evidence supports its admission; successful placements alone do not establish
continuous bridging or original-client equivalence.

## Coverage and remaining limits

Rotation interpolation, movement tasks, mouse history, relevant 1.8.9 mappings,
event priority, sampled vanilla input, and AttackPacketTimingTracker's visible
initialization were traced above. Unknown native enable paths and patch behavior
remain explicit limits. Auto Tool is audited but not implemented (optional scope).

Full-stone Scaffold, sampled on-foot combat, snowball/block Fast Place, Timer,
and Blink are the implemented subsets. Non-stone whitelist/blacklist shapes,
clicker GUI/mining paths, flight, mounts, death/respawn, native injection and
unrecovered dependencies are not silently counted as supported coverage.

Labels identify the independently enabled behavior and actual accepted game
effects. No-ops, interrupted runs and insufficient evidence remain separate.
Bot controls do not establish human-population false-positive rates. Existing
labeled real recordings and fresh held-out conditions remain separate gates.
