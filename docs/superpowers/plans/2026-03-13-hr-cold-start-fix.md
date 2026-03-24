# HR Cold Start Fix Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove stale HR data fallback chain so devices start with null HR instead of cached values from previous sessions.

**Architecture:** Surgical edits across 4 files — clear stale `currentData` fields in UserManager, delete stale overrides in ParticipantRoster, remove `currentData` fallbacks in TimelineRecorder, and align guest assignment HR clearing.

**Tech Stack:** React (frontend state management), no backend changes.

**Spec:** `docs/superpowers/specs/2026-03-13-hr-cold-start-design.md`

---

## Chunk 1: Remove Stale HR Fallback Chain

### Task 1: UserManager — Clear HR on disconnect instead of preserving

**Files:**
- Modify: `frontend/src/hooks/fitness/UserManager.js:84-89`

- [ ] **Step 1: Edit `#updateHeartRateData` to clear HR fields on disconnect**

Replace lines 84-89:
```javascript
  #updateHeartRateData(heartRate) {
    if (!heartRate || heartRate <= 0) {
      // Device disconnect (HR=0): preserve last known zone snapshot.
      // Don't recompute with HR=0, which would drop user to "cool" zone.
      return;
    }
```

With:
```javascript
  #updateHeartRateData(heartRate) {
    if (!heartRate || heartRate <= 0) {
      // Device disconnect or cold start: clear stale HR data.
      // Downstream consumers (ZoneProfileStore, TimelineRecorder) will see null
      // and correctly treat this as "no data" rather than using cached values.
      this.currentData.heartRate = null;
      this.currentData.zone = null;
      this.currentData.color = null;
      return;
    }
```

Note: `currentData` uses field names `zone` and `color` (not `zoneId`/`zoneColor`), as set by `#updateCurrentData()` at line 70.

- [ ] **Step 2: Verify no test regressions**

Run: `npx vitest run --reporter=verbose 2>&1 | head -80`
Expected: Existing tests pass (or no test file exists for UserManager — confirm either way).

---

### Task 2: UserManager — Align guest assignment HR clearing to null

**Files:**
- Modify: `frontend/src/hooks/fitness/UserManager.js` (two locations, line numbers shift +1 after Task 1)

- [ ] **Step 1: Change guest assignment HR clearing from `= 0` to `= null`**

Find and replace (two occurrences):
```javascript
        guestUser.currentData.heartRate = 0;
```
With:
```javascript
        guestUser.currentData.heartRate = null;
```

And:
```javascript
        user.currentData.heartRate = 0;
```
With:
```javascript
        user.currentData.heartRate = null;
```

- [ ] **Step 2: Commit UserManager changes (Tasks 1 + 2)**

```bash
git add frontend/src/hooks/fitness/UserManager.js
git commit -m "fix(fitness): clear HR data on disconnect instead of preserving stale values

Previously, #updateHeartRateData preserved cached HR when receiving 0/null,
causing stale values from previous sessions to leak into new sessions.
Now explicitly clears HR, zone, and color fields on disconnect.
Also aligns guest assignment HR clearing from 0 to null for consistency."
```

---

### Task 3: ParticipantRoster — Remove stale currentData overrides

**Files:**
- Modify: `frontend/src/hooks/fitness/ParticipantRoster.js:387-397, 454-457`

- [ ] **Step 1: Delete the stale HR override block (lines 390-397)**

Delete lines 390-397:
```javascript
    // Resolve heart rate from user if device doesn't have it
    let resolvedHeartRate = heartRate;
    if (mappedUser?.currentData && Number.isFinite(mappedUser.currentData.heartRate)) {
      const candidateHr = Math.round(mappedUser.currentData.heartRate);
      if (candidateHr > 0) {
        resolvedHeartRate = candidateHr;
      }
    }
```

Replace with:
```javascript
    const resolvedHeartRate = heartRate;
```

- [ ] **Step 2: Remove stale zone fallback variables (lines 387-388)**

Delete lines 387-388:
```javascript
    const fallbackZoneId = mappedUser?.currentData?.zone || null;
    const fallbackZoneColor = mappedUser?.currentData?.color || null;
```

These read stale zone/color from `currentData` — the same class of bug as the HR fallback.

- [ ] **Step 3: Remove fallback references in roster entry (lines 454-457)**

Replace:
```javascript
      zoneId: zoneInfo?.zoneId || fallbackZoneId || null,
      zoneColor: zoneInfo?.color || fallbackZoneColor || null,
      rawZoneId: zoneInfo?.rawZoneId || zoneInfo?.zoneId || fallbackZoneId || null,
      rawZoneColor: zoneInfo?.rawZoneColor || zoneInfo?.color || fallbackZoneColor || null,
```

With:
```javascript
      zoneId: zoneInfo?.zoneId || null,
      zoneColor: zoneInfo?.color || null,
      rawZoneId: zoneInfo?.rawZoneId || zoneInfo?.zoneId || null,
      rawZoneColor: zoneInfo?.rawZoneColor || zoneInfo?.color || null,
```

The `zoneInfo` object (from ZoneProfileStore via `zoneLookup`) is the live, authoritative source for zone data. If `zoneInfo` is null, the participant simply has no zone yet — correct for cold start.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/hooks/fitness/ParticipantRoster.js
git commit -m "fix(fitness): remove stale currentData overrides in roster builder

The roster was unconditionally overwriting device HR with cached
user.currentData.heartRate, and falling back to stale zone/color.
Now uses only device HR and live ZoneProfileStore data.
Null values during cold start are handled correctly by chart rendering."
```

---

### Task 4: TimelineRecorder — Remove user.currentData fallbacks

**Files:**
- Modify: `frontend/src/hooks/fitness/TimelineRecorder.js:234-238`

Note: The spec only covers the HR fallback (line 237), but the zone and color fallbacks on lines 234 and 238 use the same stale `user.currentData` pattern. Removing all three is consistent with the "device is single source of truth" principle.

- [ ] **Step 1: Remove `user.currentData` fallbacks in stageUserEntry**

Replace line 234:
```javascript
          color: snapshot?.zoneColor || user.currentData?.color || null
```
With:
```javascript
          color: snapshot?.zoneColor || null
```

Replace line 237:
```javascript
          heartRate: sanitizeHeartRate(snapshot?.heartRate ?? user.currentData?.heartRate),
```
With:
```javascript
          heartRate: sanitizeHeartRate(snapshot?.heartRate),
```

Replace line 238:
```javascript
          zoneId: snapshot?.zoneId || user.currentData?.zone || null,
```
With:
```javascript
          zoneId: snapshot?.zoneId || null,
```

- [ ] **Step 2: Commit**

```bash
git add frontend/src/hooks/fitness/TimelineRecorder.js
git commit -m "fix(fitness): remove stale user.currentData fallbacks in TimelineRecorder

stageUserEntry was falling back to user.currentData for HR, zone, and color
when device snapshot had no data. This recorded stale cached values as valid
timeline ticks. Now records null when device has no data, which the chart
correctly renders as a gap."
```

---

### Task 5: Verify build and smoke test

- [ ] **Step 1: Run the build**

Run: `cd /opt/Code/DaylightStation && npx vite build 2>&1 | tail -20`
Expected: Build succeeds with no errors.

- [ ] **Step 2: Run any existing fitness-related tests**

Run: `npx vitest run --reporter=verbose 2>&1 | tail -40`
Expected: All tests pass.

- [ ] **Step 3: Final commit (if any test fixes needed)**

Only if tests needed fixing — otherwise this step is skipped.
