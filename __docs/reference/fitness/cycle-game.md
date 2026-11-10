# Cycle Game (Cycle Race) — Reference

**Status:** Current as of 2026-06-05.

Fitness remains the context owner for sensors, safety, governance, race language, scoring, and its native surface. Future protocol integration may expose Cycle Race through the thin Gaming `RuleModule`/coordinator contracts, but this delivery does not move Fitness code or policy into Gaming.

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

- **Solo ride** — one rider and no ghost chosen. The game adds an **automatic
  pace rival** so there is always someone to chase: the rider's own best at this
  race type and length, else the household's best, else a constant "par" pace
  (§5).
- **Solo vs. ghost** — one human chasing a recorded past performance they picked
  (the ghost counts as a competitor, and no pace rival is added).
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
  widgets/CycleGame/RaceMenu.jsx               the one stop control (staging, countdown,
                                               racing): Keep racing / End race here /
                                               Discard race
  widgets/CycleGame/RiderReadyStrip.jsx        staging/countdown compliance strip
  widgets/CycleGame/CountdownStoplight.jsx     ALL3·RED·YELLOW·GREEN stoplight (presentational)

Simulation ────────────────────────────────────────────────────────────────────
  lib/cycleGame/CycleRaceController.js          lifecycle SM + parking + race close  
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
  widgets/CycleGame/CycleEventToast.jsx         transient officiating/drama toast
  lib/cycleGame/raceRecord.js                   buildRaceRecord (persist shape),
                                                raceOutcomeMeta (incomplete / stopped)
  lib/cycleGame/raceCheckpoint.js               mid-race checkpoint + how a recovered
                                                race is saved (checkpointOutcome)
  lib/cycleGame/recordRow.js                    buildRecordRow — History-table row model
  lib/cycleGame/participantIdentity.js          resolve ghost:<id> → real face/name
  lib/cycleGame/playSound.js                    one-shot SFX helper

Persistence (backend) ──────────────────────────────────────────────────────────
  1_adapters/persistence/yaml/YamlCycleRaceDatastore.mjs   YAML read/write +
                                                            _index/{YYYY-MM}.json shards
  3_applications/fitness/services/CycleRaceService.mjs      save/get/list/ghosts/
                                                            ladder/personal-bests/
                                                            rival pool
  4_api/v1/routers/fitness.mjs                              /cycle-races routes incl.
                                                            ladder + personal-bests +
                                                            rival-pool
  __app_modules/wellness/fitness/server/domain/services/cycleRivalPool.mjs
                                                            pure rival-pool domain:
                                                            request parsing, index rows
                                                            → pool entries
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
   Race menu → Discard race (staging/countdown/racing) ─► idle
   Race menu → End race here (racing only) ─────────────► results
