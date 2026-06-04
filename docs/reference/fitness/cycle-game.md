# Cycle Game (Cycle Race) — Reference

**Status:** Current as of 2026-06-03.

> **Not to be confused with the Cycle _Challenge_.** This document covers the
> **Cycle Game / Cycle Race** — the multi-rider racing widget (`cycle_game`
> fitness module: lobby → countdown → live race → results, with ghosts, a
> scoring engine, and a layout director). The **Cycle Challenge**
> (`cycing-challenge.md`, `GovernanceEngine-cycle*`, the `.cycle-challenge-demo`
> / `__fitnessGovernance` flow) is a *separate* governance-driven endurance
> feature and is **out of scope here**. They share the word "cycle" and nothing
> else.

---

## 1. What it is

A head-to-head stationary-bike racing game shown on the fitness TV. One to six
riders (any mix of live humans and recorded "ghosts") race either **to a distance
goal** or **for the furthest distance in a time cap**. RPM from each bike's
cadence sensor — scaled by the rider's live HR zone — accrues distance. The race
screen is a broadcast-style HUD whose panels are chosen each tick by a pure
**race director**. Finished races are saved and can later be replayed as ghosts.

### Use cases

- **Solo time-trial** — one rider, no comparator. Pace against the clock/goal.
- **Solo vs. ghost** — one human chasing a recorded past performance (the ghost
  counts as a competitor, so rankings/chart appear).
- **Group race** — 2–6 riders (humans and/or ghosts), distance or time.
- **Re-race a field** — selecting a ghost replays that race's *entire* recorded
  field as competitors.
- **Recap** — replay any saved race from the records rail (no bikes needed).

---

## 2. Architecture & file map

```
Lobby + lifecycle ────────────────────────────────────────────────────────────
  widgets/CycleGame/index.jsx                  module manifest (id: cycle_game)
  widgets/CycleGame/CycleGameContainer.jsx     orchestrator: phases, riders,
                                               courses, ghosts, ticking, saving
  widgets/CycleGame/CycleGameHome.jsx          the lobby (selection + start)
  widgets/CycleGame/RiderReadyStrip.jsx        staging/countdown compliance strip
  widgets/CycleGame/CountdownStoplight.jsx     3-2-1-GO stoplight (presentational)

Simulation ────────────────────────────────────────────────────────────────────
  lib/cycleGame/CycleRaceController.js          lifecycle SM + DNF + hot-start
  lib/cycleGame/CycleRaceEngine.js              tick/scoring/finish/lap splits/ghost
  lib/cycleGame/distanceModel.js                distance + zone-multiplier math
  lib/cycleGame/equipmentRpm.js                 per-equipment gauge max + abuse cap
                                                + cadence-gap RPM resolver
  lib/cycleGame/lapModel.js                     lapCount / lapProgress (overlay)
  lib/cycleGame/cycleGameLobby.js               buildRaceConfigFromCourse, formatClock
  lib/cycleGame/formatDistance.js               m / km formatting

Race screen + director ─────────────────────────────────────────────────────────
  widgets/CycleGame/CycleRaceScreen.jsx         screen shell: chrome + director wiring
  lib/cycleGame/deriveRaceSnapshot.js           engine state → semantic signals
  lib/cycleGame/racePanels.js                   panel descriptor registry
  lib/cycleGame/raceDirector.js                 zone-assignment engine (pure)
  widgets/CycleGame/RaceLayoutManager.jsx       renders decision → zones
  widgets/CycleGame/panels/PanelSlot.jsx        per-zone mount + enter animation
  widgets/CycleGame/panels/SpeedoRow.jsx        bottom gauges row
  widgets/CycleGame/panels/DistanceChart.jsx    climbing lanes + tags + event markers
  widgets/CycleGame/panels/Rankings.jsx         roster sorted by lead
  widgets/CycleGame/panels/LapTable.jsx         per-lap split table
  widgets/CycleGame/panels/OvalTrack.jsx        avatars circling a velodrome
  widgets/CycleGame/panels/CameraZoom.jsx       transient auto-framed gap view
  widgets/CycleGame/CycleSpeedometer.jsx        a single gauge
  lib/cycleGame/speedometerGeometry.js          gauge ticks/bands/needle geometry
                                                (tickStepsFor, scaleBands)
  lib/cycleGame/chartTrim.js                    plotStartIndex — first-movement line start
  lib/cycleGame/lineColors.js                   LINE_COLORS — per-rider lane palette

Results / recap / events ───────────────────────────────────────────────────────
  widgets/CycleGame/RaceResults.jsx             final standings + medals + legend
  widgets/CycleGame/RaceRecap.jsx               replay a saved race
  widgets/CycleGame/CycleEventToast.jsx         transient DNF/penalty toast
  lib/cycleGame/raceRecord.js                   buildRaceRecord (persist shape)
  lib/cycleGame/recordRow.js                    buildRecordRow — History-table row model
  lib/cycleGame/participantIdentity.js          resolve ghost:<id> → real face/name
  lib/cycleGame/playSound.js                    one-shot SFX helper

Persistence (backend) ──────────────────────────────────────────────────────────
  1_adapters/persistence/yaml/YamlCycleRaceDatastore.mjs   YAML read/write
  3_applications/fitness/services/CycleRaceService.mjs      save/get/list/ghosts
  4_api/v1/routers/fitness.mjs                              /cycle-races routes
```

