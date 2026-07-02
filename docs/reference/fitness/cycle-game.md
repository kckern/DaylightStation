# Cycle Game (Cycle Race) — Reference

**Status:** Current as of 2026-06-05.

> **Not to be confused with the Cycle _Challenge_.** This document covers the
> **Cycle Game / Cycle Race** — the multi-rider racing widget (`cycle_game`
> fitness module: lobby → countdown → live race → results, with ghosts and a
> scoring engine). The **Cycle Challenge** (`cycing-challenge.md`,
> `GovernanceEngine-cycle*`, the `.cycle-challenge-demo` / `__fitnessGovernance`
> flow) is a *separate* governance-driven endurance feature and is **out of scope
> here**. They share the word "cycle" and nothing else.

---

## 1. What it is

A head-to-head stationary-bike racing game shown on the fitness TV. One to six
riders (any mix of live humans and recorded "ghosts") race either **to a distance
goal** or **for the furthest distance in a time cap**. RPM from each bike's
cadence sensor — scaled by the rider's live HR zone — accrues distance. The race
screen is a broadcast-style HUD with a **fixed layout chosen by field size** (no
per-tick director — panels never reshuffle mid-race). Finished races are saved and
can later be replayed as ghosts.

### Use cases

- **Solo time-trial** — one rider, no comparator. Pace against the clock/goal.
- **Solo vs. ghost** — one human chasing a recorded past performance (the ghost
  counts as a competitor).
- **Group race** — 2–6 riders (humans and/or ghosts), distance or time.
- **Re-race a field** — selecting a ghost replays that race's recorded field as
  competitors; a **roster step** lets you pick *which* of those ghosts to include
  (default: all).
- **Recap** — replay any saved race from the History table (no bikes needed).

---

## 2. Architecture & file map

```
Lobby + lifecycle ────────────────────────────────────────────────────────────
  widgets/CycleGame/index.jsx                  module manifest (id: cycle_game)
  widgets/CycleGame/CycleGameContainer.jsx     orchestrator: phases, riders,
                                               courses, ghosts, ticking, saving
  widgets/CycleGame/CycleGameHome.jsx          the lobby (selection + start + GhostPicker)
  widgets/CycleGame/RiderReadyStrip.jsx        staging/countdown compliance strip
  widgets/CycleGame/CountdownStoplight.jsx     ALL3·RED·YELLOW·GREEN stoplight (presentational)

Simulation ────────────────────────────────────────────────────────────────────
  lib/cycleGame/CycleRaceController.js          lifecycle SM + DNF + false-start box
  lib/cycleGame/CycleRaceEngine.js              tick/scoring/finish/lap splits/ghost
  lib/cycleGame/distanceModel.js                distance + zone-multiplier math
  lib/cycleGame/equipmentRpm.js                 per-equipment gauge max + abuse cap
                                                + cadence-gap RPM resolver
  lib/cycleGame/effectiveLapLength.js           lap length, whole-race when goal < lap
  lib/cycleGame/lapModel.js                     lapCount / lapProgress (overlay)
  lib/cycleGame/cycleGameLobby.js               buildRaceConfigFromCourse, formatClock
  lib/cycleGame/formatDistance.js               m / km formatting

Race screen + fixed layout ──────────────────────────────────────────────────────
  widgets/CycleGame/CycleRaceScreen.jsx         screen shell: builds panel factories
  widgets/CycleGame/RaceLayoutManager.jsx       fixed layout by field size → zones
  widgets/CycleGame/panels/PanelSlot.jsx        per-zone mount (stable render prop)
  widgets/CycleGame/panels/SpeedoRow.jsx        bottom gauges row (per-rider colour tint)
  widgets/CycleGame/panels/DistanceChart.jsx    climbing lanes + goal line + event markers
  widgets/CycleGame/panels/SplitsChart.jsx      compact per-lap splits (live order early)
  widgets/CycleGame/panels/PovGrid.jsx          vertical Tron-style POV distance grid
  widgets/CycleGame/panels/OvalTrack.jsx        avatars circling a whole-race oval
  widgets/CycleGame/CycleSpeedometer.jsx        a single gauge
  lib/cycleGame/speedometerGeometry.js          gauge ticks/bands/needle geometry
                                                (tickStepsFor, scaleBands)
  lib/cycleGame/chartZoom.js                    nextZoomLevel — stepped zoom window (X+Y)
  lib/cycleGame/povWorld.js                     POV road world model (marks, gates, riders)
  lib/cycleGame/povFollowCam.js                 POV camera framing/damping
  lib/cycleGame/ovalTrackModel.js               ovalProgressFor / ovalPoint
  lib/cycleGame/chartTrim.js                    plotStartIndex — first-movement line start
  lib/cycleGame/lineColors.js                   LINE_COLORS — per-rider palette (synthwave)

Results / recap / events ───────────────────────────────────────────────────────
  widgets/CycleGame/RaceResults.jsx             final standings + splits + auto-exit + Exit
  widgets/CycleGame/RaceRecap.jsx               replay a saved race
  widgets/CycleGame/CycleEventToast.jsx         transient DNF/penalty toast
  lib/cycleGame/raceRecord.js                   buildRaceRecord (persist shape)
  lib/cycleGame/recordRow.js                    buildRecordRow — History-table row model
  lib/cycleGame/participantIdentity.js          resolve ghost:<id> → real face/name
  lib/cycleGame/playSound.js                    one-shot SFX helper

Persistence (backend) ──────────────────────────────────────────────────────────
  1_adapters/persistence/yaml/YamlCycleRaceDatastore.mjs   YAML read/write +
                                                            _index/{YYYY-MM}.json shards
  3_applications/fitness/services/CycleRaceService.mjs      save/get/list/ghosts/
                                                            ladder/personal-bests
  4_api/v1/routers/fitness.mjs                              /cycle-races routes incl.
                                                            ladder + personal-bests
  2_domains/fitness/services/cycleLadder.mjs                pure ladder domain: week
                                                            window, ISO week, course
                                                            rotation, matching, ranking

Weekly ladder (frontend) ────────────────────────────────────────────────────────
  widgets/CycleGame/home/FeaturedCourseCard.jsx  "This week's course" lobby card
  lib/cycleGame/ladder.js                        pure helpers: courseStartOverride,
                                                  pickRival, ladderDelta, daysLeft
  lib/cycleGame/ghostCandidate.js                mapRaceRecordToCandidate /
                                                  buildGhostFromCandidate — shared by
                                                  GhostPicker and Ride It
```

