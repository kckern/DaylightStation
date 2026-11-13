# Skyline Invaders

A fixed-shooter Fitness game. Threats fall on a skyline; the defender stands on a step mat, aims the cannon with a body gesture they picked for themselves, and steps to keep the cannon firing. Kills and firing time move the weapon up a ladder, and a partner on a bike can pedal up boosts. Opens at `/fitness/module/skyline_invaders`.

Code: engine and rules in `__app_modules/wellness/fitness/browser/lib/skylineInvaders/`, the widget in `browser/widgets/SkylineInvaders/`, server in `server/` (adapters, services, `api/fitness.mjs`).

## Play contract

- A level is one timed round. There are no lives: a threat that reaches the ground costs skyline (base HP), stars and the kill streak, and the round always runs to its timer.
- A round passes when the defender has at least `pass.kills` kills and at least `pass.base_hp_min` percent of the skyline left at the end. Every World 1 level asks for kills only (`base_hp_min: 0`); the skyline decides the stars. Passing a level opens the next one in world order.
- Stars: 1 = pass, 2 = skyline at 75% or more, 3 = no damage. A pass pays 10 / 20 / 30 rings.
- Phases: `loading → lobby → ready → countdown → playing ↔ paused → result`. The setup (choose your controls, then the test sweep) covers the lobby or a paused round without changing the phase, as the Sound sheet does. The touch Pause key, gamepad Start, gamepad B and Escape pause the clock. A paused Fitness session or a hidden tab pauses it too. Escape or B during the 3-2-1 goes back to the wave list.
- The result screen shows each number alone with what the level asked for under it ("Shot down 25, needed 12"), green when met and red when short. A new round is not offered until the record is saved.
- The HUD shows skyline, kills against the target (`7 / 12`, then `25 ✓` once the target is reached), time left, score, the kill streak, the weapon ladder with its power meter and fuel gauge, the controls in use, and the boost meter.

### Leaving

`SkylineInvaders` takes `onClose` from `FitnessModuleContainer` (the game is fullscreen and covers the nav, so this is the only way out short of a reload). Every screen has a way out, drawn only when the host gave the game an `onClose`:

