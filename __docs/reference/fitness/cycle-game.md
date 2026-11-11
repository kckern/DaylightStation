# Cycle Game (Cycle Race) — Reference

**Status:** Current as of 2026-11-10.

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

- **Solo ride** — one rider and no ghost chosen. No rival unless the rider
  switches on **"Race my best"** beside Start (off by default). Switched on, the
  game adds a **pace rival**: the rider's own best at this race type and length,
  else the household's best, else a constant "par" pace (§5).
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
  widgets/CycleGame/raceMenuTestHelpers.js     test helper: open the menu, wait out the guard, tap
  nav/ImmersiveFrame.jsx                       app shell frame that hides the navigation rail
                                               while the context's `immersive` flag is set
                                               (the container sets it from staging on, §3)
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
  lib/cycleGame/raceValueStep.js                the lobby stepper's grid and limits
  lib/cycleGame/autoStartCourse.js              the simulator's one-click course shape
  lib/cycleGame/paceRival.js                    automatic pace rival: pick, merge with the
                                                server pool, par record
  lib/cycleGame/boostState.js                   heart-rate zone -> boost meter state and range
  lib/cycleGame/raceBeats.js                    halfway / minute / last stretch / final seconds
  lib/cycleGame/toastQueue.js                   one-at-a-time toast queue (stale, replaced, resolved)
  lib/cycleGame/staleClaims.js                  which lobby bike claims have gone stale
  lib/cycleGame/resultsComparison.js            results-board comparison lines against history
  lib/cycleGame/deriveRaceSnapshot.js           per-tick snapshot + drama events
  lib/cycleGame/dramaEventCopy.js               toast copy for drama events and beats

Race screen + fixed layout ──────────────────────────────────────────────────────
  widgets/CycleGame/CycleRaceScreen.jsx         screen shell: builds panel factories
  widgets/CycleGame/RaceLayoutManager.jsx       fixed layout by mode (solo/sidebar/wide) → zones
  widgets/CycleGame/panels/PaceDeltaPanel.jsx   solo: seconds ahead/behind the rival
  widgets/CycleGame/panels/PanelSlot.jsx        per-zone mount (stable render prop)
  widgets/CycleGame/panels/SpeedoRow.jsx        bottom gauges row (per-rider colour tint)
  widgets/CycleGame/panels/DistanceChart.jsx    climbing lanes + goal line + terminus tags
  widgets/CycleGame/panels/SplitsChart.jsx      per-lap splits (results board)
  widgets/CycleGame/panels/PovGrid.jsx          vertical Tron-style POV distance grid
  widgets/CycleGame/panels/OvalTrack.jsx        avatars circling a whole-race oval (kept in the
                                                codebase, not in the live panel map)
  widgets/CycleGame/CycleSpeedometer.jsx        a single gauge
  lib/cycleGame/speedometerGeometry.js          gauge ticks/bands/needle geometry
                                                (tickStepsFor, scaleBands)
  lib/cycleGame/chartZoom.js                    continuousWindow + evenTicks (chart axes)
  lib/cycleGame/chartScale.js                   chart axis scale helpers
  lib/cycleGame/layoutSizing.js                 raceLayoutMode, gaugeRowSize
  lib/cycleGame/paceDelta.js                    rider vs the rival's recording (gap s / m)
  lib/cycleGame/rivalTrace.js                   the rival's whole recording as chart samples
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

Persistence (backend, all under __app_modules/wellness/fitness/server/) ────────
  adapters/persistence/YamlCycleRaceDatastore.mjs   YAML read/write +
                                                    _index/{YYYY-MM}.json shards
  application/services/CycleRaceService.mjs         save/get/list/ghosts/ladder/
                                                    personal-bests/rival pool
  application/services/CycleRaceApiService.mjs      the API-facing projections:
                                                    ladder, personal best, rival pool
  application/activities/CycleGameProvider.mjs      gem (economy achievement) evidence
  api/fitness.mjs                                   /cycle-races routes incl. ladder +
                                                    personal-bests + rival-pool
  domain/services/cycleRivalPool.mjs                pure rival-pool domain: request
                                                    parsing, index rows -> pool entries
  domain/services/cycleLadder.mjs                   pure ladder domain: week window,
                                                    ISO week, course rotation, matching,
                                                    ranking

Weekly ladder (frontend) ────────────────────────────────────────────────────────
  widgets/CycleGame/home/FeaturedCourseCard.jsx  "This week's course" lobby card
  lib/cycleGame/ladder.js                        pure helpers: courseStartOverride,
                                                  pickRival, ladderDelta, daysLeft
  lib/cycleGame/ghostCandidate.js                mapRaceRecordToCandidate /
                                                  buildGhostFromCandidate — shared by
                                                  GhostPicker and Ride It

Verification ─────────────────────────────────────────────────────────────────────
  tests/_scratch/cycle-game-harness/            backend-free visual harness (see "Verifying a change")
  tests/live/flow/fitness/cycle-game-*.runtime.test.mjs   live Playwright flows
  tests/_lib/cycleGameLog.mjs                   reads the session log for the live flows
