# Governance SSoT Regression Audit

**Date:** 2026-02-14
**Session:** 2026-02-15 03:21-03:43 UTC (Mario Kart 8, mediaId `606442`)
**Log:** `logs/prod-logs-20260214-195730-full.txt` (51,978 lines)
**Primary file:** `frontend/src/hooks/fitness/GovernanceEngine.js`

## Context

A series of SSoT (Single Source of Truth) refactors were made to the governance system on Feb 13-14, including:
- `0bcc485e` -- exemption SSoT + stale playhead fix
- `e825a90a` -- unify SSoT for zone, HR, governance
- `45857f08` -- governance display SSoT (massive 4400-line refactor)
- `942ed689` -- videoLocked SSoT fix
- `c885e79c` -- governance UI engine hooks + sim panel

These refactors simplified the codebase significantly but introduced several governance rule-processing regressions observed during the Feb 14 fitness session.

---

## Issue 1: Challenge Failure Bypasses Warning Grace Period

**Severity:** Critical
**Status:** Active regression

### Observed Behavior

At 03:36:48 UTC, the system transitioned directly from `unlocked` to `locked`, **skipping the warning phase entirely**, because a challenge failed. At the moment of lock, all 5 participants were in the "Active" zone or above -- the base governance requirement was fully satisfied (`satisfied: true`).

### Log Evidence

```
L16955 03:34:24.707Z  challenge.started  zone:warm  selectionLabel:"all warm"  requiredCount:4  timeLimitSeconds:60
L19260 03:36:48.736Z  challenge.failed   zone:warm  requiredCount:4  actualCount:3  missingUsers:["milo"]
L19261 03:36:48.736Z  phase_change       from:unlocked  to:locked  firstRequirement:{zone:"active", satisfied:true}
L19262 03:36:48.736Z  lock_triggered     reason:challenge_failed  participantStates:
                      felix:warm(HR146) milo:active(HR124) kckern:warm(HR124) alan:warm(HR156) soren:active(HR126)
                      challengeActive:true
```

Milo was in "Active" zone (HR 124), satisfying the base governance rule but not the challenge's "Warm" requirement. The challenge's stricter threshold caused a hard lock even though governance base rules were fully met.

### Root Cause

In `GovernanceEngine.evaluate()` (line 1394):
```javascript
if (challengeForcesRed) {
  // ... immediately sets phase to 'locked'
}
```

The `challengeForcesRed` flag (`activeChallenge.status === 'failed'`) takes absolute priority over `allSatisfied`. There is no check whether base governance requirements are met before locking. The design intent was that challenges are *supplemental* to base requirements, but the current code treats challenge failure as unconditionally equivalent to governance failure.

### Expected Behavior

When a challenge fails:
1. If base governance requirements ARE satisfied: enter warning phase with grace period, do NOT lock
2. If base governance requirements are NOT satisfied: lock (current behavior is correct here)
3. Challenge failure should never bypass the warning grace period when the base threshold is met

### Fix Location

`GovernanceEngine.js:1394-1399` -- The `challengeForcesRed` block should be gated on `!allSatisfied`.

---

## Issue 2: Warning Phase Runs Concurrently with Active Challenge

**Severity:** High
**Status:** Active regression

### Observed Behavior

At 03:34:33 UTC, a warning phase started while a challenge was still active (started at 03:34:24). The warning evaluated participants against the base "Active" zone requirement while the challenge simultaneously evaluated against the "Warm" zone. After 30 seconds, the warning expired and locked the screen with `challengeActive: true`.

### Log Evidence

```
L16955 03:34:24.707Z  challenge.started    zone:warm  requiredCount:4  timeLimitSeconds:60
L17054 03:34:33.687Z  phase_change         from:unlocked to:warning  deadline:1771126503687
                      firstRequirement:{zone:"active", satisfied:false}
L17055 03:34:33.687Z  warning_started      participantsBelowThreshold:[{name:"kckern", zone:"active"}]
                      requirements:[{zone:"active", requiredCount:4, actualCount:3, missingUsers:["kckern"]}]
L18023 03:35:14.762Z  lock_triggered       reason:requirements_not_met  challengeActive:true
```

### Root Cause

The governance evaluation loop runs both base requirement checks and challenge checks independently. When base requirements become unsatisfied (kckern dropped below Active), the warning timer starts. But the challenge system doesn't know the warning has started, so it continues running. The two systems race: the warning's 30-second grace period expired first, locking the screen even though the challenge still had time remaining.

