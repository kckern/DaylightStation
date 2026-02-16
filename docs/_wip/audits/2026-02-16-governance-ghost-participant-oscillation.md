# Governance Ghost Participant Oscillation Bug

**Date:** 2026-02-16
**Severity:** High (user-visible flickering + video pause/resume cycling)
**Component:** `GovernanceEngine.evaluate()` in `frontend/src/hooks/fitness/GovernanceEngine.js`
**Session:** `fs_20260215212446` (prod, Feb 15 ~9:24 PM)

---

## Symptoms Observed (from prod logs)

1. **Lock screen flashing** between 1 row and 0 rows (should stay at 1 row)
2. **Video (Mario Kart 8) paused/resumed 4 times in 3 seconds** after governance flipped
3. **1,787 renders in 90 seconds** (profile sample #4 flagged as excessive)
4. **Session ended after only 3 minutes** due to empty roster timeout

## Root Cause

### The Ghost Participant Filter Ordering Bug

In `GovernanceEngine.evaluate()` (line 1190), there are two competing code paths that call this method. One of them has an ordering bug that removes all participants before zone data can be populated.

**The problematic sequence** (lines 1200-1280):

```
Step 1 (line 1202-1210): Build activeParticipants from roster
  → activeParticipants = ['userId']
  → userZoneMap = {}              ← EMPTY

Step 2 (line 1241-1253): Ghost participant filter
  → activeParticipants.filter(id => id in userZoneMap)
  → userZoneMap is {} → REMOVES ALL PARTICIPANTS → []

Step 3 (line 1266-1280): ZoneProfileStore populates userZoneMap
  → iterates activeParticipants.forEach(...)
  → BUT activeParticipants is already [] → DOES NOTHING

Step 4 (line 1311): activeParticipants.length === 0
  → logs "governance.evaluate.no_participants"
  → _setPhase('pending')
  → return (bypasses ALL normal phase logic)
```

**The fix:** Move step 2 (ghost filter) to after step 3 (ZoneProfileStore population), so `userZoneMap` has data before filtering.

### Two Competing Evaluate Paths

| Path | Trigger | Frequency | Passes userZoneMap? | Result |
|------|---------|-----------|---------------------|--------|
| **A: `_triggerPulse()`** | Tick timer (every 5s), pulse scheduler | ~5s | No (`userZoneMap = {}`) | Ghost filter removes everyone → `no_participants` → `pending` |
| **B: `updateSnapshot()`** | FitnessSession.js:1571 (React re-render) | On state change | Yes (from roster entries) | Proper evaluation → may produce `unlocked` |

The oscillation cycle:

```
Path A fires → ghost filter → no_participants → pending
  → phase change callback → React re-render
  → updateSnapshot → Path B fires → proper eval → unlocked
  → next tick timer → Path A fires → ghost filter → pending
  → ... repeats every few hundred ms
```

### Evidence from Prod Logs

**13 rapid phase flips in 20 seconds** (05:25:53 → 05:26:13):

| Time | Transition | Gap | Trigger |
|------|-----------|-----|---------|
| :53.904 | unlocked → pending | — | Path A (no_participants) |
| :53.915 | pending → unlocked | 11ms | Path B (satisfied:true) |
| :54.286 | unlocked → pending | 371ms | Path A (no_participants) |
| :54.305 | pending → unlocked | 19ms | Path B |
| :54.884 | unlocked → pending | 579ms | Path A |
| :54.906 | pending → unlocked | 22ms | Path B |
| :56.854 | unlocked → pending | ~2s | Path A |
| :56.870 | pending → unlocked | 16ms | Path B |
| ...continues... | | | |

**4 video pause/resume cycles in 3 seconds:**

| Time | Event | Position |
|------|-------|----------|
| :53.918 | paused | 1673.3s |
| :54.025 | resumed | 1673.3s (107ms pause) |
| :54.307 | paused | 1673.6s |
| :54.417 | resumed | 1673.6s (110ms pause) |
| :54.907 | paused | 1674.1s |
| :55.016 | resumed | 1674.1s (109ms pause) |
| :56.871 | paused | 1676.0s |
| :56.982 | resumed | 1676.0s (111ms pause) |

---

## Cascade Effects

### 1. Video Pause via `videoLocked`

`GovernanceEngine.js:277`:
```javascript
videoLocked: this.challengeState?.videoLocked
  || (this._mediaIsGoverned() && this.phase !== 'unlocked' && this.phase !== 'warning'),
```

When phase = `pending`: `videoLocked = true` (pending is neither unlocked nor warning).

`FitnessPlayer.jsx:274-283`:
```javascript
const pauseDecision = useMemo(() => resolvePause({
  governance: { locked: Boolean(governanceState?.videoLocked) },
  ...
}), [governanceState?.videoLocked, ...]);
const governancePaused = pauseDecision.reason === PAUSE_REASON.GOVERNANCE && pauseDecision.paused;
```

`FitnessPlayer.jsx:332-337`: When `governancePaused` changes, effect calls `media.pause()` or `media.play()`.

### 2. Lock Screen Flashing (0 vs 1 Rows)

`useGovernanceDisplay.js:18-19`: When `status === 'unlocked'`, returns `{ show: false }` — overlay hidden.

`useGovernanceDisplay.js:28-37`: When `status === 'pending'`, iterates `requirements[].missingUsers` to build rows.

- **Path A (no_participants):** `requirementSummary.requirements[].missingUsers = []` → 0 rows, but `show: true` (line 102: `status === 'pending'`)
- **Path B (proper eval):** requirements have actual `missingUsers` → 1 row with participant data

User sees: flash between "Waiting for participant data..." (0 rows) and actual participant row (1 row).

### 3. Warning Phase Never Reached

The `no_participants` branch (line 1311-1378) short-circuits with `_setPhase('pending')` and `return`. It **never reaches** the normal phase determination at lines 1413-1489 where warning/grace period logic lives.

Even if the user's HR was just slightly below the Active threshold (which should trigger a **warning countdown**), the ghost filter makes governance think nobody is there, skipping the warning path entirely.

### 4. Excessive Renders

The rapid phase oscillation triggers `_setPhase()` → `onPhaseChange` callback → React state update → re-render on every flip. Profile sample #4 shows 1,787 renders in 90 seconds.

---

## Contributing Factor: Redundant Hysteresis

`GovernanceEngine.js:164`:
```javascript
this._hysteresisMs = 1500; // hardcoded
```

Lines 1424-1443 require satisfaction to persist for 1500ms before transitioning to `unlocked`. This is **redundant with the warning zone**, which already provides the "HR below threshold" UX via a grace period countdown.

The warning phase + `grace_period_seconds` (configurable, typically 30s) is the intended mechanism for marginal HR. Hysteresis adds a second debounce layer that:
- Delays unlocking even when HR is solidly in the target zone
- Is invisible to the user (no UI feedback during the 1500ms wait)
- Creates edge cases where satisfaction is met but the user doesn't see the unlock

### Related: Relock Grace

`GovernanceEngine.js:166`:
```javascript
this._relockGraceMs = 5000; // hardcoded
```

Lines 1451-1456: After unlocking, stays unlocked for 5s even if requirements break. This is useful but only works for the normal evaluation path — the `no_participants` path bypasses it entirely.

---

## Code Locations

| File | Lines | What |
|------|-------|------|
| `frontend/src/hooks/fitness/GovernanceEngine.js` | 1200-1210 | Roster → activeParticipants with empty userZoneMap |
| `frontend/src/hooks/fitness/GovernanceEngine.js` | 1241-1253 | Ghost participant filter (runs too early) |
| `frontend/src/hooks/fitness/GovernanceEngine.js` | 1266-1280 | ZoneProfileStore population (runs too late) |
| `frontend/src/hooks/fitness/GovernanceEngine.js` | 1311-1378 | no_participants branch → `_setPhase('pending')` |
| `frontend/src/hooks/fitness/GovernanceEngine.js` | 1413-1489 | Normal phase logic (warning/grace/locked) — skipped |
| `frontend/src/hooks/fitness/GovernanceEngine.js` | 754-765 | `_triggerPulse()` → `evaluate()` no args |
| `frontend/src/hooks/fitness/FitnessSession.js` | 1522-1577 | `updateSnapshot()` → `evaluate({...})` with data |
| `frontend/src/hooks/fitness/GovernanceEngine.js` | 270-277 | `videoLocked` computation |
| `frontend/src/modules/Player/utils/pauseArbiter.js` | 10-18 | `resolvePause()` → governance pause |
| `frontend/src/modules/Fitness/FitnessPlayer.jsx` | 274-283, 330-383 | Pause/resume effect driven by `governancePaused` |
| `frontend/src/modules/Fitness/hooks/useGovernanceDisplay.js` | 12-113 | Display row resolution from governance state |
| `frontend/src/modules/Fitness/FitnessPlayerOverlay/GovernanceStateOverlay.jsx` | 108-274 | Lock panel rendering (rows vs "Waiting...") |

---

## Proposed Fix

**Primary (required):** Move the ghost participant filter (lines 1241-1253) to **after** the ZoneProfileStore population (lines 1266-1280). This ensures `userZoneMap` is populated before filtering, so participants aren't removed when `evaluate()` is called without explicit zone data.

**Secondary (recommended):** Consider removing `_hysteresisMs` (lines 1424-1443). The warning zone + grace period already handles the "HR near threshold" case with proper user-facing UI. Hysteresis adds invisible delay without feedback.
