# Skyline Glider

Skyline Glider is a single-rider Fitness game in which cadence controls a hang glider's target altitude. It is registered as `fitness:skyline-glider` and opens at `/fitness/module/skyline_glider`.

## Play contract

- A fresh press of a bike's physical rider-selector button starts the game, resumes that rider's compatible checkpoint, or leaves a prior result for the next flight. Failed terminal saves are retried before the new flight begins. The kiosk does not require a touchscreen press between runs.
- The selector's equipment and assigned rider are locked together for the run. Checkpoints, saved runs, and rewards remain scoped to that rider.
- School learners may fly only when the fail-closed `fitness.skyline-glider` entitlement grants access from `school.day-complete`. The Fitness roster derives `schoolLearner` from the same authoritative School learner directory used by the other school-gated surfaces. Missing identity, Guest, unavailable, expired or indeterminate state all stay locked; household members marked `schoolLearner: false` are outside this gate. The client honors the decision's `validFrom`/`validUntil` window and suspends an active countdown or flight immediately when access is revoked, preserving a resumable checkpoint and releasing the bike for another rider.
- An admin fingerprint can approve a pending physical-button start. The admin authorizes the flight but does not become its rider or reward recipient.
- Localhost and `127.0.0.1` deep links retain touchscreen Start/Resume controls for development. A non-local deep link still enters the gated kiosk lobby.
- Equipment `rpm.min` and `rpm.max` calibrate the altitude range; the safe fallback is 30–100 RPM.
- Faster cadence climbs and slower cadence descends. Zero RPM coasts for one second before descending.
- A missing or stalled cadence transport is collision-protected for 0.75 seconds, then freezes the course behind a reconnect overlay.
- **Terrain and `solid` entities are walls.** Touching one is an immediate crash ("Wing down!"), invincible or not: a two-second pause, then a restart at the latest checkpoint with three lives. The craft can never pass through the ground. Only a sensor pause protects the rider, and then the craft is held inside the open band.
- **`breakable` entities** (trees, houses) shatter on contact and cost one life, followed by `invincibility_s` of blinking. Hits while blinking still shatter but cost nothing. Losing the last life is a crash. A checkpoint restart brings back anything broken after that checkpoint.
- **`scenery` entities** never collide.
- Mountain Pass (Alpine, Act 1) lasts five minutes and has checkpoints near 25%, 50%, and 75%. Cloud Ridge (Alpine, Act 2) adds pines, a chalet and boulders.
- Completion awards 10 rings plus one per unique collectible, capped at 30. Normal heart-rate rings continue independently.

## Weapons

The rider can fire a laser and drop bombs from a gamepad or keyboard. Weapons never hurt the rider and cost nothing. They destroy placed entities.

| Input | Laser | Bomb |
|---|---|---|
| Gamepad (standard mapping) | A (0) or RT (7) | B (1), X (2) or LT (6) |
| Keyboard | Space or F | B |

On the garage's 8BitDo SFC30 (standard mapping in Firefox), that is the bottom face button (printed **B**) or **R** for the laser, and the right face button (printed **A**), **Y** or **L** for a bomb. The pad's letters follow the SNES layout, so they are swapped against the Xbox names above.

- Each press fires once; holding does not autofire. A button already held when flight starts is ignored until released. A press on a frame where no time passes waits for the next frame. Presses during a sensor pause or crash are dropped.
- **Laser:** leaves the craft nose at the craft's altitude and travels `laser_speed_s` course-seconds per second faster than the craft, for `laser_range_s`. Each step sweeps its whole path, so thin objects cannot be skipped. It stops at the first terrain or non-scenery entity it reaches, destroying that entity if it is vulnerable to the laser and being absorbed otherwise. It is unlimited, with a `laser_cooldown_s` cooldown.
- **Bomb:** released under the craft, it keeps pace with the craft while falling under `bomb_gravity`. It detonates on terrain, a non-scenery entity, or the bottom of the screen. The blast (`blast_width_s` × `blast_height`, visible for `blast_s`) destroys every entity it touches that is vulnerable to bombs. The rack holds `bombs` and refills at every checkpoint crossed and on restart.
- **Vulnerability** defaults by class: `breakable` → laser and bomb, `solid` → bomb only, `scenery` → nothing. An entity definition or placement can set `vulnerable_to: [laser, bomb]` (or `[]`). A destroyed solid stops being a wall.
- A crash clears shots and blasts in flight. A checkpoint restart restores what was destroyed at that checkpoint, as it does for crash-broken breakables.
- Kills are recorded per entity as `laser`, `bomb` or `crash`. The run saves `targets` (laser and bomb kills), `shots_fired` and `bombs_dropped` on `run` and in `result.metrics`. `targets` counts kills on the final run-through: a checkpoint restart rolls it back along with the destroyed entities, as it does collectibles. The shot counters are cumulative across restarts, like `collisions`. Reward rings do not change.
- Fire keys are ignored with Ctrl, Cmd or Alt held and while typing in a field. A fire key never also activates a focused on-screen button.

`rules.weapons` in an act overrides the defaults. Every field except `enabled` must be a non-negative number:

```yaml
rules:
  weapons:
    enabled: true          # false removes weapons from this act
    laser_cooldown_s: 0.3
    laser_speed_s: 3
    laser_range_s: 7
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

Sound slots `laser`, `bomb` and `explosion` follow the same file-or-synth rule as the other cues. A laser kill reuses `breakable`.

Logged events: `skyline_glider.flight.weapon.fired` (`weapon`, `count`, `bombsLeft` for bombs), `skyline_glider.flight.bomb.detonated` (`shotId`, `atSeconds`, `altitude`), `skyline_glider.flight.entity.destroyed` (`entityId`, `by`), `skyline_glider.input.gamepad` once per pad seen during a flight, and `skyline_glider.input.fire` per press (`action`, `source` `gamepad`|`keyboard`, `button` index and `padId`, or `key`). Per-second flight samples include `bombsLeft`. `skyline_glider.flight.crashed` carries `cause`, `segmentId`/`entityId`, and the `courseTime`, `altitude`, `filteredRpm` and `rawRpm` at the moment of the crash.

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

- **Every slot is optional and falls back to the built-in SVG art** (`svgPresets.jsx`): `alpine-sky`, `alpine-far`, `alpine-middle`, `alpine-near`, the alpine rock terrain, the glider, the bell, and the entity drawings `pine`, `chalet`, `boulder`, `signpost`. An image layer that fails to load draws its `fallback` preset.
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

## Progression

Acts play in world order: zone order from `world.yml`, then `act`. The first act is always open. Each later act opens once the act before it is completed, and that rule crosses zone boundaries. Per-rider progress lives in `fitness/skyline-glider/progress/<riderId>.yml`. It is updated whenever a completed run saves, and rebuilt from the run log when missing, so deleting it is safe.

The lobby shows the world map. The rider button starts, in priority order: a tapped tile, a flight waiting to be retried or resumed, then the rider's next act. Tapping a locked tile asks for an admin fingerprint and records the unlock with `unlocked_by`. If the world map cannot load, every act stays playable and `skyline_glider.world.error` is logged.

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
