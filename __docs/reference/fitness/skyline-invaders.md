# Skyline Invaders

A fixed-shooter Fitness game. Threats fall on a skyline; the shooter stands on a step mat, aims the cannon with their arms and fires by stepping. Heart-rate zone sets the shot, and a partner on a bike can pedal up boosts. Opens at `/fitness/module/skyline_invaders`.

Code: engine and rules in `__app_modules/wellness/fitness/browser/lib/skylineInvaders/`, the widget in `browser/widgets/SkylineInvaders/`, server in `server/` (adapters, services, `api/fitness.mjs`).

## Play contract

- A level is one timed round. There are no lives: a threat that reaches the ground costs skyline (base HP) and stars, and the round always runs to its timer.
- A round passes when the shooter has at least `pass.kills` kills and at least `pass.base_hp_min` percent of the skyline left at the end. Passing a level opens the next one in world order.
- Stars: 1 = pass, 2 = skyline at 75% or more, 3 = no damage. A pass pays 10 / 20 / 30 rings.
- Phases: `loading → lobby ↔ calibrating → countdown → playing ↔ paused → result`. Holding bike button 4, gamepad Start, gamepad B and Escape pause the clock; a round has no touch chrome. A paused Fitness session or a hidden tab pauses it too.
- The result screen shows each number alone with what the level asked for under it ("Shot down 25, needed 18"), green when met and red when short. A new round is not offered until the record is saved.
- The HUD shows skyline, kills against the target (`7 / 18`, then `25 ✓` once the target is reached), time left, score, combo, the shot tier and the boost meter.

## Inputs

### Aim: torso-relative

The cannon follows where the hands are **relative to the player's own torso**. The camera frame is never the reference.

- Hands in front of the chest = centre, at any height. Hands out to the player's left or right = left or right, at any height. Nothing is overhead; no step of the game asks for raised arms.
- The measure is the wrists' offset from the shoulder midpoint along the shoulder line, in shoulder widths (`lib/skylineInvaders/aim.js`). Where the player stands, how large they appear and a tilted shoulder line cancel out. With BlazePose 3-D keypoints a modest torso turn cancels too; the 2-D fallback does not undo a turn.
- The screen is a mirror: the player's right is screen right.
- Both arms are averaged by keypoint score. A hanging arm (wrist well below its shoulder) is ignored and the other arm aims alone.
- A pose counts as lost by keypoint score, after `poseLostAfterMs` with no usable arm. While lost the cannon keeps its aim and drifts toward the threat nearest the ground, the HUD says "Step into view", and the timer keeps running.
- Without a calibration, or with the camera denied or failed, aim is manual: gamepad left stick or the arrow keys. The game never blocks on the camera.
- `InvadersPoseBridge.jsx` is the only pose-context consumer. Poses reach the game through `tracker.processPoses`, not React state, so the round does not re-render at the pose rate. The detector runs with `maxPoses: 1` and `temporalSmoothing: false`; the tracker applies the one smoothing filter.

### Calibration

Folded into the way to the round: Start on the wave list goes to the **Ready** screen (`InvadersCalibration.jsx`, about ten seconds) unless this shooter's reach is already known:

1. **"Stand on the mat."** Head and shoulders in view for one second is enough; wrists at rest may hang out of frame.
2. **"Reach left…"**, then **"…now right."**, both hands at chest height, held still for about a second each. A live meter shows the hands and the captured left reach.

The last reach starts the countdown by itself. The two reaches become `{ left, right }` in shoulder widths and map to the screen edges, so a child and an adult both cover the full width. A span under one shoulder width is rejected ("Reach further apart.") and the reach steps repeat. Without a camera (denied or failed) there is no Ready screen: Start goes straight to the countdown and the HUD wears a "Gamepad aim" badge. A camera still starting after 20 s (`READY_CAMERA_WAIT_MS`) does the same. The panel offers Back (3), and Skip (4, gamepad aim) only when a gamepad is connected. Changing the shooter clears the calibration. It is held in memory for the mounted game only.

### Fire: step on the mat