```

| React phase | Controller phase(s) | Rendered | Enter trigger | Exit trigger |
|---|---|---|---|---|
| `idle` | — / `cancelled` | `CycleGameHome` (lobby) + history load | mount; back-to-home; **Discard race** | Start (when `canStart`) |
| `staging` | `staged` | `RiderReadyStrip` ("to your bikes") + `RaceMenu` (no End item) | Start, if `staging_buffer_ms > 0` | buffer elapsed (rolling start, §10); or **Discard race** |
| `countdown` | `staged`→`countdown` | `CountdownStoplight` + `RiderReadyStrip` + `RaceMenu` (no End item) | staging buffer elapses (or Start if buffer 0) | countdown reaches the green light; or **Discard race** |
| `go` | `racing` | `CountdownStoplight` (GREEN) — engine already live; no race menu | green light | brief hold (`GO_HOLD_MS` ≈ 800 ms) |
| `racing` | `racing` | `CycleRaceScreen` + `CycleEventToast` + `RaceMenu` | go-hold ends | distance: every live rider finished or in overtime (parked and no-sensor riders stop holding it open once a live rider has finished); time: the cap; either: every live unfinished rider away for `allParkedEndS` (15 s); or the race menu's **End race here** (→ `results`) or **Discard race** (→ `idle`) |
| `results` | `finished`→`results` | `RaceResults` | engine `finished` | manual **Exit** or auto-dwell countdown → `idle` |

### A dead sensor is not a lazy child

The garage screen told a child *"Did Not Finish — Stopped pedaling for 30s"* while he was
pedalling. His cadence sensor had sent nothing for four minutes. Verified in production: the
`niceday` bike's ANT+ sensor emitted no packets at all across three races that each forfeited him
at the threshold with rpm 0, then woke, and his very next race registered 73 rpm. On the same day
there were 29 `sensor_lost` events against 13 `sensor_recovered`, across all five machines.

From rpm alone a still bike and a sensor that sends nothing are identical, so the rider's sensor
connectivity reaches the controller on its `connected` input. The controller keeps three sets, and
a rider is in at most one of them:

- **`parked`** — the rider's sensor reported and they stopped (or never started). Nobody is
  eliminated: a parked rider keeps their distance and is back in the race on their next pedal
  stroke.
- **`noSensor`** — the rider's sensor never reported at all. Never captioned "stopped pedaling";
  the toast reads *"{name} — no sensor · Their bike never reported. Check the sensor."* Logged as
  `cycle_game.rider_no_sensor` at warn, so the store can answer "dead sensor or idle kid?" — a
  question that previously required diffing race telemetry against raw bridge output by hand. The
  rider leaves this set the moment their sensor reports movement. If the sensor connects but the
  rider is not pedalling, they move to `parked`.
- **`overtime`** — the rider was still riding when the clock or the operator closed the race. A
  parked or no-sensor rider is never also overtime.

A rider who HAS ridden keeps the idle clock even if their sensor drops later: they demonstrably had
one, so a bike that stops reporting is read as a rider who stopped. A missing `connected` flag
counts as connected, so callers that do not report sensor state are unchanged. Parked and no-sensor
riders do not hold a race open: once a live rider has finished they are skipped, and if every live
unfinished rider is away the race closes after `allParkedEndS`.

**The SENSOR chip has two windows now.** It was gated on a rider having been connected once, so a
sensor that never appeared produced no warning *ever* — and the forfeit was then the only thing
anyone saw. A rider who was connected and drops is flagged at `SENSOR_LOST_GAP_TICKS` (9); a rider
who has never connected gets the longer `SENSOR_ABSENT_GAP_TICKS` (15), which is past the mounting
and lock-on window but still short of the start-grace that ends their race — so the warning arrives
while it can still be acted on. A rider sitting on a bike with a working sensor reports
`connected: true, rpm: 0`, never advances the gap clock, and is never flagged at all.

**The bridge now keeps a presence trail.** `_extensions/fitness/src/ant.mjs` logged only data lines
and HR rejections — nothing about a sensor arriving or leaving — and the absence of a line is not
something you can grep for. A wildcard ANT+ scanner has no connection to lose, so presence is
recency: a first broadcast logs `SENSOR UP`, and a device silent for 10s logs `SENSOR DOWN (silent
Ns)` from a 5s sweep. **This is inside the container image**, so it needs a native rebuild on the
sensor host to take effect (see the fitness extension's deploy notes) — the app-side changes above
do not.

**Cadence sensors are equipment, not people.** `fitness.auto_assign_skip` fired 787 times in one day
for a single bike's cadence sensor reporting no user. Riders claim equipment from the picker and the
sensor is bound to the machine by the `cadence:` key in the household fitness config, so no user is
the correct state for it. That case is no longer reported as an anomaly; heart-rate straps, which do
identify a person, still are.

- **Tick cadence:** `RACE_TICK_MS = 1000` (1 Hz). The racing interval runs across
  the `go` and `racing` phases and is **not** torn down mid-race, so ticking stays
  even. Live session/vitals are read through refs.
- **The engine goes live at GREEN**, ~0.8 s **before** the race screen appears —
  so the race technically starts on the green light. The `go` phase holds the green
  stoplight for that beat; then the screen switches to `CycleRaceScreen`.
- **The race menu (`RaceMenu`) is the only stop control.** One low-contrast corner
  button, mounted as a direct child of `.cycle-game-container` in staging,
  countdown and racing (not in the lobby, the `go` hold or results). It opens a
  sheet with **Keep racing**, **End race here** (racing only) and **Discard
  race**; the race keeps running underneath. The two destructive items ignore
  taps for `RACE_MENU_GUARD_MS` (600 ms) after the sheet opens, so nothing ends
  or discards a race in one tap. Each phase renders its own menu, so a sheet
  that is open when the phase changes closes (logged with `reason: 'unmount'`).
- **Discard race** (`onCancel`): `controller.cancel()` → `cancelled` → `idle`.
  Emits `cycle_game.cancelled` (`control: 'race-menu.discard'`). Nothing is
  saved and the crash checkpoint is cleared.
- **End race here** (`onFinishRace`): `controller.finishNow()` → `results`.
  Riders still riding go to `overtime` with their real distance, parked and
  no-sensor riders stay as they are, and the controller sets `endedEarly`. The
  ride is **saved as incomplete** (§15): it stays in history and counts for
  nothing. Emits `cycle_game.ended_early`.
- **`canStart`** = a race type is chosen **and** ≥ 1 rider is claimed to a bike.

---

## 4. The lobby (`CycleGameHome`)

The lobby is a pure presentational component; all state and handlers live in
`CycleGameContainer`. Flows:

1. **Race type** — three tiles: **Distance**, **Time**, **Ghost**. Selected tile is
   `aria-pressed` and filled (not only outlined), as is the selected preset.
2. **Value** — preset tiers plus a +/- custom stepper (reserved-height slot):
   - Distance tiers: **100 / 300 / 1000 / 2500 (default) / 5000 m**.
   - Time tiers: **60 / 120 / 180 / 300 (default) / 600 s**.
   - The stepper uses `lib/cycleGame/raceValueStep.js` (`stepRaceValue`). Distance
     steps **100 m below 1 km and 500 m from 1 km up**, so it lands on every
     preset; time steps **one minute**. Limits: distance **100 m to 10 km**, time
     **1 to 30 min**. The - button is disabled at the minimum and + at the
     maximum. A value that arrives out of range or off the grid is shown as is,
     and the first press of either button snaps it onto the grid inside the limits.
   - Picking a ghost **locks** type + value to that recording.
3. **Starting grid** — one `BikeSlot` per cadence bike. The **entire slot** is one
   touch target → opens the **rider picker**. Filled slots show the equipment icon
   (RPM-rotated) with the rider's avatar overlaid and the rider's **name** under
   it (two guests share the default avatar). A claimed bike also shows its sensor
   state when the container supplies `sensorLive` on the bike: **Ready** (small
   tick) when the cadence sensor is reporting, **No signal** (amber, icon plus
   word, class `is-no-signal`) when it is not; unknown state shows nothing, as
   does an unclaimed slot.
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
   `recordRow.buildRecordRow`. Each row **leads with the top-placed live rider**,
   not with whoever crossed first: a solo ride lost to a pace rival or a picked
   ghost reads as that rider's ride, with their pace. A lead rider who did not
   finish a distance race has no pace, so the Speed cell holds how far they got
   instead: the value keeps its unit ("640 m"), and the cell (`data-kind="distance"`)
   and the row's accessible label say "640 m ridden, did not finish" so it is
   never read as a speed (`speedKind` on the row model: `speed`, `distance` or
   `null`). Everyone else, ghosts
   included, follows in placement order as small **crescents** (overlapping
   mini-avatars) with a `+N` overflow. Only a ghost-only race leads with a ghost.
   (The ghost picker is different: there the recording's winner is the headline.)
   There is no crown emoji in the History list. Ghost participants resolve to the
   real rider's face/name via `participantIdentity`. Tapping a row opens the
   **Recap**. Empty state: "No races yet."
7. **Volume** — touch +/- with a readout.
8. **Start** — disabled until `canStart`; checkered-flag icon. **Sensor check:**
   if any claimed bike has `sensorLive === false`, Start does not start. It shows
   a warning (`role="alert"`) naming the bikes ("Bike A is not reporting. Spin the
   pedals once, or check the sensor.", "A and B are…", "A, B and C are…") with
   **Back** and **Start anyway**, and logs `cycle_game.ui.sensor_warning` (warn).
   Start anyway logs `cycle_game.ui.sensor_warning_override` and starts. The
   warning clears by itself when every claimed bike reports, when the bike is
   unclaimed, or when `busy` turns true; once everything is live the next Start
   goes straight through. It overlays the actions row just above Start, so the
   fixed-height lobby does not shift.
9. **Starting…** — a lone rider's Start first looks up their rival (§5), and
   "Ride it" first fetches its ladder rival (§16); either can take up to 1.5 s
   (the two share that one budget on a featured ride). From the press until the
   race launches the lobby stays on screen but
   is frozen (`busy` prop, `aria-busy="true"` on the root): the Start button
   reads **"Starting…"** and is disabled, and the race-type tiles, presets,
   stepper, ghost controls, bike slots, featured "Ride it", history rows,
   high-score cards and volume button are all disabled. A picker that was
   already open stays mounted but cannot commit a change.

**One race per start.** `startRace` returns whether it accepted the start. It
refuses (logging `cycle_game.start_ignored`) unless the lobby is idle and no
other start is pending, and returns `false` when there is nobody to race or
launching failed (`cycle_game.start_failed`). "Ride it" checks the same before
its own fetches and holds the pending slot (and the freeze) through them, so a
repeat tap, a Start press or a simulator start in that time is ignored. It
writes its ladder ghost into the lobby only once its start was accepted.

A launch is all or nothing: if building the race throws partway, the controller
and race meta are cleared and the lobby is back to idle and unfrozen. Cancel and
the results exit reset the start guard themselves, not only through a re-render,
so a race launched and cancelled in one batch leaves Start usable.

`window.__cycleGameControl` (the simulator seam) exposes `startRace`, `cancel`
(the same as the race menu's Discard race), `getPhase` and `getRaceState`.

---

## 5. Riders, ghosts, guests

**Building the field** (`buildRiders`): for each cadence bike with a claimed
rider, push `{ userId, displayName, equipmentId, wheelCircumferenceM }`. If a
ghost is selected, append its (roster-filtered) participants as additional riders
carrying `ghostSeries / ghostHrSeries / ghostRpmSeries / ghostZoneSeries /
ghostIntervalS` and `equipmentId: null`.

**Automatic pace rival** (`startRace`; selection in `lib/cycleGame/paceRival.js`).
`startRace` first works out the ghost that would race: an explicit override (the
featured-course button passes its ladder rival, or `null` when it has none)
beats the lobby's hand-picked ghost. If there is no such ghost and **exactly
one** live rider is claimed, a pace rival is armed for that race:

| Kind | Who |
|---|---|
| `self` | The rider's own best ride at this win condition and exact length |
| `household` | Failing that, the best such ride by anyone |
| `par` | Failing that (or if the picked ride has no distance series to replay), a constant-speed rider, id `ghost:par:par`, named "Par" |

- **One lookup, over the full history, in two light steps.** The lobby loads
  only the five most recent race days, so on Start the container asks the
  server for the **rival pool**: one light row per saved race of this exact type
  and length (`GET /cycle-races/rival-pool?winCondition=&goalM=` or
  `&timeCapS=`, §15). The rows come from the race index (§16) and hold results
  only, no series. `rivalPoolCandidates` turns them into candidates, they are
  merged with the loaded history (each race once; the loaded copy wins, because
  it has the series) and `pickPaceRival` runs over the merged list. There is
  one selection rule, in `paceRival.js`, for both lists.
- **At most one record is fetched.** If the pick is a race the lobby already
  loaded, it is replayed from that copy and nothing more is requested. If not,
  that one race is fetched (`GET /cycle-races/:raceId`) and mapped like any
  other record. The record is used only if the same rule, run again with it in
  the list, arms the same rider of the same race.
- **The lookup never holds up or fails a start.** Both requests share 1500 ms
  in total and one abort signal. On a timeout (the request in flight is
  aborted), an HTTP or network error on either request, or a fetched record
  that cannot be replayed (missing, no series for that rider, or not holding
  that rider), the pick runs over the loaded history alone, and falls to par
  when that has no counting ride either.
- **No start waits more than 1500 ms, on any path.** "Ride it" fetches its
  ladder rival first (§16) under the same budget, measured from the press, with
  the lobby frozen from the press. If that succeeds the ladder rival races and
  there is no pace rival. If the ladder has nobody to chase, a lone rider's
  pace-rival lookup gets what is left of the 1500 ms. If the ladder rival's
  fetch times out or fails, the course starts without it and the pace rival is
  picked from loaded history only: no second request, no second wait
  (`serverLookup: 'skipped'`).
- The heavy listing (`GET /cycle-races?winCondition=…`, which returns full
  records with every series) is no longer requested by the game.
- **The lobby is frozen while it waits** (§4). If the game is closed in that
  time the request is aborted and nothing starts. Starts that need no rival (two
  or more riders, a chosen ghost) launch synchronously with no request.
- **What counts:** the record is not flagged `incomplete`
  (§15; the server leaves those races out of the pool), the rider was live (not a replay), was not stopped when the race
  closed, and for a distance race finished. Best is the lowest finish time
  (distance) or the furthest distance (time). The length compared is the final
  one `startRace` resolves, after any course override and the config defaults.
- Only the picked rider is replayed, not the rest of that race's field, and the
  rival is named after that rider.
- The par rider covers `par_speed_kmh` (§6) every second and finishes a distance
  race exactly on the goal. It carries a constant 80 rpm cadence series
  (`PAR_RPM`) so its gauge reads a steady 80, and no heart rate or zone. It has
  no avatar image; every surface falls back to the generic face.
- If par cannot be built either (no usable length, or a race longer than par's
  four-hour series cap), the race starts with no rival and the event reports
  `kind: 'none'`.
- A hand-picked ghost or a ladder rival always wins: no pace rival is added. Two
  or more live riders race each other: no pace rival, and no `pace_rival` event.
  A ghost with no live rider at all (a featured ride with nobody on a bike) is a
  ghost-only race and starts.
- The rival is armed for one race only. It never goes through the lobby's
  selected-ghost state, so it does not lock the race type or value and is chosen
  afresh next race. It is not previewed in the lobby; it first appears as an
  "AUTO" chip in the staging and countdown rider strip (§10), which shows the
  ghosts actually racing rather than the lobby selection.
- The kind armed is kept on the race meta as `rivalKind`: `self`, `household`,
  `par`, `ghost` (hand-picked or ladder rival) or `null` (no rival). It is also
  in the `cycle_game.config` event.
- Each arming logs `cycle_game.pace_rival` (§18).

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
| `race_idle_dnf_s` | 20 | The park window: seconds of zero RPM (after a rider has started) before they are parked. Parked riders resume on their next pedal stroke. Reaches the controller as `raceIdleDnfS`; the controller prefers `parkIdleS` when both are given |
| `race_start_grace_s` | 30 | Seconds a rider may report zero RPM **before their first movement** before they are parked as a no-show. More generous than `race_idle_dnf_s` to cover magnetless cadence sensors (e.g. the tricycle's COOSPO BK467) that take ~20s to lock onto rotation from a dead stop |
| `hot_start_penalty_s` | — | **Retired.** The start is rolling and there is no penalty box; nothing reads this key (the container, the lobby config builder and the controller all ignore it). Safe to delete from the YAML |
| `lap_length_m` | **400** | Lap unit for splits / oval (0 = laps off; whole-race when goal < lap) |
| `results_dwell_s` | 20 | Results auto-return countdown before returning to the lobby |
| `par_speed_kmh` | 18 | Speed of the "par" pace rival a lone rider races when nobody has a counting ride at this race type and length (§5). Must be positive, or the default is used; a positive value below 3 km/h is raised to 3 |
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
| `wheel_circumference_m` | Distance per wheel rotation (a larger wheel covers more ground per pedal stroke — the tricycle uses an enlarged wheel so it can keep pace). This is the pace-calibration knob: pick it so a rider's usual cadence on this equipment covers the same meters per second as on the other bikes. **Missing or 0 ⇒ the default (2.1 m)** applies and the race logs a `cycle_game.wheel_default` warning; it never scores 0 m per rev. The effective value per rider is in the `cycle_game.config` event. |
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

Wraps the engine with the lifecycle, **parking**, the rules for when a race
closes, and the operator **finish-now** action. `getState()` returns `{ phase,
countdownRemaining, parked[], noSensor[], overtime[], endedEarly, engineState }`,
plus the legacy keys `dnf: []`, `penalized: []` and `penaltyInfo: {}`, which are
always empty and remain only until their last readers are removed.

- **Countdown:** `startCountdown()` then `countdownTick()` decrements from
  `startCountdownS`; reaching the green light begins racing (`_beginRacing` builds
  the engine).
- **Idle → parked:** per non-ghost rider, an idle count increments on each tick
  with `rpm === 0` and resets when pedalling; the rider joins `parked` once the
  idle time reaches its threshold. Their input is not altered, and the first
  `rpm > 0` reading removes them from `parked` (and from `noSensor`). The
  threshold is **two-phase**: before the rider's first `rpm > 0` reading it is
  `race_start_grace_s` (a generous no-show window covering magnetless-sensor
  lock-on lag); after they have registered any movement it drops to the park
  window (`parkIdleS`, else `race_idle_dnf_s`). A rider who has finished is never
  parked. Idle time is counted in ticks, so the threshold is exact at any tick
  interval.
- **Rolling start, no penalty box:** pedalling before green counts for
  nothing (the engine does not exist yet) and is never punished; pedalling counts
  from the first racing tick. There is no false-start tracking anywhere: the
  controller has no `markFalseStarters()`, and neither the container nor
  `buildRaceConfigFromCourse` passes a hot-start penalty.
- **Mercy window:** in a distance race with `raceMercyAfterWinnerS > 0`, the race
  closes that many seconds after the first **live** rider finishes. Riders still
  riding land in `overtime`; parked and no-sensor riders stay where they are. A
  recording crossing the line does not start the window.
- **All-away close:** in either race type, once every live unfinished rider is
  parked or no-sensor, the controller notes the race time. If they are all still
  away `allParkedEndS` seconds of race time later (default 15), the race
  finishes. Any rider pedalling again clears the mark. `allParkedEndS: 0` closes
  on the tick everyone is away.
- **Finish now (`finishNow`):** puts every non-ghost rider still riding in
  `overtime`, sets `endedEarly: true` and ends the race. Parked and no-sensor
  riders stay in their own set. `endedEarly` is `false` for every other kind of
  finish. No-op outside racing.
- **Ghosts** are never parked, never overtime, and never affect when a race
  closes.

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
  → panels: SpeedoRow · DistanceChart · SplitsChart · PovGrid · StandingsTower
```