```

**Entry / registration.** `index.jsx` exports `CycleGameContainer` and a manifest
`{ id: 'cycle_game', name: 'Cycle Game', icon: '🚴', description }`. It has neither
`sidebar` nor `fullscreen`: the module renders inside the fitness frame, and the
container asks the shell to hide the navigation rail while a race is under way
(see §3). It is reached at `/fitness/module/cycle_game`.

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
      ▲                                              │ staging buffer elapses
      │ Exit / Rematch                               ▼
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
| `results` | `finished`→`results` | `RaceResults` | engine `finished` | **Exit** (`race-results-exit`), auto-dwell countdown (`results_dwell_s`), or **Rematch** (`race-results-rematch`: back to `idle`, then the same race starts again with a new race id) |

### A dead sensor is not a lazy child

The garage screen once told a child *"Did Not Finish — Stopped pedaling for 30s"* while he was
pedalling (nothing on screen says DNF any more). His cadence sensor had sent nothing for four minutes. Verified in production: the
`niceday` bike's ANT+ sensor emitted no packets at all across three races that each forfeited him
at the threshold with rpm 0, then woke, and his very next race registered 73 rpm. On the same day
there were 29 `sensor_lost` events against 13 `sensor_recovered`, across all five machines.

From rpm alone a still bike and a sensor that sends nothing are identical, so the rider's sensor
connectivity reaches the controller on its `connected` input. The controller keeps three sets, and
a rider is in at most one of them:

- **`parked`** — the rider's sensor reported and they stopped (or never started). Nobody is
  eliminated: a parked rider keeps their distance and is back in the race on their next pedal
  stroke. On screen they are dimmed and left out of the chart and camera framing, their
  speedometer shows **PARKED · Pedal to rejoin**, the standings tower lists them last as
  *"Parked · 412 m"*, and one calm toast reads *"{name} is parked · Pedal to rejoin"*.
- **`noSensor`** — the rider's sensor never reported at all. Never captioned "stopped pedaling" or
  "parked": the speedometer shows **NO SIGNAL · Check the sensor**, the tower reads
  *"No signal · 0 m"*, and the toast reads *"{name} — no sensor · Their bike never reported. Check
  the sensor."* Logged as `cycle_game.rider_no_sensor` at warn, so the store can answer "dead
  sensor or idle kid?" — a question that previously required diffing race telemetry against raw
  bridge output by hand. The rider leaves this set the moment their sensor reports movement
  (`cycle_game.rider_sensor_recovered`). If the sensor connects but the rider is not pedalling,
  they move to `parked`.
- **`overtime`** — the rider was still riding when the clock or the operator closed the race. A
  parked or no-sensor rider is never also overtime.

A rider who HAS ridden keeps the idle clock even if their sensor drops later: they demonstrably had
one, so a bike that stops reporting is read as a rider who stopped. A missing `connected` flag
counts as connected, so callers that do not report sensor state are unchanged. Parked and no-sensor
riders do not hold a race open: once a live rider has finished they are skipped, and if every live
unfinished rider is away the race closes after `allParkedEndS`.

**The SENSOR chip has two windows now.** It was gated on a rider having been connected once, so a
sensor that never appeared produced no warning *ever* — and being set aside was then the only
thing anyone saw. A rider who was connected and drops is flagged at `SENSOR_LOST_GAP_TICKS` (9); a rider
who has never connected gets the longer `SENSOR_ABSENT_GAP_TICKS` (15), which is past the mounting
and lock-on window but still short of the start-grace that sets them aside — so the warning arrives
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
- **The navigation rail hides during a race.** The container sets the fitness
  context's `immersive` flag (`setImmersive`) while the React phase is anything
  but `idle` (staging, countdown, `go`, racing, results), and clears it on
  returning to `idle` and on unmount. `ImmersiveFrame` (the shell's frame) hides
  the rail while the flag is set, and the module gets the rail's width. The lobby
  keeps the rail: riders navigate from it. The unmount cleanup restores the rail
  however the game ends, including a crash caught by an error boundary above it.
  Logged as `cycle_game.immersive` (debug, `{ on }`) on each change. The flag
  defaults to false, so no other module is affected.

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
   does an unclaimed slot. There is no scoring-rule line under the grid: the
   "Harder effort goes further…" hint was removed on the owner's call
   (2026-11-10); each race gauge's boost row shows the zone multiplier.
   A claim nobody has pedalled for 30 minutes is cleared by the lobby itself
   (§5, "Stale claims clear themselves").
4. **Rider picker** (modal) — people grouped into **Household / Family / Guests**
   tabs; each tile shows avatar, name, and a "live" badge for an active HR strap.
   Built-in **Guest (Adult)** / **Guest (Kid)** lead the Guests tab. `Escape` closes.
5. **Ghost picker** (`GhostPicker`) — past races grouped by day, most-recent-first.
   **Three-step selection:** first tap scrolls + focuses a card; second tap opens a
   **roster submenu** listing that race's participants (avatars + names), **all
   selected by default**, each tappable to toggle off, with **Select all** and
   **Start** (Start is disabled if you exclude everyone). Start commits the race
   with only the chosen ghosts — the picker pre-filters `candidate.participants`, so
   the rest of the ghost pipeline is unchanged. A card shows the winner plus up to
   three more overlapping avatars (`GHOST_CARD_MAX_AVATARS` = 4); any further riders
   collapse into a `+N` chip so the row never overruns the race-type pill.
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

**Pace rival — opt-in** (`startRace`; selection in `lib/cycleGame/paceRival.js`).
A rival the rider did not hand-pick in the Ghost picker joins a race **only**
when the lobby's **"Race my best"** switch (`data-testid="race-my-best"`,
`role="switch"`, container state `raceMyBest`) is on. It is **off by default**,
shown beside Start only with no hand-picked ghost and at most one rider, and
pressing it again before Start removes the rival (`cycle_game.race_my_best_set`).
Off, a lone rider's Start launches at once with no lookup and logs
`cycle_game.pace_rival_skipped {reason: 'not_opted_in'}` (DEBUG). (2026-11-10: a
rival was added to a plain Distance race with no way to opt out.) The switch does
**not** gate "Ride it": the weekly course always races its leader's ghost (§16).

`startRace` first works out the ghost that would race: an explicit override (the
featured-course button passes its ladder rival, or `null` when it has none)
beats the lobby's hand-picked ghost. If there is no such ghost, **exactly one**
live rider is claimed and "Race my best" is on, a pace rival is armed for that
race:

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
- **Stale claims clear themselves.** Claims live on the session and outlast a
  race, so a bike can still carry yesterday's rider. The session keeps no
  claim time and no last-pedalled time (the cadence reading's `ts` moves on
  every packet, a still bike included), so the container records one per bike
  in a ref: seeded when it first sees a claim or the claim changes hands (or
  at once for a picker claim), moved on every reading above 0 rpm. The lobby
  and pre-race polls and every race tick sample it. When the lobby appears
  (mount, or back from a race) and once a minute while it is up, every bike in
  `staleClaims(bikes, now, 30 min)` is unclaimed through the normal unassign
  path (`rider_unassigned` with `control: 'lobby.auto-clear'`) and logged as
  `cycle_game.rider_auto_cleared`. Never during staging, countdown, a race or
  the results board, never while a start is pending, and never a claim the
  container first saw less than 30 minutes ago, cadence or not. The record is
  lost when the game unmounts, so a claim older than the game is timed from
  when the lobby first saw it.
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
is the single source of truth for the lap unit used by the engine, splits
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
| `race_idle_dnf_s` | 20 | The park window (the key keeps its old name; nobody is eliminated): seconds of zero RPM (after a rider has started) before they are parked. Parked riders resume on their next pedal stroke. Reaches the controller as `raceIdleDnfS`; the controller prefers `parkIdleS` when both are given |
| `race_start_grace_s` | 30 | Seconds a rider may report zero RPM **before their first movement** before they are parked as a no-show. More generous than `race_idle_dnf_s` to cover magnetless cadence sensors (e.g. the tricycle's COOSPO BK467) that take ~20s to lock onto rotation from a dead stop |
| `hot_start_penalty_s` | — | **Retired.** The start is rolling and there is no penalty box; nothing reads this key (the container, the lobby config builder and the controller all ignore it). Safe to delete from the YAML |
| `lap_length_m` | 0 | Lap unit for splits (0 = laps off, which is the code default when the key is absent; the household config usually sets 400; a distance race shorter than the lap is one whole-race lap) |
| `race_mercy_after_winner_s` | 60 | Distance races: seconds after the first finisher before the race closes itself; anyone still riding goes to overtime with their real distance. 0 disables. Ignored by time races |
| `results_dwell_s` | 45 | Results auto-return countdown before returning to the lobby (a touch on the board stops it) |
| `par_speed_kmh` | 18 | Speed of the "par" pace rival a lone rider races when nobody has a counting ride at this race type and length (§5). Must be positive, or the default is used; a positive value below 3 km/h is raised to 3 |
| `default_background` | null | Ambient background Plex id for the race screen |
| `music_volume` | 0.55 | Background music level (0–1) |
| `sounds` | {} | One-shot cues `start`, `go`, `countdown` (stoplight beat), `final_seconds` (the beep in the last ten seconds of a time race), `finish` (finish-line cue); music `lobby`, `ready` (falls back to `lobby`), `end`; `racing` is `{ dir, ... }`, a folder of tracks picked at random. A cue that is not named plays nothing. `countdown` and `finish` are optional and the household leaves them unset on purpose: the start jingle and the results outro already mark those moments |

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
countdownRemaining, parked[], noSensor[], overtime[], endedEarly, engineState }`.
The old `dnf`, `penalized` and `penaltyInfo` keys are gone; nothing reads them.

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
engine state, picks the layout `mode` with `layoutSizing.raceLayoutMode({ liveCount,
fieldSize })` (live = non-ghost riders) and hands `{ panels, mode }` to
`RaceLayoutManager`. There is no per-tick director — the layout is deterministic,
so panels never reshuffle mid-race. The race **clock lives inside the distance
chart's header**.

