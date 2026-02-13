# Governance SSoT Violations Fix Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Eliminate all 5 known SSoT violations in the fitness governance system so every component reads from the same authoritative source.

**Architecture:** Each violation is a case where two+ code paths derive the same truth from different sources. The fixes converge them onto the single authoritative source (ZoneProfileStore for zones, flat `heartRate` for HR, GovernanceEngine for lock decisions). After all fixes, update the architecture doc to mark violations resolved.

**Tech Stack:** React (hooks, context, useMemo/useCallback), vanilla JS classes (GovernanceEngine, ZoneProfileStore, FitnessSession)

---

### Task 1: Fix Violation #5 — Heart Rate Structure Inconsistency

**Why first:** This is the simplest fix and eliminates dead-code defensive checks. The roster *only* uses flat `heartRate` (confirmed: `FitnessSession.js:1134`). The `hr?.value` checks in GovernanceEngine are guarding against a shape that never exists.

**Files:**
- Modify: `frontend/src/hooks/fitness/GovernanceEngine.js:296-297`
- Modify: `frontend/src/hooks/fitness/GovernanceEngine.js:723`

**Step 1: Remove `hr.value` dead-code path in zone change logging**

In `GovernanceEngine.js` at line 296, the code reads:
```javascript
const hr = rosterEntry?.hr?.value || rosterEntry?.heartRate || null;
const hrPercent = rosterEntry?.hr?.percent || rosterEntry?.hrPercent || null;
```

Replace with:
```javascript
const hr = Number.isFinite(rosterEntry?.heartRate) ? rosterEntry.heartRate : null;
const hrPercent = Number.isFinite(rosterEntry?.hrPercent) ? rosterEntry.hrPercent : null;
```

**Step 2: Remove `hr.value` dead-code path in `_getUserStates()`**

In `GovernanceEngine.js` at line 723, the code reads:
```javascript
hr: rosterEntry?.hr?.value || rosterEntry?.heartRate || null
```

Replace with:
```javascript
hr: Number.isFinite(rosterEntry?.heartRate) ? rosterEntry.heartRate : null
```

**Step 3: Run governance tests**

Run: `npx vitest run tests/isolated/domain/fitness/ --reporter=verbose 2>&1 | tail -30`

Expected: Tests run (note: pre-existing Jest/Vitest globals mismatch may cause failures unrelated to this change).

**Step 4: Commit**

```bash
git add frontend/src/hooks/fitness/GovernanceEngine.js
git commit -m "fix(fitness): remove dead hr.value struct checks — roster uses flat heartRate only"
```

---

### Task 2: Fix Violation #1 — getUserVitals().zoneId Raw Zone Exposure

**Why:** `getUserVitals()` returns `zoneId` from raw participant/device data instead of ZoneProfileStore. Any consumer reading `getUserVitals(name).zoneId` gets the unstabilized zone — contradicting what GovernanceEngine sees.

**Files:**
- Modify: `frontend/src/context/FitnessContext.jsx:1617-1676` (getUserVitals)

**Step 1: Read stabilized zone from ZoneProfileStore inside `getUserVitals()`**

In `FitnessContext.jsx` at lines 1634-1636, the current code is:
```javascript
const mergedZoneId = existing?.zoneId
  || (participant?.zoneId ? String(participant.zoneId).toLowerCase() : null);
const mergedZoneColor = existing?.zoneColor || participant?.zoneColor || null;
```

Replace with:
```javascript
// SSoT: Prefer ZoneProfileStore for stabilized zone (matches GovernanceEngine)
const profileId = existing?.profileId || participant?.profileId || participant?.id || nameOrId;
const zoneProfile = zoneProfileLookup.get(profileId);
const stabilizedZoneId = zoneProfile?.currentZoneId
  ? String(zoneProfile.currentZoneId).toLowerCase()
  : null;
const stabilizedZoneColor = zoneProfile?.currentZoneColor || null;
const mergedZoneId = stabilizedZoneId
  || existing?.zoneId
  || (participant?.zoneId ? String(participant.zoneId).toLowerCase() : null);
const mergedZoneColor = stabilizedZoneColor
  || existing?.zoneColor || participant?.zoneColor || null;
```

**Step 2: Add `zoneProfileLookup` to the `getUserVitals` dependency array**

At the end of the `getUserVitals` useCallback (line 1676), the dependency array is:
```javascript
}, [userVitalsMap, participantLookupByName, getDisplayLabel]);
```

Change to:
```javascript
}, [userVitalsMap, participantLookupByName, getDisplayLabel, zoneProfileLookup]);
```

**Step 3: Run governance tests**

Run: `npx vitest run tests/isolated/domain/fitness/ --reporter=verbose 2>&1 | tail -30`

**Step 4: Commit**

```bash
git add frontend/src/context/FitnessContext.jsx
git commit -m "fix(fitness): getUserVitals reads zone from ZoneProfileStore SSoT"
```

---

### Task 3: Fix Violation #2 — FitnessPlayer Dual Governance Check

