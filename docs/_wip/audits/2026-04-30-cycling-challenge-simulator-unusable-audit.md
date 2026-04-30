# Cycling Challenge Simulator — Unusable Audit

**Date:** 2026-04-30
**Reporter:** Internal (test users)
**Severity:** P0 — feature is non-functional end-to-end despite components being merged
**Scope:** `frontend/public/sim-panel.html` popout + `FitnessSimulationController` + `GovernanceEngine` cycle integration

---

## TL;DR

The cycle challenge feature was merged in seven commits over ~2 weeks (skeleton → RPM gauge → boosters → swap modal → sim-panel controls → README → reference docs → merge `feat/cycle-challenge`). The **engine state machine is fully implemented** (`GovernanceEngine._evaluateCycleChallenge`, `_startCycleChallenge`, `swapCycleRider`), the **overlay renders** (`CycleChallengeOverlay`), the **policy data exists in production** (`data/household/config/fitness.yml` defines `cycle_ace` equipment and a `type: cycle` selection), and **unit tests pass**. But the integration plumbing between these layers was never wired up. The result: the simulator popout and the live overlay receive **no live data** about the cycle challenge they are supposed to drive and visualise.

There are **four independent P0 breaks** in the data path between the engine, the window globals, the popout, and the device router. Any one of them alone makes the sim "completely unusable." All four exist simultaneously.

---

## Architecture in One Picture

```
┌───────────────────────┐         ┌──────────────────────────┐
│  sim-panel.html       │         │  FitnessApp (any view)   │
│  (popout window)      │  reads  │  ├─ FitnessProvider      │
│                       │ ───────►│  │  └─ window.__fitness… │
│  - getEquipment()     │         │  ├─ HRSimTrigger (gear)  │
│  - listCycleSelect…() │         │  └─ FitnessPlayer        │
│  - triggerCycle…()    │         │     └─ CycleChallengeOv… │
│  - readCycleChalleng… │         └────────────┬─────────────┘
│      Info()           │                      │
└──────────┬────────────┘                      ▼
           │              ┌────────────────────────────────────┐
           │              │   FitnessSimulationController       │
           │              │   - getEquipment()                  │
           │  via opener  │   - triggerCycleChallenge()         │
           └─────────────►│   - swapCycleRider()                │
                          │   - listCycleSelections()           │
                          └────────────────┬───────────────────┘
                                           │
                          ┌────────────────▼───────────────────┐
                          │   FitnessSession                    │
                          │   ├─ governanceEngine (cycle SM)    │
                          │   └─ _deviceRouter                  │
                          │      ├─ setEquipmentCatalog()  ←──┐ │
                          │      └─ getEquipmentCatalog() ❌ │ │
                          └─────────────────────────────────────┘
                                                              │
                                            never called ─────┘
```

---

## P0 Findings — The Four Breaks

### P0-1 — `setEquipmentCatalog()` is never called

**Path:** `frontend/src/hooks/fitness/FitnessSession.js:1005-1008`

```javascript
setEquipmentCatalog(equipmentList = []) {
  this._equipmentCatalog = equipmentList;
  this._deviceRouter.setEquipmentCatalog(equipmentList);
}
```

The setter exists on both `FitnessSession` and `DeviceEventRouter` (line 73). It is **never invoked from anywhere in the codebase** — confirmed via:

```
grep -rn "setEquipmentCatalog(" frontend/src backend/src
```

returns only the two definitions, plus the internal forward at `FitnessSession.js:1007`. No call site populates the catalog from the loaded fitness configuration.

**Effect:** `_deviceRouter._context.equipmentCatalog` is permanently `[]`. The cadence/equipment lookup `FitnessSession.getEquipmentCadence()` (line 1065+) returns `{ rpm: 0, connected: false }` for every equipment id. The simulator popout's equipment list is empty, so no RPM slider can ever appear. The governance engine's `_getEligibleUsers(equipmentId)` (`GovernanceEngine.js:312`) always returns `[]`, so no rider can be picked, and `triggerCycleChallenge` rejects with `rider_not_eligible`.

**Production data is intact** (`data/household/config/fitness.yml:368-394`):
```yaml
equipment:
  - name: CycleAce
    id: cycle_ace
    type: stationary_bike
    cadence: 49904
    eligible_users: [kckern, felix, milo]
```
The data is loaded into `fitnessConfiguration.fitness.equipment` (verified via `FitnessApp.jsx:899`) — it just never reaches the device router.