```
engine getState()
  → CycleRaceScreen (panel factories + raceLayoutMode)
  → RaceLayoutManager (fixed by mode: solo · sidebar · wide)
  → panels: DistanceChart · PovGrid · SpeedoRow ·
            StandingsTower (sidebar, wide) | PaceDeltaPanel (solo)
```

**One distance per rider.** Every printed distance for a rider (odometer,
chart tag, chart header, standings tower, POV badge) is the engine's
`cumulativeDistanceM` for that tick through `formatDistance`, and carries
`data-distance-readout="<riderId>"`. Motion may interpolate positions (chart
tips, POV avatars, the needle); printed numbers never interpolate.

### 9.1 The three layouts (`RaceLayoutManager`)

`raceLayoutMode`: **solo** when there is exactly one live rider and the field is
at most two (the rider and their pace rival); otherwise **wide** at four or more
on the road, else **sidebar**. Each zone renders its panel through a `PanelSlot`
(a stable `render` prop, so a panel never remounts per tick), every zone is
`overflow:hidden`, and every grid track has an explicit size, so nothing
collapses and no zone is left empty.

- **Solo (one live rider + their rival):** a main column (72% of the width)
  with the **distance chart** across the top (55fr of the height) over a band
  (45fr, never below 260 px) holding the live rider's **speedometer** (2fr, left)
  and the **pace-delta panel** (3fr, the rest); the **POV road** is a right
  column at 28% of the width. There is **no standings tower** and nothing ranks
  or leads: the chart header drops "Leader …", chart tags and the POV badge show
  each rider's own distance with no ordinal, and the gauge has no leader medal
  and no placement on its finish overlay. The rival has no gauge; it is on the
  chart (its replayed lane, tag and whole-race trace, §9.2), on the road and in
  the pace panel.
- **Sidebar (two or three on the road, or one rider in a bigger field):** a main
  column — the **distance chart** over a full-width **speedometer** band — beside
  a right **sidebar**: the **POV grid** (top ~70%) over the **standings tower**
  (bottom ~30%; the tower's header carries the lap strip).
- **Wide (four or more):** a top row of **chart (2×) │ standings tower │ POV grid**
  over a **speedometer** band that spans the full width. Each gauge is sized
  from the band's **width ÷ rider count** (`layoutSizing.wideGaugeSize`: clamp
  150-280 px, 16 px gaps) and the band is exactly that tall plus its chrome
  (gauge + 86 + 16 px, at most 50% of the height; the sidebar and solo speedo
  rows take up to 54%). CSS does the same sum with container units
  against `.race-layout-host` and `--cg-speedo-n` (set from `speedoCount`), so
  there is no measure-resize loop. On the garage kiosk (1301x745 content) that is
  ~191 px gauges for six riders, ~247 px for four and ~270 px for one to three
  (2026-11-11; they were ~181/187/176), every gauge on
  screen and every tower row visible. (2026-11-10: a fixed 220 px floor put six
  gauges past both edges and cut the tower's 6th row.)

`showSpeedos={false}` omits the speedo factory and its grid track; in solo the
band then holds the pace panel alone. The recap passes `soloLayout={false}`, so a
replay of one rider and their rival stays on the sidebar layout (standings and a
gauge per participant; a 12 s replay reads better as standings than as a pace
gap).

**Pace-delta panel (solo).** `paceDelta({ riderDistanceM, elapsedS, rivalSeries,
intervalS })` compares the rider with the rival's **whole recording**: the engine
exposes it on a ghost's state as `ghostRecordedSeries` (series[i] = metres at
(i + 1) × `ghostIntervalS`), because `distanceSeries` is only the part replayed so
far and the rival may reach the rider's distance later in the recording. The
interval is the recording's (`ghostIntervalS`), not the race tick. The headline
is seconds ahead/behind ("4 s ahead"), metres once the rider is past the end of
the recording; a finished rider's gap freezes at their finish time. The rival is
worded from `rivalKind` (passed by the container from `raceMetaRef.current.rivalKind`):
"vs your best", "vs {name}'s best", "vs par pace", or "vs {name}" for a
hand-picked ghost, with the ghost glyph stripped from the name. A parked or
no-sensor rider keeps the panel (the rival keeps moving away).

### 9.2 DistanceChart

Climbing gradient lanes toward the goal, over a decimating, transform-aware
**gridline** background, with the race clock folded into the panel's header.

- **Goal line** (distance races) is drawn at `yFor(goalM)` **inside the zoomable
  group**, so it tracks the live zoom window — a rider who reaches the goal visually
  meets the dotted line. Its label ("⚑ 1.50 km") rides the line near the right
  end; a terminus tag that climbs onto the line at the right edge (the leader
  closing on the finish) would be covered, so the label slides left along the
  line to just clear of any tag it would touch and slides back when the tags
  move on (`chartGoalLabel.goalLabelLeft`, pure; applied at the tick and per
  frame from the same tag geometry the tags are drawn with; tag and label boxes
  are measured only when their text changes). It never goes left of the y-axis
  label that shares the line's left end.
- **X axis.** A **time race shows the whole race** (`0 … timeCapS`) from the first
  frame, so the rider sees how much is left. A **distance race** has no fixed end
  time: its time window grows continuously (`chartZoom.continuousWindow`, data at
  ~85% of the window, never a 2× step) and the window bounds ease between ticks.
- **Y axis.** Fixed `0 … goalM` in a distance race (goal line at the top). A time
  race auto-zooms continuously to fit the leader, never below the solo rival's
  distance at `timeCapS`. A time race with two or more un-parked riders bunched
  together flips to a leader-anchored log scale ("Zoomed on leaders" chip), with
  hysteresis and a ~400 ms crossfade. **Solo stays linear**: the log scale is
  anchored on the leader and would bend the rival's trace.
- **Even axis ticks** (`chartZoom.evenTicks`): five gridlines per axis evenly
  spaced over the window with both ends included, and a label on every other
  one (0, middle, end): a 5-minute time race reads 0:00 · 2:30 · 5:00.
- **Rival trace (solo).** The rival's whole recording (`ghostRecordedSeries`) is
  drawn as a dotted line in its lane colour under every lane
  (`data-testid="rival-trace"`, built by `rivalTrace.rivalTraceSamples`), so the
  rider sees where the rival will be. In a time race it spans the whole x axis;
  in a distance race it runs to the window edge and ends on the goal line at the
  rival's finish time. It is re-sampled each frame under the eased window, so it
  drifts with the lanes. The rival's replayed lane and tag still mark where it
  is now.
- **Leading-edge interpolation:** the engine ticks at 1 Hz, so each lane's newest
  point glides from its previous position to the current one over the interval via a
  rAF clock, instead of snapping.
- **Parked riders leave the framing.** The leader the tag gaps are measured
  from, a time race's distance window and the log-scale crowding test all use
  the riders who are not parked (`riderLive[id].parked`, which covers no-sensor
  riders too), falling back to everyone when the whole field is parked. A parked
  lane and its tag draw at 40% opacity; the tag shows the rider's own distance.
  There are no event markers on the chart.
- A lane **starts at first movement** (`chartTrim.plotStartIndex`), so a late
  starter emerges to the right of the origin instead of drawing a flat zero line.

### 9.3 SplitsChart

Not on the live race screen. A compact per-lap split table (laps × riders) used
by the results board (`final` mode). It **auto-scrolls to the newest lap**, keeps
a **sticky header**, and before any lap completes shows a **live order**: riders
sorted by distance with the gap-to-leader in metres. Laps-gated: nothing shows
when `lapLengthM` is 0.

### 9.4 PovGrid