- One `pressure-mat:step` from **the shooter's mat** fires one volley. Steps from any other mat are ignored (and logged, sampled). A stomp does not fire: the same press has already produced its step.
- To fire again the shooter steps off and back on. Measured on the garage hardware this gives about 1 to 1.3 shots a second, which is why `fireIntervalS` is `1.0`.
- **Aim latch.** A shot uses the aim from `aimLatchMs` before the press, because stepping throws the arms. The tracker keeps a short aim history for this.
- The shooter is the mat's assigned rider; the "Who's shooting?" screen asks when the mat has none. A mat has two ids: the equipment id (session API) and the hardware id (the app-event bus). `matSelection.js` carries both.
- Fallbacks for testing and no-mat play: Space or F, gamepad A or RT.

### Heart-rate zone tiers

The shooter's trusted zone, at most ten seconds old, picks the shot. It is the same trust path as Skyline Glider (`lib/skylineGlider/weaponPower.js`, `trustedZoneId`).

| Zone | Tier | Shot |
|---|---|---|
| cool, active, unknown, stale or no monitor | Small | 1 damage |
| warm | Big | 2 damage, wider |
| hot | Spread | three shots fanning out, 1 damage each |
| fire | Nuke | every shot detonates on the first threat it meets |

With no trusted reading the HUD says "No trusted heart rate — small shots". In co-op, where a partner steps on the mat, the aimer's zone still powers the shot.

**Nuke.** The blast is a circle around the impact point (`nuke.radius`, default 160 scene units; `nuke.damage`, default 3), not a screen wipe, so aim still matters. Pods caught in it are destroyed without splitting. A full-HP bomber (4 HP) survives one blast at the default damage.

### Partner boosts

A second rider on a connected bike (anyone but the shooter) fills the boost meter by pedalling. With no partner the meter is hidden.

- Fill rate scales from nothing at `min_rpm` (40) to full at `full_rpm` (90). At full effort the meter fills in `fill_s` (20 s).
- A full meter starts the next boost in the rotation for `duration_s` (8 s); the meter rests while a boost runs.
- Rotation: **Rapid fire** (the cannon fires by itself every `rapid_interval_s`, 0.25 s, at the live aim and tier), **Shield** (ground impacts do no damage), **Twin cannon** (a second cannon mirrors the first).
- Every value can be overridden per level under `boost:`.

### Menus

Every menu screen is one decision: Skyline Glider's window on the left (`.skyline-menus`, `InvadersMenus.jsx`) and the four bike buttons on the right (Glider's `SkylineControlPanel`), set over the still city. What each button says and does is `lib/skylineInvaders/invadersPanel.js` (pure, tested). No instructions in prose: the buttons say what they do.

| Screen | 1 | 2 | 3 | 4 | Mat stomp |
|---|---|---|---|---|---|
| Who's shooting? (session riders on their buttons) | rider | rider | rider | rider (empty keys: Other riders) | |
| Other riders (hold any key on Who) | Previous | Next | Back | Choose | |
| Pick a wave | Previous | Next | Change shooter | Start (locked wave: Admin unlock) | Start |
| Round locked (school day) | Admin unlock | — | Back | Change shooter | |
| Ready | — | — | Back | Skip (gamepad connected only) | |
| Paused | Resume | Sound | End round | — | |
| Result (once saved) | Replay | Next wave (only when open) | Waves | Change shooter | next wave after a pass, else Replay |
| Sound | Quieter | Louder | Back | Mute | |

Start is always button 4 or a stomp on the shooter's mat (`pressure-mat:stomp`; another mat's stomp is ignored). The panel's Start key says "Or stomp the mat" when there is a mat.

**The wave list** is Glider's flight list (`FlightList` in `SkylineMenus.jsx`): a five-row window that follows the cursor, "N more" above and below, each row with a status word — **Done** with the best stars (pixel stars: gold when won, solid ink when not, never faded), **New**, or a pixel lock and **Locked**. Under the list the chosen wave says what tells it apart: the sprite and name of the threat it brings in first, its kill target and its time ("New: Drones · Shoot down 20 · 3:00", `lib/skylineInvaders/waves.js`). The seed waves are genuinely different (meteors, then drones, pods, bombers), so they stay separate rows.

