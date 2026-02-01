# Fitness Session State Machine Audit Report
**Date**: 2026-01-31  
**Session Analyzed**: 10-minute window 6:20-6:30 PM PST (02:20-02:30 UTC)  
**Log File**: `logs/prod-logs-20260131-1820-1830.txt` (52,057 lines)  
**Build**: Commit `1ecce8a6` deployed 2026-01-31 07:57:38 PST

---

## Executive Summary

Analysis of a 10-minute production session reveals **critical state machine instability** across multiple subsystems. The session experienced **17 page reloads** in 10 minutes, **21 governance state machine resets**, and multiple unrecovered playback stalls. This document catalogs all identified bugs with log evidence and codebase references.

### Bug Severity Matrix

| Bug ID | Severity | Component | Description | User Impact |
|--------|----------|-----------|-------------|-------------|
| BUG-001 | � High | UI/SSOT | Lock screen shows wrong users initially | Confusing UX |
| BUG-002 | 🔴 Critical | Playback | Stall recovery not executing | Extended stalls |
| BUG-003 | 🟠 High | Governance | State machine thrashing | UI instability |
| BUG-004 | 🟠 High | UI | 17 page reloads in 10 minutes | Session disruption |
| BUG-005 | 🟡 Medium | Labels | SSOT failure - wrong display name | Confusing UX |
| BUG-006 | 🟡 Medium | Timers | Timer thrashing on startup | Battery/performance |

---

## BUG-001: Lock Screen Briefly Shows Wrong Users Before Correcting

### Severity: 🟠 High

### Description
When governance enters `locked` phase, the lock screen overlay briefly displays ALL users (or incorrect users) before correcting to show only the actual blocking user(s). This is an SSOT (Single Source of Truth) failure where the UI renders with stale/incomplete data before governance state fully propagates.

**Clarification**: The 60-70 second pending phase observed in logs was **correct behavior** - user "kckern" was in the cool zone (HR 81-92) which blocked unlock per governance rules. The actual bug is that the lock screen momentarily showed OTHER users (alan, felix, milo) who were NOT blocking, before correcting to show only kckern.

### Log Evidence

**Governance Correctly Identifies Only kckern as Blocker:**
```bash
grep 'lock_triggered\|warning_started' logs/prod-logs-20260131-1820-1830.txt | grep 'missingUsers'
# Shows: "missingUsers":["kckern"]  ← Only kckern listed, correct
```

**Timeline for Media 606440 (Mario Kart Wii):**
```
02:22:10.389Z governance: null → pending (media: 606440)
02:23:20.872Z governance: pending → unlocked (media: 606440)
           └── Gap: 70.5 seconds - EXPECTED (kckern in cool zone)
```

**HR Data Shows kckern Was the Blocker:**
```bash
# During pending phase:
# alan:  HR 143-147, zone "active" ✓ (not blocking)
# felix: HR 129-138, zone "active" ✓ (not blocking)
# milo:  HR 141-153, zone "warm" ✓ (not blocking)
# kckern: HR 81-92, zone "cool" ✗ (BLOCKING - correct)
```

### User Observation
User reported: "On init, the lock screen briefly showed other users before correcting to only show kckern." This indicates the UI rendered before the governance state's `missingUsers` array was fully resolved.

### Code Reference