**Entry / registration.** `index.jsx` exports `CycleGameContainer` and a manifest
`{ id: 'cycle_game', name: 'Cycle Game', icon: '🚴' }`. It is reached at
`/fitness/module/cycle_game` (the legacy module id is `cycle_game`).

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
      ▲                                              │ staging_buffer_ms elapses
      │ back to home                                 ▼
   results ◄──────────── racing ◄──── countdown ───┘
   (standings)   all done /   (live)   3·2·1·GO
                 time cap                (engine starts at GO)

   Cancel from staging/countdown/racing ─────────► idle
```

| React phase | Controller phase(s) | Rendered | Enter trigger | Exit trigger |
|---|---|---|---|---|
| `idle` | — / `cancelled` | `CycleGameHome` (lobby) + history load | mount; back-to-home; cancel | Start (when `canStart`) |
| `staging` | `staged` | `RiderReadyStrip` ("to your bikes") | Start, if `staging_buffer_ms > 0` | timeout after `staging_buffer_ms` |
| `countdown` | `staged`→`countdown` | `CountdownStoplight` + `RiderReadyStrip` | staging timeout (or Start if buffer 0) | countdown reaches 0 |
| `racing` | `racing` | `CycleRaceScreen` + `CycleEventToast` | countdown hits 0 → engine begins | all riders finished/DNF, time cap, or operator **Finish race** |
| `results` | `finished`→`results` | `RaceResults` | engine `finished` | back-to-home → `idle` |

- **Tick cadence:** `RACE_TICK_MS = 1000` (1 Hz). One `setInterval` per phase
  (countdown, then racing); the racing interval is **not** torn down mid-race, so
  ticking stays even. Live session/vitals are read through refs so the interval
  closure never re-subscribes.
- **Cancel** (`onCancel`): `controller.cancel()` → controller phase `cancelled` →
  React `idle`. Emits `cycle_game.cancelled`. Discards the race.
- **Finish race** (`onFinishRace`): `controller.finishNow()` → `showResults()` →
  React `results`. Forfeits unfinished riders (DNF) and **saves**. Emits
  `cycle_game.finish_forced`.
- **`canStart`** = a race type is chosen **and** ≥ 1 rider is claimed to a bike.

---

## 4. The lobby (`CycleGameHome`)

The lobby is a pure presentational component; all state and handlers live in
`CycleGameContainer`. Flows:

1. **Race type** — three tiles: **Distance** ("first to the line"), **Time**
   ("furthest in the clock"), **Ghost** ("chase a past race"). Selected tile is
   `aria-pressed`.
2. **Value** — preset tiers plus a +/- custom stepper (in a reserved-height slot
   so the layout doesn't jump):
   - Distance tiers: **100 / 300 / 1000 / 2500 (default) / 5000 m**.
   - Time tiers: **60 / 120 / 180 / 300 (default) / 600 s**.
   - Picking a ghost **locks** type + value to that recording.
3. **Starting grid** — one `BikeSlot` per cadence bike, laid out like a start
   grid (lane number per slot). The **entire slot** is one click/touch target
   (icon + the "+ add rider" hint) — tapping anywhere opens the **rider picker**.
   Filled slots show the equipment icon (RPM-rotated) with the rider's avatar
   overlaid — **not** the rider's name (a deliberate decision; a test asserts
   names are absent on slots).
4. **Rider picker** (modal) — people grouped into **Household / Family / Guests**
   tabs (tabs only show when ≥ 2 groups exist); each person tile shows avatar,
   name, and a "live" badge if they have an active HR strap. Built-in anonymous
   **Guest (Adult)** and **Guest (Kid)** always lead the Guests tab. `Escape`
   closes (`useEscapeToClose`).
5. **Ghost picker** — past races grouped by day (Today / Yesterday / weekday),
   most-recent-first. **Two-tap selection:** first tap scrolls + focuses the card
   ("Tap again to choose"), second tap commits. Each card shows participant
   avatars, the winner's score, the goal, and the time of day.
6. **History** — recent saved races as a compact **columnar table** (winner,
   goal-marked metric columns, when), most-recent-first; row model built by
   `recordRow.buildRecordRow`. Ghost participants resolve to the real rider's face
   and name via `participantIdentity` (no generic guest avatar) and carry the
   `cg-ghost` tint. Tapping a row opens the **Recap**. Empty state: "No races yet."
7. **Volume** — touch +/- with a readout ("Muted" or a percentage).
8. **Start** — disabled until `canStart`; checkered-flag icon.

---

## 5. Riders, ghosts, guests

**Building the field** (`buildRiders`): for each cadence bike with a claimed
rider, push `{ userId, displayName, equipmentId, wheelCircumferenceM }`. If a
ghost is selected, append its recorded participants as additional riders carrying
`ghostSeries / ghostHrSeries / ghostRpmSeries / ghostZoneSeries / ghostIntervalS`
and `equipmentId: null`.

- **Claiming a rider to a bike** is external to React: `session.setEquipmentRider`
  (mirrors the hardware rider-select button). `assignVersion` is bumped to force a
  re-read. Emits `cycle_game.rider_assigned` / `rider_unassigned`.
- **Eligible people** come from the household users config (groups primary /
  secondary / family / friends / guests, mapped to Household / Family / Guest
  categories) plus the two built-in anonymous guests. Sorted HR-active-first, then
  alphabetically.
- **Display names** use the relational resolver (e.g. "Dad"/"Mom") when ≥ 2 HR
  riders are present — see `display-name-resolver.md`.
- **Ghost ids** are `ghost:<raceId>:<sourceUserId>`. The race screen / results
  strip the middle segment to resolve the original user's avatar. Ghost display
  names get a 👻 suffix.

---

## 6. Courses, win conditions & config

`buildRaceConfigFromCourse(course, opts)` merges a course preset + runtime opts
into the engine config. Precedence highlights:

- `winCondition` ← `course.win_condition` ?? `opts` ?? `'distance'`.
- `goalM` (distance) ?? `3000`; `timeCapS` (time) ?? `300`.
- `lapLengthM` ← **`course.lap_length_m`** (per-course override) ?? `opts.lapLengthM`
  (app config) ?? `0`.
- `mode` is always `'simultaneous'`; `intervalMs` is `1000`.

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
| `race_idle_dnf_s` | 20 | Seconds of zero RPM before a rider is DNF'd |
| `hot_start_penalty_s` | 0 | False-start penalty seconds (0 = disabled) |
| `lap_length_m` | 0 | Lap length for the lap overlay (0 = laps off) |
| `default_background` | null | Ambient background Plex id for the race screen |
| `music_volume` | 0.55 | Background music level (0–1) |
| `sounds` | {} | SFX + music playlist URLs |

> **Distance/time *tiers* are frontend constants** in `CycleGameHome`, not config.
> The *defaults* above are config.

### Per-equipment RPM (equipment config, not `cycle_game`)

Each cadence bike in the equipment config carries:

| Key | Purpose |
|---|---|
| `max_rpm` | Gauge dial scale for that equipment (e.g. tricycle **250**, default 120). Display only — never clamps the counted RPM. |
| `abuse_max_rpm` | Optional clamp on the RPM that *counts* toward distance, for equipment that can be hand-spun (e.g. the ab roller). Absent ⇒ uncapped — a real bike's cadence is always legitimate. |

`equipmentRpm.resolveRpmLimits(equipment)` reads these; `clampCountedRpm` applies
the abuse cap. The HR-zone `distance_multiplier`s (cool/active ×1, warm ×2, hot
×3, fire ×5) live in the shared fitness `zones` config and scale distance-per-RPM
so cranking resistance (higher HR zone) rewards more distance.

---

## 7. The engine (`CycleRaceEngine`)

Pure simulation class. `tick(inputs)` advances `elapsedS` by the interval and, per
rider:

- **Live rider:** `rotations = (rpm/60) × intervalS`; `distanceΔ = rotations ×
  wheelCircumferenceM × zoneMultiplier`. Zone multiplier comes from the rider's
  current HR zone (`distanceModel.zoneMultiplierFor`), falling back to
  `hrlessMultiplier` when there's no zone.
- **Ghost rider:** distance is **linearly interpolated** from `ghostSeries` at the
  current elapsed time; HR/RPM/zone are **nearest-sample** lookups from the
  recorded arrays. (An implicit `t=0 → 0 m` sample is prepended for exact
  interpolation.)
- **Finish (distance race):** when `cumulativeDistanceM ≥ goalM`, stamp
  `finishTimeS`, clamp distance to the line, and park the gauge (rpm 0). The race
  is `finished` when **every** rider has a finish time. **Time race:** `finished`
  when `elapsedS ≥ timeCapS`.
- **Lap splits (overlay):** if `lapLengthM > 0`, each tick detects lap-boundary
  crossings between the pre- and post-update distance and pushes the
  **interpolated crossing time** to the rider's `lapSplits[]` (computed beside the
  finish-detection logic — the engine is the only layer that sees every tick).

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
  `(d mod L) / L` (0..1). Both return 0 when `L ≤ 0`. *(Example: d=1250, L=400 →
  count 3, progress (1250 mod 400)/400 = 50/400 = 0.125.)*

---

## 8. The controller (`CycleRaceController`)

Wraps the engine with the lifecycle, **DNF**, **hot-start penalty box**, and the
operator **finish-now** action. `getState()` returns `{ phase, countdownRemaining,
dnf[], penalized[], penaltyInfo{}, engineState }`.

- **Countdown:** `startCountdown()` then `countdownTick()` decrements from
  `startCountdownS`; reaching 0 begins racing (`_beginRacing` builds the engine).
- **Idle → DNF:** per non-ghost rider, an idle timer increments while `rpm === 0`
  and resets when pedalling; at `race_idle_dnf_s` the rider joins `dnf` and their
  input is zeroed for the rest of the race.
- **Hot-start penalty box (false start):** on the **first** racing tick, any
  non-ghost rider pedalling at the green light (`rpm > 0`) enters the penalty box
  for `hot_start_penalty_s`. A boxed rider's meter is locked (input zeroed, no
  distance). The box releases only when **both** the timer has elapsed **and** the
  rider has returned to **RPM 0** — so someone who keeps pedalling stays boxed
  indefinitely. `getState().penaltyInfo[userId] = { remainingS, totalS,
  awaitingStop }`, where `awaitingStop` means the timer is served but they're still
  pedalling. Disabled when `hot_start_penalty_s = 0`.
- **Finish now (`finishNow`):** the operator "Finish race" control marks every
  non-ghost rider who hasn't crossed the line as a forfeit (adds them to `dnf`) and
  ends the race → results are finalized and **saved** (unlike `cancel()`, which
  discards). No-op outside the racing phase.
- **Ghosts are exempt** from idle/DNF, the penalty box, and forfeit (they always
  replay their recording).

### Cadence broadcast-gap tolerance (container, racing only)

The race tick reads each bike's cadence in `CycleGameContainer`. A **connected**
reading — even a real 0 — is the truth and is used + remembered (a short rolling
history of recent readings). While the sensor is **disconnected** (an ANT+
broadcast gap), the counted RPM is resolved by `equipmentRpm.rpmDuringGap`: it
**holds the last good reading** through the gap (so a momentary dropout no longer
flatlines to 0), **unless** the rider was trending *down* into the gap — a genuine
cooldown-to-stop is honoured by dropping to 0. This only applies during an active
race; the lobby/staging strips show raw cadence.

---

## 9. The race screen & director

`CycleRaceScreen` is **pure**. Each render it builds a snapshot from current engine
state, asks the director which panel owns each layout zone, and renders the
decision. Timing state is threaded through sticky refs (the same pattern as the
chart's log/linear `logRef`), so the director stays a pure function.

```
engine getState()
  → deriveRaceSnapshot(state, {lapLengthM}, prevSnapshot)   pure selectors
  → raceDirector(snapshot, prevDecision, elapsedS)          pure assignment
  → <RaceLayoutManager decision panels>                     dumb shell
  → panels: SpeedoRow · DistanceChart · Rankings · LapTable · OvalTrack · CameraZoom