**Entry / registration.** `index.jsx` exports `CycleGameContainer` and a manifest
`{ id: 'cycle_game', name: 'Cycle Game', icon: '🚴' }`. It is reached at
`/fitness/module/cycle_game`.

---

## 3. Lifecycle / phase state machine

Two state machines run in tandem: the **React phase** (`phase` state in
`CycleGameContainer`) drives what's rendered; the **controller phase**
(`CycleRaceController`) drives the simulation. The container maps controller →
React phases in `applySnapshot()`.

```
                 user presses Start (canStart)
   idle ───────────────────────────────────────► staging
   (lobby)                                        "Riders, to your bikes!"
      ▲                                              │ buffer elapses AND all RPMs == 0
      │ back to home                                 ▼
   results ◄──────── racing ◄── go ◄── countdown ───┘
   (standings)   all done /  green   ALL3·RED·       │
                 time cap   (engine  YELLOW·GREEN     │
                            live)                     │
   Cancel from staging/countdown/racing ─────────► idle
```

| React phase | Controller phase(s) | Rendered | Enter trigger | Exit trigger |
|---|---|---|---|---|
| `idle` | — / `cancelled` | `CycleGameHome` (lobby) + history load | mount; back-to-home; cancel | Start (when `canStart`) |
| `staging` | `staged` | `RiderReadyStrip` ("to your bikes") | Start, if `staging_buffer_ms > 0` | buffer elapsed **and** all riders at RPM 0 (see §10) |
| `countdown` | `staged`→`countdown` | `CountdownStoplight` + `RiderReadyStrip` | staging gate clears (or Start if buffer 0) | countdown reaches the green light |
| `go` | `racing` | `CountdownStoplight` (GREEN) — engine already live | green light | brief hold (`GO_HOLD_MS` ≈ 800 ms) |
| `racing` | `racing` | `CycleRaceScreen` + `CycleEventToast` | go-hold ends | all riders finished/DNF, time cap, or operator **Finish race** |
| `results` | `finished`→`results` | `RaceResults` | engine `finished` | manual **Exit** or auto-dwell countdown → `idle` |

- **Tick cadence:** `RACE_TICK_MS = 1000` (1 Hz). The racing interval runs across
  the `go` and `racing` phases and is **not** torn down mid-race, so ticking stays
  even. Live session/vitals are read through refs.
- **The engine goes live at GREEN**, ~0.8 s **before** the race screen appears —
  so the race technically starts on the green light. The `go` phase holds the green
  stoplight for that beat; then the screen switches to `CycleRaceScreen`.
- **Cancel** (`onCancel`): `controller.cancel()` → `cancelled` → `idle`. Emits
  `cycle_game.cancelled`. Discards the race.
- **Finish race** (`onFinishRace`): `controller.finishNow()` → `results`. Forfeits
  unfinished riders (DNF) and **saves**. Emits `cycle_game.finish_forced`.
- **`canStart`** = a race type is chosen **and** ≥ 1 rider is claimed to a bike.

---

## 4. The lobby (`CycleGameHome`)

The lobby is a pure presentational component; all state and handlers live in
`CycleGameContainer`. Flows:

1. **Race type** — three tiles: **Distance**, **Time**, **Ghost**. Selected tile is
   `aria-pressed`.
2. **Value** — preset tiers plus a +/- custom stepper (reserved-height slot):
   - Distance tiers: **100 / 300 / 1000 / 2500 (default) / 5000 m**.
   - Time tiers: **60 / 120 / 180 / 300 (default) / 600 s**.
   - Picking a ghost **locks** type + value to that recording.
3. **Starting grid** — one `BikeSlot` per cadence bike. The **entire slot** is one
   touch target → opens the **rider picker**. Filled slots show the equipment icon
   (RPM-rotated) with the rider's avatar overlaid — **not** the rider's name (a
   test asserts names are absent on slots).
4. **Rider picker** (modal) — people grouped into **Household / Family / Guests**
   tabs; each tile shows avatar, name, and a "live" badge for an active HR strap.
   Built-in **Guest (Adult)** / **Guest (Kid)** lead the Guests tab. `Escape` closes.
5. **Ghost picker** (`GhostPicker`) — past races grouped by day, most-recent-first.
   **Three-step selection:** first tap scrolls + focuses a card; second tap opens a
   **roster submenu** listing that race's participants (avatars + names), **all
   selected by default**, each tappable to toggle off, with **Select all** and
   **Start** (Start is disabled if you exclude everyone). Start commits the race
   with only the chosen ghosts — the picker pre-filters `candidate.participants`, so
   the rest of the ghost pipeline is unchanged.
6. **History** — recent saved races as a compact columnar table (winner, goal-marked
   metric columns, when), most-recent-first; row model from
   `recordRow.buildRecordRow`. The winner is shown as the **winner's avatar** with
   small **runner-up crescents** (overlapping mini-avatars) and a `+N` overflow —
   there is no crown emoji in the History list. Ghost participants resolve to the
   real rider's face/name via `participantIdentity`. Tapping a row opens the
   **Recap**. Empty state: "No races yet."
7. **Volume** — touch +/- with a readout.
8. **Start** — disabled until `canStart`; checkered-flag icon.

---

## 5. Riders, ghosts, guests

