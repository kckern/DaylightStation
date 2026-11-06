# Skyline Glider

Skyline Glider is a single-rider Fitness game in which cadence controls a hang glider's target altitude. It is registered as `fitness:skyline-glider` and opens at `/fitness/module/skyline_glider`.

## Play contract

- Identify with your configured rider button, then use the visible 2×2 bike panel to choose a flight and Start/Resume. Every menu and result uses the same four physical positions; touch is equivalent. Start waits for fresh cadence at least 30 RPM for 1.2 seconds, followed by a three-second countdown. Waiting at zero is safe; falling below 30 before takeoff resets readiness.
- The selector and equipment are captured before assignment ingestion. Navigation and all four flight buttons keep the selected rider locked; another bike continues normal assignment. Change rider is explicit. Identity uses configured avatars and shortcuts; unmapped hold/double opens Other riders. TS0044_2 publishes hold, normalized to configured long shortcuts (including button 2 for Dad).
- School learners may fly only when the fail-closed `fitness.skyline-glider` entitlement grants access from `school.day-complete`. The Fitness roster derives `schoolLearner` from the same authoritative School learner directory used by the other school-gated surfaces. Missing identity, Guest, unavailable, expired or indeterminate state all stay locked; household members marked `schoolLearner: false` are outside this gate. The client honors the decision's `validFrom`/`validUntil` window and suspends an active countdown or flight immediately when access is revoked, preserving a resumable checkpoint and releasing the bike for another rider.
- An admin fingerprint can approve a pending physical-button start. The admin authorizes the flight but does not become its rider or reward recipient.
- Localhost and `127.0.0.1` deep links retain touchscreen Start/Resume controls for development. A non-local deep link still enters the gated kiosk lobby.
- Act `rpm: { min, max }` takes precedence over equipment `skyline_glider.rpm`, then equipment `rpm`, then the 30–100 fallback. Both bundled acts use 30–130 RPM without changing shared calibration. Positive readings below the low endpoint still count as pedaling.
- Faster cadence climbs and slower cadence descends: 30 RPM targets the lowest safe height and 130 RPM the ceiling. Positive readings below 30 RPM remain at the lowest height. A fresh, connected **zero RPM immediately latches an unrecoverable stall in every act**, including the introductory open sky. The glider falls into terrain/lava or off the bottom of the scene and crashes, then returns to its checkpoint. Resuming pedaling, hillside assistance or a subsequent sensor outage cannot cancel that attempt’s stall. Missing or stale transport before the stall remains protected and cannot itself trigger one.
- The ANT bridge allows one expected crank interval plus 25% tolerance, bounded between 5 and 6 seconds, before reporting a stop. At 15 RPM this is 5 seconds plus packet delay; once the bridge reports a genuine zero there is no additional in-game coast/recovery grace. A once-per-turn sensor cannot promptly distinguish 1 RPM from stopping.
- A missing or stalled cadence transport is collision-protected for 0.75 seconds, then freezes the course behind a reconnect overlay.
- **Assisted hills:** Mountain Pass carries a low craft along the hillside without damage. Its first minute is open sky and bells; the whole act has no lava, lethal obstacles or weapons.
- **Terrain and `solid` entities are walls outside assistance.** Touching one is an immediate crash ("Wing down!"), invincible or not: the rider then chooses Retry checkpoint, Restart level, Flights or Change rider using the panel. Retry restores the latest checkpoint with three lives and waits for pedaling before takeoff. The craft can never pass through the ground. Only a sensor pause protects the rider, and then the craft is held inside the open band.
- **`breakable` entities** (trees, houses) shatter on contact and cost one life, followed by `invincibility_s` of blinking. Hits while blinking still shatter but cost nothing. Losing the last life is a crash. A checkpoint restart brings back anything broken after that checkpoint.
- **`scenery` entities** never collide.
- Mountain Pass (Alpine, Act 1) lasts five minutes, moving from open-sky bells to assisted meadow hills. Cloud Ridge (Alpine, Act 2) lasts four minutes and plays as an obstacle course: target practice, bunkers and a tower to bomb on the ground, a cracked wall only a missile breaks, a steel gate with a gap to fly through, and a gate whose shutter closes unless the rider boosts through, with lava gaps and distinct dusk scenery.
- Game score is unique bells plus weapon-destroyed targets; crash destruction earns no target point. Completion ring rewards remain based on bells.
- Completion awards 10 rings plus one per unique collectible, capped at 30. Normal heart-rate rings continue independently.