### 9.1 The two layouts (`RaceLayoutManager`)

`wide = fieldSize >= 4`. Each zone renders its panel through a `PanelSlot` (a stable
`render` prop, so a panel never remounts per tick), and every zone is
`overflow:hidden` (clipped) so panels and the chart's zoom animation never bleed
across cells. The **distance chart is never far-left** — laps/splits sit to its left
in both modes.

- **Sidebar mode (≤ 3 riders):** a main column — top row **splits │ distance chart**
  over a full-width **speedometer** band — beside a right **sidebar**: the **POV
  grid** (top ~70%) over the **standings tower** (bottom ~30%) — the tower
  REPLACES the old lap oval's slot; the oval's lap strip folds into the tower's
  own header row instead.
- **Wide mode (≥ 4 riders):** a top row of three equal columns — **splits │ chart │
  POV** — over a full-width **speedometer** band, plus the **standings tower**
  docked as a right-edge column spanning the full height (audit UX §4.2 — wide
  mode used to lose all rank/lap info; it never does now). No oval.

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
- **Officiating-event markers** (DNF) are re-projected onto the lane where
  they fired (`xFor(seriesIndex)`, `yFor(distanceM)`); a lane **starts at first
  movement** (`chartTrim.plotStartIndex`), so a late starter emerges
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