**Building the field** (`buildRiders`): for each cadence bike with a claimed
rider, push `{ userId, displayName, equipmentId, wheelCircumferenceM }`. If a
ghost is selected, append its (roster-filtered) participants as additional riders
carrying `ghostSeries / ghostHrSeries / ghostRpmSeries / ghostZoneSeries /
ghostIntervalS` and `equipmentId: null`.

- **Claiming a rider to a bike** is external to React: `session.setEquipmentRider`
  (mirrors the hardware rider-select button). Emits `cycle_game.rider_assigned` /
  `rider_unassigned`.
- **Eligible people** come from the household users config plus the two built-in
  anonymous guests. Sorted HR-active-first, then alphabetically.
- **Display names** use the relational resolver (e.g. "Dad"/"Mom") when ≥ 2 HR
  riders are present — see `display-name-resolver.md`.
- **Ghost ids** are `ghost:<raceId>:<sourceUserId>`. The race screen / results strip
  the middle segment to resolve the original user's avatar. Ghost display names get
  a 👻 suffix.

---

## 6. Courses, win conditions & config

`buildRaceConfigFromCourse(course, opts)` merges a course preset + runtime opts
into the engine config. Precedence highlights:

- `winCondition` ← `course.win_condition` ?? `opts` ?? `'distance'`.
- `goalM` (distance) ?? `3000`; `timeCapS` (time) ?? `300`.
- `lapLengthM` ← **`course.lap_length_m`** (per-course override) ?? `opts.lapLengthM`
  (app config) ?? `0`. The container then passes this through
  **`effectiveLapLength`** before it reaches the engine/panels (see below).
- `mode` is always `'simultaneous'`; `intervalMs` is `1000`.