**[frontend/src/modules/Fitness/FitnessPlayerOverlay.jsx#L628-1051](../../frontend/src/modules/Fitness/FitnessPlayerOverlay.jsx)** - `lockRows` useMemo
- Builds lock screen rows from `overlay.requirements[].missingUsers`
- Uses `participantMap` to resolve participant display data
- Race condition: `participantMap` may populate before `requirements.missingUsers` is filtered

**[frontend/src/modules/Fitness/FitnessPlayerOverlay/GovernanceStateOverlay.jsx#L180-260](../../frontend/src/modules/Fitness/FitnessPlayerOverlay/GovernanceStateOverlay.jsx)** - Lock panel rendering
- Renders `rows.map()` directly from passed `lockRows` prop
- No validation that rows match governance's authoritative `missingUsers`

### Root Cause Analysis
1. UI component renders immediately when `overlay.show` becomes true
2. `lockRows` useMemo builds rows from `participantMap` which populates before governance
3. Governance's `missingUsers` array takes longer to propagate than participant data
4. Result: lock screen shows all participants initially, then corrects when governance state arrives

### Diagnostic Logging Added
**Commit**: (pending deploy)

Added explicit logging in `FitnessPlayerOverlay.jsx` to track when blocking user lists change:
```javascript
// Log warning screen blocking user changes
useEffect(() => {
  sessionInstance.logEvent('overlay.warning_offenders_changed', {
    previousUsers, currentUsers, addedUsers, removedUsers, phase, category
  });
}, [warningOffenders]);

// Log lock screen blocking user changes  
useEffect(() => {
  sessionInstance.logEvent('overlay.lock_rows_changed', {
    previousUsers, currentUsers, addedUsers, removedUsers, phase, category
  });
}, [lockRows]);
```

### Proposed Fix
1. Add guard in `lockRows` useMemo to NOT render until `overlay.requirements` is populated
2. Or: render a "Loading..." state until governance confirms the blocking users
3. Ensure `lockRows` only includes users that are ALSO in governance's authoritative `missingUsers`

---

## BUG-002: Playback Stall Recovery Not Executing

### Severity: 🔴 Critical

### Description
Despite adding `decoder_reset` as a third recovery strategy, stalls are detected but recovery attempts never execute. Playhead remains stuck for 4-8+ seconds with no recovery events logged.

### Log Evidence

**Stall Detection Working (42 events):**
```bash
grep -c 'playback.stalled' logs/prod-logs-20260131-1820-1830.txt
# Returns: 42
```

**Stall Threshold Exceeded (5 extended stalls):**
```json
{"ts":"2026-02-01T02:23:59.125Z","event":"stall_threshold_exceeded","data":{"stallDurationMs":8215}}
{"ts":"2026-02-01T02:24:06.033Z","event":"stall_threshold_exceeded","data":{"stallDurationMs":6696}}
{"ts":"2026-02-01T02:24:14.146Z","event":"stall_threshold_exceeded","data":{"stallDurationMs":7904}}
{"ts":"2026-02-01T02:24:22.256Z","event":"stall_threshold_exceeded","data":{"stallDurationMs":7341}}
{"ts":"2026-02-01T02:24:26.587Z","event":"stall_threshold_exceeded","data":{"stallDurationMs":4130}}
```

**Recovery Never Attempted:**
```bash
grep -c 'playback.recovery_attempt\|decoder_reset' logs/prod-logs-20260131-1820-1830.txt
# Returns: 0
```

**Playhead Regression Pattern (identical to Jan 30 bug):**
```
currentTime: 6012.115
currentTime: 6012.114  # Regressed!
currentTime: 6012.113  # Regressed again!
currentTime: 6012.112  # Continues regressing
```

### Code Reference

**[frontend/src/modules/Player/hooks/usePlayheadStallDetection.js](../../frontend/src/modules/Player/hooks/usePlayheadStallDetection.js#L150-L162)**
```javascript
recoveryAttemptsRef.current = currentAttempts + 1;

// Determine strategy based on attempt number
let strategy;
if (recoveryAttemptsRef.current === 1) {
  strategy = 'pause_resume';
} else if (recoveryAttemptsRef.current === 2) {
  strategy = 'seek_nudge';
} else {
  strategy = 'decoder_reset';
}
```

### Root Cause Hypothesis
1. `usePlayheadStallDetection` hook may not be wired to the video player component
2. The stall detection interval may be getting cleared before recovery can execute
3. The `enabled` flag may be `false` when stalls occur
4. Race condition between stall detection and page reload (17 reloads in session)

### Evidence of Hook Not Active
The overlay-summary logs show stall detection occurring at the PlayerOverlayLoading level but no corresponding `playback.recovery_attempt` events, suggesting the usePlayheadStallDetection hook is either:
- Not mounted
- Not enabled
- Being unmounted by page reloads before recovery executes

---

## BUG-003: Governance State Machine Thrashing

### Severity: 🟠 High

### Description
Governance state machine exhibits excessive transitions, including 21 resets to `null` state in 10 minutes. This causes UI flicker and interrupts playback unnecessarily.

### Log Evidence

**State Machine Statistics:**
```bash
grep -c 'governance.phase_change' logs/prod-logs-20260131-1820-1830.txt
# Returns: 29 phase changes

grep -E 'governance\.phase_change.*"to":null' logs/prod-logs-20260131-1820-1830.txt | wc -l
# Returns: 21 resets to null
```

**Thrashing Example (02:26:51-02:26:54):**
```
02:26:29.745Z pending → unlocked (normal)
02:26:51.817Z pending → null     # Reset mid-session!
02:26:53.139Z null → pending     
02:26:54.305Z pending → unlocked
```

**Rapid State Changes (02:29:43-02:29:49):**
```
02:29:43.787Z pending → null
02:29:44.064Z pending → null (277ms later)
02:29:44.238Z pending → null (174ms later)
02:29:45.009Z pending → null (771ms later)
02:29:45.390Z pending → null (381ms later)
02:29:45.905Z pending → null (515ms later)
02:29:47.839Z pending → null (1934ms later)
02:29:48.215Z pending → null (376ms later)
02:29:48.563Z pending → null (348ms later)
02:29:48.715Z pending → null (152ms later)
```

### Code Reference

**[frontend/src/hooks/fitness/GovernanceEngine.js](../../frontend/src/hooks/fitness/GovernanceEngine.js#L1080-L1086)**
```javascript
// 1. Check if media is governed
if (!this.media || !this.media.id || !hasGovernanceRules) {
  if (this.phase !== null) {
    this._resetToIdle(); // This triggers null transition
  }
  return;
}
```

### Root Cause Analysis
1. `_resetToIdle()` is called when media or governance rules are temporarily unavailable
2. Page reloads (17 in 10 min) cause media to briefly become null
3. Each reload triggers `pending → null` followed by `null → pending`
4. This creates cascading state transitions that interrupt playback

---

## BUG-004: Excessive Page Reloads (17 in 10 minutes)

### Severity: 🟠 High

### Description
The fitness application mounted 17 times in a 10-minute window, indicating severe instability or intentional refresh loops.

### Log Evidence

```bash
grep 'fitness-app-mount' logs/prod-logs-20260131-1820-1830.txt | grep -o '"ts":"[^"]*"'
```

**All Mount Events:**
| # | Timestamp | Gap from Previous |
|---|-----------|-------------------|
| 1 | 02:21:01.455Z | - (initial) |
| 2 | 02:21:53.092Z | 51.6s |
| 3 | 02:26:51.818Z | 4m 58s |
| 4 | 02:28:50.822Z | 1m 59s |
| 5 | 02:29:09.579Z | 18.7s |
| 6 | 02:29:43.788Z | 34.2s |
| 7 | 02:29:44.064Z | **276ms** ⚠️ |
| 8 | 02:29:44.239Z | **175ms** ⚠️ |
| 9 | 02:29:45.010Z | **771ms** ⚠️ |
| 10 | 02:29:45.391Z | **381ms** ⚠️ |
| 11 | 02:29:45.905Z | **514ms** ⚠️ |
| 12 | 02:29:47.840Z | 1.9s |
| 13 | 02:29:48.215Z | **375ms** ⚠️ |
| 14 | 02:29:48.564Z | **349ms** ⚠️ |
| 15 | 02:29:48.715Z | **151ms** ⚠️ |
| 16 | 02:29:49.008Z | **293ms** ⚠️ |
| 17 | 02:29:49.250Z | **242ms** ⚠️ |

**⚠️ 11 reloads occurred within 6 seconds (02:29:43 - 02:29:49)**

### Root Cause Hypothesis
1. Error boundary triggering automatic reload on crash
2. Hot module replacement (HMR) instability
3. React StrictMode double-mounting in development mode leaking to prod
4. Memory pressure causing browser to kill and restart tab
5. Network instability causing manifest fetch failures

### Impact
- Each reload resets all client-side state
- Governance must re-initialize (60-70 second delay each time)
- Playback position may be lost
- User experience severely degraded

---

## BUG-005: Display Label SSOT Failure

### Severity: 🟡 Medium

### Description
The sidebar displays "KC Kern" while the governance overlay displays "Dad". The roster contains `displayLabel: "Dad"` but the sidebar ignores it.

### Log Evidence

**User Created with "KC Kern" (not "Dad"):**
```json
{"ts":"2026-02-01T02:21:01.576Z","event":"usermanager.user_created","data":{
  "configName":"KC Kern",
  "userId":"kckern",
  "userName":"KC Kern",
  "resolvedUserId":"kckern"
}}
```

**Auto-Assignment Uses "KC Kern":**
```json
{"ts":"2026-02-01T02:21:45.764Z","event":"fitness.auto_assign","data":{
  "deviceId":"40475",
  "userName":"KC Kern",
  "userId":"kckern"
}}
```

### Code Reference

**[frontend/src/modules/Fitness/FitnessSidebar/FitnessUsers.jsx](../../frontend/src/modules/Fitness/FitnessSidebar/FitnessUsers.jsx#L947)**
```javascript
const deviceName = isHeartRate ?
  (guestAssignment?.occupantName || 
   guestAssignment?.metadata?.name || 
   displayLabel ||              // ← displayLabel is 3rd priority
   ownerName ||                 // ← ownerName (cached "KC Kern") takes precedence when displayLabel is null
   participantEntry?.name || 
   deviceIdStr) 
  : (device.name || String(device.deviceId));
```

**[frontend/src/modules/Fitness/FitnessSidebar/FitnessUsers.jsx](../../frontend/src/modules/Fitness/FitnessSidebar/FitnessUsers.jsx#L909)**
```javascript
const displayLabel = userVitalsEntry?.displayLabel || participantEntry?.displayLabel || null;
```

### Root Cause Analysis

1. `displayLabel` is resolved from `userVitalsEntry?.displayLabel` or `participantEntry?.displayLabel`
2. `participantEntry` stores `profileId` (e.g., "kckern"), not `displayLabel` ("Dad")
3. When `displayLabel` resolves to `null`, fallback chain uses `ownerName`
4. `ownerName` comes from `hrDisplayNameMap[deviceIdStr]` which caches "KC Kern" from device config
5. The household config's `displayLabel: "Dad"` is never consulted

### Proposed Fix
```javascript
// Look up displayLabel from household config using profileId
const householdDisplayLabel = profileId ? 
  getHouseholdDisplayLabel(profileId) : null;

const deviceName = isHeartRate ?
  (guestAssignment?.occupantName || 
   guestAssignment?.metadata?.name || 
   householdDisplayLabel ||     // ← Use household SSOT first
   displayLabel ||              
   ownerName ||                 
   participantEntry?.name || 
   deviceIdStr) 
  : (device.name || String(device.deviceId));
```

---

## BUG-006: Timer Thrashing on Startup

### Severity: 🟡 Medium

### Description
Tick timer starts multiple times within milliseconds, indicating React component re-mounting without proper cleanup.

### Log Evidence

```bash
grep -c 'tick_timer' logs/prod-logs-20260131-1820-1830.txt
# Returns: 137 timer events
```

**Rapid Timer Starts (02:20:18):**
```
02:20:18.028Z tick_timer
02:20:18.028Z tick_timer   # Same millisecond!
02:20:18.950Z tick_timer   # 922ms later
02:20:19.013Z tick_timer   # 63ms later
02:20:19.690Z tick_timer   # 677ms later
```

**Another Burst (02:21:01-02:21:04):**
```
02:21:01.625Z tick_timer
02:21:01.630Z tick_timer   # 5ms later
02:21:02.052Z tick_timer   # 422ms later
02:21:02.791Z tick_timer   # 739ms later
02:21:03.775Z tick_timer   # 984ms later
02:21:04.107Z tick_timer   # 332ms later
02:21:04.761Z tick_timer   # 654ms later
```

### Impact
- Battery drain from excessive timer operations
- Memory leaks from uncleared intervals
- Potential race conditions in state management
- UI jank from competing state updates

---

## Governance State Machine Diagram

```
                    ┌─────────────────────────────────────────┐
                    │           State Transitions             │
                    └─────────────────────────────────────────┘

┌──────────┐         ┌──────────┐         ┌──────────┐         ┌──────────┐
│   null   │◄───────►│ pending  │────────►│ unlocked │────────►│ warning  │
│  (idle)  │         │(blocked) │         │ (play)   │         │ (play)   │
└──────────┘         └──────────┘         └──────────┘         └──────────┘
     ▲                    │                    │                    │
     │                    │                    │                    │
     │                    ▼                    ▼                    ▼
     │               ┌──────────┐         ┌──────────┐         ┌──────────┐
     └───────────────│  reset   │◄────────│challenge │◄────────│  locked  │
                     │ (crash)  │         │  failed  │         │ (blocked)│
                     └──────────┘         └──────────┘         └──────────┘

                    Session observed 21 resets to null state
```

---

## Summary Statistics

| Metric | Value | Normal Range | Status |
|--------|-------|--------------|--------|
| Page Reloads | 17 | 0-2 | 🔴 Critical |
| Governance Resets | 21 | 0-3 | 🔴 Critical |
| Stall Events | 42 | 0-5 | 🔴 Critical |
| Recovery Attempts | 0 | N/A | 🔴 Bug |
| Timer Events | 137 | 10-20 | 🟠 High |
| Extended Stalls (>3s) | 5 | 0 | 🔴 Critical |
| Max Stall Duration | 8.2s | <3s | 🔴 Critical |
| Pending Phase Duration | 60-70s | <5s | 🔴 Critical |

---

## Recommended Actions

### Immediate (P0)
1. **Fix stall recovery execution** - Ensure usePlayheadStallDetection hook is mounted and enabled
2. **Reduce pending phase duration** - Wait for zone config before starting governance evaluation
3. **Investigate page reload cause** - Add error boundary logging to identify crash triggers

### Short-term (P1)
4. **Add rate limiting to state transitions** - Prevent governance from resetting more than once per 5 seconds
5. **Fix SSOT label resolution** - Use household config as authoritative source for displayLabel
6. **Improve timer lifecycle** - Audit all setInterval/setTimeout for proper cleanup

### Long-term (P2)
7. **Add state machine health monitoring** - Alert on excessive transitions
8. **Implement playback session persistence** - Survive page reloads without losing position
9. **Add comprehensive integration tests** - Cover state machine edge cases

---

## Appendix: Search Commands Used

```bash
# Count page reloads
grep -c 'fitness-app-mount' logs/prod-logs-20260131-1820-1830.txt

# Count governance resets
grep -E 'governance\.phase_change.*"to":null' logs/prod-logs-20260131-1820-1830.txt | wc -l

# Find stall events
grep -c 'playback.stalled' logs/prod-logs-20260131-1820-1830.txt
grep 'stall_threshold_exceeded' logs/prod-logs-20260131-1820-1830.txt | jq .data.stallDurationMs

# Check recovery attempts
grep -c 'playback.recovery_attempt\|decoder_reset' logs/prod-logs-20260131-1820-1830.txt

# Timer analysis
grep 'tick_timer' logs/prod-logs-20260131-1820-1830.txt | grep -o '"ts":"[^"]*"' | head -20

# Zone analysis during pending
grep 'zone_resolved' logs/prod-logs-20260131-1820-1830.txt | grep '02:22' | grep -o '"accKey":"[^"]*".*"zone":{"id":"[^"]*"'
```

---

## Document History

| Date | Author | Changes |
|------|--------|---------|
| 2026-01-31 | AI Analysis | Initial state machine audit |