### Expected Behavior

The warning system should completely supersede and pause any active challenge. When warning phase activates:
1. Pause the active challenge timer
2. Show only the base governance requirement on the lock screen
3. The challenge should resume only after base requirements are re-satisfied

### Fix Location

`GovernanceEngine.js` -- The `_evaluateChallenges()` method should check for warning phase and auto-pause. The `_setPhase('warning')` path should explicitly pause any active challenge.

---

## Issue 3: False Offender Chips on Lock Screen

**Severity:** High
**Status:** Active regression

### Observed Behavior

Users who were in a satisfying zone (Active or above) appeared as "missing" / "offending" on the lock screen warning bar. The `participantsBelowThreshold` arrays contained users whose logged zone matched the target zone.

### Log Evidence

Multiple `warning_started` events list users in the target zone as "below threshold":

```
L17055 03:34:33.687Z  warning_started  participantsBelowThreshold:[{name:"kckern", zone:"active", required:4}]
```

kckern's zone is logged as "active" -- the same zone that is required. Yet they appear in `participantsBelowThreshold`.

More critically, at 03:36:48 when the challenge failed, the lock screen showed Milo as missing for the "Warm" challenge, but the base requirement ("Active") was `satisfied: true`. This suggests the `lockRows` displayed on screen are **merging challenge requirements with base requirements**, causing users who satisfy the base requirement but not the challenge to appear as offenders.

### Root Cause

In `_composeState()` (line 1077-1102), the `combinedRequirements` array merges unsatisfied base requirements with challenge requirements:

```javascript
const combinedRequirements = (() => {
  const list = [...unsatisfied];  // base requirements that are NOT satisfied
  if (challengeSnapshot && (challengeSnapshot.status === 'pending' || challengeSnapshot.status === 'failed')) {
    // challenge requirement is PREPENDED to the list
    list.unshift(challengeRequirement);
  }
  return list;
})();
```

This merged list is then passed to `normalizeRequirements()` which deduplicates by keeping the **strictest** requirement per participant. So if a user is "missing" from the challenge's Warm zone but "met" for the base Active zone, they still show as an offender because the challenge requirement is stricter.

The `participantsBelowThreshold` logging issue (line 700-712) iterates `requirementSummary.requirements` which includes the pre-evaluation snapshot. At the moment of evaluation, the zone map is being updated concurrently, so the logged zone may reflect the new state while the evaluation used the old state.

### Fix Location

1. `GovernanceEngine.js:1077-1102` -- `combinedRequirements` should NOT merge challenge and base requirements. They should be separate arrays. The lock screen should show base requirements when in warning/locked-from-warning state, and challenge requirements only when locked from challenge failure.
2. `GovernanceEngine.js:700-712` -- `_getParticipantsBelowThreshold()` should use the current `userZoneMap` not the stale one.

---

## Issue 4: Health Meter Multi-Tick Jumps

**Severity:** Medium
**Status:** Active regression

### Observed Behavior

The health bar (grace period countdown) sometimes removes multiple ticks at once instead of one tick per update.

### Log Evidence

Phase transition timeline shows the grace period is consistently 30 seconds:

```
03:31:22.836  unlocked -> warning
03:31:52.836   warning -> locked     +30.0s
03:34:42.985  unlocked -> warning
03:35:14.762   warning -> locked     +31.8s
03:40:04.918  unlocked -> warning
03:40:36.704   warning -> locked     +31.8s
03:41:19.234  unlocked -> warning
03:41:49.241   warning -> locked     +30.0s
```

The grace period itself works correctly (30s as configured). The multi-tick visual issue is in the frontend rendering, not the engine logic.

### Root Cause

Two contributing factors:

1. **Render thrashing**: 477 `render_thrashing` events logged. Components re-rendered 71-220 times per second for 5+ minutes sustained. The `_invalidateStateCache()` method (introduced in `c885e79c`) calls `onStateChange` on every `_stateVersion++`, triggering React re-renders. Combined with the 200ms cache throttle (`_stateCacheThrottleMs`), the countdown value can change by 2+ seconds between cache refreshes under heavy render load.