### 9.5 StandingsTower & SpeedoRow

- **StandingsTower** — the persistent rank/gap ladder the audit found missing from
  every live race (UX §4.1): rank ordinal (shared placements render the same
  ordinal — a dead heat shows two "1st"), lane-color chip, a 32px avatar
  (ghost-treated), the display name, and either a gap-to-next-above reading or —
  for the group leader, a finisher, or an overtime/DNF row — their own
  total/final metric. Distance races express the gap in metres; time races
  project it through the pace of the rider immediately above into a
  time-behind estimate. Finished riders pin to the top with a flag; overtime
  and DNF riders sink to the bottom, dimmed. Its header line folds in what used
  to be the oval's "Last / Now" lap strip ("Lap 3 · Last 0:42 · Now 0:12"),
  fed by the same `riders[id].lapSplits` data. Renders in **both** layouts —
  sidebar mode (replacing the oval's old slot) and wide mode (a docked
  right-edge column). `OvalTrack` (`ovalTrackModel.ovalProgressFor`: one loop =
  the whole race) stays in the codebase but is no longer part of the live
  panel map.
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

## 10. Countdown, rolling start & ready strip

- **Rolling start.** The "to your bikes" screen advances to the stoplight the
  moment `staging_buffer_ms` elapses, whatever the cranks are doing. Pedalling
  before green is allowed and simply counts for nothing until green (the engine
  goes live on GREEN, §3). There is no "stop pedalling" gate, no waiting bar and
  no false start. The staging hint reads **"Pedal when you see green."**