A **Tron / Cruising-USA POV road** rendered with three.js — a
shader-antialiased grid with camera-relative fog, framed by a damped follow
camera that trails the back of the field with a span derived from the leader
gap (`povFollowCam`), over a road world model of metre marks, lap-gate arches,
and rider positions (`povWorld`). Each rider is a **billboarded real-face
avatar** — a pooled DOM label positioned by the render loop. Rider motion
interpolates per-frame between 1 Hz ticks; React renders structure only — the
rAF loop owns motion.

Every rider stays on the road. A parked rider is passed to `povWorld` with
`parked: true`: they keep their position, but the leader, the trailing rider
and the camera anchor come from riders who are not parked (everyone, if the
whole field is parked), so a stopped rider never stretches the camera. Their
avatar card and rank badge carry `is-parked` (dimmed), and the badge reads
"2nd · Parked · 412 m" (or "No signal · …").

### 9.5 StandingsTower & SpeedoRow

- **StandingsTower** — the persistent rank/gap ladder the audit found missing from
  every live race (UX §4.1): rank ordinal (shared placements render the same
  ordinal — a dead heat shows two "1st"), lane-color chip, a 32px avatar
  (ghost-treated), the display name, and either a gap-to-next-above reading or —
  for the group leader, a finisher, or an overtime row — their own
  total/final metric. Distance races express the gap in metres; time races
  project it through the pace of the rider immediately above into a
  time-behind estimate. Finished riders pin to the top with a flag; overtime
  riders follow the active pack, dimmed; parked riders (`parkedRows`, kind
  `parked`) come last, dimmed, reading "Parked · 412 m" or "No signal · 412 m".
  Nobody chases a parked rider: the next active rider's gap is to the active
  rider above them. In a recap, a participant saved as `stopped` reads
  "Stopped at 412 m" once their recording has run out. Its header line folds in what used
  to be the oval's "Last / Now" lap strip ("Lap 3 · Last 0:42 · Now 0:12"),
  fed by the same `riders[id].lapSplits` data. Renders in **both** layouts —
  sidebar mode (replacing the oval's old slot) and wide mode (a docked
  right-edge column). `OvalTrack` (`ovalTrackModel.ovalProgressFor`: one loop =
  the whole race) stays in the codebase but is no longer part of the live
  panel map.
- **SpeedoRow** — one `CycleSpeedometer` per rider on a single line; gauge size is
  computed from the injected `zoneBox` (`gaugeRowSize`, fit-across-width capped by
  height, minus `CHROME_BELOW_GAUGE_PX` for the tag overhang, zone bar row and
  odometer), never self-measured. Caps: `maxGauge`/`minGauge` 360/140 in solo
  and sidebar modes, 280/150 in wide mode. Gauges sit `SPEEDO_GAP_PX` (16) apart. In solo mode it holds the live rider's gauge only, with
  `ranked={false}` (no leader medal, no placement). Each gauge's **background is tinted** with a dark wash of its
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
  staged on; cadence never changes the state. Ghost chips read **AUTO**. A live
  rider with **no heart rate** reads **"No strap · ×{hrless}"** under their name
  (the container sets `noStrapMultiplier` to `hrless_multiplier`), so the
  strapless handicap is known before the race. The
  chips are the riders **staged for this race** (fixed when the race is built)
  plus its ghosts, not whoever holds a bike at that moment: a claim changed while
  Start was waiting on its lookup does not put a rider on the strip who is not
  racing.
- **Lobby bikes.** Each entry of the lobby's `bikes` list carries the same
  `sensorLive` flag (the bike's sensor is reporting right now), which the lobby's
  sensor check reads (§4).

---

## 11. Officiating events

The tick diffs the controller's sets each second and raises edge events. Toasts
go through **`CycleEventToast`** — a single-slot, non-blocking toast that
auto-dismisses (or goes on click) and **never pauses the race**.

**Toasts never arrive late.** Every push goes through one container callback,
`showToast`, over the pure queue in `lib/cycleGame/toastQueue.js`:

- A free slot shows the toast at once; otherwise it is queued with the time it
  was raised.
- A newer toast of the same variant **replaces** a queued one (ten lead
  changes in a burst show the first and then only the latest).
- When the slot frees, a queued toast older than `TOAST_MAX_AGE_MS` (6 s) is
  **dropped**, never shown late.
- Milestones (`TOAST_KEEP_VARIANTS`: `finished`, `photo-finish`, `overtime`,
  `nosensor`, `final-lap`) are kept however long they waited, are never
  replaced, and stay up 4 s (`toastDurationMs`); everything else stays up 3 s.
- `parked` is not a milestone: a park notice that arrives late may be wrong.
  When a rider resumes, any park notice for them still in the queue is
  withdrawn (the one already on screen runs out).
- Every drop logs `cycle_game.event_toast.dropped` (DEBUG, `{ variant, ageMs,
  reason }`, reason `stale` | `replaced` | `resolved`).

| Edge | Toast (variant) | Log |
|---|---|---|
| A rider enters `parked` | *"{name} is parked · Pedal to rejoin"* (`parked`, calm muted accent, one per park) | `cycle_game.rider_parked` (INFO) |
| A parked rider pedals | none | `cycle_game.rider_resumed` (INFO, with `awayS`) |
| A rider enters `noSensor` | *"{name} — no sensor · Their bike never reported. Check the sensor."* (`nosensor`, amber) | `cycle_game.rider_no_sensor` (WARN) |
| A no-sensor rider starts moving | none | `cycle_game.rider_sensor_recovered` (INFO) |
| Riders land in `overtime` | one summary *"Race closed — N riders still riding"* (`overtime`) | `cycle_game.rider_overtime` per rider (INFO) |
| A live rider's heart-rate zone changes and the multiplier goes **up** | *"{name}: {zone} ×{mult}"* (`boost`, success green, good news) | `cycle_game.boost_change` (DEBUG) |
| A live rider's zone changes and the multiplier goes down or stays | none | `cycle_game.boost_change` (DEBUG) |

The first zone reading of a race only seeds the comparison (no toast, no log),
and a distance-race finisher (parked at the line, no zone) is left out. A strap
that starts reporting mid-race is a change from no zone (the strapless
multiplier) to the zone, so it raises the toast when that multiplier is higher.

### Race beats

The middle of a race has a shape. Each tick (except the race-ending one) the
container calls `raceBeats` (`lib/cycleGame/raceBeats.js`) with the furthest
live rider who is **not away** as the leader, keeps its state between ticks
(reset at launch) and turns each beat into toasts with `beatToasts`
(`dramaEventCopy.js`). A solo race (one live rider and one replayed rival)
gets the gap to the rival from `paceDelta` (the rival's `ghostRecordedSeries`
at this tick); a group race has no rival and no gap. While every live rider is
away the beats still advance, so none fires late, but nothing is shown,
played or logged.

| Beat | When | Toast (variant) | Also |
|---|---|---|---|
| `HALFWAY` | half the time (time race) or the leader at half the goal (distance race), once | *"Halfway"*, plus *"4 s ahead of par"* / *"6 s behind your best"* in a solo race (`halfway`) | |
| `SPLIT` | each whole minute, once, unless a bigger beat fired that tick | *"2:00"* + the gap (`split`); **no toast** without a rival | |
| `LAST_MINUTE` | 60 s left in a time race of 3 min or more, once | *"One minute left"* (`last-minute`) | starts the finale |
| `LAST_STRETCH` | the leader at 90% of a distance race, once | *"Last stretch"* (`last-stretch`) | starts the finale |
| `FINAL_SECONDS` | each of the last 10 s of a time race | none | `sounds.final_seconds` beep each second (silent when unset); the chart clock gets `is-final` (hero size, warm, pulsing; no pulse under reduced motion) |

The beat toasts share a neutral accent. **Finale:** from `LAST_MINUTE` or
`LAST_STRETCH` until the race ends the race screen root carries `is-finale`
(the vignette closes in slightly) and the racing music rises (§14).

`cycle_game.cadence_change` logs every sensor connect/drop transition. There is
no DNF toast, no DNF log, no penalty lifecycle (rolling start, §10) and no
event markers on the chart. Riders away at a tick (parked ∪ no sensor) are
passed to `deriveRaceSnapshot` as `awayIds`, so a parked rider who is ahead on
distance is never announced as taking the lead.

---

## 12. Results & recap

- **`RaceResults`** — a Mario-Kart-style finish board. Standings animate in
  (slide-into-podium, rows fly/fade in, metrics count up — the count-up is disabled
  under `prefers-reduced-motion`, and tests pass `animate={false}`), the full
  **lap-by-lap splits table** is shown (`SplitsChart final`), 🥇🥈🥉 medals (numeric
  for 4+), the winner gets a 👑 and a larger avatar. A rider who was parked or
  had no sensor at the close (`stopped` = parked ∪ noSensor, passed by the
  container) reads **"Stopped at 412 m"**: their real distance, muted, no crown.
  An overtime rider keeps their distance with an **OT** tag, explained in the
  legend. Nothing on the board says DNF. Metric is finish-time (distance race)
  or distance covered (time race).
- **Hold and leave.** The board **auto-returns to the lobby** after
  `results_dwell_s` (default 45 s) with a visible "Back to lobby in N". The
  first touch or key press anywhere on the board stops that countdown for this
  board (`cycle_game.results_held`); the board then stays until someone
  leaves. The board's own **Exit** is the one way out (the container renders
  no second button under it).
