# Bug Report: Governance Lock Screen Shows "Target" Fallback for ~2 Seconds

**Date:** 2026-02-02  
**Severity:** Medium (UI polish / user experience)  
**Status:** Fix Implemented, Needs Testing  
**Session:** fs_20260202185544  
**Log File:** logs/prod-logs-20260202-185930.txt

## Summary

When a governed video starts (e.g., Mario Kart Wii), the lock screen briefly displays "Target" as the target zone label instead of the configured zone name ("Active"). This lasts approximately 2 seconds until HR data arrives and triggers a re-evaluation.

## User Report

> "I saw it in that state briefly when Mario Kart Wii started. About 2 seconds the `Active` target loaded/appeared."

## Evidence from Production Logs

### Timeline of Events

| Timestamp | Event | Details |
|-----------|-------|---------|
| 02:55:52.032Z | `playback.queue-track-changed` | Mario Kart Wii queued |
| 02:55:52.669Z | `playback.video-ready` | Video ready to play |
| 02:55:52.670Z | `playback.started` | Video started |
| 02:55:52.677Z | `playback.paused` | Video paused (governance) |
| 02:55:52.990Z | `playback.overlay-summary` | Overlay visible, status: "Seeking…" |
| **02:55:54.518Z** | **`governance.phase_change`** | **null → pending** |
| 02:55:54.990Z | `playback.overlay-summary` | Still showing overlay |
| 02:57:03.455Z | `governance.user_zone_change` | First zone change detected |
| 02:57:03.955Z | `governance.phase_change` | pending → unlocked |

### Key Finding: Missing Requirements in Phase Change Log

The `governance.phase_change` event at **02:55:54.518Z** shows:

```json
{
  "ts": "2026-02-03T02:55:54.518Z",
  "event": "governance.phase_change",
  "data": {
    "from": null,
    "to": "pending",
    "mediaId": "606440",
    "deadline": null,
    "satisfiedOnce": false
  }
}
```

**Note:** No `requirements` array is logged. Compare to `governance.warning_started` which includes full requirements:

```json
{
  "ts": "2026-02-03T02:58:01.572Z",
  "event": "governance.warning_started",
  "data": {
    "requirements": [
      {
        "zone": "active",
        "zoneLabel": "Active",
        "targetZoneId": "active",
        "satisfied": false,
        ...
      }
    ]
  }
}
```

### Gap Analysis

| Time | Duration | What Happened |
|------|----------|---------------|
| 02:55:52.670Z - 02:55:54.518Z | **1.85s** | Video started → Governance pending (no requirements populated) |
| 02:55:54.518Z - 02:57:03.955Z | **69.4s** | Pending → Unlocked (waiting for HR to reach Active zone) |

The **1.85 second gap** between video start and governance entering pending state is when the UI shows the "Target" fallback instead of "Active".

## Root Cause Analysis

### Problem 1: Requirements Not Populated When No Participants

In `GovernanceEngine.js`, the `evaluate()` function has an early return when there are no active participants:

```javascript
// Line 1217-1235 (before fix)
if (activeParticipants.length === 0) {
  getLogger().warn('governance.evaluate.no_participants');
  this._clearTimers();
  this._setPhase('pending');  // ← Phase set to pending
  this._latestInputs = { ... };
  this._invalidateStateCache();
  return;  // ← EARLY RETURN - requirements never evaluated!
}
```

The actual requirement evaluation (which populates `zoneLabel`) only happens AFTER this check passes:

```javascript
// Line 1262-1267 (only reached if activeParticipants.length > 0)
const { summaries, allSatisfied } = this._evaluateRequirementSet(...);
this.requirementSummary = {
  policyId: activePolicy.id,
  requirements: summaries,  // ← zoneLabel comes from here
  ...
};
```

### Problem 2: TreasureBox Governance Callback is Disabled

The TreasureBox callback that was supposed to trigger immediate governance evaluation is now a no-op:

