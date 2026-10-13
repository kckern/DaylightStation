# Sim Panel Redesign — Design

**Date:** 2026-06-04
**Topic:** Reimagine `frontend/public/sim-panel.html` — the Fitness Simulation popup.
**Status:** Approved design (via brainstorming). Next: implementation plan.

---

## 1. Problem

The current sim panel (`frontend/public/sim-panel.html`) is too busy and crowded — five
stacked sections (Governance, Bulk Actions, HR Devices, Equipment, Cycle Challenge) all
visible at once, with ~6 controls per device row. It's hard to do the two things a tester
actually wants quickly: **(a)** fire a believable scenario in one click, and **(b)** nudge a
single rider or bike. Everything is equally prominent, so nothing is.

## 2. Goal

A focused two-zone panel:

- **Top — Quick Sims:** a few **1-click** scenarios.
- **Below — Controls:** a **tabbed** area (Riders / Bikes / Advanced) with lean, useful
  per-device controls; the power-user governance/challenge tools tucked into Advanced.

Reuse the existing `FitnessSimulationController` (`frontend/src/modules/Fitness/nav/
FitnessSimulationController.js`) wherever possible. The only genuinely new app-side code is a
**sim→cycle-game start bridge** so the "Cycle Game Race" preset can actually start a race.

## 3. Decisions (from brainstorming Q1–Q6)

| # | Decision |
|---|----------|
| Layout | **Tabbed** — presets pinned at top; a tab strip swaps the lower half between **Riders / Bikes / Advanced**. |
| 🚴 Cycle Game preset | **Full auto** — open the game, auto-assign 2 riders→2 bikes, **start** the race, and drive both bikes' RPM to the finish. Requires the new sim→game bridge. |
| Race buttons | Two: **Flash** = a **1-minute time race**; **100 m** = a **100-metre distance race** (one of each win-condition). |
| ❤️ Ambient preset | **Full ambient workout** — every HR strap runs an auto-session arc (warm-up→work→cool-down) **and** every bike spins at gently varying RPM. No game, no navigation. |
| Per-device controls | **Standard** — Riders: bpm slider + zone chips + ▶session + ✕. Bikes: rpm slider + RPM presets + rider ▾ + ✕. |

## 4. Layout & components

The panel is still a single static file served from `public/` and opened by `HRSimTrigger`
(unchanged: gear button, gated to localhost/Chrome, opens `/sim-panel.html`). It continues to
drive `window.opener.__fitnessSimController` and re-render on the `sim-state-change` event.

```
┌────────────────────────────────────────────┐
│ Fitness Sim                              ✕  │
├────────────────────────────────────────────┤
│ QUICK SIMS                                  │
│ [ 🚴 Cycle Game Race   ( Flash )( 100 m ) ] │
│ [ ❤️ Ambient Workout                      ] │
│ [ ⏹ Stop All                              ] │  ← danger styling
├────────────────────────────────────────────┤
│  ‹ Riders ›   Bikes    Advanced             │  ← tab strip
│ ──────────────────────────────────────────  │
│  KC    132 ▰▰▰▱▱  [cool|act|warm|hot|fire] ▶ ✕│
│  User_2 118 ▰▰▱▱▱  [cool|act|warm|hot|fire] ▶ ✕│
└────────────────────────────────────────────┘
```

### Zones (units, each one clear responsibility)

1. **Quick Sims bar** (always visible) — three preset actions. `Cycle Game Race` carries an
   inline win-condition toggle (`Flash` / `100 m`) that picks which race the click launches.
2. **Tab strip** — `Riders | Bikes | Advanced`; remembers the active tab in a module-level var
   so a re-render (from `sim-state-change`) doesn't reset it.
3. **Riders tab** — one row per HR device from `controller.getDevices()`:
   - name · live bpm · **bpm slider** (40–220, thumb tinted by zone) → `controller.setHR`
   - **zone chips** `[cool|active|warm|hot|fire]` → `controller.setZone`
   - **▶ session** → `controller.startAutoSession(deviceId)` (per-rider arc)
   - **✕** → `controller.stopDevice`