- **Rematch** (primary button) starts the same race again: same type and
  length, the riders on the bikes now, and the same hand-picked or ladder
  ghost. An automatic pace rival is re-picked at the rematch, so a ride that
  just set a new best is the one chased next. A featured-course ride rematches
  the course (it keeps its course id and ladder callouts). It goes back to the
  lobby and starts from there on the next render, through the normal start
  path. Rematch is not offered when nobody is on a bike any more, or when the
  featured course is no longer on the ladder (the post-save ladder refetch
  replaces the lobby's ladder when the course rotated or the ladder is gone).
- **Comparisons.** At launch the container records, for each live rider, their
  best and most recent result at this exact type and length (the pace rival's
  pool and filter: not incomplete, not a ghost, not stopped), taken from the
  candidates that start already had: the server rival pool merged with loaded
  history when the solo lookup answered, else loaded history. Nothing is
  fetched for it. Under each live rider's row the board shows
  `resultsComparison` as text: *New best · 12 s faster* (or *m further*),
  *First ride at this length*, or *4 s off your best · 3 s faster than last
  time*. No comparison for an ended-early ride, a rider stopped at the close,
  a distance-race rider who did not finish, or a ghost.
- **Versus line.** In a solo race (one live rider, one replayed rival) the
  board names the rival: *your best*, *{name}'s best*, *par pace*, or the
  hand-picked ghost's name, e.g. "You beat your best by 4 s".
- **`RaceRecap`** — full-screen modal that replays a saved race by feeding
  synthesized rider state into `CycleRaceScreen` over ~12 s regardless of race
  length, with play/pause + scrub, then the final standings. **RPM is always 0 in
  recap.** A participant saved with `stopped: true` (carried by
  `mapRaceRecordToCandidate`) reads "Stopped at …" in the standings tower once
  their recording has run out; the recap never shows the live PARKED overlay.
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
- **The gauge is the column's hero** (owner, 2026-11-11: "the speedometer is too
  small, the chips are too big"). Everything else in the column is one line.
- **Rpm is the large number, km/h the small one** (the rider controls rpm), on
  **one line** in the free lower hemisphere (`speedometerOverlayLayout`:
  `READOUT_TOP_RATIO` 0.69, under the avatar, below every tick label).
- **Multiplier tag** (replaces the old multiplier badge, which sat on the dial's
  top-right label): one solid line **straddling the dial's base**
  (`TAG_HEIGHT_PX` 28, hanging `TAG_OVERHANG_PX` 10 below the gauge box, so it
  stays clear of the readout at the 140 px floor). In the zone colour with dark
  text it reads `{zone} ×{mult}`; with no heart rate it is the same tag on a
  neutral plate reading `No strap ×{hrless}` at every gauge size
  (`boostState.boostChipLabel`), never a wider pill or an extra line.
  Multipliers print with at most one decimal and no trailing `.0`
  (`boostState.formatMultiplier`).
- **Zone progress row** under the gauge: a solid bar filling to the zone
  progress (hidden when progress is unknown, e.g. a ghost) and, on a gauge of
  220 px or more, the next step beside it (`{next} ×{mult}`, absent at the top
  zone). Empty for a strapless rider, so every column's odometer lines up. The
  container builds the boost per rider as
  `riderLive[id].boost = boostState({ zoneId, zones, hrlessMultiplier, progress })`
  (ghosts: the replayed zone, `progress: null`); no `boost` (the recap) means no
  tag and no row. `layoutSizing.CHROME_BELOW_GAUGE_PX` = tag overhang 10 + row
  22 + odometer 42 + 2 × 6 gap = 86 (was 118), which sets the gauge floors
  (sidebar/solo band `minmax(260px, …)` → min gauge 140; wide band sized from
  the width → min gauge 150).
- **Nothing fades.** Inactive cadence bands are their colour mixed solid into the
  dial (no opacity, no pulse); FINISHED / PARKED / NO SIGNAL sit on a solid
  plate across the dial instead of dimming it. The PARKED/NO SIGNAL plate ends
  where the readout starts, so the live rpm stays readable under it; a
  finisher's readout (rpm forced to 0) steps aside under the taller FINISHED
  plate. The leader medal sits inside the odometer pill.
- **Overlay states** (one at a time, in the same slot):
  - **FINISHED** — 🏁 + placement for a rider over the line in a distance race.
  - **PARKED · Pedal to rejoin** — `parked` (idle past the park window). Calm,
    not an alarm.
  - **NO SIGNAL · Check the sensor** — `noSensor`, **or** `parked` while the
    `sensorLost` chip is up. A rider whose sensor has dropped may be pedalling
    the whole time, so they are told to check the sensor, never to pedal.
  Both away overlays clear on the render after the controller sees movement.
  The **SENSOR** chip (rpm slot) is independent and can show under NO SIGNAL,
  where it agrees; it never shows under PARKED, because PARKED is only chosen
  when the sensor is not lost. A finisher never shows an away overlay. There is
  no penalty overlay (rolling start, §10).
- **The odometer prints, it does not count.** It shows the engine's
  `cumulativeDistanceM` through `formatDistance`, the same value and formatter
  as every other distance readout (§9). Only the needle glides between ticks.
- **Avatar compositor layer.** `.cycle-speedometer__avatar { transform: translateZ(0);
  will-change }` so the needle's per-tick repaint doesn't flicker the overlaid avatar.

---

## 14. Sound & music

`playSound(url, { volume })` is a no-throw one-shot (`new Audio().play()`, swallows
autoplay rejections; no-op on a falsy url). The container drives a lifecycle
soundtrack — lobby loop (idle), ready cue (staging), start jingle + per-tick beeps
(countdown), random racing track (racing), outro (results) — all scaled by the
master volume.

- **Music level** = `(music_volume + lift) × master`, clamped to 1. The lift is
  0, except in a race's **finale** (last minute / last stretch, §11), where it
  is 0.15 (15% of master) until the race ends or is discarded.
- **Final seconds:** each of the last ten seconds of a time race plays
  `sounds.final_seconds` (its own key, so it can be enabled without bringing back
  the stoplight beeps; silent when unset).

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
    final_time_s: 142          # null if the rider did not finish / time race
    placement: 1               # null if unplaced
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
**"This week's course"** card offers a one-tap **Ride It** that always races the
week's leader as a ghost. Results then call out ladder movement. Built on the same records and index
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
  better; a participant with a null `final_time_s` — stopped or unfinished — doesn't
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
  (which sets `course_id` for free) and **always arms the weekly-course ghost**,
  whatever the "Race my best" switch says (owner 2026-11-11: two riders on
  Sprint 1500 raced only each other while a child held #1 — the ghost had been
  put behind the switch). `pickRival({ standings, riderIds })` in
  `lib/cycleGame/ladder.js` picks, from the riders claimed on every bike:
  - the ladder **leader** is not riding → the leader's best race this week
    (`rivalKind: 'leader'`);
  - the leader **is** riding → the best run this week by the highest-ranked
    rider who is not (`'best-not-riding'`);
  - everyone on the ladder is riding → the leader's own week-best run, as a
    ghost (`'leader-own-record'`);
  - no runs this week → no ghost (`'none'`); the card reads "No rides yet this
    week, so no ghost to race."
  Only the rival's own line replays (`onlyParticipant`): a best run ridden
  alongside others, or against a ghost, does not bring them along.
  The lookup never holds up or fails Ride It. The lobby freezes at the press
  (§4), and the race-record request has one 1500 ms budget and one abort
  signal. On a timeout, an HTTP or network error, or a record
  with nothing to replay, the course starts without the ladder ghost and
  `cycle_game.featured_rival_lookup_failed` is logged (§18); a lone rider with
  "Race my best" on then gets the automatic pace rival from loaded history only
  (§5). `cycle_game.ride_featured` logs `{ courseId, rider, riders, rivalKind,
  rivalUserId, rivalRaceId, ghostArmed, raceMyBest }`. If the game is
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

### Race index: rebuilds, warm-up and logging

The race index (`_index/{YYYY-MM}.json` beside the race folders) is derived data.
A day is rebuilt from its race files when its month has no readable shard, when
the shard was written by another index version, or when the day's folder changed
(the day after any save). A rebuild parses race files synchronously, so:

- **It yields.** The datastore returns to the event loop after each rebuilt day,
  so other requests are served during a long rebuild.
- **One pass at a time.** Per race folder, overlapping readers share one pass
  rather than each parsing the files. A race saved while a pass is running is
  left out of that pass's shards and read from its file by the next pass; a
  reader that arrives after such a save waits for the running pass and starts a
  fresh one, so it always sees the save.
- **It is warmed at boot.** Five seconds after the fitness API is composed,
  `CycleRaceService.warmIndex()` builds the index for the default household, so a
  cold rebuild is not paid inside a rider's Start (the rival-pool lookup has a
  1500 ms budget). The warm-up never blocks startup and never throws.