```javascript
// TreasureBox.js line 727-737
setGovernanceCallback(callback) {
  // No-op: Governance callback removed - now tick-driven via ZoneProfileStore
  if (callback) {
    getLogger().warn('treasurebox.governance_callback_deprecated', {
      message: 'Governance now reads from ZoneProfileStore on tick boundaries'
    });
  }
}
```

This means governance only evaluates when:
1. React render cycle triggers `updateSnapshot()` via useEffect
2. `participantRoster` dependency changes (requires `forceUpdate()`)

### Problem 3: Data Flow Has Unnecessary Indirection

Current flow:
```
HR arrives → DeviceManager → TreasureBox (callback disabled)
                                    ↓
                           (no direct path)
                                    ↓
React useEffect (on participantRoster change) → updateSnapshot() → evaluate()
                                    ↑
                        forceUpdate() from onPhaseChange/onPulse
```

The `forceUpdate()` is only called when governance phase changes - but the phase can't change until evaluation runs, and evaluation only runs when React re-renders due to dependency changes.

### Why Policy/Zone Data Should Be Available Immediately

The policy and zone configuration are **static** - they don't depend on participant data:

| Data | Source | Available At |
|------|--------|--------------|
| Zone names ("Active", "Cool") | `zoneConfig` | Session start |
| Zone ranks | Computed from `zoneConfig` | Session start |
| Policy requirements | `governanceConfig.policies` | Session start |
| Target zone label | Derived from above | Session start |

Only these require HR data:
- Which users meet requirements
- `satisfied` status

## Impact

1. **Visual glitch:** Users see "Target" instead of "Active" for ~2 seconds on video start
2. **Confusing UX:** Lock screen appears incomplete/broken initially
3. **Logging gap:** Cannot diagnose zone label issues from `governance.phase_change` logs

## Fix Implemented

### 1. Pre-populate requirements before HR arrives

Added logic to build requirement shell from policy even when `activeParticipants.length === 0`:

```javascript
// GovernanceEngine.js - in evaluate(), before early return
if (activeParticipants.length === 0) {
  // NEW: Pre-populate requirements from policy
  const activePolicy = this._chooseActivePolicy(0);
  if (activePolicy) {
    const prePopulatedRequirements = this._buildRequirementShell(
      activePolicy.baseRequirement || {},
      zoneRankMap || {},
      zoneInfoMap || {}
    );
    this.requirementSummary = {
      policyId: activePolicy.id,
      requirements: prePopulatedRequirements,  // ← Now has zoneLabel!
      ...
    };
  }
  // ... rest of early return
}
```

### 2. New helper method `_buildRequirementShell()`

```javascript
_buildRequirementShell(requirementMap, zoneRankMap, zoneInfoMap) {
  // Returns requirement objects with zone labels but without participant data
  return entries.map(([zoneKey, rule]) => ({
    zone: zoneId,
    zoneLabel: zoneInfo?.name || zoneId,  // ← Proper label from config
    targetZoneId: zoneId,
    satisfied: false,
    missingUsers: [],  // Empty - no participants yet
    ...
  }));
}
```

### 3. Enhanced logging

Added requirement summary to `governance.phase_change` log:

```javascript
logger.sampled('governance.phase_change', {
  from: oldPhase,
  to: newPhase,
  // NEW: Include requirement summary
  requirementCount: this.requirementSummary?.requirements?.length || 0,
  firstRequirement: firstReq ? {
    zone: firstReq.zone,
    zoneLabel: firstReq.zoneLabel,
    satisfied: firstReq.satisfied
  } : null
}, { maxPerMinute: 30 });
```

## Files Changed

- `frontend/src/hooks/fitness/GovernanceEngine.js`
  - Added `_buildRequirementShell()` method
  - Modified `evaluate()` to pre-populate requirements
  - Enhanced `_setPhase()` logging

## Testing Checklist

- [ ] Start governed video with no HR devices connected
  - Lock screen should show "Active" (or configured zone) immediately
  - Logs should show `requirementCount > 0` on `governance.phase_change`
- [ ] Start governed video with HR devices connected but no HR data yet
  - Lock screen should show proper zone label immediately
  - Should transition to unlocked when HR reaches target zone