**Keys, foot pad, gamepad** (`useMenuInput`; the digits 1–6 are never acted on, the garage kiosk's OS binds them): left = 1, right = 2, Escape/B = 3, Enter/A/any foot-pad key = 4. Exceptions: on Who's shooting, accept takes the first rider and right opens Other riders; on the lock screen accept is Admin unlock; on Paused accept and back resume; on the Sound sheet accept is Back, so a stray foot-pad press only closes it. While the admin fingerprint prompt is up only Cancel (3, or Escape/B) acts.

### Sound

Invaders plays at its **own** volume (`useGameVolume('skyline-invaders')`, the track `fitness-game-skyline-invaders/global/game` in the fitness volume store), never the video level and never full gain. The stored value is the output gain itself (curve applied once); an unset track plays at level 60 (0.158). Every voice -- cue files, the music loop, synth tones -- ends on the one output gain of the shared Skyline audio engine, 0 when muted. See `nav/gameVolumeModel.js`.

The **Sound sheet** (`InvadersSoundSheet.jsx`, its body the shared `SkylineGlider/GameSoundSheet.jsx`) shows the level, the house touch volume strip (11 keys, 0 = off, no slider) and Back / Quieter / Louder / Mute. It opens from:

- **Touch:** the "more" button (three dots, a solid 64 × 56 px key) in the bottom-right corner of the Who, Other riders, wave list, lock, pause and result screens, on the street under the panel and clear of every window, the panel and the round HUD. A round has no touch chrome: pause first.
- **Keys, foot pad, gamepad:** Sound on the pause screen. In the sheet Back has the focus, so a stray foot-pad press only closes it; Escape or B goes back.
- **Bike buttons:** hold 4 in a round to pause; on the pause screen 2 opens Sound; in the sheet 1 quieter, 2 louder, 3 back, 4 mute. On every menu screen the bike buttons are the panel; mid-round a single press stays with rider selection.

A workout resume never restarts the round under an open sheet.

## Threats

Scene units, 1000 × 600, ground at y = 540.

| Threat | HP | Points | Falls (units/s) | Ground damage | Notes |
|---|---|---|---|---|---|
| meteor | 1 | 10 | 70 | 10 | straight down |
| drone | 1 | 20 | 55 | 10 | zigzags ±90 units on a 2 s period |
| pod | 2 | 30 | 35 | 20 | splits into two drones when destroyed |
| bomber | 4 | 60 | does not fall | none | crosses at the top, drops a bomb every 4 s |
| bomb | 1 | 5 | 120 | 15 | from a bomber only; can be shot, does not count as a kill |

A level file may spawn `meteor`, `drone`, `pod` and `bomber`.

## Scoring

- Points per kill, times the combo: +10% per consecutive volley that hits, up to +100%. A volley whose shots all leave the field without a hit resets the combo.
- Arms above the shoulders, held for `armsUpHoldMs` before the press, multiply a kill's points by 1.5. It is a bonus only.

## Level file

Schema `skyline-invaders-level/v1`. Levels are household data; nothing is bundled with the app.

```yaml
schema: skyline-invaders-level/v1
id: invaders-1-4              # ^[a-z][a-z0-9-]+$ ; also the progress key
name: Bomber Run
duration_s: 240               # 30..900
pass: { kills: 30, base_hp_min: 30 }   # kills: integer >= 1; base_hp_min: 0..100, default 0
cannons: 1                    # 1 or 2 (2 = one cannon per arm); default 1
max_bombers: 1                # bombers alive at once; default 2. A bomber rolled past the cap spawns as a meteor
nuke: { radius: 160, damage: 3 }       # optional; these are the defaults
boost: { fill_s: 20, duration_s: 8, min_rpm: 40, full_rpm: 90, rapid_interval_s: 0.25, rotation: [rapid, shield, twin] }   # optional; defaults shown
waves:
  - { at: 0, spawn: { meteor: 2, drone: 1 }, rate_s: 4.0 }
  - { at: 60, spawn: { bomber: 1 }, rate_s: 6 }
  - { at: 66, spawn: { meteor: 4, drone: 2, pod: 1 }, rate_s: 4.2 }
```

**Waves.** `at` is strictly increasing and before `duration_s`; `rate_s` is at least 0.3. The wave in force spawns one threat every `rate_s` until the next wave's `at`, and each spawn picks a type from `spawn` by weight (`{ meteor: 2, drone: 1 }` is two meteors in three). The column and the pick come from the round's seed, so what falls depends on the seed and the level only, never on the frame rate or on what was shot down.

**Exact counts.** A wave that ends within one `rate_s` of starting spawns exactly once. The fourth seed level uses this to send exactly two bombers on every seed (`{ at: 60, spawn: { bomber: 1 }, rate_s: 6 }` followed by a wave at 66).

**Reachability.** `validateLevel(raw, { reachability: true })` (the default) plays the level with a bot on the real engine: small shots only, no partner, one shot every `fireIntervalS`, perfect aim at the lowest threat. The level may ask for at most `reachabilityHitRate` (0.6) of the bot's kills and no more skyline than the bot ends with. A level that fails is rejected in the browser, logged as `skyline_invaders.level.invalid` with the reason, and left out of the lobby. The server catalog checks structure only.

The checker plays seed 1; a real round gets a random seed. `seedLevels.test.js` therefore also plays each seed level on twelve seeds with 15 points of skyline to spare, keeps `pass.kills` at or under 80% of what is reachable, and plays level 1 with a shooter who fires once every two seconds. If `fireIntervalS` changes, that test is the alarm: re-tune the levels there.

**Authoring a level.** Copy a seed file, change it, add the id to `world.yml`, and load the lobby. A rejected level's reason is in the log line. To check before installing, put the file beside the seed fixtures under `tests/_fixtures/fitness/skyline-invaders/levels/` and run the seed test.

### Seed levels

The tested source is `tests/_fixtures/fitness/skyline-invaders/`; the installed files are copies.

| Level | Introduces | Duration | Pass |
|---|---|---|---|
| `invaders-1-1` First Light | meteors, one every 3.5–4.5 s | 180 s | 18 kills, 40% skyline |
| `invaders-1-2` Zigzag | drones | 180 s | 20 kills, 40% skyline |
| `invaders-1-3` Split Decision | pods | 210 s | 26 kills, 30% skyline |
| `invaders-1-4` Bomber Run | two bombers, at 60 s and 150 s | 240 s | 30 kills, 30% skyline |

## World order and progression

`world.yml` is `{ levels: [id, …] }`. Levels play in that order; installed levels not named there follow, sorted by id. The first level is always open. Each later level opens when the one before it is completed, or when an admin unlocks it from the lobby (fingerprint prompt). Only a `completed` run counts; `failed` (timer ran out below the pass mark) and `abandoned` (ended early) do not.

Per-rider progress keeps the best completion per level (more stars, then higher score). A missing progress file is rebuilt from the run log, so deleting one loses nothing.

## Data paths

Relative to the household folder (data) and the media root (sounds):

```text
fitness/skyline-invaders/world.yml                      # level order
fitness/skyline-invaders/levels/*.yml                   # skyline-invaders-level/v1
fitness/skyline-invaders/progress/<riderId>.yml         # skyline-invaders-progress/v1: { completed, unlocked }
fitness/log/skyline-invaders/<date>/<runId>.yml         # skyline-invaders-run/v1, dated by started_at
media: fitness/skyline-invaders/sounds/<slot>.mp3
```

Level files and `world.yml` are read on every request, so an edit shows on the next lobby load with no restart.

Sound slots: `laser`, `missile`, `hit`, `target`, `explosion`, `crash` (the nuke rumble), `hurt`, `deny`, `boost`, `finish`, `music` (the loop). A missing, empty or undecodable file falls back to the synthesized tone, so the folder ships with empty placeholders. Audio is the Skyline Glider audio engine, at the game's own volume (see Sound).

A run record carries `run` (`id`, `level_id`, `started_at`, `ended_at`, `status`, `duration_s`, `score`, `kills`, `stars`, `base_hp`, `shots_fired`, `hits`, `best_combo`, `nukes`, `boosts_used`, `reward_rings`, optional `fitness_session_id`, `mat_equipment_id`, `partner_id`), `rider.user_id`, and an embedded `gaming-result/v1` block, where a failed round is a completed session with a `loss` outcome.

## API

All under `/api/v1/fitness/skyline-invaders`. Each takes an optional `household`.

| Route | Purpose |
|---|---|
| `GET /levels` | `{ levels }`: every structurally valid level in world order. An empty list means none installed. |
| `GET /world?rider=<id>` | `{ riderId, levels: [{ id, name, status, best? }], next }` with `status` `locked` / `open` / `completed`. Without a rider, the progression a new rider starts from. |
| `POST /progress/:riderId/unlock` | Body `{ levelId, unlockedBy }`. Admin skip-ahead; the browser collects the fingerprint first. 404 for an unknown level. |
| `POST /runs` | Body `{ record }`. 201 on first save, 200 on an identical resend, 409 on a conflicting record with the same id, 400 on an invalid one. Records the completion in progress. |
| `GET /runs/:runId` | `{ record }` or 404. |

A route answers 503 when its service is not wired. There is no suspension beacon and no resumable checkpoint: a reload ends the round and nothing is saved for a round that was never finalized.

## Access gate

A school learner needs the `fitness.skyline-invaders` entitlement, granted by `school.day-complete` (see [State Gates](../state-gates/README.md)).

**The gate follows the riders, not the pick.** The learners gated are everyone in the fitness session's roster (heart-rate straps) and the mat's rider who is known to be a school learner, plus the shooter unless known not to be one (`gateLearnerIds` in `lib/skylineInvaders/people.js`). The round opens only when every one of them has the entitlement (`useSkylineGroupAccess` in Skyline Glider's `useSkylineAccess.js`, called with this capability id and the `skyline_invaders` log scope). So a child who picks a grown-up as the shooter while riding still sees the lock.

The shooter picker offers the session's riders (roster and mat rider); everyone else in the household is behind a press-and-hold on "Other riders".

While locked, the game shows only the lock screen (`InvadersLocked.jsx`, Skyline Glider's `denied` pattern): "Round locked — Finish today's school work to unlock." with "School first: <names>" for the learners it waits on, and the four bike buttons: 1 Admin unlock (admin fingerprint), 3 Back and 4 Change shooter (both open the shooter picker). Gamepad A / Enter is Admin unlock, B / Escape is Back. An admin unlock covers the learners riding at that moment; anyone new joining asks again. Losing access mid-round ends the round.

## Menu tile

The household Fitness menu is deployment-owned configuration and is not tracked in this repository. Add this tile:

```yaml
- id: skyline-invaders
  label: Skyline Invaders
  icon: rocket            # any icon the household menu supports
  target:
    type: module
    module_id: skyline_invaders
```

## Logging

Browser events use the `skyline-invaders` component; filter the log store with `"skyline_invaders."`. Round events carry `runId`, `levelId` and `shooterId`.

| Event | Fields | Notes |
|---|---|---|
| `skyline_invaders.mounted` / `.unmounted` | `sessionId`, `mats`, `poseModel`, `poseBackend`, `viewport`, `pixelRatio` / `phase`, `runId` | |
| `.levels.loaded` | `levels`, `rejected`, `ids` | |
| `.levels.error` | `reason` (`none-installed`, `request-failed`), `error` | error level |
| `.level.invalid` | `levelId`, `errors` | a level the validator rejected, with why |
| `.world.loaded` / `.world.error` | `riderId`, `next` / `error` | |
| `.assets.loaded` / `.assets.error` | `sounds`, `missing: [{ slot, reason }]` | `reason: empty` is a placeholder |
| `.lobby.shooter_picked`, `.lobby.level_chosen` | `shooterId`, `matEquipmentId`, `previous` / `levelId` | |
| `.control.action` | `action`, `screen`, `source` (touch, bike, key, gamepad, stomp), `shooterId` | one line per menu press |
| `.lobby.calibration_opened`, `.lobby.calibration_reset`, `.lobby.calibration.camera_timeout` | `shooterId`, `pose` / `reason` / `waitedMs` | |
| `.lobby.calibration.started`, `.step`, `.too_narrow`, `.closed` | `step`, `how` (`held` or `too-narrow`), `attempt`, `elapsedMs`; `left`, `right` on too_narrow | |
| `.lobby.calibrated` | `left`, `right`, `span`, `how`, `attempts`, `elapsedMs` | the range in shoulder widths |
| `.pose.camera_ready`, `.pose.camera_unavailable` | `enabled` / `error` | |
| `.pose.state` | `state` (`loading`, `detecting`, `error`, `camera-denied`), `backend`, `modelType`, `error` | on change |
| `.pose.metrics` | `fps`, `latency`, `backend`, `modelType` | sampled while detecting; compare `fps` with `poseMinFps` |
| `.pose.acquired`, `.pose.lost` | `aim` | |
| `.fire.armed`, `.fire.no_mat`, `.fire.other_mat` | `matId`, `cannons` / `hasEventBus` / `from` | other_mat is sampled |
| `.level.countdown` | `runId`, `levelId`, `shooterId` | |
| `.level.start` | `seed`, `partnerId`, `aimMode`, `tier`, `tierTrusted`, `matId`, `cannons`, `durationS`, `pose`, `poseFps` | the seed replays the round |
| `.fire` | `tier`, `aim`, `source` (`mat`, `keyboard`, `gamepad`, `auto`), `armsUp`, `time` | sampled, 30 a minute |
| `.mat.press_to_shot_ms` | `ms` | sampled; app event to shot, not foot to screen |
| `.round.nuke`, `.round.boost.activated`, `.round.base.hit` and other `.round.<engine event>` | the event's data | per-shot and per-threat events are not logged |
| `.round.paused` / `.round.resumed` | `reason` (`player`, `lifecycle`, `hidden`), `time` / `how`, `pausedBy` | |
| `.round.session_ended`, `.access.revoked` | `phase`, `state` | the round was ended from outside |
| `.effect.executed` / `.skipped` / `.failed` | `eventType`, `effectId`, `reason` | sampled |
| `.render.health` | `frames`, `longFrames`, `fps`, `windowMs`, `pose`, `poseFps`, `poseLatency`, `threats`, `shots` | every 20 s of play |
| `.frame.error` | `error` | sampled; the round continues |
| `.level.end` | `status`, `score`, `stars`, `kills`, `baseHp`, `shots`, `hits`, `bestCombo`, `nukes`, `boosts`, `durationS`, `seed`, `aimMode`, `shotsBySource` | |
| `.round.saved` / `.round.save_error` | `status`, `retried` / `error` | |
| `.reward.awarded` / `.reward.skipped` | `rings`, `stars` / `reason` | |
| `.boost.partner` | partner bike and rider, `when` | |
| `.audio.volume` | `level`, `muted`, `isDefault`, `output` | on mount and every change; `output` is the gain every voice ends on |
| `.settings.opened` / `.settings.closed` | `phase`, `source` (`touch`, `pause-menu`, `bike`) / `level`, `muted` | the Sound sheet |
| `.audio.level_set` / `.audio.mute_toggled` | `level` / `muted`, `control` (`touch`, `sheet`, `bike`) | |
| `.access.verdict` | `learners`, `status`, `state`, `unlocked`, `blockedBy` | one line per change of verdict |
| `.access.read_failed`, `.access.override_requested` / `_granted` / `_denied`, `.access.locked_choice` | `riderId`, `learners`, `reason`, `adminUserId` / `choice` | |
| `.progress.unlock_requested` / `_granted` / `_denied` / `_error` | `riderId`, `levelId`, `adminUserId`, `reason`, `error` | |

Server (`fitness.skyline_invaders.*`): `level.invalid` (`file`, `id`), `run.saved`, `progress.rebuilt` (`riderId`, `completed`), `progress.unlocked`, `progress.record_failed`.

## Tunables

`lib/skylineInvaders/tunables.js` is the one place these live; they come from the Phase 0 garage spike.

| Key | Value | Meaning |
|---|---|---|
| `fireIntervalS` | 1.0 | seconds per shot from step-off/step-on firing; drives the reachability bot |
| `reachabilityHitRate` | 0.6 | share of the bot's kills a level may demand |
| `aimLatchMs` | 200 | a shot uses the aim from this long before the press |
| `poseModelType` | `full` | BlazePose model |
| `poseBackend` | `null` | detector default |
| `poseMinFps` | 20 | logged against, not enforced |
| `keypointMinScore` | 0.3 | below this an arm is unusable |
| `poseLostAfterMs` | 500 | no usable arm for this long = lost |
| `armsUpHoldMs` | 300 | hold before the arms-up bonus counts |

The spike widget stays registered as the re-measurement tool: `/fitness/module/skyline_invaders_spike` (`widgets/SkylineInvadersSpike/`, events `skyline_invaders.spike.*`). Run it again after a change to the camera, the garage box or the mat firmware, write the numbers into `tunables.js`, and run the seed-level test.

## Art

Threats, the cannon and buildings are original 11 × 8 pixel grids in `lib/skylineInvaders/sprites.js`, drawn by the shared `PixelSprite` renderer in the gaming capability. Colours are the `--si-*` tokens on `.skyline-invaders`.

## Troubleshooting

**"No levels installed."** `GET /levels` returned none. Check that `fitness/skyline-invaders/levels/` exists in the household folder the app reads and that each file passes the structural check (server log `fitness.skyline_invaders.level.invalid`).

**A level is missing from the lobby.** The browser validator rejected it. Look for `skyline_invaders.level.invalid`; the `errors` field says whether it is structure or reachability ("pass.kills 40 is not reachable at one shot per 1s: at most 34").

**Pose is slow (around 13 fps).** A page served without cross-origin isolation runs the pose model single-threaded. The TF.js WASM backend needs `SharedArrayBuffer` for its threads, and the browser grants that only when the document response carries `Cross-Origin-Opener-Policy: same-origin` and `Cross-Origin-Embedder-Policy: credentialless`. The app and the dev server set both, but anything that serves the page another way (a proxy that rewrites headers, a static host, a test harness) may not. This was the Phase 0 lesson: without isolation the lite and the full model both ran at about 13 fps, so the limit was the single-threaded CPU backend, not the model size. Check `self.crossOriginIsolated` in the kiosk's console (it must be `true`), then `skyline_invaders.pose.metrics` for `fps` and `backend`. The engine is frame-rate independent and plays the same at 13 Hz aim; the cannon is only less smooth.

**Stepping does nothing.** `skyline_invaders.fire.no_mat` means no mat hardware id reached the game; `fire.other_mat` means steps are arriving from a mat that is not the shooter's. Pick the shooter on the right mat in the lobby. The first `fire.armed` line names the mat in use.

**Every shot is small.** The shooter has no trusted zone: no monitor, a stale reading (over ten seconds) or an ineligible one. `level.start` records `tier` and `tierTrusted`.

**The cannon will not follow the arms.** Without a calibration the game is in gamepad aim (`aimMode: manual` on `level.start`). Start a wave: the Ready screen calibrates. If the HUD says "Step into view", the arms' keypoints are under `keypointMinScore`: an arm crossing behind the body drops out and the other carries the aim.

**The boost meter is missing.** No partner: no connected bike with a rider other than the shooter (`skyline_invaders.boost.partner` logs when one is found).

**A round did not save.** The result screen holds on "Retry save" and logs `round.save_error`. A 409 means a different record already has that run id.

## Not verified live

The game is covered by unit and widget tests and by backend-free screenshots of the shell. The first live check is on the garage display after a deploy: the lobby lists the four levels, calibration completes at the mat, a step fires, `pose.metrics` shows the frame rate, and a finished round appears under `fitness/log/skyline-invaders/` and in the session history.