- **Shards are written atomically** (staged beside the file, then renamed).

| Event | Level | Data | When |
|---|---|---|---|
| `fitness.cycle_races.index.rebuilt` | info | `{ days, races, ms, reason }` | A pass rebuilt at least one day. `reason` is `version` (a shard of another index version was discarded), `cold` (a month had no readable shard) or `stale-day` (only days a good shard did not cover or whose folder changed). The strongest reason in the pass is reported, in that order. |
| `fitness.cycle_races.index.warmed` | debug | `{ entries, ms }` | The boot warm-up finished. |
| `fitness.cycle_races.index.warm_failed` | warn | `{ error }` | The boot warm-up failed; the first reader builds the index instead. |

A `rebuilt` event with `days: 1, reason: 'stale-day'` after each saved race is
normal. One with hundreds of days and `reason: 'version'` outside a deploy means
an older build sharing the data tree rewrote the shards.

### Rival-pool request: length parsing

`GET /api/v1/fitness/cycle-races/rival-pool` takes `winCondition` (`distance` or
`time`) and the length that belongs to it (`goalM` for distance, `timeCapS` for
time). The length must be a plain decimal number: digits, optionally a point and
more digits (`1500`, `1609.3`). It is not trimmed, so padding, a sign, an
exponent, hex and separators are rejected, as is a zero length, a repeated
parameter, or the other race type's length. A rejected request answers `400`
with an error body, without reading the index. When cycle races are not wired
the route answers `503`.

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
  `race_saved`, `rider_assigned` / `rider_unassigned`, `rider_auto_cleared`, `rider_parked` /
  `rider_resumed`, `rider_sensor_recovered`, `rider_overtime`, `cadence_change`,
  `ended_early`, `cancelled`, `recap_*`, `volume_set`, `history_loaded`,
  `pace_rival`.
- **Away riders.** `cycle_game.rider_parked` (INFO) `{ raceId, userId,
  elapsedS, distanceM }` when a rider enters `parked`;
  `cycle_game.rider_resumed` (INFO) the same plus `awayS` (race seconds spent
  parked) when they pedal again; `cycle_game.rider_no_sensor` (WARN) `{ raceId,
  userId, equipmentId, elapsedS }` when a rider's sensor never reported, and
  `cycle_game.rider_sensor_recovered` (INFO) `{ raceId, userId, equipmentId,
  elapsedS, distanceM }` when that rider starts moving. No DNF, penalty or
  false-start event exists, and `race_started` and `cycle_game.config` carry no
  such fields.
- **`cycle_game.boost_change`** (DEBUG) — a live rider's heart-rate zone
  changed, either direction: `{ raceId, userId, from, to, mult, elapsedS }`
  (`from`/`to` are zone ids, `null` for no strap; `mult` is the new
  multiplier). An upward change also raises the `boost` toast (§11).
- **`cycle_game.drama_event`** (DEBUG) — every edge `deriveRaceSnapshot` fires
  (`LEAD_CHANGE`, `RIDER_FINISHED`, `PHOTO_FINISH`, `FINAL_LAP`,
  `LAPPING_IMMINENT`): `{ raceId, type, riderIds, elapsedS }`.
- **`cycle_game.event_toast.dropped`** (DEBUG) — a queued toast that was
  never shown: `{ variant, ageMs, reason }`; `reason` is `stale` (waited past
  6 s), `replaced` (a newer toast of the same variant) or `resolved` (a park
  notice for a rider who resumed first). See §11.
- **`cycle_game.beat`** (INFO) — a race beat (§11): `{ raceId, beat, elapsedS,
  gapS, gapM }` (gap to the rival in a solo race, else `null`). Once per beat;
  `FINAL_SECONDS` is logged once, when the final ten seconds start.
- **`cycle_game.finale_started`** (INFO) — once per race, on the beat that
  starts the finale: `{ raceId, beat, elapsedS }`.
- **`cycle_game.results_held`** (INFO) — the board was touched and its
  auto-return stopped: `{ raceId, secondsLeft }`.
- **`cycle_game.rematch`** (INFO) — Rematch pressed: `{ fromRaceId,
  winCondition, goalM, timeCapS, hasGhost }`. The new race then logs the usual
  start events with `control: 'results.rematch'`.
- **`cycle_game.rider_auto_cleared`** (INFO) — the lobby unclaimed a bike
  nobody had pedalled for 30 minutes (§5): `{ equipmentId, userId, idleMs }`.