2. **State cache throttling**: `_getCachedState()` returns a cached state for 200ms. During that window, the countdown timer continues. When the cache finally refreshes, the `countdownSecondsRemaining` jumps by however many seconds elapsed during the throttle window. Under normal load this is <1 second, but under render thrashing the effective refresh rate drops.

### Fix Location

The frontend countdown component should compute remaining seconds from the `deadline` timestamp directly (`Math.max(0, Math.ceil((deadline - Date.now()) / 1000))`) rather than relying on the cached `countdownSecondsRemaining` value. The `deadline` field is already exposed in the state object (line 1158).

---

## Issue 5: Overlay Spinner False Positive Flashing

**Severity:** Medium
**Status:** Partially understood

### Observed Behavior

The player overlay spinner appeared to flash open and disappear periodically during normal playback.

### Log Evidence

**47 `playback.stalled` events** fired during the session. However, the overlay correctly stayed hidden (`vis:n/a/0ms`) for all of them. The stall durations ranged from 1200ms to 2606ms -- these are micro-stutters from CPU pressure, not real stalls.

The overlay actually became visible during **pause** states (governance lock/unlock transitions):

```
03:31:52 - 03:32:23  vis:30303ms  status:paused  (governance lock)
03:35:14 - 03:37:06  vis:17519ms  status:paused  (governance lock)
03:40:31 - 03:40:38  vis:7618ms   status:paused  (governance lock)
```

The "flashing" was likely caused by rapid phase transitions. The timeline shows several very rapid cycles:

```
03:38:03.883  unlocked -> warning
03:38:05.718   warning -> unlocked     +1.8s    << VERY RAPID
03:32:29.681  unlocked -> warning
03:32:44.981   warning -> unlocked     +15.3s
03:32:49.466  unlocked -> warning       +4.5s   << RAPID RE-ENTRY
03:32:54.991   warning -> unlocked      +5.5s
```

### Root Cause

1. **Stall threshold too low**: The 1200ms stall detection threshold triggers on normal `timeupdate` jitter under CPU pressure from render thrashing (304 thrashing events, 71-220 renders/sec for 5+ minutes).

2. **Rapid governance transitions**: The 500ms hysteresis (`_hysteresisMs`) is insufficient to prevent rapid warning-unlocked cycling when HR hovers around the zone boundary. The 1.8-second warning at 03:38:05 shows the system flipping states almost immediately.

3. **No `playback.recovered` events**: Zero recovery events were logged, meaning the stall/recovery lifecycle is not completing properly.

### Fix Location

1. Increase stall detection threshold from 1200ms to 2500-3000ms
2. Consider increasing governance hysteresis from 500ms to 1000-2000ms for the warning-to-unlocked direction
3. Investigate why `playback.recovered` is never emitted

---

## Issue 6: Cover Mismatch

**Severity:** Low
**Status:** Not reproducible from logs

### Investigation

No log entries matching "cover", "mismatch", "thumbnail", "poster", or "artwork" were found in the session logs. This issue either:
- Occurred on a different device/session not captured in this log
- Is a visual issue not instrumented for logging
- Was observed but not logged by the current telemetry

### Errors Found (Unrelated)

The logs do contain backend errors from the health API (`YamlHealthDatastore` -- "Cannot read properties of undefined (reading 'read')") and a `nowDate is not defined` reference error in `health.mjs:54`. These are pre-existing bugs unrelated to the fitness session but noted for tracking.

---

## Issue 7: Ghost Participant and Zero-Participant Warnings

**Severity:** Medium
**Status:** Active bug

### Observed Behavior

At 03:42:23, a lock was triggered with a single participant "Eli" who had no prior zone change or join events in the log. Earlier at 03:41:53, a warning started with `participantCount: 0` but `requiredCount: 1`, listing "kckern" as missing despite no active participants.

### Log Evidence

```
L27298 03:41:53.741Z  warning_started  participantCount:0  requirements:[{requiredCount:1, missingUsers:["kckern"]}]
L29085 03:42:23.741Z  lock_triggered   participantStates:[{id:"eli", name:"Eli", zone:"cool", hr:81}]
```

### Root Cause

The roster is shrinking as participants disconnect, but governance continues enforcing rules against stale roster data. The `_normalizeRequiredCount()` method anchors to `effectiveCount` from the roster, but the roster may contain entries that have already disconnected. "Eli" appears to be an alias or secondary profile for a participant whose primary profile was already removed.