## Loop and effects

The simulation and its plumbing come from the gaming [real-time kit](../gaming/realtime-kit.md). `stepFlight` is sub-stepped by the kit's `advance` (1/60 s steps, last step partial). The flight loop is a kit `createFrameDriver` with frames capped at 0.1 s; a frame that throws is logged as `skyline_glider.frame.error` and the flight continues. Flight events (sounds, toasts) go through the kit's `createEffectDispatcher`, which keeps the `skyline_glider.effect.executed`, `.skipped` and `.failed` names and their `effectId` field. Once a flight is saved the game calls `announceGameAchievement`, so the gem ceremony looks at once.

## Weapons

During flight, top-left fires laser, top-right drops a bomb, bottom-left launches a guided missile and bottom-right boosts the craft forward. The 2×2 panel is not drawn during flight; the HUD bar across the top shows hearts, time remaining, bells, targets and (when above 1×) heart-rate power on the left, and a 2×2 legend of the four actions on the right in their physical positions, each with its ammunition or recharge. Every press flashes its legend cell: green when it fires, red with the reason (`Reloading`, `Empty`, `Charging`, `Wait`) plus a short deny tone when it does not, logged as `skyline_glider.input.refused` (`action`, `reason`). Holding bottom-right opens a labeled menu for Resume, Sound, End flight and Change rider. The menu freezes simulation; resuming requires pedal readiness and preserves ammunition. A committed stall completes before the menu can open. Sensor loss still permits ending the flight. No attack or menu input reassigns the rider.

| Input | Laser | Bomb | Missile | Boost |
|---|---|---|---|---|
| Bike 2×2 panel | Top-left (1) | Top-right (2) | Bottom-left (3) | Bottom-right (4) |
| Gamepad standard indexes | A (0) / RT (7) | B (1) / X (2) / LT (6) | LB (4) | Y (3) |
| Keyboard | Space / F | B | M | V |
| Step mat (a partner) | — | Stomp | — | — |

**The step mat is the partner's bomb button.** While a flight is armed, every classified stomp on any step mat (`pressure-mat:stomp` on the fitness app event bus, see [`pressureMat`](../../../__app_modules/wellness/fitness/browser/context/fitnessPressureMat.js)) drops a bomb from the same rack, logged as `skyline_glider.input.fire` with `source: stomp-mat` plus `skyline_glider.stomp_mat.bomb`. Ordinary steps do nothing, so someone walking past never fires. Stomps outside a flight are ignored. How hard a press must be to count as a stomp is the mat's `stomp_gradient_vps` threshold, live-tunable on the mat.

Numeric keys 1–4 operate the current panel; Escape opens the flight menu. Existing text-entry and browser shortcuts retain their meaning.

On the garage's 8BitDo SFC30 (standard mapping in Firefox), that is the bottom face button (printed **B**) or **R** for the laser, and the right face button (printed **A**), **Y** or **L** for a bomb. The pad's letters follow the SNES layout, so they are swapped against the Xbox names above.