---

### P0-2 — `getEquipmentCatalog()` does not exist

**Path:** `frontend/src/hooks/fitness/DeviceEventRouter.js:33-90`

`DeviceEventRouter` exposes only `setEquipmentCatalog`. There is no `getEquipmentCatalog`.

But three call sites assume it exists, all using optional chaining that **silently swallows the missing method**:

```javascript
// FitnessSimulationController.js:144
const catalog = session?._deviceRouter?.getEquipmentCatalog?.();
return Array.isArray(catalog) ? catalog : [];

// GovernanceEngine.js:312
const catalog = this.session?._deviceRouter?.getEquipmentCatalog?.() || [];
```

**Effect:** Even after P0-1 is fixed, the controller and the engine's eligibility check both return `[]`. The bug is invisible at runtime because the optional-chain shortcut never throws. `getEquipment()` returns `[]`; `listCycleSelections()` returns selections (because those come from `engine.policies`, which is populated separately) but the rider picker for those selections has no equipment to look up. `triggerCycleChallenge` reaches the engine, the engine's `_getEligibleUsers` returns `[]`, the engine cannot pick a rider, returns `{ success: false, reason: 'failed_to_start' }`, and the popout shows `alert('Trigger failed: failed_to_start')`.

---

### P0-3 — `_updateGlobalState()` exposes ZERO cycle-specific fields

**Path:** `frontend/src/hooks/fitness/GovernanceEngine.js:385-409`

```javascript
_updateGlobalState() {
  if (typeof window !== 'undefined') {
    const self = this;
    window.__fitnessGovernance = {
      phase: this.phase,
      get warningDuration() { ... },
      get lockDuration() { ... },
      activeChallenge: this.challengeState?.activeChallenge?.id || null,
      activeChallengeZone: this.challengeState?.activeChallenge?.zone || null,
      videoLocked: ...,
      contentId: this.media?.id || null,
      satisfiedOnce: this.meta?.satisfiedOnce || false,
      userZoneMap: { ...(this._latestInputs?.userZoneMap || {}) },
      activeParticipants: [...(this._latestInputs?.activeParticipants || [])],
      zoneRankMap: { ...(this._latestInputs?.zoneRankMap || {}) }
    };
  }
}
```

The popout's `readCycleChallengeInfo()` (`sim-panel.html:509-529`) reads:

| Field consumer expects | Where engine has it internally | Exposed on window? |
|------------------------|--------------------------------|---|
| `gov.activeChallengeType` | `activeChallenge.type` | ❌ |
| `gov.cycleState` | `activeChallenge.cycleState` | ❌ |
| `gov.currentRpm` | `ctx.equipmentRpm` per tick | ❌ |
| `gov.riderId` | `activeChallenge.rider.id` | ❌ |
| `gov.currentPhaseIndex` | `activeChallenge.currentPhaseIndex` | ❌ |
| `gov.totalPhases` | `activeChallenge.totalPhases` | ❌ |
| `gov.phaseProgressPct` | computed in snapshot | ❌ |
| `gov.activeChallengeEquipment` | `activeChallenge.equipment` | ❌ |

The early-bail at `sim-panel.html:516`

```javascript
if (!gov.cycleState && !gov.currentRpm && !gov.riderId) return null;
```

is **always true**, so the cycle info detail box never renders, even when a challenge is fully active. The popout shows only the generic "Challenge: active" pill and nothing about RPM, phase, rider, or progress. Users see a static label that never changes and conclude the simulator does nothing.

The engine **does build a snapshot** with these fields (`GovernanceEngine.js:546-579`) — but only emits it via `governance.cycle.snapshot` log events, never as window state.

---

### P0-4 — `sim-state-change` is not fired on engine ticks

**Path:** `frontend/src/context/FitnessContext.jsx:1311-1314`

```javascript
controller.onStateChange = () => {
  window.dispatchEvent(new CustomEvent('sim-state-change', {
    detail: controller.getDevices()
  }));
};
```

`controller._notifyStateChange()` (the trigger for `onStateChange`) is called only on user-initiated controller mutations: `setHR`, `setRpm`, `setZone`, `startAuto`, `stopDevice`, `triggerChallenge`, `disableGovernance`, etc. (`FitnessSimulationController.js:406-410`).