### Fix Location

`GovernanceEngine.evaluate()` should filter the roster for truly active participants (checking connection status or heartbeat recency) before computing requirements.

---

## Phase Transition Timeline (Complete)

```
03:31:22  unlocked -> warning
03:31:52   warning -> locked          +30.0s
03:32:23    locked -> unlocked        +30.3s
03:32:29  unlocked -> warning          +6.5s
03:32:44   warning -> unlocked        +15.3s
03:32:49  unlocked -> warning          +4.5s   << rapid re-entry
03:32:54   warning -> unlocked         +5.5s
03:34:33  unlocked -> warning         +98.7s
03:34:39   warning -> unlocked         +5.5s
03:34:42  unlocked -> warning          +3.8s
03:35:14   warning -> locked          +31.8s
03:36:01    locked -> unlocked        +46.7s
03:36:48  unlocked -> locked          +47.2s   *** SKIP WARNING (challenge fail) ***
03:37:06    locked -> unlocked        +18.1s
03:38:03  unlocked -> warning         +57.0s
03:38:05   warning -> unlocked         +1.8s   << very rapid
03:39:06  unlocked -> warning         +61.1s
03:39:24   warning -> unlocked        +17.6s
03:39:29  unlocked -> warning          +5.0s
03:39:39   warning -> unlocked        +10.4s
03:40:04  unlocked -> warning         +25.1s
03:40:36   warning -> locked          +31.8s
03:41:14    locked -> unlocked        +38.0s
03:41:19  unlocked -> warning          +4.5s
03:41:49   warning -> locked          +30.0s
03:41:53    locked -> pending          +4.3s
03:41:53   pending -> warning          +0.2s   << very rapid
03:42:23   warning -> locked          +30.0s
03:43:42    locked -> pending         +78.9s
```

---

## Challenge History

| Time | Zone | Label | Required | Result | Duration |
|------|------|-------|----------|--------|----------|
| 03:26:26 | warm | some warm | 2 | completed | instant |
| 03:28:11 | hot | 1 hot | 1 | completed | 15ms |
| 03:29:15 | hot | some hotssh | 2 | completed | 25.6s |
| 03:31:18 | warm | some warm | 2 | completed | instant |
| 03:34:24 | warm | all warm | 4 | **FAILED** | 144s (expired) |
| 03:38:10 | warm | some warm | 2 | completed | instant |

---

## Render Thrashing Summary

- **477 `render_thrashing` events** across 4 components
- **Peak rates**: 220 renders/sec (FitnessPlayerOverlay)
- **Sustained duration**: 5+ minutes continuous
- **Impact**: CPU starvation causing video decode stutters, stale state, and false stall detection
- **Root cause**: `_invalidateStateCache()` fires `onStateChange` callback on every `_stateVersion++` (introduced in commit `c885e79c`), creating a feedback loop where state changes trigger re-renders which trigger more state changes

---

## Recommendations (Priority Order)

1. **Fix challenge-failure lock priority** (Issue 1): Gate `challengeForcesRed` on `!allSatisfied` so base governance requirements take precedence
2. **Separate challenge and warning states** (Issue 2): Warning phase should pause active challenges; challenge requirements should not merge with base requirements in `lockRows`
3. **Fix offender chip derivation** (Issue 3): Display only base-requirement offenders during warning/lock; challenge offenders only during challenge-failure lock
4. **Compute countdown from deadline** (Issue 4): Frontend should derive remaining seconds from `deadline` timestamp, not cached `countdownSecondsRemaining`
5. **Increase stall threshold** (Issue 5): Raise from 1200ms to 2500ms+ to eliminate false positives under CPU pressure
6. **Increase governance hysteresis** (Issue 5): Consider 1000-2000ms for warning-to-unlocked direction to prevent rapid phase cycling
7. **Throttle `_invalidateStateCache`** (Render thrashing): Debounce or batch `onStateChange` callbacks to prevent render storms

---

## Git History Context

30 commits touched GovernanceEngine.js recently. The Feb 13 SSoT refactors (`0bcc485e`, `e825a90a`, `45857f08`) were followed by 4+ immediate fix-up commits, indicating the refactors introduced regressions. The core issue is that the refactors correctly consolidated **data sources** (zone, HR, display) but inadvertently changed **rule priority logic** -- specifically, how challenge failures interact with base governance requirements and warning states.