- **`CountdownStoplight`** (presentational): the sequence is **ALL3 → RED → YELLOW →
  GREEN** — earlier beats flash all three lamps ("get set"), then the last three
  beats are red, yellow, and green-at-GO (so yellow never holds for two beats). The
  **container** plays the per-tick beep and the GO sound; the engine goes live on
  **GREEN** (§3).
- **`RiderReadyStrip`** (staging + countdown): one chip per rider — avatar, name,
  live RPM, and the bike's sensor state, in word + icon + colour: **✓ READY**
  (green) when the bike's cadence sensor is reporting, **⚠ NO SIGNAL** (amber)
  when it is not. The container sets `sensorLive` on each chip from
  `session.getEquipmentCadence(bikeId)?.connected` for the bike the rider was
  staged on; cadence never changes the state. Ghost chips read **AUTO**. The
  chips are the riders **staged for this race** (fixed when the race is built)
  plus its ghosts, not whoever holds a bike at that moment: a claim changed while
  Start was waiting on its lookup does not put a rider on the strip who is not
  racing.
- **Lobby bikes.** Each entry of the lobby's `bikes` list carries the same
  `sensorLive` flag (the bike's sensor is reporting right now), which the lobby's
  sensor check reads (§4).

---

## 11. Officiating events

When a rider newly DNFs, the container records an event
`{ id, type: 'dnf', riderId, displayName, seriesIndex, distanceM }` into
`raceEvents` and enqueues a **toast**:

- **`CycleEventToast`** — a single-slot, non-blocking toast
  auto-dismissing after ~4 s (or on click). Extra events queue. **Never pauses the
  race.**
- **Chart markers** — `raceEvents` is threaded into `DistanceChart`, which
  re-projects each event onto the rider's lane as a persistent glyph chip. *(These
  live in `DistanceChart` because that's where the chart's coordinate projection
  lives.)*
- Logs: `cycle_game.rider_dnf`, and `cycle_game.cadence_change` on every sensor
  connect/drop transition. There is no penalty lifecycle (rolling start, §10).

---

## 12. Results & recap

- **`RaceResults`** — a Mario-Kart-style finish board. Standings animate in
  (slide-into-podium, rows fly/fade in, metrics count up — the count-up is disabled
  under `prefers-reduced-motion`, and tests pass `animate={false}`), the full
  **lap-by-lap splits table** is shown (`SplitsChart final`), 🥇🥈🥉 medals (numeric
  for 4+), the winner gets a 👑 and a larger avatar, and DNF rows show "DNF". The board **auto-returns to the lobby** after
  `results_dwell_s` with a visible countdown, and a manual **Exit** button leaves
  immediately. Metric is finish-time (distance race) or distance covered (time race).
- **`RaceRecap`** — full-screen modal that replays a saved race by feeding
  synthesized rider state into `CycleRaceScreen` over ~12 s regardless of race
  length, with play/pause + scrub, then the final standings. **RPM is always 0 in
  recap.**
- **Ending vs discarding.** The race menu (§3) offers **End race here** (saves
  the ride as incomplete and shows this board) and **Discard race** (saves
  nothing, back to the lobby). The board of an ended-early ride carries no
  ladder-movement callout (§16); once the save has landed, the notes slot shows
  one line instead: "Ended early: saved to history, not counted for records or
  the ladder." There is no race menu on the results board.

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
- **Overlay states:** **FINISHED** (🏁 + placement, gauge parked). There is no
  penalty overlay (rolling start, §10).
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
  # incomplete: true        # only on a race a rider ended early; key absent otherwise