- **`cycle_game.ended_early`** (INFO) — the race was ended from the race menu
  and will be saved as incomplete: `{ raceId, elapsedS, control: 'race-menu.end' }`.
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
- **`cycle_game.race_my_best_set`** (INFO) — the lobby's "Race my best" switch
  was pressed: `{ on, control: 'lobby.race-my-best' }`.
- **`cycle_game.pace_rival_skipped`** (DEBUG) — a lone rider started with "Race my
  best" off, so no rival was looked up: `{ reason: 'not_opted_in', control }`.
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
  `control` is `lobby.start-button`, `featured`, `results.rematch` or `sim.autostart`.
- **`cycle_game.start_failed`** (ERROR) — building the race threw, on any start
  path: `{ control, error }`. Nothing is left staged and the lobby is unfrozen.
- **`cycle_game.featured_rival_lookup_failed`** (WARN) — "Ride it" could not arm
  its ladder rival and started the course without it:
  `{ courseId, stage, reason, error, lookupMs }`. `stage` is `record`; `reason` is `timeout` or `error`
  (`error` holds the message, else `null`).
- **`cycle_game.immersive`** (DEBUG) — the container asked the shell to hide
  (`on: true`) or restore (`on: false`) the navigation rail (§3): `{ on }`.
- **Lobby and results events** — `home` (lobby shown), `race_type_selected`,
  `race_value_set`, `start_pressed`, `ride_featured`, `ghost_selected` /
  `ghost_cleared` / `ghost_empty`, `history_loaded` / `history_error`,
  `ladder_loaded` / `ladder_error`, `ladder_movement` /
  `ladder_movement_error` (results-board ladder callouts), `race_save_retry`
  (WARN, a transient save failure being retried), `back_to_home` (Exit pressed
  on the board), and `checkpoint_discarded`. UI-only events carry the
  `cycle_game.ui.` prefix: `sensor_warning` (WARN) and `sensor_warning_override`,
  `rider_picker_open` / `rider_picker_close`, `ghost_picker_open` /
  `ghost_picker_close`, `ghost_focus`, `ghost_skip_roster`, `picker_tab`,
  `volume_open` / `volume_close`, `ride_featured`.
- **Engine and screen diagnostics** — `race_telemetry` (rate-limited, per tick: tick
  index, elapsed time and wall-clock drift), `sensor_lost` / `sensor_recovered` (the SENSOR chip), `countdown`
  (DEBUG, per stoplight step), `sfx` (DEBUG, `{ cue, attempted }`: `attempted` is
  false when the household `sounds` config names no such cue), `music` /
  `music_deferred` / `music_unavailable`, `tick_catchup`, `render_pacing`,
  `layout_overflow`, `chart_resize`, `event_toast.shown` / `event_toast.dismissed`,
  and the POV scene's `pov.mount` / `pov.unmount` / `pov.camera` /
  `pov.import_failed` / `pov.webgl_unavailable`; `recap_opened` / `recap_closed` /
  `recap_play` / `recap_scrub` for the History recap.
- Server side the cycle-race service logs `fitness.cycle_races.save.error`,
  `fitness.cycle_races.ladder.computed`, `fitness.cycle_races.rival_pool.computed`
  and the index events (§16).
- **Firehose (DEBUG, off by default)** — `cycle_game.tick`: one event/second with a
  per-rider array `{ rpm, cadenceConnected, hr, zoneId, multiplier, distanceM,
  parked, finished }` (`parked` = parked or no sensor), read from post-resolution
  engine state.
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
- **Lap panels are config-gated.** Splits (results board) and the standings
  tower's "Lap N" header only appear when the **effective** lap length > 0
  (per-course override or app config, via `effectiveLapLength`).
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
  `raceValueStep`, `equipmentRpm` (gauge limits, abuse clamp, `rpmDuringGap`
  hold-vs-cooldown), `chartTrim`, `chartZoom`, `paceDelta`, `paceRival`,
  `rivalTrace`, `boostState`, `raceBeats`, `toastQueue`, `staleClaims`,
  `resultsComparison`, `layoutSizing` (`raceLayoutMode`), `povWorld`/`povFollowCam`,
  `ovalTrackModel`, `participantIdentity`, `recordRow`, `lineColors`,
  `speedometerGeometry`, `CycleRaceController` (parking and resuming, no-sensor
  riders, the mercy window, the all-away close, `finishNow` setting `endedEarly`),
  `raceCheckpoint` (round-trip, `checkpointOutcome`).
- **Components (vitest + @testing-library):** `CycleRaceScreen` (+ `.solo`),
  `RaceLayoutManager`, `DistanceChart`, `SplitsChart`, `PovGrid`, `OvalTrack`,
  `SpeedoRow`, `PaceDeltaPanel`, `CycleSpeedometer`, `CountdownStoplight`,
  `RaceResults`, `RaceMenu` (guard time, focus, Escape), `RiderReadyStrip`,
  `StandingsTower`, `ImmersiveFrame`, and a set of `CycleGameContainer.*.test.jsx`
  files, one per concern: smoke and rolling start, `raceMenu`, `parked`, `boost`,
  `beats`, `toasts`, `dramaEvents`, `results` (comparison, rematch),
  `staleClaims`, `lobbyBikes`, `checkpoint`, `wallclock`, `immersive`.
- **Server (vitest):** the datastore index, `CycleRaceService`,
  `CycleRaceApiService`, `cycleLadder`, `cycleRivalPool` and the router's ladder
  tests live next to the code under `__app_modules/wellness/fitness/server/`,
  with `tests/unit/api/cycleRaces.routes.test.mjs`.
- **Live (Playwright):** `tests/live/flow/fitness/cycle-game-*.runtime.test.mjs`
  drive the simulator through full lifecycles via `FitnessSimHelper` and the
  `window.__cycleGameControl` seam (`startRace`, `cancel`, `getPhase`,
  `getRaceState`), and assert logs through `tests/_lib/cycleGameLog.mjs`:
  `lifecycle` (distance and time races, a parked rider), `rolling-start`,
  `autostart-drive`, `layout-modes`, `flash-ui`, `piston-avatar`, `ladder`,
  `park-resume` (the PARKED card, `rider_parked`, `rider_resumed`, no DNF),
  `solo-rival` (a pace rival, the solo layout, the comparison, the rematch) and
  `race-menu` (guarded End and Discard, the incomplete record, the unmoved
  ladder, the rail hidden during a race). They need a machine where the backend
  can run; see "Verifying a change". A lone rider's start waits up to 1500 ms on
  the rival lookup, so flows poll the phase instead of expecting a synchronous
  start.

> Visual verification (kiosk 1280x720 and 1920x1080) is the only way to catch
> SCSS/layout regressions: jsdom asserts structure, not pixels.

---

## 21. Verifying a change

Three levels, cheapest first.

1. **Unit tests** (no services needed):
   `npx vitest run --config tests/_infrastructure/config/vitest.config.mjs __app_modules/wellness/fitness/browser/lib/cycleGame __app_modules/wellness/fitness/browser/widgets/CycleGame`
   Add the `nav/` and server folders when the change touches them.
2. **The backend-free screenshot harness** (`tests/_scratch/cycle-game-harness/`).
   It renders the presentational components (lobby, staging, countdown, race
   screen, menu, toast, results, pace delta) in a real browser with stubbed data
   and never starts the backend or calls `/api`. From the repo (or worktree) root:
   - `node_modules/.bin/vite --config tests/_scratch/cycle-game-harness/vite.harness.config.mjs`
     starts a loopback-only dev server (`HARNESS_PORT` overrides its port);
   - in another shell, `BASE_URL=<that server> node tests/_scratch/shoot-cycle-game.mjs`
     screenshots every scene (`SCENES=a,b` limits the run, `VIEWPORT=WxH` forces
     one size) into `tests/_scratch/out/cycle-game/` with a `metrics.json` of
     layout measurements;
   - stop the server afterwards.
   Its README has the details.