- [ ] Verify existing behavior unchanged:
  - Grace period countdown works correctly
  - Warning → Locked transitions work
  - Challenge requirements display correctly

### Automated Test Coverage (2026-02-03)

- [x] **30ms rapid polling test** - `governance-lockscreen-monitor.runtime.test.mjs`
  - Confirms 1116ms total hydration time
  - Captures placeholder → real value transition
  - Documents exact timing deltas between phases
  - Run: `npx playwright test tests/live/flow/fitness/governance-lockscreen-monitor.runtime.test.mjs`

## Future Considerations

### Re-enabling Direct Governance Callback

The TreasureBox callback was disabled to use "stable zone state from ZoneProfileStore on tick boundaries". This introduces ~32-48ms lag from HR arrival to governance evaluation.

For time-critical scenarios (approaching grace period deadline), this lag could cause:
- Unnecessary lock when user just barely reaches zone
- UI showing stale state during rapid zone changes

Consider re-enabling direct callback with debouncing for time-critical phases (warning, approaching deadline).

## Related Documentation

- [Session Summary](../../logs/2026-02-02-session-summary.md)
- [Remediation Plan](../plans/2026-02-02-governance-lock-screen-preload-fix.md)

## Log Commands Used

```bash
# Find governance events
grep '"event":"governance\.' prod-logs-20260202-185930.txt | jq '.'

# Extract phase changes with timestamps
grep '"governance.phase_change"' prod-logs-20260202-185930.txt | jq -r '[.ts, .data.from, .data.to] | @tsv'

# Check warning_started for zone labels
grep '"governance.warning_started"' prod-logs-20260202-185930.txt | jq '.data.requirements[0]'

# Search for "Target zone" fallback (none found)
grep '"Target zone"' prod-logs-20260202-185930.txt  # No output

# Verify proper zone labels present
grep '"zoneLabel"' prod-logs-20260202-185930.txt | grep governance
# Shows: "zoneLabel":"Active", "zoneLabel":"Cool"
```

## Empirical Timing Data (2026-02-03)

### Test: 30ms Rapid Polling for Hydration Sequence

A Playwright test with 30ms polling interval captured the exact hydration sequence:

```
Test file: tests/live/flow/fitness/governance-lockscreen-monitor.runtime.test.mjs
Commit: dfedd190
```

### Captured Hydration Phases

| Timestamp | Phase | Rows | Message | Target Zone | Target HR |
|-----------|-------|------|---------|-------------|-----------|
| T+1040ms | `NO_OVERLAY` | - | - | - | - |
| T+1429ms | `HR_PRESENT_ZONES_PENDING` | 2 | "Loading unlock rules..." | **"Target zone"** (placeholder) | **60** (placeholder) |
| T+1803ms | `HR_PRESENT_ZONES_PENDING` | 3 | "Loading unlock rules..." | **"Target zone"** (placeholder) | **60** (placeholder) |
| T+2156ms | `FULLY_HYDRATED` | 3 | "Meet these conditions..." | **"Active"** (real) | **100/120/125** (real) |

### Detailed Row State at Each Phase

**T+1429ms (HR_PRESENT_ZONES_PENDING):**
```
Dad:  meta="50 / 60", currentZone="Cool", targetZone="Target zone" [HR:✓, CZ:✓, TZ:✗]
Milo: meta="50 / 60", currentZone="Cool", targetZone="Target zone" [HR:✓, CZ:✓, TZ:✗]
```

**T+2156ms (FULLY_HYDRATED):**
```
Dad:  meta="50 / 100", currentZone="Cool", targetZone="Active" [HR:✓, CZ:✓, TZ:✓]
Milo: meta="50 / 120", currentZone="Cool", targetZone="Active" [HR:✓, CZ:✓, TZ:✓]
Alan: meta="50 / 125", currentZone="Cool", targetZone="Active" [HR:✓, CZ:✓, TZ:✓]
```

### Timing Deltas