**The governance engine's tick — which is what advances `cycleState`, increments RPM, transitions ramp→maintain→locked→unlock — does not call `_notifyStateChange()`.** No bridge connects engine state mutations to the popout.

**Effect:** Even after P0-3 is fixed and the popout *can* read cycle fields from `window.__fitnessGovernance`, it will only re-render when the user clicks something, not when the challenge state evolves over time. RPM and phase progress will appear frozen until the user pokes a slider.

---

## Secondary Issues (P1 / P2)

### P1-1 — Activation gate is "FitnessProvider mounted," not "Player mounted"

The popout's error message is `"Open this panel from FitnessPlayer"` and `"Simulation not available - reload FitnessPlayer"`, suggesting the controller is player-scoped. In fact it is mounted on `FitnessProvider` (`FitnessContext.jsx:1287-1330`) which wraps the entire app. Messaging is misleading. Cycle challenges, however, can only meaningfully fire while a video is playing because the dim/lock effects are visual overlays on the player. So the **practical** activation precondition is "play a cycling video" — which the audit docs and the popout do not state.

### P1-2 — Failure messaging is opaque

`triggerCycleChallenge` and `swapCycleRider` return `{ success: false, reason: '...' }` with reasons like `'engine_unavailable'`, `'failed_to_start'`, `'rider_not_eligible'`, `'swap_window_closed'`. The popout `alert()`s the bare reason. `'failed_to_start'` in particular is a black box — could be missing equipment, no eligible rider, no policies loaded, or a state-machine reject. A user sees `alert('Trigger failed: failed_to_start')` and has nothing to act on.

### P1-3 — Equipment list filtering is silent

`getEquipment()` filters on `entry.cadence != null` (`FitnessSimulationController.js:160`). Equipment without a cadence device is dropped silently. With an empty catalog (P0-1), this filter discards an empty list and the user sees `"No cycle-capable equipment in session catalog."` — a message that could equally mean "no bikes configured" or "the catalog is empty due to a wiring bug." Without instrumentation, the user cannot tell which.

### P1-4 — Popout opens 400×500 with no responsive sizing

Bulk actions + governance + HR devices + equipment + cycle controls stack vertically. With 2 HR devices and 1 bike the content is ~600px tall. `body` has no overflow rule; only `.device-list` and `.equipment-list` scroll. On a 500px-tall popout the cycle controls at the bottom may sit below the fold. Cosmetic, but contributes to "I can't find the controls" reports.

### P2-1 — `policies` race window

`controller.listCycleSelections()` reads `engine.policies`. Policies load asynchronously after fitness config arrives. If the user opens the popout before policies are normalized into the engine, the picker shows "(no cycle selections)" with no retry/refresh. Refreshing the popout (or any state change) re-renders. Mitigation is trivial; mention it in fix scope.

### P2-2 — Tests pass without exercising the broken path

The cycle unit tests (`tests/unit/fitness/FitnessSimulationController-cycling.test.mjs`, `CycleChallengeOverlay.test.mjs`, `GovernanceEngine-cycleTrigger.test.mjs`, etc.) all stub `_deviceRouter.getEquipmentCatalog` directly with the expected shape, and stub the engine's challenge state directly on `window.__fitnessGovernance`. They verify component contracts, not integration. **There is no end-to-end test that walks: load config → set catalog → trigger cycle → tick → window globals → popout reads → renders.** That gap is precisely the bug surface.

---

## Failure Trace — A User's Experience

Following the actual code paths, here is what a user trying to test the cycling challenge sees:

1. User loads `/fitness`, queues `Cycle Sprint Workouts`, plays an episode. Player mounts; FitnessFrame is hidden by the overlay player.
2. User clicks the gear (`HRSimTrigger`) at bottom-left → popup opens at 400×500.
3. Popup `init()` finds `window.opener.__fitnessSimController` ✓ and renders.
4. **Equipment section reads** `controller.getEquipment()` → `_getEquipmentCatalog()` → `session._deviceRouter.getEquipmentCatalog?.()` → **undefined** (P0-2) → `[]` → renders `"No cycle-capable equipment in session catalog."` Even if the method existed, `_context.equipmentCatalog` is `[]` (P0-1).
5. **Cycle Challenge section** reads `controller.listCycleSelections()`. This *does* return entries from `engine.policies` (which are normalized correctly from the YAML). The selection picker shows `"Cycle sprint (cycle_ace)"`. ✓
6. **Rider picker** for that selection reads `controller.getEquipment().find(e => e.equipmentId === 'cycle_ace')`. Equipment list is `[]` (P0-1, P0-2). `equipment` is `undefined`. `riders = []`. Picker shows only "Random rider".
7. User clicks "Trigger Cycle" → `engine.triggerChallenge({ type: 'cycle', selectionId: 'cycle_sprint', riderId: undefined })`.
8. Engine looks up equipment via `_getEligibleUsers('cycle_ace')` → reads `_deviceRouter.getEquipmentCatalog?.()` → **undefined** (P0-2) → `[]` → no eligible users. The engine cannot pick a rider, returns `{ success: false, reason: 'failed_to_start' }`.
9. Popout shows `alert('Trigger failed: failed_to_start')`. (P1-2)
10. **User concludes feature is broken and gives up.**

If P0-1 and P0-2 were fixed (catalog populated and gettable), the trigger would succeed and the engine would emit a snapshot with `cycleState: 'init'`, `riderId: 'kckern'`, etc.

11. The popout would then call `readCycleChallengeInfo()` → reads `window.__fitnessGovernance.cycleState` → **undefined** (P0-3) → returns `null`. The cycle info box would not render.
12. Even if the user manually reloaded the popout to see the state on first render, RPM and phase progress would appear frozen because `sim-state-change` (P0-4) does not fire on engine ticks. The user would still see the simulator as "broken."

So all four P0s must be fixed for the simulator to be usable.

---

## Why this happened

Reading the commit chain, the cycle work was sequenced correctly:

- `6564e6605` overlay skeleton
- `c68914fdc` RPM gauge
- `cb7c63ebd` boosters
- `6dede7f8a` swap modal
- `1924c62df` sim-panel cycle controls
- `e63002d79` README docs
- `0a28ada16` reference docs
- `dd5ce473d` merge

Each commit was self-tested with stubs at its boundary. The **integration commit that bridged engine state to window globals (P0-3) and bridged config to device router (P0-1) was never written**. The merge commit added no new wiring code — it just resolved conflicts. The lack of an end-to-end test (P2-2) meant nothing caught the gap.

This is an integration-layer miss, not a design or implementation flaw. The fix is small in lines but spans four files.

---

## Fix Surface

| Break | File | Approx LOC | Risk |
|-------|------|-----------|------|
| P0-1 (catalog never set) | `FitnessContext.jsx` (or `FitnessSession.js` init) | ~5 | Low — additive |
| P0-2 (no getter) | `DeviceEventRouter.js`, `FitnessSession.js` | ~10 | Low — pure read |
| P0-3 (window cycle fields) | `GovernanceEngine.js` `_updateGlobalState` | ~15 | Low — additive properties |
| P0-4 (engine→popout refresh) | `GovernanceEngine.js` (emit) + `FitnessContext.jsx` (subscribe) | ~10 | Low — event bus |

Total fix is ~40 LOC across four files. Implementation plan and exit-criteria Playwright lifecycle test are in `docs/_wip/plans/2026-04-30-cycle-challenge-sim-fix-and-lifecycle-test.md`.

---

## Recommended Verification

End-to-end Playwright test that walks the whole lifecycle in a real browser, scripted in the plan doc:

1. Boot fitness app, queue a cycle-eligible Plex episode.
2. Open the sim popup; assert the equipment list contains `cycle_ace` with at least one eligible rider.
3. Drive HR sliders for two participants into the active zone (so they're "present").
4. Trigger a cycle challenge via the popup; assert `engine.triggerChallenge` returns `{ success: true }`.
5. Drive RPM via the popup slider through `init → ramp → maintain` — assert `cycleState` advances on the popup *and* the on-screen `CycleChallengeOverlay`.
6. Drop RPM below `loRpm` mid-maintain; assert transition to `locked` and the lock overlay appears.
7. Recover RPM; assert unlock.
8. Run all phases through; assert `status === 'success'` and overlay clears.
9. Verify no orphan state on `window.__fitnessGovernance` after teardown.

This test is the exit criterion for the fix.