**Why:** FitnessPlayer.jsx lines 327-351 independently decides if media is governed by comparing labels against `governedLabelSet`. This duplicates what GovernanceEngine does internally via `_mediaIsGoverned()`. If the two diverge, the player may lock when the engine says unlocked.

**Strategy:** Remove the local label/type matching logic and instead read `videoLocked` directly from GovernanceEngine state. The engine already evaluates whether current media is governed and whether the phase requires locking.

**Files:**
- Modify: `frontend/src/modules/Fitness/FitnessPlayer.jsx:297-351`

**Step 1: Replace the local governance check with engine-only decision**

The current `pauseDecision` at line 297 reads:
```javascript
const pauseDecision = useMemo(() => resolvePause({
    governance: { locked: playIsGoverned || governanceState?.videoLocked },
    resilience: {
      stalled: resilienceState?.stalled,
      waiting: resilienceState?.waitingToPlay
    },
    user: { paused: isPaused }
  }), [playIsGoverned, governanceState?.videoLocked, resilienceState?.stalled, resilienceState?.waitingToPlay, isPaused]);
```

Replace with:
```javascript
const pauseDecision = useMemo(() => resolvePause({
    governance: { locked: Boolean(governanceState?.videoLocked) },
    resilience: {
      stalled: resilienceState?.stalled,
      waiting: resilienceState?.waitingToPlay
    },
    user: { paused: isPaused }
  }), [governanceState?.videoLocked, resilienceState?.stalled, resilienceState?.waitingToPlay, isPaused]);
```

**Step 2: Remove the `playIsGoverned` state and its effect**

Remove the `playIsGoverned` state declaration (search for `const [playIsGoverned, setPlayIsGoverned]`).

Remove the entire `useEffect` block at lines 327-351 that computes `playIsGoverned` from local label matching.

**Step 3: Update `governancePaused` if needed**

Line 306 (`const governancePaused = ...`) depends on `pauseDecision` which no longer references `playIsGoverned`. No change needed here — it already works off `pauseDecision`.

**Step 4: Verify no other references to `playIsGoverned`**

Run: `grep -n 'playIsGoverned' frontend/src/modules/Fitness/FitnessPlayer.jsx`

Expected: No matches (state and effect both removed).

**Step 5: Run governance tests**

Run: `npx vitest run tests/isolated/domain/fitness/ --reporter=verbose 2>&1 | tail -30`

**Step 6: Commit**

```bash
git add frontend/src/modules/Fitness/FitnessPlayer.jsx
git commit -m "fix(fitness): remove dual governance check — use GovernanceEngine as sole lock authority"
```

---

### Task 4: Fix Violation #3 — Heart Rate Triple-Storage

**Why:** HR is stored in DeviceManager (raw), UserManager (copied), and ZoneProfileStore (copied again). While all currently update in the same `ingestData()` call, the triple-storage is technical debt.

**Strategy:** This is a documentation + defensive-coding fix rather than a full refactoring. The three stores serve different roles (device tracking, user mapping, zone computation) and collapsing them would require significant architectural changes beyond SSoT scope. The fix is to:
1. Add a comment block in `FitnessSession.ingestData()` documenting the HR propagation chain
2. Ensure `ZoneProfileStore.buildProfile()` always reads HR from a single source (UserManager) rather than having two fallback paths

**Files:**
- Modify: `frontend/src/hooks/fitness/FitnessSession.js` (add documentation comment in `ingestData`)
- Modify: `frontend/src/hooks/fitness/ZoneProfileStore.js:166-168` (simplify HR source)

**Step 1: Document the HR propagation chain**

In `FitnessSession.js` at line 434 (start of `ingestData`), add a comment block after the function signature:

```javascript
  ingestData(payload) {
    // HR propagation chain (SSoT note):
    // 1. DeviceManager stores raw sensor value (device.heartRate)
    // 2. UserManager copies from DeviceManager (user.currentData.heartRate)
    // 3. ZoneProfileStore reads from UserManager (profile.heartRate)
    // All three update synchronously in this call. If any path becomes async,
    // the triple-storage must be collapsed to a single authoritative store.
```

**Step 2: Simplify ZoneProfileStore HR source**

In `ZoneProfileStore.js` at lines 166-168, the current code is:
```javascript
const heartRate = Number.isFinite(user?.currentData?.heartRate)
  ? Math.max(0, user.currentData.heartRate)
  : (Number.isFinite(user?.zoneSnapshot?.currentHR) ? Math.max(0, user.zoneSnapshot.currentHR) : 0);
```

The `zoneSnapshot.currentHR` fallback reads from a potentially stale snapshot. Replace with:
```javascript
const heartRate = Number.isFinite(user?.currentData?.heartRate)
  ? Math.max(0, user.currentData.heartRate)
  : 0; // No fallback — UserManager.currentData.heartRate is the SSoT for HR
```

**Step 3: Run governance tests**

Run: `npx vitest run tests/isolated/domain/fitness/ --reporter=verbose 2>&1 | tail -30`

**Step 4: Commit**