3. **The live flows** (Playwright). They need the real backend, the simulator
   and the fitness session log, so they run only on a machine where the backend
   can run (the deployed host or a dev server there), never beside a running
   household controller: a second backend instance makes real home-automation
   calls. Run one flow with `npm run test:browser -- <flow file>`.

---

## 22. Deploying this version

- **Backend and frontend deploy together.** A new frontend on an old backend
  still races, but a lone rider's pace rival falls back to the lobby's loaded
  history because the `rival-pool` route is missing (the request fails and is
  logged as `pace_rival_lookup_failed`).
- **The race index version changed.** The first index read after the deploy
  rebuilds the index from all race files once (the backend warms it five seconds
  after boot, §16), so that first read is slow on a large history.
- **Two builds with different index versions must not share one data tree.**
  Each rebuilds the other's shards on every alternation.
- **Kiosks need a reload** to pick up the new frontend.
- **Optional sounds.** `countdown`, `final_seconds` and `finish` (see §6) play only
  if the household `sounds` config names them. The household leaves `countdown`
  and `finish` unset on purpose, so silence there is not a fault.

## Legibility from the bike

**The kiosk viewport is 1381x777 CSS px** (a 1920x1080 panel at DPR 1.39), so a
rem renders 1.39x larger there than in a 1920-wide browser. Render checks use that
size: `VIEWPORT=1301x745 DPR=1.39` (the content area beside the app's nav rail).

**Lobby and results board are NOT on the read-from-the-bike scale.** On
2026-11-10 the owner had the legibility pass reverted for both (the lobby's rail
had grown to 36 rem and squashed the starting grid; everything on the results
board was too big). The lobby is back to its earlier rem sizes and a 260 px rail;
the results board keeps its structure (Rematch, comparisons, versus line, medals)
at the earlier compact sizes (names 1.2 rem, winner 1.5 rem, list at most 760 px
wide). `typeScale.test.js` exempts `home/`, `CycleGameHome.scss`,
`RaceResults.scss` and `RaceRecap.scss`. The rest of this section applies to the
race, staging and countdown screens only.

**The starting grid gets its space first.** A bike/ghost slot is a fixed card:
`width: 136px; aspect-ratio: 3 / 4; flex: none`, with a fixed 96 px square device
circle. Six fit the kiosk's main column (6 x 136 + 5 x 16 = 896 of ~965 px). The
grid section and row are `flex: none`.

**The lobby's main column never scrolls** (owner, 2026-11-10: a scrollbar on the
kiosk). It is `overflow: visible` with every child `flex: none` and fits the
kiosk's 1301x745 content box in every state by design: 14 px section gaps,
compact race-type cards (12 px padding, 48 px icons, one-line name and hint), a
fixed-height value row, and no boost-rule line (removed the same night). The
slack collects above Start. Guarded by `CycleGameHome.raceMyBest.test.jsx` (no
scrolling overflow in the CSS) and two harness gates: `lobbyMainOverflow`
(`.cycle-game-home__main` scrollHeight <= clientHeight) and `gridTilesBroken`
(every slot inside the viewport, the row and the main column, at its 3:4 shape),
over `lobby-garage-one` / `-five` / `-six` (Distance, "How far?" open, "Race my
best" shown), `lobby-garage-time` (Time, switch on, six bikes),
`lobby-garage-ghost` (a picked ghost with its field on the grid) and the other
`lobby-*` scenes.

Race, staging and countdown text is sized for a viewer 2 to 3 m from the
screen, from the type scale in `_cgTokens.scss` (`cg-type(N)`; `typeScale.test.js`
forbids literal sizes). Text a rider reads while pedalling is at least step 2
(20 px): dial numerals, the boost row, the tower header, names and metrics, chart
axes and lane tags, POV badges, ready-strip chips, toast subtitles, results
comparison lines. Step 3 (25.6 px) or more for the race clock label, toast
titles, rider names on the tower and results rows, and the odometer. Step 1
(16 px) is kept for text nobody reads mid-race: legend lines and the race menu's
sub-copy. The screenshot harness fails a race, staging or countdown
scene whose smallest visible text (`raceTextMinPx`, skipping `data-secondary`
elements and the allow-listed secondary classes) is under 20 px.

Minimums above the step-2 floor, each gated per scene by the harness:

- Dial numerals render at no less than 24 px on screen and about 9.8% of the gauge
  diameter on larger dials (`labelFontUnits`; about 30 px on a 310 px gauge).
  Labels sit inside the tick ring, and the avatar is 36% of the gauge
  (`AVATAR_RATIO`). Below ~240 px the 24 px floor would run the right-hand "120"
  under the avatar, so the floor yields to 10% of the gauge
  (`LABEL_AVATAR_CLEAR_RATIO`; a 250-RPM dial needs at most 10.25%): ~18 px on
  the kiosk's 181-190 px gauges. Gate: `gaugeNumeralMinPx` at least
  min(24, 10% of the smallest gauge).
- The standings tower header ("Lap 3 · Last 1:55 · Now 0:13") is step 3 (25.6 px)
  and must fit on one line. In the wide layout the tower takes two fifths of the
  chart/tower pair so "No signal · 120 m" fits on one line beside a name. Gate:
  `towerHeaderPx` at least 25.6, no wrap or clip of the header or any metric.
- The lobby carries no text floor (see above); the 260 px records rail scrolls
  its history list.

The away overlay ("NO SIGNAL / Check the sensor", "PARKED / Pedal to rejoin")
sits on two lines and hides the dial numerals while it is up, at every gauge size.

### Crowded road panel

The POV panel lays out rank badges by screen band (`povWorld.layoutBadgeBands`).
Riders whose badges would collide form a band shown as one column in rank order,
leader on top. A band shows at most three badges; the rest collapse into one badge
that names what it holds: the ordinals as a range (`4th–6th`, or `4th & 6th` for two
split ranks) with one lane-colour dot per rider (`collapsedLabel`). A single extra
rider is never collapsed ("+1" is never shown): it gets its own badge, and the block
is the same height. A band sits below its riders' cards, clear of every other card and of the
pinned horizon chip, and inside the panel (lifted above the cards when it will
not fit below them). When its own column has no clean spot at all — neither
under its riders nor above them without landing on the chip or a nearer card
(a six-rider stack near the finish) — the band steps sideways to the nearest
side of what is in the way, still one column in rank order at its riders'
height, and the leader lines tie it back; only if no side fits does it keep
the vertical result. The "LEADER +N m" chip is anchored to the panel's top edge
with an arrow and follows `horizonChipState` (shown once the true gap passes
120 m, with hysteresis).

Layer order, bottom to top: road (GL) → avatar cards → gate and metre labels →
leader lines → badges → horizon chip. Gate labels sit above the cards, so a
rider at the finish arch never hides "FINISH" behind their avatar; the labels
carry the badges' dark plate for that. Gate labels fade with distance, FINISH
to no less than 0.7. Far gates compress toward the horizon until their labels
would print over each other: FINISH is placed first, then the nearer gates, and
a label that would land on one already placed is held that frame.

A band lifted away from its riders stays tied to them: `badgeLeaders` returns a thin
line in the rider's lane colour from the card's nearer edge to the badge (or to the
collapsed badge), drawn in an SVG layer under the badges. A badge still directly
under its card has no line.
