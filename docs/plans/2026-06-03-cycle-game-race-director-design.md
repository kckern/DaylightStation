# CycleGame Race Director & Layout Manager — Design Doc

**Date:** 2026-06-03
**Status:** Validated (brainstormed section-by-section with KC, all 7 sections approved)
**Companion plan:** `docs/plans/2026-06-03-cycle-game-race-director.md` (implements this)
**Builds on:** the synthwave visual redesign (`2026-06-03-cycle-game-visual-redesign-design.md`)

## Goal

Replace the race screen's hardcoded layout (speedometers bottom, chart top-left,
rankings top-right) with a **race director**: a pure-function engine that watches
live race state and continuously decides *which panel to show, where, and when* —
so the layout adapts to the field (solo vs. group vs. ghost), the race phase, and
dramatic moments (lapping, photo finish).

## Locked decisions

1. **Decision model: relevance-scoring director (option B).** Not hand-authored
   templates (A) and not YAML-config rules (C — deferred, YAGNI). Each panel
   declares pure `candidacy`/`priority` functions; one pure pass ranks and assigns
   panels to zones. Cycling, hysteresis, and transient promotion all fall out of
   this one mechanism. The descriptor shape is already config-shaped, so promoting
   to YAML (C) later is mechanical.
2. **Laps are a config-gated overlay, not a fourth win-condition.** A race is still
   distance/time as today; `lapLengthM` turns lap features on. Absent/`0` → all lap
   panels gate off, non-lap races unaffected.
3. **`fieldSize` includes ghosts.** Layout gates key off total riders (humans +
   ghosts). A human + 1 ghost is a *race* (rankings + chart show). `isSolo` means
   `fieldSize === 1` — one entity, no comparator, a pure time-trial. `humanCount`/
   `ghostCount` survive only for styling, never layout gating.
4. **Motion is fine here.** The animation-kill is `Menu.scss`-scoped to
   `.menu-items-container`; CycleGame renders outside it, so panel enter/leave
   transitions play.

## Section 1 — Architecture & data flow

One-way flow, three new pure layers between the existing engine and the screen:

```
CycleRaceEngine.getState()                 ← exists (truth)
  → deriveRaceSnapshot(state, config, prev) ← NEW pure selectors
  → raceDirector(snapshot, prevDecision, clock) ← NEW pure fn (option B)
  → <RaceLayoutManager decision snapshot>   ← NEW dumb shell
  → panels: SpeedoRow, DistanceChart, Rankings, LapTable, OvalTrack, CameraZoom
```

- `raceDirector` is **pure** — `(snapshot, prevDecision, clock) → decision`. No
  React, no internal timers. Timing state is threaded in via `prevDecision` and
  out via the returned decision, exactly like today's sticky `logRef` in
  `CycleRaceScreen`. Fully unit-testable on scripted snapshot sequences.
- `CycleRaceScreen` *becomes* `RaceLayoutManager`. Its current chart/roster/speedo
  JSX is extracted into standalone panel components (props unchanged — pure
  refactor, existing tests follow the components).

## Section 2 — The lap model (net-new)

- **Config:** `lapLengthM` (e.g. `100`, or `400` for a track feel). `0`/absent →
  `lapsEnabled = false`.
- **`lapModel.js`** (mirrors `distanceModel.js`, pure):
  - `lapCount(distanceM, lapLengthM) = floor(distanceM / lapLengthM)`
  - `lapProgress(distanceM, lapLengthM) = (distanceM % lapLengthM) / lapLengthM`
    — the `0..1` fraction the oval-track avatar uses for its angle.
- **Lap splits need a crossing *time*.** Only the engine sees every tick, so it
  captures splits where `finishTimeS` is already detected: when `lapCount`
  increments, interpolate the crossing time between the two surrounding
  `distanceSeries` samples (same linear interpolation as ghost replay). Engine
  state gains per-rider `lapSplits: number[]`.
- Snapshot exposes per rider: `laps`, `lapProgress`, `lapSplits[]`, `lastLapTimeS`.

## Section 3 — The snapshot (director's eyes)

`deriveRaceSnapshot(state, config, prevSnapshot)` — pure; `prevSnapshot` lets it
detect **edges** (events fire on transition, not level).

- **Composition:** `fieldSize` (incl. ghosts), `humanCount`, `ghostCount`,
  `isSolo` (`fieldSize === 1`), `winCondition`, `lapsEnabled`.
- **Phase** (state machine over progress, with hysteresis bands like `logRef`):
  `PRE → EARLY (<~15%) → MID → FINALE (>~85% or any rider on final lap) → FINISHED`.
- **Tension metrics:** `leaderGapM`, `closingRateMPS` (Δgap/interval; negative =
  pack catching → drama), `tightestPairGapM` (photo finish), `lapDeltaMax` (biggest
  lap gap = about-to-be-lapped).
- **Drama events (edge-triggered, `{type, riderIds, firedAtClock}`):**
  `LAPPING_IMMINENT`, `LEAD_CHANGE`, `FINAL_LAP`, `RIDER_FINISHED`, `PHOTO_FINISH`.
  v1 panels need not consume all — camera launches on `LAPPING_IMMINENT` +
  `PHOTO_FINISH` first; rest tuned later.

## Section 4 — Panel registry (descriptors)

Uniform descriptor per panel (`racePanels.js`):