```bash
git add frontend/src/hooks/fitness/FitnessSession.js frontend/src/hooks/fitness/ZoneProfileStore.js
git commit -m "fix(fitness): document HR propagation chain, remove stale snapshot fallback"
```

---

### Task 5: Fix Violation #4 — Progress Bar Data Source Split

**Why:** `computeProgressData()` in FitnessPlayerOverlay calculates progress from two different sources: zone snapshot vs raw HR. The fallback to raw HR produces different values than the zone-based calculation, causing visible progress bar jumps.

**Strategy:** When zone snapshot is available, always use it. Only fall back to raw HR when there's no snapshot at all (initial state before first zone computation). Add a comment explaining the two paths.

**Files:**
- Modify: `frontend/src/modules/Fitness/FitnessPlayerOverlay.jsx:684-750`

**Step 1: Consolidate progress computation**

In `computeProgressData` at lines 684-750, the current fallback at line 726 kicks in when `calculateZoneProgressTowardsTarget` returns null. The issue is that it then uses raw `heartRate` instead of the snapshot's `currentHR`.

Replace lines 726-744 with:
```javascript
    // Fallback: Direct HR-to-target comparison (only when no zone snapshot available)
    // Uses snapshot HR when available to stay consistent with zone-based path
    if (Number.isFinite(targetHeartRate) && targetHeartRate > 0) {
      const hrValue = Number.isFinite(progressEntry?.currentHR)
        ? progressEntry.currentHR
        : Number.isFinite(heartRate)
          ? heartRate
          : null;
      if (!Number.isFinite(hrValue)) {
        return null;
      }
      if (hrValue >= targetHeartRate) {
        return { progress: 1, intermediateZones: [], currentSegment: 0, segmentsTotal: 0 };
      }
      const floor = Math.max(0, targetHeartRate - COOL_ZONE_PROGRESS_MARGIN);
      const span = targetHeartRate - floor;
      if (span <= 0) {
        const prog = hrValue >= targetHeartRate ? 1 : 0;
        return { progress: prog, intermediateZones: [], currentSegment: 0, segmentsTotal: 0 };
      }
      return { progress: clamp((hrValue - floor) / span), intermediateZones: [], currentSegment: 0, segmentsTotal: 0 };
    }
```

The key change: prefer `progressEntry.currentHR` over raw `heartRate` in the fallback path, so both code paths use the same HR source.

**Step 2: Run governance tests**

Run: `npx vitest run tests/isolated/domain/fitness/ --reporter=verbose 2>&1 | tail -30`

**Step 3: Commit**

```bash
git add frontend/src/modules/Fitness/FitnessPlayerOverlay.jsx
git commit -m "fix(fitness): progress bar fallback prefers snapshot HR over raw HR"
```

---

### Task 6: Update Architecture Documentation

**Files:**
- Modify: `docs/reference/fitness/governance-system-architecture.md` (section "Known Remaining SSoT Violations")

**Step 1: Replace the 5 violation entries with resolution notes**

Replace the "Known Remaining SSoT Violations" section (lines 460-526) with:

```markdown
## Resolved SSoT Violations

All previously documented SSoT violations have been addressed:

| # | Violation | Resolution | Commit |
|---|-----------|-----------|--------|
| 1 | `getUserVitals().zoneId` raw zone | Now reads from ZoneProfileStore first | Task 2 |
| 2 | FitnessPlayer dual governance check | Removed local label check; GovernanceEngine is sole authority | Task 3 |
| 3 | Heart rate triple-storage | Documented propagation chain; removed stale snapshot fallback | Task 4 |
| 4 | Progress bar data source split | Fallback path now prefers snapshot HR over raw HR | Task 5 |
| 5 | Heart rate structure inconsistency | Removed dead `hr.value` checks; standardized on flat `heartRate` | Task 1 |

### Design Decisions

- **Triple HR storage retained:** DeviceManager, UserManager, and ZoneProfileStore each serve different roles. The three stores update synchronously in `ingestData()`. If any path becomes async, this must be collapsed.
- **Raw zone fields retained in vitals:** `getUserVitals().zoneId` now prefers ZoneProfileStore but falls back to raw zone for initial state before first stabilization.
- **`computeProgressData` two paths retained:** Zone-based and HR-based are fundamentally different algorithms for different scenarios. The fix ensures both use the same HR source.
```

**Step 2: Commit**

```bash
git add docs/reference/fitness/governance-system-architecture.md
git commit -m "docs(fitness): mark all 5 SSoT violations as resolved"
```

---

## Execution Notes

- **Task order matters:** Task 1 first (simplest, no dependencies), then Tasks 2-5 in order, Task 6 last (documentation).
- **Pre-existing test failures:** The governance test suite has pre-existing Jest/Vitest globals mismatches. These are unrelated to SSoT fixes. Don't block on them.
- **Risk assessment:** Tasks 1, 4, 5 are low-risk (cleanup/preference changes). Task 2 (removing dual check) is medium-risk — it relies on GovernanceEngine correctly evaluating `videoLocked`. Task 3 is low-risk (documentation + removing a dead fallback).
- **Rollback:** Each task is committed independently, so any can be reverted in isolation.