- Each press fires once; holding does not autofire. A button already held when flight starts is ignored until released. A press on a frame where no time passes waits for the next frame. Presses during a sensor pause or crash are dropped.
- **Laser:** leaves the craft nose at the craft's altitude (entity boxes count as `laser_aim`, default 0.045, taller for it, so a shot a hair off a target lands; terrain stays exact) and travels `laser_speed_s` course-seconds per second faster than the craft, until it leaves the right edge of the screen (measured from the camera, so a boosted craft does not shoot further); a course may shorten that with `laser_range_s`. Each step sweeps its whole path, so thin objects cannot be skipped. It stops at the first terrain or non-scenery entity it reaches, destroying that entity if it is vulnerable to the laser and being absorbed otherwise. It is unlimited, with a `laser_cooldown_s` cooldown.
- **Bomb:** bombs go *down*. Their targets sit on the ground below the lowest the craft can fly (bunkers), or rise into the low flight band (a tower the rider can fly over or bomb from above). Released under the craft, it keeps pace with the craft while falling under `bomb_gravity`. It detonates on terrain, a non-scenery entity, or the bottom of the screen. The blast (`blast_width_s` × `blast_height`, visible for `blast_s`) destroys every entity it touches that is vulnerable to bombs. The rack holds `bombs` and refills at every checkpoint crossed and on restart.
- **Missile:** three per checkpoint, with a 0.8-second cooldown. Like the laser it flies until it leaves the right edge of the screen (`missile_range_s` may shorten that). Locks the nearest on-screen missile-vulnerable entity, not hidden behind a wall it cannot break, that it can still turn onto (else the nearest one), and re-acquires when that one is destroyed or passed. It steers onto the target's vertical centre by intercept: the turn rate rises from `missile_turn_rate` to whatever reaching the centre in time needs, capped at `missile_max_turn_rate` (2.5/s), with `missile_aim` (0.04) tolerance. Launches without a target still consume ammunition. Cannot damage bomb-only barriers. A cracked wall (`required_weapon: missile`) is the missile's job: lasers spark off it and flying into it crashes.
- **Boost:** a dash across the screen. The camera keeps scrolling at 1×; the craft surges `offset_s` (2.8, about 200 of the scene's 1000 units) course-seconds ahead of its anchor over `surge_s` (0.5), holds there until `duration_s` (1.6), then drifts back over `return_s` (5). The drift is never faster than the scroll (`return_s` is raised to at least 1.5 × `offset_s` / 0.9), so the craft never moves backwards along the course into something it just passed. `courseTime` is the craft's position; the camera is `courseTime − boostOffset` (`cameraTime` in `liftBoost.js`), and the scene, the screen edge for shots and shutters all read the camera. A laser or missile keeps the craft's course speed from the moment it leaves the nose (never below 1×), so one fired mid-dash is not overtaken and one already downrange does not lurch; a bomb falls in the world's frame and lands where the ground was under the craft. Eight seconds recharge from activation; crossing a checkpoint clears the recharge, and so does a shutter starting its warning (so a press made too early is never fatal), and a boost fired mid-drift surges on from where the craft already is. A sensor dropout freezes the dash where it is. Pressing boost while boosting shows "Boosting" without the deny tone. It does not cancel a stall or grant immunity; a checkpoint retry puts the craft back on its anchor. The boost's use is the **shutter gate** (below): only a craft dashed ahead gets through before it closes.
- **Impacts:** every shot that lands leaves a short-lived (`impact_s`, 0.35 s) record in `impacts` with `effect` `damage` (a hit that did not kill: the entity flashes white and a high tick plays), `kill` (a burst and a floating "+1", `target` cue) or `absorbed` (a grey puff and the deny tone, for an entity that weapon cannot hurt). A shot into terrain simply ends, with no impact. Each is logged as `skyline_glider.flight.weapon.hit` (`shotId`, `weapon`, `effect`, `entityId`, `damage`, `hitPoints`).
- **Heart-rate power:** the locked rider’s trusted, eligible zone profile, at most ten seconds old, sets basic/warm/hot/fire damage to 1/2/3/4. Cool, active, missing, stale and unknown zones use basic power. Each shot snapshots its power. Bomb blast dimensions scale by 1/1.25/1.5/1.75. A monitor is optional; conserved basic bombs can clear mandatory barriers. More physical resistance can raise effort without changing cadence/altitude.
- **Vulnerability** defaults by class: `breakable` → laser, bomb and missile, `solid` → bomb only, `scenery` → nothing. An entity definition or placement can set `vulnerable_to: [laser, bomb, missile]` (or `[]`). A destroyed solid stops being a wall.
- **Role** tells the rider what to do with an entity and drives its marking: `shoot` draws pulsing crosshair brackets and, for `hit_points` above 1, health pips that empty as it is damaged; `bomb` (also inferred from `required_weapon: bomb`) labels it "BOMB ↓"; `missile` (also inferred from `required_weapon: missile`) labels it "MISSILE →"; `avoid` and `scenery` add nothing. A shutter is marked separately: its gap edges blink red and "BOOST »" shows above the gap for the 3 s before it closes. Set `role` on a zone entity definition or a placement. Only `shoot`, `bomb` and `missile` entities score as targets (HUD ◎, the "+1", the `target` cue and the saved `targets`); breaking an `avoid` entity just shatters it. Courses with no roles keep the older rule that any weapon kill scores. An unarmed act (`weapons.enabled: false`) shows `shoot` entities as `avoid`, since nothing there can be shot.
- A crash clears shots and blasts in flight. A checkpoint restart restores what was destroyed at that checkpoint, as it does for crash-broken breakables.
- Kills are recorded per entity as `laser`, `bomb`, `missile` or `crash`. The run saves `targets` (laser, bomb and missile kills), `shots_fired`, `bombs_dropped`, `missiles_fired` and `boosts_used` on `run` and in `result.metrics`. `targets` counts kills on the final run-through: a checkpoint restart rolls it back along with the destroyed entities, as it does collectibles. The shot counters are cumulative across restarts, like `collisions`. Game score adds weapon targets to bells; reward rings do not change. Positive integer `hit_points` supports tougher targets. Partial target damage persists and rolls back with checkpoints.
- Fire keys are ignored with Ctrl, Cmd or Alt held and while typing in a field. A fire key never also activates a focused on-screen button.

`rules.weapons` in an act overrides the defaults. Every field except `enabled` must be a non-negative number:

```yaml
rules:
  weapons:
    enabled: true          # false removes weapons from this act
    laser_cooldown_s: 0.3
    laser_speed_s: 3
    laser_range_s: 7       # optional cap; unset = fly to the screen edge
    bombs: 5
    bomb_cooldown_s: 0.8
    bomb_gravity: 1.4
    blast_width_s: 1.2
    blast_height: 0.16
    blast_s: 0.5
```

Weapons are drawn with the built-in SVG presets `laser`, `bomb` and `blast`, chosen by shot kind. A zone may name sprite frames from its sheet under `weapons:`. A laser sprite is right-aligned so its tip stays at the hit point. The laser and bomb animate by time; a blast steps through its frames once over its lifetime:

```yaml
weapons:
  laser: { frames: [laser-0, laser-1], fps: 12 }
  bomb: { frame: bomb }
  blast: { frames: [blast-0, blast-1, blast-2, blast-3] }
```

Sound slots `laser`, `bomb`, `missile`, `explosion`, `boost`, `hit`, `target`, `hurt` and `deny` follow the same file-or-synth rule as the other cues. A laser or missile kill plays `target`; losing a heart to a breakable plays `hurt`, so success and penalty never sound alike.

A crash names its cause on the crash menu ("Hit the ground…", "Crashed into the cracked wall. Fire a missile…", "Hit the gate. … fly through it", "The gate shut before you got through. Boost…", "Crashed into a tower. Fly over it, or drop a bomb…", "Out of hearts — shoot the bracketed targets…"). The result screen lists bells, targets (armed acts), score and bumps. On the ready screen after Resume or Retry checkpoint, buttons 1–3 read "End flight", because they end and save that attempt.

Logged events: `skyline_glider.flight.weapon.fired` (`weapon`, `count`, `bombsLeft` for bombs), `skyline_glider.flight.bomb.detonated` (`shotId`, `atSeconds`, `altitude`), `skyline_glider.flight.entity.destroyed` (`entityId`, `by`), `skyline_glider.input.gamepad` once per pad seen during a flight, and `skyline_glider.input.fire` per press (`action`, `source` `gamepad`|`keyboard`, `button` index and `padId`, or `key`). `skyline_glider.flight.gate.cleared` (`gateId`, `shutter`, `boostOffset`) fires when the craft's tail passes a gate, and `boost.activated` carries `cameraTime`. Per-second flight samples include `bombsLeft` and `boostOffset`. `skyline_glider.flight.crashed` carries `cause`, `segmentId`/`entityId`, and the `courseTime`, `altitude`, `filteredRpm` and `rawRpm` at the moment of the crash.

## Persistence

The browser stores the current checkpoint under `fitness:skyline-glider:<userId>:<courseId>`. Reloading offers Resume or Start Over. Finished and abandoned runs are stored under the household Fitness log and projected into session activity history as `skyline-glider`. If a terminal save is pending, a physical start request retries that exact terminal record before creating a new run; a failed retry remains recoverable and never discards the old result.

Run saves are idempotent by run ID. Reusing an ID with different content returns HTTP 409. The reward key is `rpm-flight:<runId>:completion:<userId>`, so retrying a successful save cannot pay twice.

## World: zones and acts

The game is a world of **zones** (art, sprites, sounds, entity classes) holding **acts** (course layouts). Bundled files live in `__app_modules/wellness/fitness/server/adapters/skylineGlider/`. Household files with the same id replace them; new ids add to them:

```text
fitness/skyline-glider/world.yml        # zone order: { zones: [alpine, space] }
fitness/skyline-glider/zones/*.yml      # skyline-glider-zone/v1
fitness/skyline-glider/courses/*.yml    # acts: skyline-glider-course/v1
```

Each file is loaded on every request, so an edit takes effect on the next lobby load with no restart. A malformed act is skipped and logged as `fitness.skyline_glider.course_override.invalid`. A malformed zone is logged as `fitness.skyline_glider.zone_override.invalid`. Neither hides the bundled world. The browser validates again, including reachability, and logs `skyline_glider.course.invalid` for anything it drops.

### Zone file

```yaml
schema: skyline-glider-zone/v1
id: green-hill
name: Green Hill
asset_root: fitness/skyline-glider/green-hill   # media-relative folder
pixel_art: true                                  # crisp scaling for pixel art
layers:                                          # drawn back to front
  - { id: sky,  kind: svg,   draw: alpine-sky }
  - { id: far,  kind: image, src: far.png, parallax: 0.14, y: 0.35, height: 0.4, fallback: alpine-far }
  - { id: dust, kind: image, src: dust.png, parallax: 1.4, y: 0.9, height: 0.1, front: true }
terrain: { fill: rock.png, edge: grass.png, ceiling_edge: icicles.png, edge_lip: 0.02, edge_height: 0.06 }
sprites: { sheet: sprites.png, frames: sprites.json }
craft: { frames: [ship-1, ship-2], fps: 8, height: 0.09 }
collectible: { frame: ring }
checkpoint: { frame: post }
finish: { frame: goal }
entities:
  palm:    { class: breakable, frame: palm, width_s: 0.6, height: 0.18 }
  boulder: { class: solid, draw: boulder, width_s: 0.8, height: 0.12 }
sounds: { bell: ring.mp3, checkpoint: post.mp3, breakable: smash.mp3, crash: crash.mp3,
          restart: restart.mp3, finish: fanfare.mp3, wind: wind.mp3, music: theme.mp3 }
```

- **Every slot is optional and falls back to the built-in SVG art** (`svgPresets.jsx`): `alpine-sky`, `alpine-far`, `alpine-middle`, `alpine-near`, the alpine rock terrain, the glider, the bell, and the entity drawings `pine`, `chalet`, `boulder`, `signpost`, `barrier`, `target`, `crackwall`, `bunker`, `tower` and `gate` (drawn per piece as `gate-top`, `gate-bottom`, `gate-shutter`). An image layer that fails to load draws its `fallback` preset.
- `parallax` is a fraction of the course scroll speed (1 moves with the terrain, above 1 moves faster, for foreground). `y` and `height` are fractions of the 600-unit scene height, and strips repeat horizontally at their natural aspect ratio. Layers with `front: true` draw over the craft.
- The terrain `fill` is a texture locked to the course. The `edge` strip is drawn `edge_lip` above the collision line, so grass tips can be brushed without crashing. Ceilings use `ceiling_edge`, or the floor edge flipped.
- Sprite sheets use the TexturePacker/Aseprite JSON export (`hash` or `array`). Frame names drop their extension, so `glider-1.png` is addressed as `glider-1`. Any `frame:` can be `frames: [...]` with `fps:` to animate.
- Asset paths resolve against `asset_root` on the media mount and are served by `/api/v1/proxy/media/*` with revalidating cache headers, so replacing a file keeps its name. A path starting with `/` is media-root-relative.
- Sounds: `bell`, `checkpoint`, `breakable`, `crash`, `restart` and `finish` are cues. `wind` and `music` loop during flight. A missing, empty or undecodable file falls back to the synthesized tone, so the alpine zone ships with empty placeholders under `media/fitness/skyline-glider/alpine/sounds/`.
- On each act change the lobby preloads the zone and logs `skyline_glider.assets.loaded` with `{ zoneId, images, spriteFrames, sounds, missing }`. The level is `warn` when anything other than an empty placeholder failed.

### Act file

An act is a course file with three additions:

```yaml
zone: green-hill          # default alpine
act: 2                    # play order inside the zone
overrides:                # per-act changes to the zone
  layers: { sky: { src: dusk.png } }
  sounds: { music: night.mp3 }
entities:                 # placed by name; they stand on `altitude`
  - { id: palm-01, entity: palm, at_s: 42, altitude: 0.70 }
```

Give entities stable `id`s, and bump `version` whenever placements change: the id is what a checkpoint remembers as broken. Validation rejects unknown entities, duplicate ids, a solid entity that leaves no reachable gap, and a checkpoint whose `restart_altitude` sits inside terrain.

### Slopes, lava and palettes

A `lower-terrain` segment may use `profile: [{ at_s, altitude }, ...]`. Points strictly increase, span exactly `start_s`–`end_s`, and use altitude 0–1. Rendering, craft-footprint collisions and projectile sweeps share the same piecewise-linear surface. `rules.assist_terrain: true` carries beginners over lower terrain.

A `lava` segment uses `start_s`, `end_s` and `top` below the safe flight band (greater than 0.815). A latched stall falls below the ordinary minimum-height clamp into its actual rendered surface. The previous lava-only `motion.stop_coast_s` grace is no longer used; zero stalls immediately throughout the course.

A solid placement with `required_weapon: bomb` or `required_weapon: missile` explicitly allows an otherwise impassable barrier. Weapons must be enabled, the barrier vulnerable to that weapon and the rack (`bombs` / `missiles`) sufficient for basic damage. Prefer missiles for a wall ahead: a bomb falls, so bombing a wall in front of the craft is awkward. Author a reachable detonation surface and enough blast width to clear the wall before the craft nose arrives; validate a complete basic-power route. Ordinary solids still require a flyable gap.

**Gates.** An entity definition with `gap` (and a placement `gap_altitude`, the gap's centre) is a gate: steel nothing breaks, with an opening to fly through. `resolveAct` expands one placement into the boxes the engine already understands — `<id>-top` from the top of the screen to the gap and `<id>-bottom` from the gap to the ground, both carrying `group: <id>` and `piece` — so collisions, shots (absorbed) and reachability need no gate logic of their own. A placement `closes_at_s` (camera time) adds `<id>-shutter`, which does not exist until the camera reaches that time and is solid after it: a rider at the anchor reaches the gate too late, and only one dashed ahead by a boost clears it. The shutter warns for 3 s and slams over the last 0.4 s, so it never looks shut while it is still open. Cloud Ridge sets its gaps low (centre 0.6, 0.28 tall), which a rider threads at roughly 42–78 rpm: a hurdle, not a sprint. Text cues and the HUD clock follow the camera, not a dashed-ahead craft. Validation rejects a shutter in an act with boost off, or one that closes so early that a full `offset_s` dash cannot carry the craft's tail past the gate in time.

```yaml
# zone
entities:
  gate: { class: solid, role: avoid, draw: gate, width_s: 0.8, gap: 0.24, vulnerable_to: [] }
# act
entities:
  - { id: gap-gate-01, entity: gate, at_s: 165, gap_altitude: 0.6, gap: 0.28 }
  - { id: shutter-gate-01, entity: gate, at_s: 200, gap_altitude: 0.6, gap: 0.28, closes_at_s: 198.9 }
```

`hit_points` can be defined on a class or placement. Checkpoint retries refill ammunition and restore obstacles/damage; no rescue ammunition is provided.

Zone `palette` (or act `overrides.palette`) accepts `theme`, `sky`, `horizon`, `rock`, `rock_low`; built-in themes `meadow` and `volcanic` also tint backdrop silhouettes. Texture and sprite slots still work. Bundled course versions (Mountain Pass v6, Cloud Ridge v6) were incremented, invalidating old active course layouts while retaining pending terminal saves and earned completion.

## Progression

Acts play in world order: zone order from `world.yml`, then `act`. The first act is always open. Each later act opens once the act before it is completed, and that rule crosses zone boundaries. Per-rider progress lives in `fitness/skyline-glider/progress/<riderId>.yml`. It is updated whenever a completed run saves, and rebuilt from the run log when missing, so deleting it is safe.

**Gems.** The economy's `glider-act` and `glider-bells` milestones come from `application/measures/fitnessAchievementProvider.mjs`, which reads the **run log**, not the progress file: `completed.<act>.at` moves to the rider's best-bells run, so it is not the first completion and would re-date the milestone. `glider-act` is the rider's earliest `completed` run of the act (key `<actId>`). `glider-bells` is the earliest run of any status whose collectibles include every bell of the act's current `collectible-path` segments (key `<actId>:<hash of the bell ids>`, so changing the act's bells makes a new achievement rather than re-dating the old one). Both are dated by the study day of `ended_at`.

The flight picker shows the world map beside the 2×2 controls. Its top two buttons browse, bottom-left changes rider, and bottom-right starts/resumes or requests admin approval for a locked act. Default to the next unfinished act, otherwise the rider's last played act. Results offer Replay, Next level (Flights after the final act), Flights and Change rider. A failed terminal save offers Retry save and blocks a new run until the same record is saved. Locked-act approval records `unlocked_by`. If the world map cannot load, every act stays playable and `skyline_glider.world.error` is logged.

The household Fitness menu is deployment-owned configuration and is not tracked in this repository. Add this tile to the production menu:

```yaml
- id: skyline-glider
  label: Skyline Glider
  icon: plane
  target:
    type: module
    module_id: skyline_glider
```

## API

- `GET /api/v1/fitness/skyline-glider/courses`: resolved acts in world order, each with its zone merged in
- `GET /api/v1/fitness/skyline-glider/world?rider=<id>`: zones → acts with `locked | open | completed`, `best`, and `next`
- `POST /api/v1/fitness/skyline-glider/progress/:riderId/unlock` with `{ actId, unlockedBy }`
- `POST /api/v1/fitness/skyline-glider/runs` with `{ record, household? }`
- `GET /api/v1/fitness/skyline-glider/runs/:runId`

Terminal results embed `gaming-result/v1`; continuous flight simulation remains owned by Fitness.