| Transition | Duration | What Changed |
|------------|----------|--------------|
| NO_OVERLAY → Rows appear | **389ms** | Lock screen visible, rows with placeholders |
| More rows appear | **+374ms** | Additional users added, still placeholders |
| **Placeholders → Real values** | **+353ms** | Target zone "Target zone" → "Active", HR 60 → 100/120/125 |
| **Total hydration time** | **~1116ms** | From first appearance to fully correct |

### Key Finding: Placeholder Values

The test confirmed that initial values are **placeholders**, not just missing:

| Field | Placeholder Value | Real Value |
|-------|-------------------|------------|
| Target zone label | "Target zone" | "Active" |
| Target HR | 60 | 100, 120, 125 (user-specific) |
| Message | "Loading unlock rules..." | "Meet these conditions to unlock playback." |

The **60 BPM** placeholder is particularly misleading because it's a valid-looking number that doesn't match any user's actual target.

### Lock Screen Lifecycle (Observed)

```
T+0      Controller ready
T+389ms  Lock screen appears with partial data:
         ├── Title: "Video Locked" ✓
         ├── Message: "Loading unlock rules..." (intermediate)
         ├── Rows: Present but with placeholders
         │   ├── Current HR: Correct (from device)
         │   ├── Target HR: 60 (WRONG - placeholder)
         │   ├── Current Zone: "Cool" ✓
         │   └── Target Zone: "Target zone" (WRONG - placeholder)
         └── Progress bar: Not shown

T+1116ms Lock screen fully hydrated:
         ├── Title: "Video Locked" ✓
         ├── Message: "Meet these conditions..." ✓
         ├── Rows: Fully populated
         │   ├── Current HR: Correct ✓
         │   ├── Target HR: User-specific (100/120/125) ✓
         │   ├── Current Zone: Correct ✓
         │   └── Target Zone: "Active" ✓
         └── Progress bar: Visible when applicable
```

### Test Code Reference

The hydration phases are detected using this logic:

```javascript
// Determine phase from DOM state
let phase;
if (emptyRow) {
  phase = 'EMPTY_WAITING';
} else if (rows.length === 0) {
  phase = 'PANEL_NO_ROWS';
} else {
  const allHydrated = rowDetails.every(r => r.fullyHydrated);
  const anyHasHR = rowDetails.some(r => r.hasValidHR);

  if (allHydrated) {
    phase = 'FULLY_HYDRATED';
  } else if (anyHasHR) {
    phase = 'HR_PRESENT_ZONES_PENDING';  // ← The problematic state
  } else {
    phase = 'ROWS_PRESENT_DATA_PENDING';
  }
}

// fullyHydrated check
const hasValidHR = meta?.match(/^(\d+)\s*\/\s*(\d+)$/) !== null;
const hasTargetZone = targetZone && targetZone !== 'Target' && targetZone !== 'Target zone';
const fullyHydrated = hasValidHR && hasCurrentZone && hasTargetZone;
```

## Resolution (2026-02-02)

### Additional Issues Identified

1. **zoneInfoMap empty on first evaluate()** - Fixed by seeding zone maps in `configure()`
2. **UI fallback chain too aggressive** - Added zoneMetadata lookup before "Target" fallback
3. **Deprecated callback confusion** - Removed unused TreasureBox callback registration
4. **Missing diagnostics** - Added logging for empty zone maps

### Files Changed (Complete Fix)

- `frontend/src/hooks/fitness/GovernanceEngine.js`
  - Seed `_latestInputs` zone maps in `configure()`
  - Remove TreasureBox callback registration
  - Add diagnostic logging for zone map state
- `frontend/src/modules/Fitness/FitnessPlayerOverlay.jsx`
  - Add zoneMetadata lookup in fallback chain
  - Capitalize raw zone ID before "Target" fallback

### Verification

- [ ] Zone maps are seeded before first evaluate() (check debug log)
- [ ] Pre-populated requirements have proper labels (check debug log)
- [ ] Lock screen shows "Active" immediately on governed video start
- [ ] No "Target" or "Target zone" fallback visible
- [ ] Existing governance behavior unchanged (grace period, challenges)