participants:
  <userId>:
    display_name: "User_3"
    equipment: "cycle_ace"
    final_distance_m: 3000
    final_time_s: 142          # null if DNF / time race
    placement: 1               # null if DNF
    distance_series: "<RLE>"   # SessionSerializerV3-encoded
    hr_series: "<RLE>"
    rpm_series: "<RLE>"
    zone_series: "<RLE>"
    # stopped: true            # only on a rider who was stopped (parked) when the race closed
```

Two optional flags, both written only when true (the key is absent otherwise, so
every record saved before they existed reads as a normal, complete race):

- **`race.incomplete`** — `buildRaceRecord` sets it when called with
  `meta.endedEarly`: a rider ended the race before its win condition closed it.
  The ride is saved and stays in history, but it **never counts** for the weekly
  ladder, the all-time record, personal bests, the `race-pb` gem or the lobby
  high scores (§16). Its duration is whatever the rider chose, so neither its
  time nor its distance is comparable to a full run of the course.
- **participant `stopped`** — set for each userId in `meta.stopped`: the rider
  was parked when the race closed. Independent of `incomplete` (a race can run to
  its normal close with a stopped rider in it).

**Who sets them.** The container builds both from the controller's `getState()`
at the moment of saving (`raceOutcomeMeta`): `stopped` is `parked` ∪ `noSensor`,
on every save; `endedEarly` is the controller's flag, which only the race menu's
**End race here** sets. The three places a record is built:

| Save | `incomplete` | `stopped` |
|---|---|---|
| Results (the normal save) | only if the race was ended from the menu | `parked` ∪ `noSensor` at the close |
| `pagehide` beacon (page closing mid-race) | always: the ride is being cut off | `parked` ∪ `noSensor` at that moment |
| Crash recovery (checkpoint found on the next mount) | yes, unless the checkpoint says the race had finished on its own | the checkpoint's `parked` ∪ `noSensor` |

**Crash checkpoint.** While racing, every 5th tick writes
`{ raceMeta, engineState, raceState, savedAt }` to `sessionStorage`
(`raceCheckpoint.js`); `raceState` is `{ parked, noSensor, endedEarly, finished }`.
A last checkpoint with `finished: true` is written when the race ends (on its
own or from the menu) and is cleared when the save lands or the race is
discarded. A checkpoint still there on the next mount (under 30 minutes old,
some distance covered) is saved by `checkpointOutcome`'s rule: a recovered race
is an interrupted ride, so `incomplete`, except when `finished` is true and
`endedEarly` is false, which means the race ran to its end and only its save was
lost. A checkpoint with no `raceState` (written by an older build) cannot show
that and is saved `incomplete`. `cycle_game.race_recovered` carries the result
as `incomplete`.

`mapRaceRecordToCandidate` carries both onto the ghost candidate
(`candidate.incomplete`, `participant.stopped`, each a plain boolean), and
`buildHighScores` skips an `incomplete` candidate outright.

### Storage

`household[-{id}]/fitness/log/cycle-races/{YYYY-MM-DD}/{raceId}.yml`. The
`{YYYY-MM-DD}` folder is **sliced from the raceId** (so folder and id can never
disagree), built from **local** time — there is **no UTC foldering bug**.

### API (`/api/v1/fitness/cycle-races`)

| Route | Purpose |
|---|---|
| `POST /cycle-races` | save `{ record, household? }` → `{ ok, raceId, file }` |
| `GET /cycle-races/ladder?week=YYYY-Www` | this week's (or a specified week's) featured-course ladder — see §16 |
| `GET /cycle-races/personal-bests?userId=&courseId=` | a rider's all-time PB on a course — see §16 |
| `GET /cycle-races/rival-pool?winCondition=distance\|time&goalM=` (or `&timeCapS=`) | light index rows of one race type and exact length, for the pace rival — see below |
| `GET /cycle-races/:raceId` | one race |
| `GET /cycle-races?date=YYYY-MM-DD` | races on a day |
| `GET /cycle-races?courseId=… \| winCondition=…&goalM/timeCapS=…` | ghost candidates: full records with series, read from every race file. No longer requested by the game (the pace rival uses `rival-pool`) |
| `GET /cycle-races` | list date folders |

`CycleRaceService` is a thin wrapper over `YamlCycleRaceDatastore`
(`save / get / listByDate / listDates / findGhostCandidates`), plus the ladder /
personal-best queries described next and the rival pool. Wired in `bootstrap.mjs`.

> `ladder`, `personal-bests` and `rival-pool` are registered **before** `/:raceId`
> in the router — otherwise Express would swallow them as a raceId lookup.

**`GET /cycle-races/rival-pool`** — the listing a lone rider's pace rival is
picked from (§5). `winCondition` is required (`distance` or `time`), with
`goalM` for a distance race or `timeCapS` for a time race; `household` is
optional. A missing or unknown `winCondition`, or a length that is not a
positive number, is a `400`
(`{ error: 'winCondition (distance|time) and a positive goalM or timeCapS required' }`).
It reads the index shards only (§16): no race file is opened unless a day's
rows have to be rebuilt. Response:

```json
{
  "entries": [
    {
      "raceId": "20260629080000",
      "date": "2026-06-29",
      "winCondition": "distance",
      "goalM": 1500,
      "participants": [
        { "id": "rider-a", "isGhost": false, "stopped": false,
          "finalTimeS": 148.2, "finalDistanceM": 1500, "placement": 1 }
      ]
    }
  ]
}
```

A time race carries `timeCapS` in place of `goalM`. Rows match on the win
condition and the length compared as a number; rows flagged `incomplete` are
left out. Ghost and stopped riders stay in, flagged, so the client's one
selection rule decides and its `candidates` count is the number of races
considered. Nothing is ranked on the server. The filter and mapping are
`parseRivalPoolQuery` / `rivalPoolEntries` in `cycleRivalPool.mjs`.

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
    { "userId": "user_1", "bestValue": 148.2, "raceId": "20260630091200", "attempts": 3 },
    { "userId": "user_3",   "bestValue": 161.4, "raceId": "20260629174501", "attempts": 1 }
  ],
  "allTimeRecord": { "userId": "user_1", "bestValue": 141.0, "raceId": "20260512080000", "date": "2026-05-12" }
}
```