**Effective lap length.** `effectiveLapLength({ lapLengthM, winCondition, goalM })`
is the single source of truth for the lap unit used by the engine, splits, oval,
and results. It returns the configured lap, **except** for a distance race whose
goal is shorter than the lap, where one lap = the whole race (so a 100/200/250 m
race isn't sliced into sub-laps). `0` ⇒ laps off.

### Config keys (`cycle_game` app config)

Loaded **once at container startup** — changing config requires a container
restart to take effect.

| Key | Default | Purpose |
|---|---|---|
| `distance_goal_default_m` | 2500 | Default distance goal |
| `time_cap_default_s` | 300 | Default time cap |
| `staging_buffer_ms` | 5000 | "To your bikes" delay before countdown (0 = skip staging) |
| `start_countdown_s` | 3 | Stoplight countdown length |
| `cadence_zones` / `zones` | [] | HR zones; each `{ id, distance_multiplier, color }` |
| `hrless_multiplier` | 1 | Distance multiplier for a rider with no HR strap |
| `race_idle_dnf_s` | 20 | Seconds of zero RPM (after a rider has started) before they're DNF'd |
| `race_start_grace_s` | 30 | Seconds a rider may report zero RPM **before their first movement** before a no-show DNF. More generous than `race_idle_dnf_s` to cover magnetless cadence sensors (e.g. the tricycle's COOSPO BK467) that take ~20s to lock onto rotation from a dead stop |
| `hot_start_penalty_s` | 0 | False-start penalty seconds (0 = disabled) |
| `lap_length_m` | **400** | Lap unit for splits / oval (0 = laps off; whole-race when goal < lap) |
| `results_dwell_s` | 20 | Results auto-return countdown before returning to the lobby |
| `default_background` | null | Ambient background Plex id for the race screen |
| `music_volume` | 0.55 | Background music level (0–1) |
| `sounds` | {} | SFX + music playlist URLs |

> **Distance/time *tiers* are frontend constants** in `CycleGameHome`, not config.
> The *defaults* above are config.

### Per-equipment cadence & RPM (equipment config, not `cycle_game`)

Each cadence bike in the equipment config carries:

| Key | Purpose |
|---|---|
| `cadence` | The cadence sensor device id — **or an array of ids** for a bike with more than one sensor on the same wheel (e.g. tricycle `cadence: [7153, 7186]`). Multiple sensors are merged as **one unit**: the fastest *currently-live* sensor wins, so a single flaky sensor's dropouts no longer flatline the bike. |
| `max_rpm` | Gauge dial scale for that equipment (e.g. tricycle **250**, default 120). Display only — never clamps the counted RPM. |
| `wheel_circumference_m` | Distance per wheel rotation (a larger wheel covers more ground per pedal stroke — the tricycle uses an enlarged wheel so it can keep pace). |
| `abuse_max_rpm` | Optional clamp on the RPM that *counts* toward distance, for hand-spinnable equipment (e.g. the ab roller). Absent ⇒ uncapped. |

The HR-zone `distance_multiplier`s (cool/active ×1, warm ×2, hot ×3, fire ×5) live
in the shared fitness `zones` config and scale distance-per-RPM so cranking
resistance (higher HR zone) rewards more distance.

---

## 7. The engine (`CycleRaceEngine`)

Pure simulation class. `tick(inputs)` advances `elapsedS` by the interval and, per
rider:

- **Live rider:** `rotations = (rpm/60) × intervalS`; `distanceΔ = rotations ×
  wheelCircumferenceM × zoneMultiplier`. Zone multiplier comes from the rider's
  current HR zone (`distanceModel.zoneMultiplierFor`), falling back to
  `hrlessMultiplier` when there's no zone.
- **Ghost rider:** distance is **linearly interpolated** from `ghostSeries` at the
  current elapsed time; HR/RPM/zone are **nearest-sample** lookups. (An implicit
  `t=0 → 0 m` sample is prepended for exact interpolation.)
- **Finish (distance race):** when `cumulativeDistanceM ≥ goalM`, stamp
  `finishTimeS`, clamp distance to the line, and park the gauge (rpm 0). The race
  is `finished` when **every** rider has a finish time. **Time race:** `finished`
  when `elapsedS ≥ timeCapS`.
- **Lap splits:** if `lapLengthM > 0`, each tick detects lap-boundary crossings
  between the pre- and post-update distance and pushes the **interpolated crossing
  time** to the rider's `lapSplits[]`.

`getState()` returns a serializable snapshot: `{ elapsedS, finished, winCondition,
goalM, timeCapS, riders{ …, cumulativeDistanceM, distanceSeries, lapSplits,
hrSeries, rpmSeries, zoneSeries, heartRate, rpm, zoneId, finishTimeS, isGhost },
standings[] }`.

### Scoring math

- `distanceModel.computeDistanceDelta(rotationsΔ, wheelCircumferenceM, mult)` =
  `r × c × m` (each guarded `> 0`).
- `distanceModel.zoneMultiplierFor(zoneId, zones, hrless)` — case-insensitive zone
  lookup; falls back to `hrless`.
- `lapModel.lapCount(d, L)` = `floor(d / L)`; `lapModel.lapProgress(d, L)` =
  `(d mod L) / L` (0..1). Both return 0 when `L ≤ 0`.

---

## 8. The controller (`CycleRaceController`)

Wraps the engine with the lifecycle, **DNF**, **false-start box**, and the operator
**finish-now** action. `getState()` returns `{ phase, countdownRemaining, dnf[],
penalized[], penaltyInfo{}, engineState }`.

- **Countdown:** `startCountdown()` then `countdownTick()` decrements from
  `startCountdownS`; reaching the green light begins racing (`_beginRacing` builds
  the engine).
- **Idle → DNF:** per non-ghost rider, an idle timer increments while `rpm === 0`
  and resets when pedalling; the rider joins `dnf` (and their input is zeroed for
  the rest of the race) once the timer crosses its threshold. The threshold is
  **two-phase**: before the rider's first `rpm > 0` reading it's `race_start_grace_s`
  (a generous no-show window covering magnetless-sensor lock-on lag); after they've
  registered any movement it drops to the normal `race_idle_dnf_s` (gave-up window).
- **False start (pre-green only):** riders may **legally start pedalling on GREEN** —
  the engine is live at the green light. A false start is **only** a rider who
  pedalled **before** green. The container tracks pre-green pedallers during the
  countdown and commits them via `controller.markFalseStarters(userIds)`, which puts
  each into the penalty box (and suppresses the engine's first-tick auto-check).
- **Penalty box:** a boxed rider's meter is locked (input zeroed, no distance) for
  `hot_start_penalty_s`, and releases only when **both** the timer has elapsed **and**
  the rider has returned to **RPM 0** — keep pedalling and you stay boxed.
  `getState().penaltyInfo[userId] = { remainingS, totalS, awaitingStop }`. Disabled
  when `hot_start_penalty_s = 0`.
- **Finish now (`finishNow`):** marks every non-ghost rider who hasn't crossed the
  line as a forfeit (adds them to `dnf`) and ends the race → results finalized and
  **saved**. No-op outside racing.
- **Ghosts are exempt** from idle/DNF, the penalty box, and forfeit.

### Cadence broadcast-gap tolerance (container, racing only)

The race tick reads each bike's cadence in `CycleGameContainer`. For a multi-sensor
bike the **fastest live sensor** is taken first (see §6). A **connected** reading —
even a real 0 — is the truth and is remembered. While **all** of a bike's sensors
are **disconnected** (an ANT+ broadcast gap), `equipmentRpm.rpmDuringGap` **holds
the last good reading** through the gap (so a momentary dropout no longer flatlines
to 0), **unless** the rider was trending *down* into the gap — a genuine
cooldown-to-stop drops to 0. This only applies during an active race.

---

## 9. The race screen & fixed layout

`CycleRaceScreen` is **pure**: it builds a map of panel factories from the current
engine state and hands `{ panels, fieldSize }` to `RaceLayoutManager`, which picks
one of **two fixed layouts by field size**. There is no per-tick director — the
layout is deterministic, so panels never reshuffle mid-race. The race **clock lives
inside the distance chart's header**; the **false-start banner** is fixed chrome
above the grid.

```
engine getState()
  → CycleRaceScreen (5 panel factories)
  → RaceLayoutManager (fixed by fieldSize)
  → panels: SpeedoRow · DistanceChart · SplitsChart · PovGrid · OvalTrack
```

### 9.1 The two layouts (`RaceLayoutManager`)

`wide = fieldSize >= 4`. Each zone renders its panel through a `PanelSlot` (a stable
`render` prop, so a panel never remounts per tick), and every zone is
`overflow:hidden` (clipped) so panels and the chart's zoom animation never bleed
across cells. The **distance chart is never far-left** — laps/splits sit to its left
in both modes.

- **Sidebar mode (≤ 3 riders):** a main column — top row **splits │ distance chart**
  over a full-width **speedometer** band — beside a right **sidebar**: the **POV
  grid** (top ~70%) over the **lap oval** (bottom ~30%).
- **Wide mode (≥ 4 riders):** a top row of three equal columns — **splits │ chart │
  POV** — over a full-width **speedometer** band. No oval.

`showSpeedos={false}` omits the speedo factory (its zone renders empty).

### 9.2 DistanceChart

Climbing gradient lanes toward the goal, over a decimating, transform-aware
**gridline** background, with the race clock folded into the panel's header.

- **Goal line** (distance races) is drawn at `yFor(goalM)` **inside the zoomable
  group**, so it tracks the live zoom window — a rider who reaches the goal visually
  meets the dotted line.
- **Y scaling** auto-picks log vs linear (sticky via a ref). The log curve is shaped
  to **expand the top** (leaders) and compress the bottom, so close gaps between the
  front riders read clearly.
- **Stepped zoom-out camera** (`chartZoom.nextZoomLevel`): the X (time) and Y
  (distance) windows each double in 2× steps when data hits ~90% of the window; the
  pull-back is a ~400 ms eased transform applied with a snap-then-ease trick (set the
  new scale with `transition:none`, then ease to 1× next frame).
- **Leading-edge interpolation:** the engine ticks at 1 Hz, so each lane's newest
  point glides from its previous position to the current one over the interval via a
  rAF clock, instead of snapping.
- **Officiating-event markers** (DNF/penalty) are re-projected onto the lane where
  they fired (`xFor(seriesIndex)`, `yFor(distanceM)`); a lane **starts at first
  movement** (`chartTrim.plotStartIndex`), so a penalty-boxed late starter emerges
  to the right of the origin instead of drawing a flat zero line.

### 9.3 SplitsChart

A compact per-lap split table (laps × riders) sized to hold many laps. It
**auto-scrolls to the newest lap**, keeps a **sticky header** and a **pinned
current-lap row**. **Before any lap completes** it shows a **live order** instead of
dead space: riders sorted by distance with the gap-to-leader in metres. On the
results screen it renders in `final` mode (no live current-lap row). Laps-gated:
nothing shows when `lapLengthM` is 0.

### 9.4 PovGrid

A **Tron / Cruising-USA POV road** rendered with three.js — a
shader-antialiased grid with camera-relative fog, framed by a damped follow
camera that trails the back of the field with a span derived from the leader
gap (`povFollowCam`), over a road world model of metre marks, lap-gate arches,
and rider positions (`povWorld`). Each rider is a **billboarded real-face
avatar** — a pooled DOM label positioned by the render loop. Rider motion
interpolates per-frame between 1 Hz ticks; React renders structure only — the
rAF loop owns motion.

### 9.5 OvalTrack & SpeedoRow

- **OvalTrack** — avatars circling a velodrome where **one loop = the whole race**
  (`ovalTrackModel.ovalProgressFor`: lap progress when laps are on, else fraction of
  the goal/elapsed). `θ = −π/2 + progress·2π`, clockwise from top; ghosts dashed. A
  "Lap N" label tracks the leader. Sidebar mode only.
- **SpeedoRow** — one `CycleSpeedometer` per rider on a single line; gauge size is
  computed from the injected `zoneBox` (`gaugeRowSize`, fit-across-width capped by
  height), never self-measured. Caps: `maxGauge`/`minGauge` 360/220 for ≤ 3 riders,
  280/96 for ≥ 4. Each gauge's **background is tinted** with a dark wash of its
  rider's lane colour (≈ 20 % over the deep-indigo backdrop).

### 9.6 Rider colours (`lineColors.js`)

`LINE_COLORS` is a **synthwave palette** indexed by rider order (`% length`):

```
#4dd0e1 cyan   #d472c0 magenta   #2dd4bf teal
#a14d6b maroon #cbb285 sand      #9aa3c0 slate-grey
```

These are deliberately chosen to **not collide with the HR-zone colours**
(cool blue, active green, warm yellow, hot orange, fire red) — so a rider lane is
never confused with a heart-rate signal — nor with the reserved UI chrome
(cyan `#21e6ff`, magenta `#ff2d95`). Six entries support up to six distinguishable
riders; a 7th+ reuses a hue.

---

## 10. Countdown, staging gate & ready strip

- **Staging gate.** The "to your bikes" screen holds until **both** the
  `staging_buffer_ms` has elapsed **and** every rider is at **RPM 0** — you can't
  progress to the stoplight with the cranks still turning. When the buffer elapses
  but bikes are still moving, the progress bar is replaced by a **diagonal-striped
  indeterminate "waiting" bar** until everything stops.
- **`CountdownStoplight`** (presentational): the sequence is **ALL3 → RED → YELLOW →
  GREEN** — earlier beats flash all three lamps ("get set"), then the last three
  beats are red, yellow, and green-at-GO (so yellow never holds for two beats). The
  **container** plays the per-tick beep and the GO sound; the engine goes live on
  **GREEN** (§3).
- **`RiderReadyStrip`** (staging + countdown): one chip per rider — avatar, name,
  live RPM, and compliance: **READY ✓** when not pedalling, **WAIT ⚠** (amber,
  pulsing) when pedalling early. Anyone still "WAIT" *before* green earns a false
  start.

---

## 11. Officiating events (DNF / penalty)

When a rider newly DNFs or is newly penalized, the container records an event
`{ id, type: 'dnf'|'penalty', riderId, displayName, seriesIndex, distanceM }` into
`raceEvents` and enqueues a **toast**:

- **`CycleEventToast`** — a single-slot, non-blocking toast (🛑 DNF / ⏱️ penalty)
  auto-dismissing after ~4 s (or on click). Extra events queue. **Never pauses the
  race.**
- **Chart markers** — `raceEvents` is threaded into `DistanceChart`, which
  re-projects each event onto the rider's lane as a persistent glyph chip. *(These
  live in `DistanceChart` because that's where the chart's coordinate projection
  lives.)*
- Logs: `cycle_game.rider_dnf`; the penalty lifecycle logs `penalty_entered` →
  `penalty_awaiting_stop` → `penalty_cleared`; and `cycle_game.cadence_change` on
  every sensor connect/drop transition.

---

## 12. Results & recap

- **`RaceResults`** — a Mario-Kart-style finish board. Standings animate in
  (slide-into-podium, rows fly/fade in, metrics count up — the count-up is disabled
  under `prefers-reduced-motion`, and tests pass `animate={false}`), the full
  **lap-by-lap splits table** is shown (`SplitsChart final`), 🥇🥈🥉 medals (numeric
  for 4+), the winner gets a 👑 and a larger avatar, DNF rows show "DNF", and a ⏱️
  badge marks false starts. The board **auto-returns to the lobby** after
  `results_dwell_s` with a visible countdown, and a manual **Exit** button leaves
  immediately. Metric is finish-time (distance race) or distance covered (time race).
- **`RaceRecap`** — full-screen modal that replays a saved race by feeding
  synthesized rider state into `CycleRaceScreen` over ~12 s regardless of race
  length, with play/pause + scrub, then the final standings. **RPM is always 0 in
  recap.**
- **Finish race vs Cancel.** During racing the container shows **"Finish race"**
  (forfeits unfinished riders as DNF and **saves**) alongside **Cancel** (discards
  the race entirely).

---

## 13. The speedometer

`CycleSpeedometer` renders an SVG gauge: cadence-band arcs, ticks/labels, an RPM
needle (`speedometerGeometry.needleAngleDeg`), a centered avatar, a distance
odometer, and the RPM readout. The gauge **face is tinted** with a dark wash of the
rider's lane colour (a CSS `color-mix` over the deep-indigo backdrop). Ghosts render
with the `cg-ghost` treatment.

- **Per-equipment gauge scale.** The dial maxes at the rider's equipment `max_rpm`
  (e.g. 250 tricycle, 120 default) — wired per-rider via `riderLive.maxRpm`.
- **Tick spacing scales** (`tickStepsFor`) so a 250 dial isn't crowded; **bands
  scale proportionally** (`scaleBands`) so a real sprint is the top red tier.
- **Multiplier badge** (×2, ×3, ×5…) shows when the zone multiplier > 1, pinned
  top-right of the avatar.
- **Overlay states:** **FINISHED** (🏁 + placement, gauge parked) and the **PENALTY
  BOX** (⛔ FALSE START) — real (red) needle, a draining countdown bar
  (`penaltyRemainingS / penaltyTotalS`), and a pulsing **"STOP PEDALING TO CLEAR"**
  once the timer is served but they're still pedalling (`penaltyAwaitingStop`).
- **Avatar compositor layer.** `.cycle-speedometer__avatar { transform: translateZ(0);
  will-change }` so the needle's per-tick repaint doesn't flicker the overlaid avatar.

---

## 14. Sound & music

`playSound(url, { volume })` is a no-throw one-shot (`new Audio().play()`, swallows
autoplay rejections; no-op on a falsy url). The container drives a lifecycle
soundtrack — lobby loop (idle), ready cue (staging), start jingle + per-tick beeps
(countdown), random racing track (racing), outro (results) — all scaled by the
master volume.

---

## 15. Persistence

### Record shape (`buildRaceRecord` → v1)

```yaml
version: 1
race:
  id: "20260602143012"        # YYYYMMDDHHmmss (local time)
  date: "2026-06-02T21:30:12.000Z"   # ISO (see gotcha)
  mode: simultaneous
  win_condition: distance     # or "time"
  goal_m: 3000                # distance races
  # time_cap_s: 300           # time races
  interval_seconds: 1
  background_plex_id: null
  course_id: null           # featured-course id for ladder rides; null for lobby races
participants:
  <userId>:
    display_name: "Milo"
    equipment: "cycle_ace"
    final_distance_m: 3000
    final_time_s: 142          # null if DNF / time race
    placement: 1               # null if DNF
    distance_series: "<RLE>"   # SessionSerializerV3-encoded
    hr_series: "<RLE>"
    rpm_series: "<RLE>"
    zone_series: "<RLE>"
```

### Storage

`household[-{id}]/history/fitness/cycle-races/{YYYY-MM-DD}/{raceId}.yml`. The
`{YYYY-MM-DD}` folder is **sliced from the raceId** (so folder and id can never
disagree), built from **local** time — there is **no UTC foldering bug**.

### API (`/api/v1/fitness/cycle-races`)

| Route | Purpose |
|---|---|
| `POST /cycle-races` | save `{ record, household? }` → `{ ok, raceId, file }` |
| `GET /cycle-races/ladder?week=YYYY-Www` | this week's (or a specified week's) featured-course ladder — see §16 |
| `GET /cycle-races/personal-bests?userId=&courseId=` | a rider's all-time PB on a course — see §16 |
| `GET /cycle-races/:raceId` | one race |
| `GET /cycle-races?date=YYYY-MM-DD` | races on a day |
| `GET /cycle-races?courseId=… \| winCondition=…&goalM/timeCapS=…` | ghost candidates |
| `GET /cycle-races` | list date folders |

`CycleRaceService` is a thin wrapper over `YamlCycleRaceDatastore`
(`save / get / listByDate / listDates / findGhostCandidates`), plus the ladder /
personal-best queries described next. Wired in `bootstrap.mjs`.

> `ladder` and `personal-bests` are registered **before** `/:raceId` in the router —
> otherwise Express would swallow them as a raceId lookup.

---

## 16. Weekly ladder

A **featured course** rotates weekly: everyone on the household rides it
asynchronously through the week, a live ladder ranks best attempts, and the lobby's
**"This week's course"** card offers a one-tap **Ride It** that pre-arms a rival
ghost. Results then call out ladder movement. Built on the same records and index
as the rest of persistence (§15) — there is no separate ladder datastore.

### Config (`cycle_game` app config)

| Key | Default | Purpose |
|---|---|---|
| `featured_courses` | `[]` | Ordered list of course presets: `{ id, label, win_condition, goal_m \| time_cap_s }` (plus any of the usual course keys, e.g. `lap_length_m`, `background_plex_id`) |
| `featured_course_override` | `null` | Course `id` to pin as this week's course, bypassing rotation |

A course with no `id` is skipped. An empty (or all-skipped) `featured_courses` list
means no featured course — the ladder card doesn't render and the ladder endpoint
returns `404`.

### Rotation

The active course is `featured_courses[isoWeekNumber % length]` — the **ISO-8601
week number** of the current date modulo the list length, so the rotation is
**deterministic** (no cron, no stored "current course" state; the same week number
always resolves the same course). `featured_course_override` **wins** over
rotation when it names a course present in the list.

**Week window:** local **Monday 00:00 → the following Monday 00:00, exclusive** —
the same local-day convention the datastore already uses for its `{YYYY-MM-DD}`
folders, so there's no timezone disagreement between "this week" and where a race
actually filed.

### Endpoints

**`GET /cycle-races/ladder?week=YYYY-Www`** — `week` is optional (defaults to the
current week); an out-of-range or malformed value is a `400`. Response:

```json
{
  "course": { "id": "sprint-1500m", "label": "Sprint 1500", "win_condition": "distance", "goal_m": 1500 },
  "week": { "start": "2026-06-29", "end": "2026-07-06" },
  "standings": [
    { "userId": "kckern", "bestValue": 148.2, "raceId": "20260630091200", "attempts": 3 },
    { "userId": "milo",   "bestValue": 161.4, "raceId": "20260629174501", "attempts": 1 }
  ],
  "allTimeRecord": { "userId": "kckern", "bestValue": 141.0, "raceId": "20260512080000", "date": "2026-05-12" }
}
```

No featured course configured → `404`. No qualifying races in the window → `200`
with `standings: []`; `allTimeRecord` reflects all-time history independent of the
window and may still be populated; it is `null` only when the course has no
qualifying race in its entire history.

**`GET /cycle-races/personal-bests?userId=&courseId=`** — both params required
(missing either is a `400`). Response:

```json
{ "userId": "milo", "courseId": "sprint-1500m",
  "best": { "bestValue": 161.4, "raceId": "20260630174501", "date": "2026-06-30" } }
```

`best` is `null` when the rider has no qualifying attempt. If `courseId` isn't in
`featured_courses`, the course definition (win condition / goal) is inferred from
any matching index entry — so a rider's PB on a *retired* featured course still
resolves.

### Ladder semantics

- **Matching a race to a course:** `race.course_id === course.id`, **or** (legacy
  fallback, for races predating `course_id`) `win_condition` matches **and** the
  goal matches — `goal_m` for a distance course, `time_cap_s` for a time course.
- **Attempt value:** a **distance** course ranks by `final_time_s` (lower is
  better; a participant with a null `final_time_s` — DNF or unfinished — doesn't
  qualify). A **time** course ranks by `final_distance_m` (higher is better; any
  value `> 0` qualifies).
- **Best per rider:** each rider's single best qualifying attempt in the window;
  `attempts` counts all their qualifying attempts (not just the best). A
  multi-rider race counts every live participant independently.
- **Eligibility:** ghosts (`ghost:*` participant ids) never qualify. Guests do —
  the ladder has no household-only restriction.
- **Ties:** the earlier attempt (smaller/earlier raceId) holds the rung.
- **All-time record:** the same matching/ranking rules over full history, no week
  window.
- Ranking runs entirely off the month-shard **index** (§15/§2) — never a full scan
  of the YAML race files.

### Lobby & results UX

- **"This week's course" card** (`FeaturedCourseCard`, lobby) shows the course
  label, a days-remaining chip, the ranked standings (avatar, name, formatted best
  value), and the all-time record. It fetches the ladder on lobby mount; a fetch
  failure hides the card and logs a `warn` — riders can still race the featured
  course manually, since matching is by `course_id`, not by entry point.
- **Ride It** builds the race through the normal `buildRaceConfigFromCourse` path
  (which sets `course_id` for free) and **pre-arms a rival ghost**:
  - the rider directly assigned to the first bike, if **ranked** on the ladder →
    the rider **one rung above** becomes the ghost;
  - if that rider is the **leader** → their own **all-time personal best**
    (via the personal-bests endpoint) becomes the ghost;
  - if **unranked** (or no rider assigned yet) → the **tail** (lowest-ranked)
    rider becomes the ghost;
  - no ladder data at all → no ghost; the race proceeds plain.
  Ghost lookups are best-effort: any fetch failure just starts the race without a
  ghost, never blocking Ride It. The ghost is armed through the same
  record-to-candidate / candidate-to-ghost pipeline the Ghost Picker uses (§17),
  not a separate mechanism.
- **Results ladder-movement callout.** After a race whose `course_id` matches the
  ladder snapshot taken at Ride It time, and a successful save, the ladder is
  refetched and diffed per live (non-ghost) rider against that snapshot. Each
  mover gets a one-line note on the results board — a lead ("Ladder lead this
  week!") or a rank + gap to the rung above ("2nd this week — 0:04 behind Dad").
  A refetch/diff failure is logged and silently skipped; it never blocks the
  results board.

### Index shards

The ladder reads from the same self-healing index the datastore already
maintains: `household[-{id}]/history/fitness/cycle-races/_index/{YYYY-MM}.json`.
Shards are **disposable** — deleting one just forces a rebuild (per-day mtime
check) on the next read; nothing else depends on their presence.

---

## 17. Ghost system end-to-end

1. **Record** a race → saved with `distance/hr/rpm/zone` series per participant.
2. **Discover** — the lobby loads recent races; each becomes a ghost candidate
   (winner first; score/goal inverted by win condition).
3. **Select** — focus a card, then the **roster submenu** lets you pick which ghosts
   to include (default all). `onSelectGhost` decodes the chosen participants' series,
   builds `ghost:<raceId>:<id>` riders, and **locks** the race type/value.
4. **Replay** — the engine interpolates distance and nearest-samples HR/RPM/zone
   each tick; ghosts never DNF and are never penalized.

---

## 18. Telemetry & logging

All cycle-game logging goes through the structured framework (`getLogger().child`,
component `cycle-game` / `cycle-game-ui` / `cycle-event-toast` / `cycle-distance-chart`
/ `cycle-speedo-row`). The fitness app routes these to the per-session JSONL
(`media/logs/fitness/<start>.jsonl`, which survives redeploys). Events are correlated
by `raceId` (+ `elapsedS` where relevant).

- **Spine (INFO, always on)** — `phase_transition` (`{from,to}`), `config` (full
  effective config + zone multipliers, once at start), `ghost_rider` (per-ghost
  series point-counts), `staged` / `staging` / `race_started` / `race_finished` /
  `race_saved`, `rider_assigned` / `rider_unassigned`, `rider_dnf`,
  `penalty_entered` / `penalty_awaiting_stop` / `penalty_cleared`, `cadence_change`,
  `finish_forced`, `cancelled`, `recap_*`, `volume_set`, `history_loaded`.
- **Firehose (DEBUG, off by default)** — `cycle_game.tick`: one event/second with a
  per-rider array `{ rpm, cadenceConnected, hr, zoneId, multiplier, distanceM,
  penalized, finished }`, read from post-resolution engine state.
- **Failures (WARN/ERROR)** — `music_unavailable` / `music_deferred` / `sfx`,
  `race_saved` / `history_error`.

The fitness app currently configures the root logger at **`debug`** while the
cycle-game is under active tester debugging. Revert to `info` once stable.

---

## 19. Nuances & gotchas

- **Layout is static, not director-driven.** The old per-tick `raceDirector` /
  `racePanels` zone-assignment engine (and the `Rankings` / `LapTable` / `CameraZoom`
  panels) were retired. The layout is now two fixed field-size modes (§9) — simpler
  and flicker-free. Don't reintroduce dynamic panel shuffling.
- **Ghost needle reads 0 for old recordings.** `rpm_series` was added *after*
  `hr_series`; ghosts recorded in between have HR + distance but no RPM → the needle
  sits at 0. Not a bug, not backfillable. (Recap always shows 0 RPM by design.)
- **Config is read at startup.** Changing `cycle_game` config (incl. courses, zones,
  `lap_length_m`, penalties, `results_dwell_s`) requires a **container restart**.
- **Lap panels are config-gated.** Splits, the oval lap label, and lap splits only
  appear when the **effective** lap length > 0 (per-course override or app config,
  via `effectiveLapLength`). With laps off, the splits panel still shows a live order.
- **`lap_length_m` default is 400, with a whole-race shortcut.** A distance race
  whose goal is shorter than the lap runs as a single lap (`effectiveLapLength`).
- **Multi-sensor cadence is the fastest live sensor.** A bike with `cadence: [a, b]`
  is one unit: the fastest currently-connected sensor wins, so one flaky sensor's
  10–20 s dropouts don't flatline the bike. A simultaneous 1-tick gap on *all* sensors
  can still blip; `rpmDuringGap` bridges longer gaps.
- **Race starts on GREEN.** The engine goes live at the green light, ~0.8 s before
  the race screen appears. A false start is only pre-green pedalling
  (`markFalseStarters`); pedalling *on* green is legal.
- **Synthwave lane palette, capped at 6.** Rider colours avoid the HR-zone hues and
  the reserved chrome (cyan/magenta); a 7th+ rider reuses a hue.
- **`date` metadata is UTC, the folder is local.** Harmless — nothing files by `date`
  (foldering uses the raceId).
- **`showSpeedos={false}`** omits `speedoRow` from the panels map, so its zone renders
  empty.
- **SCSS token path.** Panel styles in `panels/` must `@use '../cgTokens'` (the token
  partial lives one dir up in `CycleGame/`). jsdom doesn't compile SCSS, so this class
  of break is invisible to unit tests — verify visually.
- **Every layout zone is clipped (`overflow:hidden`).** Panels and the chart's zoom
  animation must stay within their cell; the chart needs the grid chain to fill the
  screen (`.race-layout` + slot `height:100%`) or its absolute SVG collapses to 0.
- **Don't size a panel from its own measured height** in an `auto`-height grid track —
  that's a measure→resize→measure thrash (it bit `SpeedoRow`). Size from width.
- **Penalty box ≠ a fixed timer.** A boxed rider isn't released until they return to
  RPM 0 *after* the timer — keep pedalling and they stay boxed (`awaitingStop`).
- **History list shows the winner avatar, not a crown.** The 👑 is only on the
  `RaceResults` board; the History table uses the winner's avatar + runner-up
  crescents (`recordRow.buildRecordRow`).

---

## 20. Testing

- **Pure logic (vitest):** `lapModel`, `distanceModel`, `CycleRaceEngine` (incl. lap
  splits), `effectiveLapLength`, `cycleGameLobby`, `raceRecord`, `formatDistance`,
  `equipmentRpm` (gauge limits, abuse clamp, `rpmDuringGap` hold-vs-cooldown),
  `chartTrim` (`plotStartIndex`), `chartZoom` (`nextZoomLevel`), `povWorld`/`povFollowCam`,
  `ovalTrackModel`, `participantIdentity` (ghost→source), `recordRow`,
  `lineColors` (no HR-zone/chrome clash), `speedometerGeometry` (`tickStepsFor`,
  `scaleBands`), `CycleRaceController` (penalty box RPM-0 exit, `finishNow` forfeit).
- **Components (vitest + @testing-library):** `CycleRaceScreen` (clock, speedometers,
  lanes, penalty banner, event markers, `showSpeedos`, `zoneBox` forwarding),
  `RaceLayoutManager` (mode by field size, splits-before-chart), `DistanceChart`,
  `SplitsChart` (sticky/live-order/final), `PovGrid`, `OvalTrack`, `SpeedoRow`,
  `CycleSpeedometer`, `CountdownStoplight` (ALL3→RED→YELLOW→GREEN), `RaceResults`
  (exit button, count-up under `animate={false}`).
- **Live (Playwright):** `tests/live/flow/fitness/cycle-game-*.runtime.test.mjs`
  drive the simulator through full lifecycles via `FitnessSimHelper`
  (`launchCycleGame`, `setEquipmentRider`, `setRpm`).
- **Run unit tests:** `npx vitest run --config vitest.config.mjs <path>`.

> Visual verification (kiosk 1280×720) is the only way to catch SCSS/layout
> regressions — jsdom asserts structure, not pixels.