```js
{ id, zones: [...best-first], sizeHint: 'wide'|'standard'|'focus',
  cycles: bool, candidacy: (snap)=>bool, priority: (snap)=>number,
  transient: null | { minHoldS, cooldownS, triggers:[eventType] } }
```

| Panel | zones | candidacy | priority |
|---|---|---|---|
| SpeedoRow | bottom (wide) | always | constant-high |
| DistanceChart | topLeft, topCenter | `fieldSize ≥ 2 \|\| !lapsEnabled` ¹ | mid; rises with spread |
| Rankings | topRight, topCenter | `fieldSize ≥ 2` *(ghost counts)* | rises with `leaderGapM` |
| LapTable | topLeft/Center/Right | `lapsEnabled` | **boosted when `isSolo`** |
| OvalTrack | topCenter, topLeft | `lapsEnabled && fieldSize ≥ 2` | rises with `lapDeltaMax` |
| CameraZoom | topCenter (focus) | event-driven | spikes on trigger, else 0 |

¹ DistanceChart refinement (found wiring RaceRecap, a solo replay): a single
climbing line still reads as *pace toward the goal*, so the chart shows solo too —
suppressed only for a solo race *with laps*, where the lap table is the better
stage. Without this, a solo no-laps surface had a blank top band.

CameraZoom is the only **transient**: `{minHoldS:6, cooldownS:10,
triggers:['LAPPING_IMMINENT','PHOTO_FINISH']}`. Descriptors are pure functions
(not YAML yet) so weights can be tuned against real races via the test harness.

## Section 5 — The director algorithm

`raceDirector(snapshot, prevDecision, clock)` — one pure pass, four stages:

1. **Eligibility:** keep panels with `candidacy === true`; score with `priority`.
2. **Transient promotion (highest precedence):** for each transient, check
   triggers vs. `snapshot.events` and timing vs. `prevDecision` — promote if
   triggered and past `cooldownS`; **keep** while within `minHoldS` even after the
   event clears (anti-flicker hold); release after hold with no active trigger. May
   displace a resident from the focus zone for the hold window.
3. **Zone assignment (greedy by score):** walk high→low; each panel claims its best
   free `zones` entry; one panel per zone; leftovers → per-zone **cycle pool**.
4. **Cycling:** a zone whose pool has >1 candidate and a `cycles:true` lead becomes
   a rotator — dwell `cycleDwellS` (~8s), advance; rotation index in `prevDecision`
   (deterministic/pure); pool re-sorts by current relevance each rotation.

**Stability guarantees (all via `prevDecision`):** min dwell per zone (can't evict
before `minDwellS` unless a transient displaces — drama wins); score hysteresis
(challenger must beat incumbent by ~+15%, not tie). Output:
`decision = { zones:{bottom,topLeft,topCenter,topRight}, pools, timers }`.

## Section 6 — Zones & the RaceLayoutManager shell

Dumb shell: holds the `prevDecision` ref, calls the director each tick, renders the
returned zones. CSS grid replacing the hardcoded `__top` + `__speedos`:

```
┌ topLeft ┬ topCenter(focus) ┬ topRight ┐   rows: 1fr auto
├─────────┴──────────────────┴──────────┤   top cols: 1fr 1fr 1fr
│            bottom (wide)               │   SpeedoRow lives here
└────────────────────────────────────────┘
```

- A `null` zone collapses; top columns recompute from how many top zones are filled
  (1 filled → full width, 2 → 50/50, 3 → thirds). Makes the **solo** layout (just
  LapTable up top) feel intentional, not floating in an empty third.
- Clock frame + penalty banner stay as fixed chrome (always-on HUD, not
  director-managed).
- **Transitions:** a `<PanelSlot>` wrapper fades+slides (transform/opacity, ~300ms)
  on mount/unmount/swap/cycle — no pop-in. The manager's only state is the
  `prevDecision` ref (same pattern as existing `logRef`/`speedoSize`).

## Section 7 — Testing strategy

Hard logic is pure → tested without React/timers.

- `lapModel.test.js` — count/progress boundaries; split interpolation vs. a known
  `distanceSeries`.
- Engine: extend `CycleRaceEngine.test.js` — splits land at interpolated crossing
  times; `lapsEnabled=false` adds nothing.
- `deriveRaceSnapshot.test.js` — phase hysteresis; each event fires on its edge
  only.
- `raceDirector.test.js` (centerpiece) — scripted snapshot sequences asserting
  `decision.zones` over time: solo (no rankings/chart, lap table promoted), human +
  ghost (rankings present), lapping event (camera holds `minHoldS` after clear then
  releases), near-equal scores (no swap-thrash), overflow zone (deterministic
  cycle).
- Component tests stay green (extraction is pure refactor); `RaceLayoutManager`
  gets a light render test (decision → right panels in right zones).
- No snapshot/visual tests (brittle on kiosk); final check is manual TV smoke.

## Phasing (in the companion plan)

- **Phase A — lap foundation:** `lapModel.js` + engine splits (no UI change).
- **Phase B — director core:** `deriveRaceSnapshot`, `racePanels`, `raceDirector`
  (pure, fully tested, not yet wired).
- **Phase C — layout shell + extraction:** extract existing panels, build
  `RaceLayoutManager`, wire the director (existing layouts reproduced first).
- **Phase D — new panels:** LapTable, OvalTrack, CameraZoom.