No featured course configured → `404`. No qualifying races in the window → `200`
with `standings: []`; `allTimeRecord` reflects all-time history independent of the
window and may still be populated; it is `null` only when the course has no
qualifying race in its entire history.

**`GET /cycle-races/personal-bests?userId=&courseId=`** — both params required
(missing either is a `400`). Response:

```json
{ "userId": "user_3", "courseId": "sprint-1500m",
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
- **Incomplete races never count.** An index row with `incomplete: true` (§15)
  matches **no** course — `raceMatchesCourse` rejects it before the `course_id`
  and legacy checks — so it is absent from the standings, from `attempts`, from
  the all-time record and from personal bests. A row with no `incomplete` key
  (a shard written before the flag existed) is a complete race.
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
  The lookup never holds up or fails Ride It. The lobby freezes at the press
  (§4), and the personal-best and race-record requests share one 1500 ms budget
  and one abort signal. On a timeout, an HTTP or network error, or a record
  with nothing to replay, the course starts without the ladder ghost and
  `cycle_game.featured_rival_lookup_failed` is logged (§18); a lone rider then
  gets the automatic pace rival from loaded history only (§5). If the game is
  closed while it waits, the request is aborted and nothing starts. The ghost is armed through the same
  record-to-candidate / candidate-to-ghost pipeline the Ghost Picker uses (§17),
  not a separate mechanism.
- **Results ladder-movement callout.** After a race whose `course_id` matches the
  ladder snapshot taken at Ride It time, and a successful save, the ladder is
  refetched and diffed per live (non-ghost) rider against that snapshot. Each
  mover gets a one-line note on the results board — a lead ("Ladder lead this
  week!") or a rank + gap to the rung above ("2nd this week — 0:04 behind Dad").
  A refetch/diff failure is logged and skipped; it never blocks the results
  board. A ride ended from the race menu (saved `incomplete`, §15) gets no
  callout and no refetch: the notes slot shows the ended-early line instead
  (§12).

### Index shards

The ladder, personal bests and the pace-rival pool (§15) read from the same
self-healing index the datastore already maintains: `household[-{id}]/fitness/log/cycle-races/_index/{YYYY-MM}.json`.
Shards are **disposable** — deleting one just forces a rebuild (per-day mtime
check) on the next read; nothing else depends on their presence.

Each row carries `incomplete` (boolean, from `race.incomplete`) after
`time_cap_s`, ahead of `participants`. Adding it took the shard format to
**version 2**. A shard whose `version` differs from the running build's is
discarded whole and rebuilt from the race files, so a row written without the
field is never trusted.

Each participant in a row carries `stopped` (boolean, from the record's
participant `stopped`: parked when the race closed) after `isGhost`. The pace
rival never replays such a ride; the ladder ignores the flag. Adding it took
the shard format to **version 3**, so the first index read by a build with it
rebuilds every shard from the race files once.

The version rule runs in both directions: a build that writes an older version
discards a newer shard and rewrites it in its own format.
Two builds of different ages sharing one data tree therefore stay correct, at
the cost of a full rebuild each time the other one has written last.

### Gems (economy achievement evidence)

`application/measures/fitnessAchievementProvider.mjs` feeds the economy's
`race` contest and `race-pb` milestone. `race` is this ladder (`getLadder` for
the ISO week of the school week's Monday), roster riders only, scored
higher-better: `1e6 / seconds` on a distance course, metres on a time course;
closed once the week is over. `race-pb` walks the index rows in raceId order per
course definition (id + win condition + goal): a strictly better result than the
rider's prior best is a PB, their first ride of a course is not. Lobby races,
ghosts and incomplete races never count (an incomplete ride neither is a PB nor
sets the bar a later ride must beat). It is dated by the study day of `race.date` via
`raceEpochMs()` (the record is fetched for each candidate) and keyed
`<courseId>:<raceId>`.

---

## 17. Ghost system end-to-end

1. **Record** a race → saved with `distance/hr/rpm/zone` series per participant.
2. **Discover** — the lobby loads recent races; each becomes a ghost candidate
   (winner first; score/goal inverted by win condition).
3. **Select** — focus a card, then the **roster submenu** lets you pick which ghosts
   to include (default all). `onSelectGhost` decodes the chosen participants' series,
   builds `ghost:<raceId>:<id>` riders, and **locks** the race type/value.
4. **Replay** — the engine interpolates distance and nearest-samples HR/RPM/zone
   each tick; ghosts are never parked, never in overtime, and never hold a race
   open (§8).

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
  `race_saved`, `rider_assigned` / `rider_unassigned`, `rider_dnf`, `cadence_change`,
  `ended_early`, `cancelled`, `recap_*`, `volume_set`, `history_loaded`,
  `pace_rival`.
- **`cycle_game.ended_early`** (INFO) — the race was ended from the race menu
  and will be saved as incomplete: `{ raceId, elapsedS, control: 'race-menu.end' }`.
  It replaces `cycle_game.finish_forced`, which is no longer emitted.
  **`cycle_game.cancelled`** carries `control: 'race-menu.discard'` (the
  simulator seam's `cancel` logs the same).
- **Race menu UI** (component `cycle-race-menu`) — `cycle_game.ui.race_menu_open`
  (INFO, `{ canEnd }`); `cycle_game.ui.race_menu_close` (DEBUG, `{ reason }`:
  `keep`, `end`, `discard`, `scrim`, `escape`, `timeout` or `unmount`);
  `cycle_game.ui.race_menu_guarded_tap` (DEBUG, `{ item }`: a tap on `end`,
  `discard` or the `scrim` inside the guard time, ignored);
  `cycle_game.ui.race_menu_handler_failed` (ERROR, `{ item, error }`).
- **`cycle_game.race_recovered`** (INFO) — a checkpointed race was saved on
  mount: `{ raceId, ok, incomplete }` (or `skipped: 'zero_distance'`).
- **`cycle_game.pace_rival`** (INFO) — once per race start in which a lone rider
  had no ghost (§5). Not emitted when a ghost was chosen or two or more riders
  are racing.

  | Field | Meaning |
  |---|---|
  | `raceId` | The race being started |
  | `kind` | What was armed: `self`, `household`, `par`, or `none` (no rival could be built) |
  | `requestedKind` | What selection asked for. `requestedKind: 'self'` with `kind: 'par'` means the rider's best ride could not be replayed |
  | `sourceRaceId`, `participantId` | The ride replayed; `sourceRaceId` is `null` for par |
  | `source` | Where the armed rival came from: `server-history` (picked from the merged list after the server answered, whether replayed from a loaded race or a fetched record), `history` (the lobby's loaded history alone) or `par` |
  | `candidates` | Races of this type and length the pick chose from (the merged list when the server answered, else loaded history) |
  | `historyLoaded` | Whether a lobby history load had completed when Start was pressed |
  | `serverLookup` | The server lookup (rival pool, then the picked record if one was needed): `used`, `error`, `timeout`, or `skipped` (a featured ride had already spent the budget) |
  | `lookupMs` | How long the server lookup took, from Start to its answer, error or timeout. `0` when `skipped` |
  | `recordFetched` | `true` when the pick was not in the loaded history, so its record was requested (also `true` when that request then failed or timed out) |

- **`cycle_game.pace_rival_lookup`** (DEBUG) when the request starts;
  **`cycle_game.pace_rival_lookup_failed`** (WARN) on `error` or `timeout`, with
  `outcome`, `stage` (`pool` or `record`: which request it was in),
  `sourceRaceId` (the record being fetched, else `null`), `error` and `lookupMs`.
- Backend: **`fitness.cycle_races.rival_pool.computed`** (DEBUG) per pool
  request: `winCondition`, `length`, `entries` (index rows read), `pool` (rows
  returned), `ms`.
- **`cycle_game.start_ignored`** (INFO) — a start that was dropped:
  `{ reason, control }`. `reason` is `not_idle` (a race is already staged or
  running) or `start_pending` (another start is waiting on its rival lookup, or
  "Ride it" on its ladder rival);
  `control` is `lobby.start-button`, `featured` or `sim.autostart`.
- **`cycle_game.start_failed`** (ERROR) — building the race threw, on any start
  path: `{ control, error }`. Nothing is left staged and the lobby is unfrozen.
- **`cycle_game.featured_rival_lookup_failed`** (WARN) — "Ride it" could not arm
  its ladder rival and started the course without it:
  `{ courseId, stage, reason, error, lookupMs }`. `stage` is `personal-best` or
  `record` (which request it was in); `reason` is `timeout` or `error`
  (`error` holds the message, else `null`).
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
  `lap_length_m`, `results_dwell_s`) requires a **container restart**.
- **Lap panels are config-gated.** Splits and the standings tower's "Lap N" header
  only appear when the **effective** lap length > 0 (per-course override or app
  config, via `effectiveLapLength`). With laps off, the splits panel still shows a
  live order.
- **`lap_length_m` default is 400, with a whole-race shortcut.** A distance race
  whose goal is shorter than the lap runs as a single lap (`effectiveLapLength`).
- **Multi-sensor cadence is the fastest live sensor.** A bike with `cadence: [a, b]`
  is one unit: the fastest currently-connected sensor wins, so one flaky sensor's
  10–20 s dropouts don't flatline the bike. A simultaneous 1-tick gap on *all* sensors
  can still blip; `rpmDuringGap` bridges longer gaps.
- **Race starts on GREEN.** The engine goes live at the green light, ~0.8 s before
  the race screen appears. The start is rolling: pedalling before green counts for
  nothing and is never punished, and counts from the first racing tick (§8, §10).
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
  `scaleBands`), `CycleRaceController` (parking and resuming, no-sensor riders,
  the mercy window, the all-away close, `finishNow` setting `endedEarly`),
  `raceCheckpoint` (race state round-trip, `checkpointOutcome`).
- **Components (vitest + @testing-library):** `CycleRaceScreen` (clock, speedometers,
  lanes, event markers, `showSpeedos`, `zoneBox` forwarding),
  `RaceLayoutManager` (mode by field size, splits-before-chart), `DistanceChart`,
  `SplitsChart` (sticky/live-order/final), `PovGrid`, `OvalTrack`, `SpeedoRow`,
  `CycleSpeedometer`, `CountdownStoplight` (ALL3→RED→YELLOW→GREEN), `RaceResults`
  (exit button, count-up under `animate={false}`), `RaceMenu` (guard time, focus,
  Escape), and `CycleGameContainer.raceMenu.test.jsx` (the menu in each phase,
  what each save records, the ended-early results line).
- **Live (Playwright):** `tests/live/flow/fitness/cycle-game-*.runtime.test.mjs`
  drive the simulator through full lifecycles via `FitnessSimHelper`
  (`launchCycleGame`, `setEquipmentRider`, `setRpm`).
- **Run unit tests:** `npx vitest run --config tests/_infrastructure/config/vitest.config.mjs <path>`.

> Visual verification (kiosk 1280×720) is the only way to catch SCSS/layout
> regressions — jsdom asserts structure, not pixels.