4. **Bikes tab** — one row per item from `controller.getEquipment()`:
   - name · live rpm · **rpm slider** (0–150) → `controller.setRpm`
   - **RPM presets** `[0 40 60 80 100]` → `controller.setRpm`
   - **rider ▾** (eligible users) → `controller.setEquipmentRider`
   - **✕** → `controller.stopEquipment`
5. **Advanced tab** — the power-user tools moved off the main path:
   - governance on/off → `enableGovernance` / `disableGovernance`; phase readout from
     `getGovernanceState`
   - trigger HR challenge → `triggerChallenge`
   - cycle-challenge: selection picker (`listCycleSelections`) + rider picker, **Trigger**
     (`triggerCycleChallenge`) and **Swap** (`swapCycleRider`)
   - **Run Cycle Demo (~3 min)** — the existing scripted INIT→RAMP→MAINTAIN→LOCKED→RECOVER→
     PHASES walk, moved here verbatim
   - live cycle readout (rider / state / phase / RPM) from `window.opener.__fitnessGovernance`

> All slider/drag value-preservation behavior (tracking `activeSlider` so a re-render mid-drag
> doesn't snap the thumb) carries over from the current panel.

## 5. Quick Sim behaviors

### ❤️ Ambient Workout (no new app code)
1. `controller.startAutoSessionAll()` — every strap runs its warm-up→work→cool-down arc.
2. For every bike in `controller.getEquipment()`, start a **varying-RPM driver**: a panel-side
   interval that re-sends a gently wandering RPM (~50–90) every second via `controller.setRpm`
   (cadence freshness is per-message, so it must be re-sent — same reason the demo re-sends).
3. A single "stop" clears both (see Stop All).

### ⏹ Stop All
- `controller.stopAll()` (HR) + `controller.stopEquipment(id)` for each bike + clear any
  panel-side RPM-driver intervals (ambient or game).

### 🚴 Cycle Game Race — full auto (needs the bridge, §6)
Given the inline toggle (`Flash` → `{winCondition:'time', value:60}`; `100 m` →
`{winCondition:'distance', value:100}`):
1. Pick the first **2 bikes** from `getEquipment()` and assign a distinct eligible rider to
   each via `controller.setEquipmentRider` (auto-assign).
2. **Open the game**: ask the opener to navigate to the cycle-game module (§6).
3. **Wait** for the game to register its control hook (poll up to a few seconds), then **start**
   the race with the chosen win-condition + value and the two assigned riders (§6).
4. **Drive RPM**: start the varying-RPM driver on both bikes (~70–95 rpm, lightly staggered)
   so distance accrues and the race runs to its finish (time cap or 100 m), then stop the
   drivers. The driver tolerates the game's countdown/staging (keeps the cadence warm).

## 6. The sim→cycle-game bridge (only new app-side code)

Today `CycleGameContainer` (`frontend/src/modules/Fitness/widgets/CycleGame/
CycleGameContainer.jsx`) has an internal `startRace`, reachable only by a human picking
type/value and pressing Start. The bridge adds two seams:

1. **Navigation seam** — a way for the popup to bring the opener to the cycle-game module
   **without a full page reload** (a reload would destroy `__fitnessSimController` and the
   popup's reference to it). Expose a small launcher on the opener window, e.g.
   `window.__fitnessLaunchModule = (moduleId) => { setActiveModule({ id: moduleId }); … }`,
   set in `FitnessApp`. The popup calls `window.opener.__fitnessLaunchModule('cycle_game')`.
   *(Exact name/shape finalized in the plan; the constraint is "SPA navigation, no reload.")*
2. **Start seam** — `CycleGameContainer` registers a control hook when mounted, mirroring the
   `__fitnessSimController` pattern:
   ```
   window.__cycleGameControl = {
     ready: true,
     startRace({ winCondition, value, riders }) { … }   // assigns type/value + calls startRace
   }
   ```
   and clears it on unmount. The popup, after navigating, **polls** `window.opener.
   __cycleGameControl?.ready`, then calls `startRace(opts)`. Rider assignment is already done
   via `setEquipmentRider` (the game's `buildRiders` reads the session's equipment-rider map),
   so `startRace` just needs the win-condition + value (and may take the rider list for
   robustness).

**Why a hook, not a URL param:** the popup must keep driving RPM after start, so the opener
must stay on the same JS context (no reload). A `window.__cycleGameControl` hook (consistent
with the existing `__fitnessSimController` global) gives in-context start without reload and
without threading state through the router.

New/changed app files for the bridge:
- `FitnessApp.jsx` — expose the module-launch seam on `window`.
- `CycleGameContainer.jsx` — register/unregister `window.__cycleGameControl` with a
  `startRace({winCondition,value,riders})` that sets `raceType`/`raceValueM`(or time cap) and
  invokes the existing `startRace`.
- `FitnessSimulationController.js` *(optional)* — a small helper for the varying-RPM arc driver
  and bike auto-assign, if it's cleaner there than in the panel; otherwise keep it panel-side.

## 7. Error handling

- **Game won't mount / hook never appears** — the `__cycleGameControl` poll times out (~5 s);
  the panel shows a brief inline error ("couldn't start the race — is the cycle game
  available?") and stops cleanly (no orphaned RPM drivers).
- **Fewer than 2 bikes** in the catalog — the 🚴 preset assigns what's available (≥1) and notes
  it; if **0**, it errors without navigating.
- **No eligible riders** for a bike — assign what's possible; a bike with no rider is left
  unassigned (the game handles unclaimed bikes).
- **Opener gone / controller missing** — every preset first checks `window.opener.
  __fitnessSimController` (existing `showError` path) and bails with the current error UI.
- **Driver cleanup** — all panel-side intervals (ambient + game RPM drivers, demo) are tracked
  and cleared on Stop All, on starting a different preset, and on panel close, so nothing keeps
  injecting cadence after the user moves on.

## 8. Out of scope

- The backend `/api/v1/fitness/simulate` process spawner (the `?simulate=` URL path) — unrelated
  to this popup; untouched.
- The `HRSimTrigger` gating/placement — unchanged.
- Any change to the cycle **Challenge** governance logic or the cycle **Game** race engine —
  the bridge only *starts* a race; it doesn't alter how races run.

## 9. Testing

- **Pure/unit (vitest):** any extracted helper (e.g. the varying-RPM arc generator, bike
  auto-assign selection) gets unit tests. The `CycleGameContainer` start-hook
  registration/unregistration and that `startRace({winCondition,value})` sets the right
  race config are component-testable with @testing-library.
- **Manual (the panel itself is static HTML, not unit-tested):** on localhost/Chrome, open the
  panel and verify each Quick Sim end-to-end — Ambient drives HR+RPM; Cycle Game Race (Flash
  and 100 m) opens the game, assigns riders, starts, and runs to a finish; Stop All clears
  everything; the three tabs show the lean control rows and act on the right device.
- **Regression:** existing Advanced-tab actions (governance, cycle-challenge trigger/swap, Run
  Cycle Demo) behave exactly as the current panel's equivalents.

## 10. File map

| File | Change |
|------|--------|
| `frontend/public/sim-panel.html` | Full rewrite — tabbed two-zone panel, Quick Sims, lean rows, Advanced tab; panel-side RPM-arc drivers + interval cleanup. |
| `frontend/src/Apps/FitnessApp.jsx` | Expose a no-reload module-launch seam on `window` for the popup. |
| `frontend/src/modules/Fitness/widgets/CycleGame/CycleGameContainer.jsx` | Register/unregister `window.__cycleGameControl` with `startRace({winCondition,value,riders})`. |
| `frontend/src/modules/Fitness/nav/FitnessSimulationController.js` | *(optional)* extract RPM-arc driver + bike auto-assign helpers. |