```

### 9.1 Snapshot signals (`deriveRaceSnapshot`)

Edge detection uses `prevSnapshot`. Produces:

- **Composition:** `fieldSize` (**includes ghosts**), `humanCount`, `ghostCount`,
  `isSolo` (`fieldSize === 1` — one entity, no comparator), `lapsEnabled`.
- **Phase:** `PRE → EARLY (<15%) → MID → FINALE (>85% or any final-lap) →
  FINISHED`, with **hysteresis bands** (e.g. leaves FINALE only below 80%) so it
  can't flap; **MID is sticky** (only FINALE/FINISHED leave it).
- **Tension:** `leaderGapM`, `tightestPairGapM` (photo-finish), `lapDeltaMax`
  (about-to-be-lapped), `closingRateMPS`.
- **Drama events (edge-triggered):** `LEAD_CHANGE`, `RIDER_FINISHED`,
  `LAPPING_IMMINENT`, `PHOTO_FINISH`, `FINAL_LAP` — each `{ type, riderIds,
  firedAtClock }`.

### 9.2 Panel registry (`racePanels`)

Each panel declares `{ id, zones (best-first), sizeHint, cycles, candidacy(snap),
priority(snap), transient }`:

| Panel | Candidacy | Priority |
|---|---|---|
| `speedoRow` (bottom) | always | constant-high |
| `distanceChart` (topLeft/Center) | `fieldSize ≥ 2 \|\| !lapsEnabled` ¹ | rises with spread |
| `rankings` (topRight/Center) | `fieldSize ≥ 2` (ghost counts) | rises with `leaderGapM` |
| `lapTable` (any top) | `lapsEnabled` | **boosted when `isSolo`** |
| `ovalTrack` (topCenter/Left) | `lapsEnabled && fieldSize ≥ 2` | rises with `lapDeltaMax` |
| `cameraZoom` (topCenter, focus) | event-driven only | spikes on trigger |

¹ The chart shows solo **without** laps (a single climbing line reads as pace
toward the goal); it's suppressed only for solo **with** laps, where the lap table
takes the stage. `cameraZoom` is the only **transient**: `{ minHoldS: 6,
cooldownS: 10, triggers: [LAPPING_IMMINENT, PHOTO_FINISH] }`.

### 9.3 Director algorithm (`raceDirector`)

Pure `(snapshot, prevDecision, clock) → decision`, four stages:

1. **Eligibility + score** — keep candidates, score by `priority`.
2. **Transient promotion** (highest precedence) — promote the camera on a trigger
   if past `cooldownS` **since last release**; **hold** it for `minHoldS` after the
   event clears (anti-flicker); then release.
3. **Greedy assignment** — walk high→low; each panel claims its best free zone;
   overflow goes to a per-zone cycle pool. Protected by a **min dwell** (5 s) and
   **score hysteresis** (a challenger must beat the incumbent by ~15%), with the
   dwell gated on the incumbent still being a candidate.
4. **Cycling** — a zone with > 1 pooled candidate and a cycling lead rotates every
   `CYCLE_DWELL_S` (8 s), pool re-sorted by current relevance, and won't evict a
   freshly-assigned panel (dwell-aware).

All timing state lives in `prevDecision` (no internal timers) — fully unit-tested
on scripted snapshot sequences.

### 9.4 Layout manager & zones

`RaceLayoutManager` is a CSS-grid shell: a top band of three zones
(`topLeft / topCenter / topRight`) over a wide `bottom` band. Empty zones
collapse and the top columns reflow via `--top-filled` (1 filled → full width,
2 → halves, 3 → thirds), so a solo lap-table reads as intentional, not floating.
Each zone renders its assigned panel through a `PanelSlot` **keyed by panel id at
the use site** so an in-zone swap remounts and the enter animation fires. The
clock frame and false-start banner are fixed chrome above the grid (always-on,
not director-managed).

**Solo split (one participant).** When the field is exactly one rider
(`riderIds.length === 1` — a ghost/pacer is a second entry and reverts to the
velodrome grid), `CycleRaceScreen` passes `solo` to the manager, which re-arranges
into two balanced 50/50 columns instead of top-row-over-band: the **gauge** on the
left, the **single qualifying top panel** (chart, or lap table when laps are on —
the director already chose via candidacy) on the right. The director and panel
registry are unchanged; only the rendering branches. Each half keeps its
`PanelSlot`, so the measured `zoneBox` still flows; the lone gauge uses a larger
cap (`maxGauge` 420 vs 280) so it fills its column. This kills the "tiny gauge
marooned in a void" start-state of a solo race.

> **Wiring gotcha:** the `panels` map factories in `CycleRaceScreen` are invoked
> as components by `PanelSlot.cloneElement`, which injects `{ zoneBox }`. Each
> factory **must forward `zoneBox`** (`(slot) => <Panel zoneBox={slot?.zoneBox} />`);
> a zero-arg `() => <Panel />` silently drops it, leaving `SpeedoRow` at its 96px
> gauge floor. Locked by `CycleRaceScreen.zoneBox.test.jsx`.

**Collision / overlap prevention** is *logical*, not geometric: the director's
`taken` set guarantees one panel per zone (overflow goes to the cycle pool, never
overlaps), and the CSS grid keeps zones in distinct cells, so there's no
pixel-level overlap to detect. *Within* a panel there is real collision
avoidance — `DistanceChart` 1-D de-overlaps its terminus tags, and `SpeedoRow`
never wraps. **Temporal thrash** is prevented in the director (min-dwell,
score-hysteresis, cycle-dwell, transient hold/cooldown — §9.3). **Size thrash**
was a separate failure mode: `SpeedoRow` once ran its own `ResizeObserver` on an
`auto`-height grid track, a measure→resize→measure loop that made the chart + RPM
band oscillate; it now sizes purely from the **`zoneBox`** the `PanelSlot` measures
once and injects (`gaugeRowSize` fits N gauges across the width, capped by height
and the `maxGauge` clamp), so the panel never measures itself. Layout dimensions
are monitored via debug telemetry —
`cycle_game.layout` (zone/`filledTop` changes), `cycle_game.speedo_resize`,
`cycle_game.chart_resize` — emitted only on change. There is **no active
geometric collision detector or rightsizing governor** yet (planned).

### 9.5 The panels

- **SpeedoRow** — one `CycleSpeedometer` per rider on a single line, gauge size
  computed from the injected `zoneBox` via `gaugeRowSize` (fit-across-width, capped
  by height + `maxGauge`); never self-measures (avoids the resize feedback loop).
  Renders `cycle-race-screen__speedos`; the parent omits it from the panels map
  when `showSpeedos` is false (preserving the hide behavior even though the
  director always candidates it).
- **DistanceChart** — climbing gradient lanes toward the goal line, de-overlapped
  terminus tags, log/linear auto-scale (sticky), and **officiating-event markers**
  (DNF/penalty glyphs re-projected onto the lane where they fired — see §11). A
  rider's lane **starts at first movement** (`chartTrim.plotStartIndex`): a
  penalty-boxed late starter emerges from the axis to the right of the origin
  instead of drawing a flat zero line, and a rider who never moved draws nothing.
- **Rankings** — roster sorted by lead. In a distance race, riders who've crossed
  the line **float to the top in finish order** and show a **medal + finish time**
  (🥇🥈🥉, gold row); everyone else shows running distance. Lane-colored metric;
  ghost rows dimmed.
- **LapTable** — growing table, one row per completed lap, one column per rider,
  cells = per-lap split (`splits[i] − splits[i-1]`), em-dash until completed.
- **OvalTrack** — a velodrome oval; each rider's avatar sits at `ovalPoint(lapProgress)`
  (`θ = −π/2 + progress·2π`, start at top, clockwise); ghost dashed.
- **CameraZoom** — transient "broadcast camera": `framePositions` normalizes the
  framed riders' distances to 0–100% (trailing left → leader right; all-equal →
  50%), over a drifting neon grid, with a gap connector. Promoted by the director
  during lapping / photo-finish moments.

### 9.6 Lane colors (`lineColors.js`)

`LINE_COLORS` — six neon hues (green, orange, purple, yellow, blue, pink) spaced
around the wheel, indexed by rider order (`% length`). Magenta and cyan are
**reserved for UI chrome** and never used as a rider lane, so a rider is never
confused with a selection/telemetry accent. Six entries support up to six
distinguishable riders; a 7th+ would reuse colors.

---

## 10. Countdown & ready strip

- **`CountdownStoplight`** (presentational): a 3-lamp stoplight; the lamp follows
  `remaining/total` thirds (red → yellow → green-at-GO); shows the ceiling number
  or "GO". The **container** plays the per-tick beep and the GO sound (the
  component emits nothing).
- **`RiderReadyStrip`** (staging + countdown): one chip per rider showing avatar,
  name, live RPM, and compliance — **READY ✓** when not pedalling, **WAIT ⚠**
  (amber, pulsing) when pedalling early. It visually *predicts* the hot-start
  penalty: anyone still "WAIT" at the green light earns it.

---

## 11. Officiating events (DNF / penalty)

When a rider newly DNFs or is newly penalized, the container records an event
`{ id, type: 'dnf'|'penalty', riderId, displayName, seriesIndex, distanceM }` into
`raceEvents` and enqueues a **toast**:

- **`CycleEventToast`** — a single-slot, non-blocking toast (🛑 DNF / ⏱️ penalty)
  auto-dismissing after ~4 s (+280 ms exit), or on click. Extra events queue and
  pop via `onEventToastDone`. **It never pauses the race.**
- **Chart markers** — `raceEvents` is threaded into `DistanceChart`, which
  re-projects each event onto the rider's lane (`xFor(seriesIndex)`,
  `yFor(distanceM)`) as a persistent glyph chip (`race-event-marker-{type}`).
  *(These markers live in `DistanceChart` — not the screen shell — because that's
  where the chart's coordinate projection lives.)*
- Logs: `cycle_game.rider_dnf`; the penalty-box lifecycle logs
  `cycle_game.penalty_entered` → `penalty_awaiting_stop` (timer served, still
  pedalling) → `penalty_cleared`; and `cycle_game.cadence_change` on every
  sensor connect/drop transition.

---

## 12. Results & recap

- **`RaceResults`** — standings in placement order with a **staggered reveal**;
  🥇🥈🥉 medals (numeric for 4+); winner gets a 👑 and a larger avatar; DNF rows
  show "DNF"; ⏱️ badge marks false starts; a legend appears when any DNF/penalty
  occurred. Metric is finish-time (distance race) or distance covered (time race).
- **`RaceRecap`** — full-screen modal that replays a saved race by feeding
  synthesized rider state into `CycleRaceScreen` over ~12 s (`REPLAY_TARGET_MS`)
  regardless of race length, with play/pause + scrub, then the final standings.
  **RPM is always 0 in recap** (replays don't drive the needle).
- **Finish race vs Cancel.** During racing the container shows a **"Finish race"**
  control alongside Cancel. Finish (`controller.finishNow()` → `showResults()`)
  forfeits any unfinished riders (marked DNF) and **saves** the result — for when
  the leader's done and stragglers have quit. Cancel discards the race entirely.

---

## 13. The speedometer

`CycleSpeedometer` renders an SVG gauge: cadence-band arcs, ticks/labels, an
RPM needle (`speedometerGeometry.needleAngleDeg`), a centered avatar, a distance
odometer, and the RPM readout. Ghosts render with the `cg-ghost` treatment.

- **Per-equipment gauge scale.** The dial maxes at the rider's equipment `max_rpm`
  (e.g. 250 for the tricycle, 120 default) — wired per-rider via
  `riderLive.maxRpm`. Without it the needle pinned at 120 and "flattened" for a
  hard sprint.
- **Tick spacing scales** (`speedometerGeometry.tickStepsFor`) so a 250 dial isn't
  crowded — ~12 minor ticks at any max, labelled every third (the legacy 120 dial
  keeps its 10/30 spacing).
- **Bands scale proportionally** (`speedometerGeometry.scaleBands`): the config
  cadence zones were authored for the 120 dial, so they're stretched to the actual
  gauge — a real sprint is the top red tier, not a giant red wedge.
- **Multiplier badge** (×2, ×3, ×5…) shows when the zone multiplier > 1, pinned to
  the avatar's **top-right** (clear of the HR readout in the avatar's bottom band).
- **Overlay states:** **FINISHED** (🏁 + placement, gauge parked) and the
  **PENALTY BOX** (⛔ FALSE START) — which shows the real (red) needle so the rider
  can pedal down to 0, a **draining countdown bar** (`penaltyRemainingS /
  penaltyTotalS`), and a pulsing **"STOP PEDALING TO CLEAR"** cue once the timer is
  served but they're still pedalling (`penaltyAwaitingStop`).

---

## 14. Sound & music

`playSound(url, { volume })` is a no-throw one-shot (`new Audio().play()`,
swallows autoplay rejections; no-op on a falsy url). The container drives a
lifecycle soundtrack — lobby loop (idle), ready cue (staging), start jingle +
per-tick beeps (countdown), random racing track (racing), outro (results) — all
scaled by the master volume, kept in sync as the user adjusts it.

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
disagree), and the raceId is built from **local** time
(`getFullYear/getMonth/getDate`) — there is **no UTC foldering bug**.

### API (`/api/v1/fitness/cycle-races`)

| Route | Purpose |
|---|---|
| `POST /cycle-races` | save `{ record, household? }` → `{ ok, raceId, file }` |
| `GET /cycle-races/:raceId` | one race |
| `GET /cycle-races?date=YYYY-MM-DD` | races on a day |
| `GET /cycle-races?courseId=… \| winCondition=…&goalM/timeCapS=…` | ghost candidates |
| `GET /cycle-races` | list date folders |

`CycleRaceService` is a thin wrapper over `YamlCycleRaceDatastore`
(`save / get / listByDate / listDates / findGhostCandidates`). Wired in
`bootstrap.mjs`.

---

## 16. Ghost system end-to-end

1. **Record** a race → saved with `distance/hr/rpm/zone` series per participant.
2. **Discover** — the lobby loads recent races; each becomes a ghost candidate
   (winner first; score/goal inverted by win condition).
3. **Select** — `onSelectGhost` decodes the series, builds `ghost:<raceId>:<id>`
   riders, and **locks** the race type/value to the recording.
4. **Replay** — the engine interpolates distance and nearest-samples HR/RPM/zone
   each tick; ghosts never DNF and are never penalized.

---

## 17. Telemetry & logging

All cycle-game logging goes through the structured framework (`getLogger().child`,
component `cycle-game` / `cycle-game-ui` / `cycle-event-toast` / `cycle-race-layout`
/ `cycle-speedo-row` / `cycle-distance-chart`). The fitness app routes these to the
per-session JSONL (`media/logs/fitness/<start>.jsonl`, which survives redeploys).
Every event is correlated by `raceId` (+ `elapsedS` where relevant), and every
stateful thing logs both its entry and its exit.

- **Spine (INFO, always on)** — the readable narrative: `phase_transition`
  (single chokepoint, `{from,to}`), `config` (full effective config + zone
  multipliers, once at start), `ghost_rider` (per-ghost series point-counts),
  `staged` / `staging` / `race_started` / `race_finished` / `race_saved`,
  `rider_assigned` / `rider_unassigned`, `rider_dnf`,
  `penalty_entered` / `penalty_awaiting_stop` / `penalty_cleared`,
  `cadence_change`, `finish_forced`, `cancelled`, `recap_*`, `volume_set`,
  `history_loaded`.
- **Firehose (DEBUG, off by default)** — `cycle_game.tick`: one event/second with
  a per-rider array `{ rpm, cadenceConnected, hr, zoneId, multiplier, distanceM,
  penalized, finished }`, read from post-resolution engine state, so a race can be
  reconstructed tick-by-tick.
- **Dimensions (DEBUG, on change)** — `cycle_game.layout` (zone/`filledTop`),
  `cycle_game.speedo_resize`, `cycle_game.chart_resize` — for spotting layout
  thrash.
- **Failures (WARN/ERROR)** — `music_unavailable` / `music_deferred` / `sfx`
  (sound), `race_saved` / `history_error` (persistence).

The fitness app currently configures the root logger at **`debug`** (in
`FitnessApp`) while the cycle-game is under active tester debugging, so the
firehose + dimension logs are captured. Revert to `info` once it's stable.

---

## 18. Nuances & gotchas

- **Ghost needle reads 0 for old recordings.** `rpm_series` recording was added
  *after* `hr_series`, so ghosts recorded in between have HR + distance but no RPM
  → the speedometer needle/label sit at 0. **Not a bug, not backfillable**; new
  records replay RPM correctly. (Recap always shows 0 RPM by design.)
- **Config is read at startup.** Changing `cycle_game` config (incl. courses,
  zones, `lap_length_m`, penalties) requires a **container restart**.
- **Lap panels are config-gated.** `LapTable` / `OvalTrack` (and lap splits) only
  appear when `lap_length_m > 0` (per-course override or app config). With laps
  off, the director never candidates them — non-lap races are unaffected.
- **`date` metadata is UTC, the folder is local.** The record's `date` field uses
  `toISOString()` (UTC) and can read a day off from the local folder. Harmless —
  nothing files by `date` (foldering uses the raceId).
- **Director purity is load-bearing.** `deriveRaceSnapshot`/`raceDirector` must
  never call `Date.now()` or read React state — all time via args, all memory via
  `prev*`. They run every render with refs written *during* render (idempotent at
  a fixed `elapsedS`); the app intentionally has **no `StrictMode`** wrapper.
- **Lane palette caps at 6.** A 7th+ rider reuses a hue. Magenta/cyan are reserved
  for chrome and must not become rider colors.
- **`showSpeedos={false}`** is honored by omitting `speedoRow` from the panels map
  (the director always candidates it), so the bottom zone renders empty.
- **SCSS token path.** Panel styles in `panels/` must `@use '../cgTokens'` (the
  token partial lives one dir up in `CycleGame/`); a bare `'cgTokens'` only
  resolves for files *in* `CycleGame/`. jsdom doesn't compile SCSS, so this class
  of break is invisible to unit tests — verify visually.
- **Chart height depends on the grid chain.** `DistanceChart`'s SVG is
  `position:absolute/inset:0`; it needs `.race-layout` to fill the screen and the
  slot/`__chart-wrap` to be `height:100%`, or the chart collapses to 0.
- **Don't size a panel from its own measured height** in an `auto`-height grid
  track — that's a measure→resize→measure thrash (it bit `SpeedoRow`). Size from a
  stable axis (width) instead. Watch `cycle_game.speedo_resize` / `chart_resize` /
  `layout` for regressions.
- **Tricycle RPM zeros are usually a sensor gap, not a stop.** The ANT+ cadence
  broadcast drops intermittently; the gap-hold (`rpmDuringGap`) carries the last
  reading so it doesn't flatline. A *connected* 0 (or a downward trend into the
  gap) is still treated as a real stop.
- **`max_rpm` is display, `abuse_max_rpm` is the clamp.** Raising a bike's gauge
  scale (e.g. tricycle 250) never limits the counted RPM; only `abuse_max_rpm`
  clamps (set it for hand-spinnable gear like the ab roller). Tick spacing and the
  colour bands auto-scale to the gauge max.
- **Penalty box ≠ a fixed timer.** A boxed rider isn't released until they return
  to RPM 0 *after* the timer — keep pedalling and they stay boxed
  (`awaitingStop`). This is intentional (a false start must fully reset).
- **Records surface is the History table.** The old records rail was replaced by a
  columnar History table (`recordRow.buildRecordRow`, `.cgh-records--table`).

---

## 19. Testing

- **Pure logic (vitest):** `lapModel`, `distanceModel`, `CycleRaceEngine` (incl.
  lap splits), `deriveRaceSnapshot` (phase hysteresis, edge events), `racePanels`,
  `raceDirector` (transient hold/cooldown, candidacy-gated dwell, cycling,
  hysteresis), `cycleGameLobby`, `raceRecord`, `formatDistance`,
  `equipmentRpm` (gauge limits, abuse clamp, `rpmDuringGap` hold-vs-cooldown),
  `chartTrim` (`plotStartIndex`), `participantIdentity` (ghost→source),
  `recordRow`, `speedometerGeometry` (`tickStepsFor`, `scaleBands`),
  `CycleRaceController` (penalty box RPM-0 exit, `finishNow` forfeit).
- **Components (vitest + @testing-library):** `CycleRaceScreen` (clock,
  speedometers, lanes, penalty banner, event markers, `showSpeedos`),
  `RaceLayoutManager`, and each panel.
- **Live (Playwright):** `tests/live/flow/fitness/cycle-game-lifecycle.runtime.test.mjs`
  drives the simulator through full distance/time/DNF lifecycles via
  `FitnessSimHelper` (`launchCycleGame`, `setEquipmentRider`, `setRpm`).
- **Run unit tests:** vitest is **not** on `node_modules/.bin` —
  `npx --no-install vitest run --config vitest.config.mjs <path>`.

> Visual verification (kiosk 1280×720) is the only way to catch SCSS/layout
> regressions — jsdom asserts structure, not pixels.