- **In a round** (and during the 3-2-1): an **Exit** key beside **Pause** on the street strip, bottom right. One tap ends the round as `abandoned` and leaves. Gamepad **Select** (button 8) does the same.
- **On every menu screen** a player can stop on (Who's defending, the wave list, the lock screen, Ready, the setup's method list and test sweep, the pause screen, the result screen, and the loading and error screens): **Exit** is a touch key of its own (position 6 in `invadersPanel.js`, a paper key under the screen's coloured ones). On the keys and the gamepad, down is Exit on each of those screens except the two setup screens (on the method grid down reads as "the row below"), and Escape or B is Exit on Who's defending (the first screen) and on the error and loading screens. The roster and the Sound sheet have Back instead.

What leaving does:

- From a menu and from a saved result: the game closes.
- Mid-round (the round's Exit key, Select, or Exit on the pause screen or on a setup opened from it): the round is finalized as `abandoned`, the save is started with `keepalive`, and the game closes without waiting for it.
- From a result still saving or whose save failed: Exit is there all the same; a failed save gets one more try on the way out.
- From the countdown: nothing is saved (`round: discarded`).

Every exit logs `skyline_invaders.exit` with `phase`, `how` (`touch`, `key`, `gamepad`) and `round` (`abandoned`, `discarded`, `saved`, `saving`, `error`, or null). The foot pad sends plain letters, which are "accept" (key 4), so the foot pad does not reach Exit; touch, the arrow keys and the gamepad do.

## Inputs

### Aim: a gesture, picked by the rider

The cannon follows one of eight gestures. Each is a pure function of one BlazePose pose (`lib/skylineInvaders/gestures.js`), measured in the **player's own body frame** (`aim.js` `torsoFrame`): where the player stands, how large they appear and a tilted shoulder line do not move the cannon. None asks for hands above the head. The screen is a mirror: the player's right is screen right.

A gesture's output is one of four kinds. `aim` is a position 0..1, or null to hold the last aim. `velocity` is screens per second, integrated by the tracker. `impulse` drives the cannon while a stroke lasts, after which it glides. `hop` moves the cannon one lane.

| Gesture | Name on screen | Kind | Signal and mapping |
|---|---|---|---|
| `wiper` | Wipers | aim | Each forearm's tilt from upright about its elbow, on the torso plane; the two are averaged by keypoint score. `wiperMaxDeg` (50°) is the screen edge. A forearm counts whenever its wrist is above its elbow and it is at least `wiperMinForearmSw` (0.3 shoulder widths) long on that plane (shorter means it points at the camera). |
| `twist` | Twist | aim | Torso yaw: the angle of the 3-D shoulder line against the camera's image plane. `twistMaxDeg` (35°) is the edge. The arms are not read. Needs `keypoints3D`. |
| `wings` | Wings | aim | Roll of the wrist-to-wrist line against the shoulder line, in the image. `wingsMaxDeg` (30°) is the edge. The wrists must be at least `wingsMinSpanSw` (1.5) apart. |
| `wheel` | Steering wheel | aim | The same roll with the hands close together. `wheelMaxDeg` (45°) is the edge. The wrists must be between `wheelMinSpanSw` (0.25) and `wheelMaxSpanSw` (1.5) apart. |
| `sprinkler` | Sprinkler | aim | Azimuth of the midpoint of the wrists from straight ahead, in the 3-D torso frame: `atan2(lateral, forward)`. `sprinklerMaxDeg` (40°) is the edge. It is an angle, so arm length does not change the range. Needs `keypoints3D`, both wrists, and the hands at least `sprinklerMinReachSw` (0.5) from the chest. |
| `drag` | Slide | velocity | Mean wrist offset from the shoulder midpoint. Inside `dragDeadZoneSw` (0.3) the speed is 0; it rises to `dragMaxSpeed` (0.8 screens/s) at `dragFullSw` (1.0). Arms down is speed 0: the cannon stays. |
| `push` | Push | impulse | A wrist moving away from the body midline faster than `pushMinSpeedSw` (2 shoulder widths/s) is a stroke. During it the cannon moves at `pushGain` (0.3) screens per shoulder width of hand travel, capped at `pushMaxSpeed` (2.5 screens/s). After it the cannon glides with friction (`pushFrictionMs`, 220) and stops on a lane centre once slower than `pushSettleSpeed` (0.08). The return stroke is ignored: it moves toward the midline, and for `pushCooldownMs` (250) after a stroke one the other way is not counted. |
| `hop` | Hop | hop | An arm triggers when its wrist comes within `hopRaiseDropSw` (0.15) of shoulder height, or reaches `hopReachSw` (1.3) out on its own side. The right arm hops right, the left arm hops left. It re-arms only after the wrist has dropped past `hopLowerDropSw` (0.5) and come back inside `hopReachReleaseSw` (0.9). Hops are at least `hopRefractoryMs` (350) apart, and both arms triggering on one frame is not a hop. |

Sign conventions, for anyone reading traces:

- **twist.** `torsoFrame().yawDeg` is `atan2(z, x)` of the right-to-left shoulder vector in `keypoints3D`. Turning toward the player's own right brings the left shoulder toward the camera. MediaPipe's world landmarks put smaller z nearer the camera, so that turn is a negative yaw, and `twistSign: -1` maps it to screen right. This sign has not been checked on the garage camera. If a right turn steers left, set `twistSign` to `1`.
- **wings / wheel.** Roll is positive when the player's right hand is the lower one (a plane banking right, a wheel turned right).
- **sprinkler.** Forward is taken as a distance, so the sign of z does not matter.

`offset` (wrist offset from the shoulder midpoint at a fixed gain, `offsetReachSw` 1.2) is the release-one gesture without its calibration. It is computed on every frame for the trace and is not offered to players.

**Lost and held.** A gesture that cannot read its signal (arms down, a wrist unseen) holds the aim. The defender is lost only when the torso (both shoulders) has been out of view for `poseLostAfterMs` (800). While lost the cannon keeps its aim and drifts toward the threat nearest the ground, the HUD says "Step into view", and the timer keeps running. With the camera denied or failed, before it has seen anyone, or when the defender chose **Gamepad**, aim is manual (gamepad left stick or the arrow keys) and the HUD wears a "Gamepad aim" badge. The game never blocks on the camera.

**Aim help.** In a round played on a gesture, the shell watches whether the cannon is following. Out of view for `aimHelpLostS` (3 s) after being lost, or in view with the cannon in one lane for `aimHelpStuckS` (12 s), a solid strip at the bottom left of the street says "Can't see you" or "Cannon not moving?" with a **Controls** key. The key pauses the round and opens the setup over the pause screen. The strip goes as soon as the cannon moves again; the timer never stops for it. Each appearance logs `skyline_invaders.round.aim_help` (`kind: lost | stuck`). It counts game time from when play last started: a pause (or a setup opened from it) starts both clocks over, and it is off while the camera is not detecting (the HUD's own badge says why).

`InvadersPoseBridge.jsx` is the only pose-context consumer. Poses reach the game through `tracker.processPoses`, not React state, so the round does not re-render at the pose rate. The detector runs with `maxPoses: 1` and `temporalSmoothing: false`; the tracker applies the one smoothing filter (`aimSmoothingMs`, 120) to `aim` gestures.

### Setup: choose your controls, then test them

**Why.** On 2026-11-13 a defender played a round that ignored his gestures. The old controls intro walked a card per gesture and took a mat **step** as Next and a **stomp** as "Use these". Standing on the mat, his weight shifts turned five cards in under twenty seconds, and a stomp 0.48 s into the sixth card chose **Slide** (`drag`), which he never tried. He then steered like a wheel: under Slide, hands in front are inside the dead zone, so the cannon sat in the right edge lane for half a minute, and the pause screen had no way to change the gesture. The setup replaces that intro.

**When.** Start on the wave list goes through the setup until the defender's method has **passed its test in this visit** (`verified`, per defender, kept while the game is mounted). After that Start is the Ready screen. The setup also opens from the **Controls** key on the wave list (position 5; up on the keys), from **Controls** on the pause screen (position 4; up), and from the aim help key in a round. With the camera denied or failed there is nothing to choose: Start goes straight to the countdown on gamepad aim, and Controls is not drawn.

**The mat does nothing in the setup** except as the sweep's fire step. The defender is standing on it, and a weight shift must never choose for them.

**1. Choose your controls** (the `method` screen of `InvadersMenus.jsx`). Nine tiles in a 3 × 3 grid: the eight gestures, each with its stick-figure demo (`GestureDemo.jsx`) and name, and **Gamepad**. The defender's own method is ringed and says "Yours". Tap a tile to choose it. The keys and the gamepad move a cursor (left/right) and choose it (accept); the cursor is drawn only once a key or the gamepad is driving, since under touch a lit tile reads as already chosen, and when the screen was opened by touch the first accept only shows the cursor (the foot pad is an accept key: it must not choose a tile nobody saw). Back returns to the wave list, or to the pause screen when it was opened from a round. With the camera off the gesture tiles are disabled and the window says so; while the camera is starting it says that.

**Gamepad** needs no test: choosing it makes it the defender's method for this visit (it is not saved; the saved method stays a gesture), and from Start the round counts down at once.

**2. The test sweep** (the `sweep` screen; `lib/skylineInvaders/setupTest.js`, driven by `widgets/SkylineInvaders/useInvadersSetup.js`). The window sits at the top of the screen with the method's demo and its one line of how; under it the real cannon follows the defender with that method, starting from the middle, and two targets mark the left and right edge lanes. Three steps, in order, each ticked only when it is **detected**:

| Step | Detected when |
|---|---|
| Go left | the cannon arrives on lane 0 and rests there `setupHoldMs` (400 ms) with the defender in view. A cannon already parked there when the test starts must leave and come back; one resting there when the step times out finishes its hold, and after Try again a cannon already on the edge counts from then. |
| Go right | the same on lane 7 |
| Stomp to fire | a step or a stomp on the defender's mat (another mat does not count). Accept on the keys (Space, Enter, gamepad A, the foot pad) also counts, mat or not; without a mat the step reads "Press fire". |

A step not detected within `setupStepTimeoutS` (15 s) stops the test: the heading says **Not detected**, the step is marked with a cross, and the keys offer **Try again** (that step, from now; accept on the keys) and **Choose another** (back to the list; Escape or B). Choose another is there until the test passes. While the defender is out of view the line says "Stand where the camera can see you." When all three pass the heading says **It works!** for `setupPassedMs` (1.5 s) and then:

- opened by **Start**: the round counts down (no Ready screen: the defender was just seen doing it);
- opened by **Controls** on the wave list: back to the wave list;
- opened from a **paused round**: back to the pause screen, the round now aimed with the new method (its record carries the gesture in use when it ended).

A passed method becomes the defender's: a gesture is saved **per defender** with their progress (`POST /progress/:riderId/controls`, the `controls` field of the progress file) and comes back with the world map. If the save fails the choice still holds for the visit.

### Ready

Start on the wave list, once the defender's method has passed its test in this visit, goes to the **Ready** screen (`InvadersReady.jsx`): "Stand on the mat." Once head and shoulders have been in view for a second the countdown starts by itself; wrists at rest may hang out of frame. The screen shows the one line of how the defender's own gesture works and how to fire. A camera still starting after 20 s (`READY_CAMERA_WAIT_MS`) gives up and plays on gamepad aim. Ready offers Back, Exit, and Skip (gamepad aim) only when a gamepad is connected. Replay and Next wave on the result go straight to the countdown.

### Lanes

The aim range is cut into `lanes` (8) equal columns (`lib/skylineInvaders/lanes.js`). Threats spawn on lane centres. The cannon stands on a lane centre: the gesture's raw aim picks the lane, and the cannon moves only when the aim is `laneHysteresis` (25% of a lane) past the edge of its own lane, so an aim resting on a boundary cannot make it flicker. A zigzagging drone still swings about its lane centre.

A shot leaves from where the cannon is drawn. There is no aim latch and the cannon does not glide. Because stepping throws the arms, the lane holds for `stepLaneFreezeMs` (150) after a mat step while the raw aim keeps moving; set it to 0 to turn that off.

The cannon's lane is lit from the street to the top of the sky, and the threat the next shot will meet (the lowest one in that column) is marked with corner brackets.

### Fire: steps fuel a stream

- A `pressure-mat:step` from **the defender's mat** buys `fuelPerStepS` (1.5 s) of fuel, up to `fuelCapS` (5 s). While there is fuel the cannon fires a volley every `streamIntervalS` (0.25 s) by itself, the first one on the step. Spamming the mat only fills the tank. Steps from any other mat are ignored (and logged, sampled).
- The fuel gauge is in the HUD and as a strip of the street under the cannon's lane (red when empty). An empty tank reads "Step!" in the HUD.
- The player is the **defender**: the person assigned to the mat; the "Who's defending?" screen asks when the mat has none. Invaders is played standing on the mat and driven by touch, not riding: no screen says "rider", "shooter" or "bike" (only the boost partner rides), and the game never listens to the bike buttons. (Code, logs and saved records still call the defender `shooterId` / `rider.user_id`.) A mat has two ids: the equipment id (session API) and the hardware id (the app-event bus). `matSelection.js` carries both.
- Without a mat: Space or F, gamepad A or RT buy fuel the same way.

### Power meter and the weapon ladder

Kills and firing time fill the power meter: `powerPerKill` (0.08) per kill and `powerPerFiringS` (0.03) per second of firing, so a full meter is about 18 s of steady shooting. Heart-rate zone does not set the weapon.

| Level | Volley | Reached by |
|---|---|---|
| Single | one shot | the start |
| Double | two shots side by side (28 units apart) | a full meter |
| Spread | three shots fanning out | a full meter |
| Bomb | (the stream stays Spread) | a full meter at Spread: the meter stays full and the HUD says "Stomp!" |

Every shot does 1 damage. A stream left idle for `weaponIdleDropS` (8 s) drops one level and empties the meter; it drops again after another 8 s.

**Bomb.** A `pressure-mat:stomp` with a bomb ready blasts a circle (`nuke.radius`, default 160 scene units; `nuke.damage`, default 3) around the lowest threat in the cannon's lane, or with that lane clear around the nearest threat, or in the empty sky above the cannon. It spends the meter. Pods caught in it are destroyed without splitting; a full-HP bomber (4 HP) survives one. The mat reports a stomp instead of a step, never both, so a stomp always buys fuel too; a stomp with no bomb ready is just a step. Without a mat: B on the keyboard, X or Y on the gamepad.

### Partner boosts

A second rider on a connected bike (anyone but the defender) fills the boost meter by pedalling. With no partner the meter is hidden.

- Fill rate scales from nothing at `min_rpm` (40) to full at `full_rpm` (90). At full effort the meter fills in `fill_s` (20 s).
- A full meter starts the next boost in the rotation for `duration_s` (8 s); the meter rests while a boost runs.
- Rotation: **Rapid fire** (the stream runs every `rapid_interval_s`, 0.125 s, twice its normal rate, and burns no fuel), **Shield** (ground impacts do no damage and do not end the kill streak), **Twin cannon** (a second cannon mirrors the first).
- Every value can be overridden per level under `boost:`.

### Menus

Invaders is a **touch-screen** game: the defender stands on the mat, so nothing depends on the bike buttons (they are not listened to at all). Every menu screen is one decision in one centred window (`.skyline-menus`, `InvadersMenus.jsx`) over the still city: people are tiles to tap, and the screen's actions are solid touch keys under it (`InvadersTouchKeys`). What each key says and does is `lib/skylineInvaders/invadersPanel.js` (pure, tested), at four positions that the keyboard, gamepad and mat press too; a blank position draws no key. Two more keys sit past the four: **Controls** (position 5, on the wave list) and **Exit** (position 6), paper-coloured and on a smaller row of their own under the four, at the right, so the four colours stay the screen's decision and six keys never share a row. Keys carry their label only; the hints drawn are "Or stomp the mat" and "Or step on the mat" (`DRAWN_HINTS`) where the mat does the same thing.

| Screen | Touch | Keys 1 / 2 / 3 / 4 | Mat stomp |
|---|---|---|---|
| Who's defending? | a tile per person in the workout (the mat's person, then people not on a bike, then bike riders), and **Someone else**; key Exit | first four people; Escape / B / down = Exit | |
| Pick the defender (from Someone else) | a tile per household member | Previous / Next / Back / Choose (a cursor on the tiles) | |
| Pick a wave | tap a row; keys Previous, Next, Change defender, Start (locked wave: Locked → admin unlock), then Controls (with a camera) and Exit | same; up = Controls, down = Exit | Start |
| Choose your controls | a tile per method; keys Back and Exit | Previous / Next / Back / Choose (a cursor on the tiles; opened by touch, the first accept only shows the cursor); down does nothing (touch Exit) | nothing |
| Test sweep | Choose another; Try again once a step was not detected; Exit | accept = Try again (and fire on the fire step), back = Choose another; down does nothing (touch Exit) | step or stomp = the fire step |
| Round locked (school day) | Admin unlock, Back, Change defender, Exit | 1 / — / 3 / 4; down = Exit | |
| Ready | Back; Skip with a gamepad connected; Exit | — / — / 3 / 4; down = Exit | |
| Round | **Pause** and **Exit** (solid keys on the street strip, bottom right, where nothing falls); the aim help's **Controls** when it is up | gamepad Start, B, Escape pause; gamepad Select exits | fire |
| Paused | Resume, Sound, End round, Controls (with a camera), Exit | 1 / 2 / 3 / up; down = Exit | |
| Result (once saved) | Replay, Next wave (only when open), Waves, Change defender, Exit (Exit also while saving or unsaved) | 1 / 2 / 3 / 4; down = Exit | next wave after a pass, else Replay |
| Sound | the sheet's own volume strip and Mute; key Back | Quieter / Louder / Back / Mute | |

Start is the Start key or a stomp on the defender's mat (`pressure-mat:stomp`; another mat's stomp is ignored). Until the defender's method has passed its test in this visit, Start opens the setup, where the mat chooses nothing.

**The wave list** is Glider's flight list (`FlightList` in `SkylineMenus.jsx`): a five-row window that follows the cursor, "N more" above and below, each row with a status word — **Done** with the best stars (pixel stars: gold when won, solid ink when not, never faded), **New**, or a pixel lock and **Locked**. Under the list the chosen wave says what tells it apart: the sprite and name of the threat it brings in first, its kill target and its time ("New: Drones · Shoot down 20 · 3:00", `lib/skylineInvaders/waves.js`). The seed waves each bring in a different threat (meteors, then drones, pods, bombers), so they stay separate rows.

**Keys, foot pad, gamepad** (`useMenuInput`; the digits 1–6 are never acted on, the garage kiosk's OS binds them): left = 1, right = 2, Escape/B = 3, Enter/A/any foot-pad key = 4, up = 5 (Controls), down = 6 (Exit). Exceptions: on Who's defending, accept takes the first person, right opens Pick the defender and Escape/B is Exit; on the lock screen accept is Admin unlock; on Paused accept and back resume and up is Controls; on the test sweep accept is Try again, or fire on the fire step; on the Sound sheet accept is Back, so a stray foot-pad press only closes it. While the admin fingerprint prompt is up only Cancel (3, or Escape/B) acts.

**Type.** The whole game, Glider's shared menu windows included, is set in **Press Start 2P** (SIL OFL, `frontend/public/fonts/arcade/`, licence beside it; declared in `SkylineMenus.scss`), the 8-bit face. Nothing is smaller than 22 px on the garage display; titles are a size down from Glider's, since every glyph is a full em wide.

### Sound

Invaders plays at its **own** volume (`useGameVolume('skyline-invaders')`, the track `fitness-game-skyline-invaders/global/game` in the fitness volume store), never the video level and never full gain. The stored value is the output gain itself (curve applied once); an unset track plays at level 60 (0.158). Every voice -- cue files, the music loop, synth tones -- ends on the one output gain of the shared Skyline audio engine, 0 when muted. See `nav/gameVolumeModel.js`.

The **Sound sheet** (the `sound` screen of `InvadersMenus.jsx`, its body the shared `SkylineGlider/GameSoundSheet.jsx`) shows the level, the house touch volume strip (11 keys, 0 = off, no slider), Mute and a Back key. It opens from:

- **Touch:** the "more" button (three dots, a solid 64 × 56 px key) in the bottom-right corner of the Who, Pick the defender, wave list, lock, pause and result screens, on the street and clear of every window and the round HUD; in a round, Pause first, then Sound.
- **Keys, foot pad, gamepad:** Sound on the pause screen; left and right step the level. In the sheet Back has the focus, so a stray foot-pad press only closes it; Escape or B goes back.

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

- Points per kill, times the kill streak: +10% per kill in a row, up to +100%. A threat reaching the ground ends the streak (a shielded one does not). A missed volley costs nothing: a stream fires through empty sky all the time.
- Wrists above the shoulders, held for `armsUpHoldMs` before the volley, multiply a kill's points by 1.5. It is a bonus only.
- `shots_fired` and `hits` in the run record count volleys (one beat of the stream), not single shots. `steps` counts fuel presses and `firing_s` the seconds the stream ran.

## Level file

Schema `skyline-invaders-level/v1`. Levels are household data; nothing is bundled with the app.

```yaml
schema: skyline-invaders-level/v1
id: invaders-1-1              # ^[a-z][a-z0-9-]+$ ; also the progress key
name: First Light
duration_s: 180               # 30..900
pass: { kills: 12, base_hp_min: 0 }    # kills: integer >= 1; base_hp_min: 0..100, default 0
cannons: 1                    # 1 or 2 (2 = one cannon per arm); default 1
max_bombers: 1                # bombers alive at once; default 2. A bomber rolled past the cap spawns as a meteor
spawn_lanes: [1, 6]           # optional: threats spawn only in this run of lanes (0..7); default every lane
fall: { meteor: 50 }          # optional: fall speed by threat type, scene units per second
fire: { fuel_per_step_s: 1.5, fuel_cap_s: 5, stream_interval_s: 0.25, power_per_kill: 0.08, power_per_firing_s: 0.03, idle_drop_s: 8 }   # optional; defaults shown
nuke: { radius: 160, damage: 3 }       # optional: the bomb's blast; these are the defaults
boost: { fill_s: 20, duration_s: 8, min_rpm: 40, full_rpm: 90, rapid_interval_s: 0.125, rotation: [rapid, shield, twin] }   # optional; defaults shown
waves:
  - { at: 0, spawn: { meteor: 1 }, rate_s: 4.5 }
  - { at: 60, spawn: { meteor: 1 }, rate_s: 4.0 }
```

**Waves.** `at` is strictly increasing and before `duration_s`; `rate_s` is at least 0.3. The wave in force spawns one threat every `rate_s` until the next wave's `at`, and each spawn picks a type from `spawn` by weight (`{ meteor: 2, drone: 1 }` is two meteors in three). The lane and the pick come from the round's seed, so what falls depends on the seed and the level only, never on the frame rate or on what was shot down.

**Exact counts.** A wave that ends within one `rate_s` of starting spawns exactly once. The fourth seed level uses this to send exactly two bombers on every seed (`{ at: 60, spawn: { bomber: 1 }, rate_s: 6 }` followed by a wave at 66).

**Reachability.** `validateLevel(raw, { reachability: true })` (the default) plays the level with a bot on the real engine (`simulateBot`). The bot plays the way a child on the mat does:

- it steps for fuel every `botStepIntervalS` (1.0 s) while anything is falling, and the stream does the shooting;
- it re-chooses its lane every `botDecisionS` (1.0 s) and takes `botLaneMoveS` (0.35 s) to cross each lane;
- for `botLaneErrorRate` (40%) of the threats it lines up one lane to the side and never corrects, so a share of what falls gets through;
- it has no partner and never drops a bomb.

The level is played on each of `reachabilitySeeds` (1, 2, 3) and held to the worst of them: it may ask for `reachabilityHitRate` (0.6) of the bot's kills, and for no more skyline than the bot kept, less `reachabilityBaseHpMargin` (15). A level that fails is rejected in the browser, logged as `skyline_invaders.level.invalid` with the reason, and left out of the lobby. The server catalog checks structure only.

The first release's bot never missed, which is how level 1 shipped asking for 18 kills and 40% skyline on full-speed meteors in every lane: about 87% of everything intercepted. `levels.test.js` keeps that level as a case the validator must reject.

`seedLevels.test.js` also plays each seed level on twelve seeds, keeps `pass.kills` at or under 80% of what is reachable and at or under half of what spawns, and requires `base_hp_min: 0` across World 1.

**Authoring a level.** Copy a seed file, change it, add the id to `world.yml`, and load the lobby. A rejected level's reason is in the log line. To check before installing, put the file beside the seed fixtures under `tests/_fixtures/fitness/skyline-invaders/levels/` and run the seed test.

### Seed levels

The tested source is `tests/_fixtures/fitness/skyline-invaders/`; the installed files are copies.

| Level | Introduces | Lanes | Duration | Pass |
|---|---|---|---|---|
| `invaders-1-1` First Light | meteors at fall 50, one every 3.5–4.5 s | middle six | 180 s | 12 kills |
| `invaders-1-2` Zigzag | drones; meteors at fall 60 | middle six | 180 s | 16 kills |
| `invaders-1-3` Split Decision | pods | all eight | 210 s | 22 kills |
| `invaders-1-4` Bomber Run | two bombers, at 60 s and 150 s | all eight | 240 s | 28 kills |

## World order and progression

`world.yml` is `{ levels: [id, …] }`. Levels play in that order; installed levels not named there follow, sorted by id. The first level is always open. Each later level opens when the one before it is completed, or when an admin unlocks it from the lobby (fingerprint prompt). Only a `completed` run counts; `failed` (timer ran out below the pass mark) and `abandoned` (ended early) do not.

Per-rider progress keeps the best completion per level (more stars, then higher score), the levels an admin unlocked, and the rider's controls (`controls: { gesture, at }`). A missing progress file is rebuilt from the run log, which restores the completions. The controls and the admin unlocks are not in the run log: a rider whose file was deleted chooses their controls again (the setup opens on Start either way until a method passes its test).

## Data paths

Relative to the household folder (data) and the media root (sounds):

```text
fitness/skyline-invaders/world.yml                      # level order
fitness/skyline-invaders/levels/*.yml                   # skyline-invaders-level/v1
fitness/skyline-invaders/progress/<riderId>.yml         # skyline-invaders-progress/v1: { completed, unlocked, controls }
fitness/log/skyline-invaders/<date>/<runId>.yml         # skyline-invaders-run/v1, dated by started_at
media: fitness/skyline-invaders/sounds/<slot>.mp3
```

Level files and `world.yml` are read on every request, so an edit shows on the next lobby load with no restart.

Sound slots: `laser`, `missile` (bomb ready), `hit`, `target`, `explosion`, `crash` (the bomb's rumble), `hurt`, `deny`, `boost`, `finish`, `music` (the loop). A missing, empty or undecodable file falls back to the synthesized tone, so the folder ships with empty placeholders. Audio is the Skyline Glider audio engine, at the game's own volume (see Sound).

A run record carries `run` (`id`, `level_id`, `started_at`, `ended_at`, `status`, `duration_s`, `score`, `kills`, `stars`, `base_hp`, `shots_fired`, `hits`, `best_combo`, `bombs`, `boosts_used`, `steps`, `firing_s`, `weapon_peak`, `reward_rings`, optional `fitness_session_id`, `mat_equipment_id`, `partner_id`, `gesture`), `rider.user_id`, and an embedded `gaming-result/v1` block, where a failed round is a completed session with a `loss` outcome. Records saved before this release have `nukes` and no `bombs`, `steps`, `firing_s`, `weapon_peak` or `gesture`.

## API

All under `/api/v1/fitness/skyline-invaders`. Each takes an optional `household`.

| Route | Purpose |
|---|---|
| `GET /levels` | `{ levels }`: every structurally valid level in world order. An empty list means none installed. |
| `GET /world?rider=<id>` | `{ riderId, levels: [{ id, name, status, best? }], next, controls }` with `status` `locked` / `open` / `completed` and `controls` `{ gesture }` or null. Without a rider, the progression a new rider starts from. |
| `POST /progress/:riderId/controls` | Body `{ gesture }`, one of the eight gesture ids. Saves the rider's controls; 400 for an unknown gesture or a bad rider id. |
| `POST /progress/:riderId/unlock` | Body `{ levelId, unlockedBy }`. Admin skip-ahead; the browser collects the fingerprint first. 404 for an unknown level. |
| `POST /runs` | Body `{ record }`. 201 on first save, 200 on an identical resend, 409 on a conflicting record with the same id, 400 on an invalid one. Records the completion in progress. |
| `GET /runs/:runId` | `{ record }` or 404. |

A route answers 503 when its service is not wired. There is no suspension beacon and no resumable checkpoint: a reload ends the round and nothing is saved for a round that was never finalized.

## Access gate

A school learner needs the `fitness.skyline-invaders` entitlement, granted by `school.day-complete` (see [State Gates](../state-gates/README.md)).

**The gate follows the workout, not the pick.** The learners gated are everyone in the fitness session's roster (heart-rate straps) and the mat's person who is known to be a school learner, plus the defender unless known not to be one (`gateLearnerIds` in `lib/skylineInvaders/people.js`). The round opens only when every one of them has the entitlement (`useSkylineGroupAccess` in Skyline Glider's `useSkylineAccess.js`, called with this capability id and the `skyline_invaders` log scope). So a child in the workout who picks a grown-up as the defender still sees the lock.

The defender picker offers the people in the workout (roster and the mat's person); everyone else in the household is behind a press-and-hold on "Someone else".

While locked, the game shows only the lock screen (the `locked` screen of `InvadersMenus.jsx`, Skyline Glider's `denied` pattern): "Round locked — Finish today's school work to unlock." with "School first: <names>" for the learners it waits on, and its keys: Admin unlock (admin fingerprint), Back and Change defender (both open the defender picker). Gamepad A / Enter is Admin unlock, B / Escape is Back. An admin unlock covers the learners in the workout at that moment; anyone new joining asks again. Losing access mid-round ends the round.

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
| `.world.loaded` / `.world.error` | `riderId`, `next`, `gesture` / `error` | |
| `.assets.loaded` / `.assets.error` | `sounds`, `missing: [{ slot, reason }]` | `reason: empty` is a placeholder |
| `.lobby.shooter_picked`, `.lobby.level_chosen` | `shooterId`, `matEquipmentId`, `previous` / `levelId` | |
| `.control.action` | `action`, `screen`, `source` (touch, key, gamepad, step, stomp), `shooterId` | one line per menu press |
| `.lobby.ready_opened`, `.lobby.ready.started`, `.lobby.ready.in_view`, `.lobby.ready.camera_timeout` | `shooterId`, `pose`, `gesture` / `elapsedMs` / `waitedMs` | the Ready screen |
| `.setup.opened` / `.setup.closed` | `setupId`, `from` (`start`, `lobby`, `paused`), `source`, `shooterId`, `current`, `verified`, `pose`, `runId` / `how`, `stage`, `method` | the setup; closed = Back without a pass |
| `.setup.method_chosen` | `setupId`, `shooterId`, `method`, `how`, `previous` | a tile (or the cursor) was chosen: its test starts |
| `.setup.step` | `setupId`, `method`, `step` (`left`, `right`, `fire`), `result` (`passed`, `timeout`), `ms`, `attempt`, `source` (fire), `lost`, `lane` (timeout) | a timeout is logged at warn: the method did not work for this defender |
| `.setup.retry`, `.setup.other` | `setupId`, `method`, `step`, `attempt` / `status` | Try again; Choose another |
| `.setup.passed` | `setupId`, `shooterId`, `method`, `from`, `runId` | all three steps detected (or Gamepad chosen) |
| `.setup.method_changed` | `setupId`, `shooterId`, `method`, `label`, `previous`, `saved`, `error` | the defender's method changed; warn when the save failed (the choice holds for the visit) |
| `.round.aim_help` | `runId`, `levelId`, `kind` (`lost`, `stuck`), `gesture`, `lane`, `time` | the round told the defender the cannon is not following |
| `.pose.camera_ready`, `.pose.camera_unavailable` | `enabled` / `error` | |
| `.pose.state` | `state` (`loading`, `detecting`, `error`, `camera-denied`), `backend`, `modelType`, `error` | on change |
| `.pose.metrics` | `fps`, `latency`, `backend`, `modelType` | sampled while detecting; compare `fps` with `poseMinFps` |
| `.pose.acquired`, `.pose.lost` | `aim`, `lane`, `gesture` | the torso came into or went out of view |
| `.pose.trace`, `.shot.trace` | see "Joint recorder" | batched every 20 s |
| `.fire.armed`, `.fire.no_mat`, `.fire.other_mat` | `matId` / `hasEventBus` / `from` | other_mat is sampled |
| `.level.countdown`, `.level.countdown_cancelled` | `runId`, `levelId`, `shooterId` | |
| `.level.start` | `seed`, `partnerId`, `gesture`, `gestureChosen`, `aimMode`, `lane`, `matId`, `cannons`, `durationS`, `pose`, `poseFps` | the seed replays the round |
| `.fuel` | `source` (`mat`, `keyboard`, `gamepad`), `fuel`, `lane`, `time` | one per step, sampled, 30 a minute |
| `.mat.press_to_fuel_ms` | `ms` | sampled; app event to the engine, not foot to screen |
| `.round.weapon.level`, `.round.bomb.ready`, `.round.bomb`, `.round.boost.activated`, `.round.base.hit` and other `.round.<engine event>` | the event's data | per-volley and per-threat events are not logged |
| `.round.paused` / `.round.resumed` | `reason` (`player`, `lifecycle`, `hidden`), `time` / `how`, `pausedBy` | |
| `.round.session_ended`, `.access.revoked` | `phase`, `state` | the round was ended from outside |
| `.exit` | `phase`, `how` (`touch`, `key`, `gamepad`), `runId`, `levelId`, `shooterId`, `round`, `time` | the game was closed |
| `.effect.executed` / `.skipped` / `.failed` | `eventType`, `effectId`, `reason` | sampled |
| `.render.health` | `frames`, `longFrames`, `fps`, `windowMs`, `pose`, `poseFps`, `poseLatency`, `threats`, `shots` | every 20 s of play |
| `.frame.error` | `error` | sampled; the round continues |
| `.level.end` | `status`, `score`, `stars`, `kills`, `baseHp`, `shots`, `hits`, `bestCombo`, `bombs`, `boosts`, `steps`, `firingS`, `weaponPeak`, `durationS`, `seed`, `gesture`, `aimMode`, `tally` | `tally` counts steps by source, stomps, and volleys by `stream` / `rapid` |
| `.round.saved` / `.round.save_error` | `status`, `retried` / `error` | |
| `.reward.awarded` / `.reward.skipped` | `rings`, `stars` / `reason` | |
| `.boost.partner` | partner bike and rider, `when` | |
| `.audio.volume` | `level`, `muted`, `isDefault`, `output` | on mount and every change; `output` is the gain every voice ends on |
| `.settings.opened` / `.settings.closed` | `phase`, `source` (`touch`, `pause-menu`, `bike`) / `level`, `muted` | the Sound sheet |
| `.audio.level_set` / `.audio.mute_toggled` | `level` / `muted`, `control` (`touch`, `sheet`, `bike`) | |
| `.access.verdict` | `learners`, `status`, `state`, `unlocked`, `blockedBy` | one line per change of verdict |
| `.access.read_failed`, `.access.override_requested` / `_granted` / `_denied`, `.access.locked_choice` | `riderId`, `learners`, `reason`, `adminUserId` / `choice` | |
| `.progress.unlock_requested` / `_granted` / `_denied` / `_error` | `riderId`, `levelId`, `adminUserId`, `reason`, `error` | |

Server (`fitness.skyline_invaders.*`): `level.invalid` (`file`, `id`), `run.saved`, `progress.rebuilt` (`riderId`, `completed`), `progress.unlocked`, `progress.controls` (`riderId`, `gesture`), `progress.record_failed`.

## Joint recorder

`lib/skylineInvaders/traceRecorder.js` records what the camera saw and what every gesture made of it, so the gestures can be compared from data. Two events, both batched: one batch every `traceBatchMs` (20 s), because the log ingest allows each event name a burst of 30 and then 3 a minute per client. Rows are arrays of integers (null = no value) under one header per batch. A round flushes its last batch when it ends or is left; a pose batch is about 60 KB of JSON.

Both events carry the header `kind` (`round` or `tryout`, a test sweep), `runId` (the round's id, or the setup's `setupId`), `levelId`, `shooterId`, `gesture` (the one driving the cannon), `gestureKind`, `hz`, `seq` (batch number within the run), `t0` (epoch ms of the first row), `n`, `cols`, `rows` and `reason` (`interval`, `round-end`, `abandoned`, `begin`, `tryout-chosen`, `tryout-closed`, `unmount`). Tryout batches add `card` (the gesture's index, 0–7), and round batches add `seed`. A sweep's batch ends with `tryout-chosen` when it passed and `tryout-closed` when the defender chose another or went back. A sweep opened from a paused round is not recorded: the round's own trace stays open across it.

### `skyline_invaders.pose.trace`

`traceHz` (10) rows a second. Columns, in order (`POSE_TRACE_COLS`):

| Columns | Meaning |
|---|---|
| `dt` | ms since the batch's `t0` |
| `k<i>x`, `k<i>y`, `k<i>s` for i in 11–16, 19, 20, 23, 24 | image keypoint: px, px, score ×100 (shoulders, elbows, wrists, index fingers, hips) |
| `w<i>x`, `w<i>y`, `w<i>z` for i in 11–16 | world keypoint (`keypoints3D`): mm |
| `wiper`, `twist`, `wings`, `wheel`, `sprinkler`, `offset` | that gesture's aim ×1000 for this frame (0 = screen left); null where it would hold |
| `dragVel` | drag's cannon speed, screens/s ×1000 |
| `pushVel` | the faster wrist's sideways speed, shoulder widths/s ×100 |
| `pushStroke` | 1 when a push stroke began since the last row |
| `hop` | −1 or 1 when a hop triggered since the last row, else 0 |
| `roll`, `span` | wrist-to-wrist line: roll in degrees ×10, wrist spacing in shoulder widths ×100 |
| `yaw`, `azimuth` | torso yaw and hand azimuth, degrees ×10 |
| `lean` | shoulder midpoint against hip midpoint, shoulder widths ×100; no gesture uses it |
| `raw`, `lane`, `cannonX` | the cannon: raw aim ×1000, lane 0–7, drawn x in scene units |
| `lost` | 1 = no torso in view |
| `armL`, `armR` | arm state: 0 ok, 1 down, 2 low score, 3 missing, 4 no body |
| `target` | test sweep only: 1 while the left edge is the step in hand, 3 for the right edge, else 0 |
| `step` | 1 when the defender stepped (or stomped) on the mat since the last row |

Every gesture's signal is computed from every frame, whichever gesture is active. Push strokes, hops and mat steps that fall between two rows are written on the next row.

### `skyline_invaders.shot.trace`

One row per volley, written when the volley settles. Columns (`SHOT_TRACE_COLS`): `t` (ms since the batch's `t0`), `lane`, `aim` (raw aim ×1000), `x` (cannon x), `tx`, `ty` (the nearest threat in x, bombs aside; null with an empty sky), `miss` (`tx − x`, signed: positive means the threat was to the right), `hit` (1, 0, or null when the round ended with the volley in the air), `weapon` (0 single, 1 double, 2 spread).

### `skyline_invaders.setup.step`

One per step of a test sweep, passed or timed out. `ms` is how long after the step opened it was detected (or how long the defender tried before it timed out). A method whose `left` or `right` step times out for a defender is one that does not work for them as they do it; the matching `tryout` pose batch (its `runId` is the `setupId`) shows what every gesture made of their movement meanwhile.

### Analyzing a session

Pull the events for a day, then feed them to the script. `{env.log_store_url}` is in `CLAUDE.local.md`. The script expects the store's flattened rows (`data.rows`, `data.cols` and the rest as `data.*` fields, with arrays as JSON text); it has been run on synthetic batches from the real recorder, not yet on rows from the store.

```bash
for e in pose.trace shot.trace setup.step level.end; do
  curl -s {env.log_store_url}/select/logsql/query \
    -d "query=\"skyline_invaders.$e\" AND _time:24h" -d 'limit=5000' > "si-$e.jsonl"
done
python3 si_traces.py si-pose.trace.jsonl si-shot.trace.jsonl si-setup.step.jsonl
```

```python
# si_traces.py: per-gesture stats from Skyline Invaders traces.
import json, statistics as st, sys
from collections import defaultdict

def load(path):
    out = []
    for line in open(path):
        if not line.strip(): continue
        e = json.loads(line)
        d = {k[5:]: v for k, v in e.items() if k.startswith('data.')}   # the store flattens data.*
        for k in ('cols', 'rows', 'visits'):                            # arrays and objects arrive as JSON text
            if isinstance(d.get(k), str): d[k] = json.loads(d[k])
        out.append(d)
    return out

def table(batch):
    c = {name: i for i, name in enumerate(batch['cols'])}
    return [{name: row[i] for name, i in c.items()} for row in batch['rows']]

def pct(xs, p):
    xs = sorted(xs); return xs[min(len(xs) - 1, int(p / 100 * len(xs)))] if xs else None

AIMS = ['wiper', 'twist', 'wings', 'wheel', 'sprinkler', 'offset']
pose, shots, steps = (load(p) for p in sys.argv[1:4])

# 1. Round play: every gesture's signal is in every row, so one round compares them all.
noise, reach, held = defaultdict(list), defaultdict(list), defaultdict(lambda: [0, 0])
for b in (b for b in pose if b.get('kind') == 'round'):
    rows = table(b)
    for g in AIMS:
        vals = [r[g] for r in rows]
        for r in rows:
            held[g][0] += r[g] is None; held[g][1] += 1
        ok = [v / 1000 for v in vals if v is not None]
        reach[g] += ok
        # still-noise: spread of the signal over each second in which the cannon did not change lane
        for i in range(0, len(rows) - 10, 10):
            w = rows[i:i + 10]
            if len({r['lane'] for r in w}) == 1 and all(r[g] is not None for r in w):
                noise[g].append(st.pstdev(r[g] / 1000 for r in w))
print('ROUND PLAY, per gesture signal (aim 0..1)')
for g in AIMS:
    if not reach[g]: continue
    edge = sum(v <= 0.0625 or v >= 0.9375 for v in reach[g]) / len(reach[g])
    print(f'  {g:10s} still-noise p50 {pct(noise[g], 50):.3f} p90 {pct(noise[g], 90):.3f}  '
          f'range p5 {pct(reach[g], 5):.2f} p95 {pct(reach[g], 95):.2f}  time in edge lanes {edge:.0%}  held {held[g][0] / held[g][1]:.0%}')

# 2. Step throw: how far each gesture's signal moves in the 300 ms after a mat step, against where it
#    was 200 ms before. A quarter of a lane (0.031) is what the lane hysteresis absorbs.
throw = defaultdict(list)
for b in (b for b in pose if b.get('kind') == 'round'):
    rows = table(b)
    for i, r in enumerate(rows):
        if not r['step'] or i < 2 or i + 3 >= len(rows): continue
        for g in AIMS:
            before, after = rows[i - 2][g], [rows[j][g] for j in range(i, i + 4)]
            if before is None or any(v is None for v in after): continue
            throw[g].append(max(abs(v - before) for v in after) / 1000)
print('STEP THROW, per gesture signal: aim moved by a mat step')
for g in AIMS:
    if throw[g]:
        print(f'  {g:10s} steps {len(throw[g])}  p50 {pct(throw[g], 50):.3f} p90 {pct(throw[g], 90):.3f}  over a quarter lane {sum(v > 0.031 for v in throw[g]) / len(throw[g]):.0%}')

# 3. Shots: hit rate and miss distribution, by the gesture that was driving.
by = defaultdict(list)
for b in shots:
    by[b['gesture']] += [r for r in table(b) if r['hit'] is not None]
print('SHOTS, by active gesture')
for g, rows in by.items():
    aimed = [r for r in rows if r['miss'] is not None]
    miss = [r['miss'] for r in aimed if not r['hit']]
    lanes = [round(m / 110) for m in miss]
    print(f'  {g:10s} volleys {len(rows)}  hit {sum(r["hit"] for r in rows) / len(rows):.0%}  '
          f'miss p50 |{pct([abs(m) for m in miss], 50)}| units  one lane off {sum(abs(l) == 1 for l in lanes) / max(1, len(lanes)):.0%}  '
          f'left/right of target {sum(m > 0 for m in miss)}/{sum(m < 0 for m in miss)}  '
          f'edge-lane volleys {sum(r["lane"] in (0, 7) for r in rows) / len(rows):.0%}')

# 4. Test sweeps: the same left / right / fire task for every method.
print('TEST SWEEPS, per method: steps passed / timed out, time to pass (ms)')
by = defaultdict(list)
for t in steps: by[t['method']].append(t)
for g, ts in by.items():
    line = f'  {g:10s}'
    for side in ('left', 'right', 'fire'):
        got = [int(t['ms']) for t in ts if t['step'] == side and t['result'] == 'passed']
        out = sum(1 for t in ts if t['step'] == side and t['result'] == 'timeout')
        line += f'  {side} {len(got)} ok / {out} timeout p50 {pct(got, 50)}'
    print(line)

# 5. Sweep traces: steadiness on an edge and overshoot.
#    steadiness = spread of the raw aim while the cannon is on a target;
#    overshoot  = how far past the target lane's centre the raw aim went on the way in.
CENTRE = {1: 0.0625, 3: 0.9375}
steady, over = defaultdict(list), defaultdict(list)
for b in (b for b in pose if b.get('kind') == 'tryout'):
    rows = table(b)
    i = 0
    while i < len(rows):
        t = rows[i]['target']
        if not t: i += 1; continue
        j = i
        while j < len(rows) and rows[j]['target'] == t: j += 1
        raw = [r['raw'] / 1000 for r in rows[i:j] if r['raw'] is not None]
        if len(raw) >= 5:
            steady[b['gesture']].append(st.pstdev(raw))
            past = max((v - CENTRE[t]) * (1 if t == 3 else -1) for v in raw)
            over[b['gesture']].append(max(0, past))
        i = j
print('SWEEP TRACES, per gesture: raw aim while an edge is the step in hand')
for g in steady:
    print(f'  {g:10s} visits {len(steady[g])}  steadiness (sd) p50 {pct(steady[g], 50):.3f}  overshoot p50 {pct(over[g], 50):.3f} p90 {pct(over[g], 90):.3f}')
```

What the numbers mean. **Still-noise** is the spread of a gesture's signal over a second in which the cannon held its lane; a lane is 0.125 wide, so a noise of 0.03 crosses the 25% hysteresis now and then. **Step throw** is how far a signal jumps when the foot comes down; over a quarter lane it can move the cannon, which is what `stepLaneFreezeMs` is there to cover. **Range** and **time in edge lanes** say whether a gesture reaches lanes 0 and 7. **Held** is the share of frames the gesture could not be read. For `drag`, `push` and `hop` there is no aim column: compare them by the shot table, the sweep times and the cannon's `raw` in their own rounds. Overshoot at an edge is clipped by the screen edge, so it says more about how a gesture settles than about its reach.

## Tunables

`lib/skylineInvaders/tunables.js` is the one place these live. The pose and mat numbers come from the Phase 0 garage spike; the gesture, lane, fuel and power numbers are first guesses from the 2026-11-12 play session, and the traces exist to replace them with measured values. `fire:` in a level file overrides the fuel and power numbers for that level.

| Key | Value | Meaning |
|---|---|---|
| `poseModelType` | `full` | BlazePose model |
| `poseBackend` | `null` | detector default |
| `poseMinFps` | 20 | logged against, not enforced |
| `keypointMinScore` | 0.3 | below this a keypoint is not used |
| `poseLostAfterMs` | 800 | no torso for this long = lost |
| `armsUpHoldMs` | 300 | hold before the arms-up bonus counts |
| `aimSmoothingMs` | 120 | time constant of the aim filter (`aim` gestures) |
| `defaultGesture` | `wiper` | played with when a defender has not picked one |
| `wiperMaxDeg`, `wiperMinForearmSw` | 50, 0.3 | wiper: edge angle; shortest usable forearm |
| `twistMaxDeg`, `twistSign` | 35, −1 | twist: edge angle; sign of yaw that is a right turn |
| `wingsMaxDeg`, `wingsMinSpanSw` | 30, 1.5 | wings: edge angle; least wrist spacing |
| `wheelMaxDeg`, `wheelMinSpanSw`, `wheelMaxSpanSw` | 45, 0.25, 1.5 | wheel: edge angle; wrist spacing range |
| `sprinklerMaxDeg`, `sprinklerMinReachSw` | 40, 0.5 | sprinkler: edge angle; least reach from the chest |
| `dragDeadZoneSw`, `dragFullSw`, `dragMaxSpeed` | 0.3, 1.0, 0.8 | drag: dead zone, full deflection, full speed (screens/s) |
| `pushMinSpeedSw`, `pushGain`, `pushMaxSpeed` | 2.0, 0.3, 2.5 | push: stroke threshold, screens per shoulder width, speed cap |
| `pushFrictionMs`, `pushSettleSpeed`, `pushCooldownMs` | 220, 0.08, 250 | push: glide time constant, stop speed, return-stroke cooldown |
| `hopRaiseDropSw`, `hopLowerDropSw` | 0.15, 0.5 | hop: raised; lowered enough to re-arm |
| `hopReachSw`, `hopReachReleaseSw`, `hopRefractoryMs` | 1.3, 0.9, 350 | hop: reached; back in enough to re-arm; least time between hops |
| `offsetReachSw`, `offsetDownRatio` | 1.2, 1.1 | offset (trace only): edge offset; a wrist this far below its shoulder is hanging (also drag, push, hop) |
| `lanes`, `laneHysteresis`, `stepLaneFreezeMs` | 8, 0.25, 150 | lanes: count; share of a lane to cross before moving; lane hold after a mat step |
| `fuelPerStepS`, `fuelCapS`, `streamIntervalS` | 1.5, 5, 0.25 | fuel per step; tank; seconds between volleys |
| `powerPerKill`, `powerPerFiringS`, `weaponIdleDropS` | 0.08, 0.03, 8 | power meter per kill and per second of firing; idle time that costs a level |
| `botStepIntervalS`, `botDecisionS`, `botLaneErrorRate`, `botLaneMoveS` | 1.0, 1.0, 0.4, 0.35 | reachability bot |
| `reachabilitySeeds`, `reachabilityHitRate`, `reachabilityBaseHpMargin` | [1, 2, 3], 0.6, 15 | reachability check |
| `setupHoldMs`, `setupStepTimeoutS`, `setupPassedMs` | 400, 15, 1500 | test sweep: rest on an edge that counts; seconds before a step is "Not detected"; how long "It works!" stays up |
| `aimHelpLostS`, `aimHelpStuckS` | 3, 12 | aim help in a round: seconds out of view, or in one lane while in view, before the strip offers Controls |
| `traceHz`, `traceBatchMs` | 10, 20000 | joint recorder |

The spike widget stays registered as the re-measurement tool: `/fitness/module/skyline_invaders_spike` (`widgets/SkylineInvadersSpike/`, events `skyline_invaders.spike.*`). It measures the old offset aim and one-step-one-shot firing; the pose-rate and mat-rate tests still apply.

## Art

Threats, the cannon and buildings are original 11 × 8 pixel grids in `lib/skylineInvaders/sprites.js`, drawn by the shared `PixelSprite` renderer in the gaming capability. Colours are the `--si-*` tokens on `.skyline-invaders`.

## Troubleshooting

**"No levels installed."** `GET /levels` returned none. Check that `fitness/skyline-invaders/levels/` exists in the household folder the app reads and that each file passes the structural check (server log `fitness.skyline_invaders.level.invalid`).

**A level is missing from the lobby.** The browser validator rejected it. Look for `skyline_invaders.level.invalid`; the `errors` field says whether it is structure or reachability ("pass.kills 40 is not reachable at one shot per 1s: at most 34").

**Pose is slow (around 13 fps).** A page served without cross-origin isolation runs the pose model single-threaded. The TF.js WASM backend needs `SharedArrayBuffer` for its threads, and the browser grants that only when the document response carries `Cross-Origin-Opener-Policy: same-origin` and `Cross-Origin-Embedder-Policy: credentialless`. The app and the dev server set both, but anything that serves the page another way (a proxy that rewrites headers, a static host, a test harness) may not. This was the Phase 0 lesson: without isolation the lite and the full model both ran at about 13 fps, so the limit was the single-threaded CPU backend, not the model size. Check `self.crossOriginIsolated` in the kiosk's console (it must be `true`), then `skyline_invaders.pose.metrics` for `fps` and `backend`. The engine is frame-rate independent and plays the same at 13 Hz aim; the cannon is only less smooth.

**Stepping does nothing.** `skyline_invaders.fire.no_mat` means no mat hardware id reached the game; `fire.other_mat` means steps are arriving from a mat that is not the defender's. Pick the defender on the right mat. The first `fire.armed` line names the mat in use, and each step that counts logs `skyline_invaders.fuel`.

**The weapon keeps dropping back to Single.** The stream was idle for `weaponIdleDropS`. `level.end` records `steps`, `firingS` and `weaponPeak`.

**The cannon will not follow.** `level.start` records `gesture`, `gestureChosen` and `aimMode`. `aimMode: manual` means the camera had not seen a torso when the round began. If the HUD says "Step into view", both shoulders are under `keypointMinScore`. If neither, the gesture is holding: its signal could not be read (the `held` share in the trace analysis). `twist` and `sprinkler` hold on every frame when the pose carries no `keypoints3D`.

**Twist steers the wrong way.** Flip `twistSign` in `tunables.js` (see the sign convention under Aim).

**The setup opens on Start every visit.** By design: a method is tested once per visit (each time the game is opened), so a defender always proves their controls before the first round. Their saved method is ringed "Yours" and is one tap away. If it is not marked, their progress file has no `controls` (it was deleted and rebuilt from the run log), or the save failed (`skyline_invaders.setup.method_changed` at warn).

**Gestures are ignored in a round.** Look for `skyline_invaders.setup.step` with `result: timeout` (the method did not work in the sweep) and `skyline_invaders.round.aim_help` (`stuck`: in view, cannon not moving; `lost`: out of view). `level.start` names the `gesture` and `aimMode`; `aimMode: manual` with a gesture method means the camera never saw the defender.

**The volume did not stay.** The level lives in the kiosk browser's `localStorage` (the fitness volume store, key `volume:fitness:fitness-game-skyline-invaders:global:game`), so it is per screen, not per person, and a cleared Firefox profile starts again at 60. `skyline_invaders.audio.volume` on mount says what was read (`isDefault: false` = a stored level). Checked 2026-11-13 on the garage display: set to 70 at 23:10 UTC, read 70 after four later page loads; set to 20 at 06:42, read 20 on the next mount.

**The boost meter is missing.** No partner: no connected bike with a rider other than the defender (`skyline_invaders.boost.partner` logs when one is found).

**A round did not save.** The result screen holds on "Retry save" and logs `round.save_error`. A 409 means a different record already has that run id.

## Not verified live

The game is covered by unit and widget tests and by backend-free screenshots of the shell (`tests/_scratch/shoot-skyline-invaders*.mjs`, which stub the audio and mute the browser). Nothing in this release has been played on the garage display. The first live check after a deploy: the wave list shows the four waves, Start opens Choose your controls, the test sweep ticks left, right and a stomp only when each is done (and says Not detected for a method that does not follow), Ready passes when they stand in view, the round's Exit key leaves, Controls on the pause screen changes the method, a step starts the stream, a stomp drops a ready bomb, Exit returns to the Fitness menu, `pose.trace` and `shot.trace` batches arrive in the log store, and a finished round appears under `fitness/log/skyline-invaders/`.

Open questions that only the garage can answer: the sign of `twist`, whether `keypoints3D` wrist depth is steady enough for `sprinkler`, whether the mat classifies a deliberate stomp reliably enough to be the "pick" and "bomb" input, and whether a 60 KB trace event every 20 s is within what the log store accepts per line.
