# Governance Post-Fix Prod Verification Audit

**Date:** 2026-02-17
**Session Under Review:** `fs_20260215212446` (prod, Feb 15 ~9:24 PM)
**Media:** Mario Kart 8 (Game Cycling - Mario Kart), `plex:606442`
**Log Source:** `logs/prod-logs-20260215-212735-last5min.txt`

---

## Purpose

Evaluate which governance fixes (from 4 implementation plans, Feb 13-14) are confirmed working, confirmed still broken, or unable to verify based on prod log evidence from the Feb 15 Mario Kart 8 session.

### Plans Evaluated

| Plan | Goal |
|------|------|
| `2026-02-13-governance-video-lock-pending-phase.md` | `videoLocked` = true when phase is pending or locked |
| `2026-02-13-governance-video-lock-and-log-fixes.md` | `media.pause()` on governance lock + log spam reduction |
| `2026-02-13-governance-transition-tightness.md` | Eliminate "Waiting for participant data" flash |
| `2026-02-14-governance-ssot-playobject-autoplay.md` | playObject reads `governanceState.videoLocked` as SSoT |

---

## Verdict Summary

| Plan | Status | Evidence |
|------|--------|----------|
| Video lock during pending phase | **CONFIRMED WORKING** | `videoState:"governance-locked"` in fitness-profile samples 2-3 |
| Video pause on governance lock | **CONFIRMED WORKING** | `playback.paused` at 05:24:59.763, immediately after pending phase |
| Log spam reduction (sampled aggregation) | **CONFIRMED WORKING** | `record_heart_rate.aggregated` and `build_profile.aggregated` events present |
| Transition tightness (no "Waiting" flash) | **UNABLE TO VERIFY** | Ghost oscillation produces different symptoms; cannot isolate |
| playObject SSoT | **UNABLE TO VERIFY** | No playObject-specific events in log; requires separate test |
| **Ghost participant oscillation** | **CONFIRMED STILL BROKEN** | 26+ phase flips in 25 seconds, 7 video pause/resume cycles |

---

## Section 1: Confirmed Working Fixes

### 1A. videoLocked During Pending Phase

**Plan:** `2026-02-13-governance-video-lock-pending-phase.md`
**Change:** Added `|| (this._mediaIsGoverned() && (this.phase === 'pending' || this.phase === 'locked'))` to `_composeState().videoLocked`

**Evidence:**

Fitness-profile sample 2 (line 197, at 05:25:13.667):
```
governancePhase: "pending"
videoState: "governance-locked"
sessionActive: true
rosterSize: 1
```

Fitness-profile sample 3 (line 238, at 05:25:43.668):
```
governancePhase: "pending"
videoState: "governance-locked"
```

Both samples show `videoState:"governance-locked"` while `governancePhase:"pending"`. Before this fix, pending phase would not have set `videoLocked`, so the video would have played freely during the pending lock phase.

**Verdict:** Fix is working correctly. The pending phase now correctly derives `videoLocked = true`.

### 1B. Video Pause on Governance Lock

**Plan:** `2026-02-13-governance-video-lock-and-log-fixes.md`
**Change:** Added `media.pause()` alongside `media.muted = true` in governance lock effect

**Evidence:**

| Time | Event | Data |
|------|-------|------|
| 05:24:56.531 | `governance.phase_change` | null → pending (mediaId 606442) |
| 05:24:59.754 | `playback.started` | Mario Kart 8, currentTime=1668.0 |
| 05:24:59.763 | `playback.paused` | currentTime=1668.0 (9ms after start) |

The video was paused within 9ms of starting, while governance was in the `pending` phase. This confirms the pause-on-lock effect is working.

**Verdict:** Fix is working. Video is correctly paused when governance locks.

**Ironic side effect:** Because this fix works, it now amplifies the ghost oscillation bug. Each spurious pending→unlocked→pending cycle triggers a real `media.pause()` / `media.play()` pair, causing visible video stuttering. Before this fix, the oscillation was invisible to the user (video kept playing). Now it's viscerally noticeable.

### 1C. Log Spam Reduction (Sampled Aggregation)

**Plan:** `2026-02-13-governance-video-lock-and-log-fixes.md`
**Change:** ZoneProfileStore `logger.warn()` → `logger.sampled()`, TreasureBox `_log` level warn → debug

**Evidence:**

Line 257 (05:25:47.149):
```json
{
  "event": "treasurebox.record_heart_rate.aggregated",
  "data": {
    "sampledCount": 5,
    "skippedCount": 228,
    "window": "60s"
  }
}
```

Line 364 (05:26:46.855):
```json
{
  "event": "zoneprofilestore.build_profile.aggregated",
  "data": {
    "sampledCount": 5,
    "skippedCount": 28844,
    "window": "60s"
  }
}
```

Without sampled aggregation, these would have been 228 + 28,844 = **29,072 individual log lines** in a 60-second window. Instead, the sampled logger emits 5 + 5 = 10 events per window, with aggregated counts.

**Verdict:** Fix is working excellently. Log volume is reduced by >99.9%.

**Hidden signal:** The aggregated counts themselves are diagnostic. 28,844 `build_profile` calls in 60 seconds = **480 profile rebuilds per second** for 17 users. This indicates the ghost oscillation is driving massive computation even though the logging itself is suppressed.

---

## Section 2: Confirmed Still Broken

### 2A. Ghost Participant Oscillation (Phase Thrashing)

**Root cause documented in:** `docs/_wip/audits/2026-02-16-governance-ghost-participant-oscillation.md`

**Evidence: Complete Phase Change Timeline**

| # | Time (05:2X:XX) | From → To | Gap | Line |
|---|-----------------|-----------|-----|------|
| 1 | 4:56.531 | null → pending | — | 162 |
| 2 | 5:48.168 | pending → unlocked | 51.6s | 270 |
| 3 | 5:48.168 | unlocked → pending | **0ms** | 271 |
| 4 | 5:48.181 | pending → unlocked | 13ms | 272 |
| 5 | 5:49.120 | unlocked → pending | 939ms | 275 |
| 6 | 5:49.136 | pending → unlocked | 16ms | 276 |
| 7 | 5:50.938 | unlocked → pending | 1.8s | 281 |
| 8 | 5:50.952 | pending → unlocked | 14ms | 282 |
| 9 | 5:53.904 | unlocked → pending | 2.95s | 290 |
| 10 | 5:53.915 | pending → unlocked | 11ms | 291 |
| 11 | 5:54.286 | unlocked → pending | 371ms | 294 |
| 12 | 5:54.305 | pending → unlocked | 19ms | 295 |
| 13 | 5:54.884 | unlocked → pending | 579ms | 299 |
| 14 | 5:54.906 | pending → unlocked | 22ms | 300 |
| 15 | 5:56.854 | unlocked → pending | 1.95s | 307 |
| 16 | 5:56.870 | pending → unlocked | 16ms | 308 |
| 17 | 5:58.820 | unlocked → pending | 1.95s | 320 |
| 18 | 5:58.831 | pending → unlocked | 11ms | 321 |
| 19 | 5:59.705 | unlocked → pending | 874ms | 324 |
| 20 | 5:59.713 | pending → unlocked | 8ms | 325 |
| 21 | 5:59.807 | unlocked → pending | 94ms | 326 |
| 22 | 5:59.814 | pending → unlocked | 7ms | 327 |
| 23 | 6:01.037 | unlocked → pending | 1.2s | 328 |
| 24 | 6:01.048 | pending → unlocked | 11ms | 329 |
| 25 | 6:01.782 | unlocked → pending | 734ms | 330 |
| 26 | 6:01.800 | pending → unlocked | 18ms | 331 |
| 27 | 6:06.813 | unlocked → pending | 5.0s | 334 |
| 28 | 6:06.814 | pending → unlocked | **1ms** | 335 |
| 29 | 6:11.814 | unlocked → pending | 5.0s | 340 |
| 30 | 6:11.815 | pending → unlocked | **1ms** | 341 |
| 31 | 6:13.865 | unlocked → pending | 2.05s | 343 |

**Pattern:** 31 phase changes in ~85 seconds. Every unlocked→pending transition is immediately followed by a pending→unlocked correction (8-22ms). The correction comes from Path B (`updateSnapshot`) which has proper zone data, but Path A (`_triggerPulse`) fires again moments later with empty `userZoneMap`, restarting the cycle.

### 2B. Video Stutter-Pausing

**Direct consequence of 2A + fix 1B working.**

| # | Time | Event | Position | Gap |
|---|------|-------|----------|-----|
| 1 | 05:24:59.763 | paused | 1668.0s | — (initial lock) |
| 2 | 05:25:48.324 | resumed | 1668.0s | 48.6s (user earned unlock) |
| 3 | 05:25:49.137 | paused | 1668.7s | 813ms |
| 4 | 05:25:49.255 | resumed | 1668.7s | 118ms pause |
| 5 | 05:25:50.954 | paused | 1670.4s | 1.7s |
| 6 | 05:25:51.067 | resumed | 1670.5s | 113ms pause |
| 7 | 05:25:53.918 | paused | 1673.3s | 2.9s |
| 8 | 05:25:54.025 | resumed | 1673.3s | 107ms pause |
| 9 | 05:25:54.307 | paused | 1673.6s | 282ms |
| 10 | 05:25:54.417 | resumed | 1673.6s | 110ms pause |
| 11 | 05:25:54.907 | paused | 1674.1s | 490ms |
| 12 | 05:25:55.016 | resumed | 1674.1s | 109ms pause |
| 13 | 05:25:56.871 | paused | 1676.0s | 1.9s |
| 14 | 05:25:56.982 | resumed | 1676.0s | 111ms pause |

7 stutter-pause cycles in 8 seconds after the initial unlock. Each pause lasts 107-118ms — long enough to be visible as a video hiccup but too short for the user to understand what happened.

After line 310 (05:25:56.982), no more playback.paused/resumed events appear even though phase oscillation continues (through line 343). This may indicate the video element was unmounted or the player stopped responding to governance state changes.

### 2C. Excessive Render Count

| Sample | Time | Elapsed | forceUpdateCount | renderCount | Rate |
|--------|------|---------|-----------------|-------------|------|
| 2 | 05:25:13.667 | 30s | 1,073 | 1,081 | 36/s |
| 3 | 05:25:43.668 | 60s | 1,784 | 1,784 | 30/s |
| 4 | 05:26:13.668 | 90s | 1,771 | 1,787 | 20/s |
| 5 | 05:26:43.668 | 120s | 22 | 22 | 0.7/s |

Sample 2 (30s mark): 1,073 force updates already, before the phase thrashing even starts. This is from the `_triggerPulse()` path firing `evaluate()` repeatedly with empty `userZoneMap` during the pending phase.

Sample 3 (60s mark): 1,784 renders. The ghost oscillation bug is driving ~700 additional renders in 30 seconds.

Sample 5 (120s mark): Only 22 renders. By this point, `rosterSize: 0`, `deviceCount: 0` — the HR device disconnected and the roster emptied. With no participants, the oscillation stops because there's nothing to oscillate.

### 2D. ZoneProfileStore Computation Waste

Line 364 (05:26:46.855):
```json
{
  "event": "zoneprofilestore.build_profile.aggregated",
  "data": {
    "skippedCount": 28844,
    "window": "60s",
    "aggregated": {
      "userId": {
        "elizabeth": 1697, "niels": 1697, "lewis": 1697,
        "marybliss": 1697, "grandpa": 1697, "grannie": 1697,
        "lila": 1697, "finn": 1697, "jin": 1697,
        "eli": 1697, "james": 1697, "josie": 1697,
        "kckern": 1696, "felix": 1696, "milo": 1696,
        "alan": 1696, "soren": 1696
      }
    }
  }
}
```

28,844 profile rebuilds in 60 seconds across 17 users = ~1,697 rebuilds per user = **28 full profile rebuilds per second per user**. Only kckern is an active participant; the other 16 users are being unnecessarily rebuilt every cycle.

---

## Section 3: Disproof of Hysteresis / Zone-Boundary Theory

An initial hypothesis was that the phase oscillation was caused by the user's HR fluctuating around the Active zone threshold (hysteresis). The log evidence conclusively disproves this.

### Evidence: Stable HR, Zero Reverse Zone Changes

**Zone changes in entire session:**

| Time | Event | From → To | HR |
|------|-------|-----------|-----|
| 05:25:46.664 | `governance.user_zone_change` | cool → active | 100 |

This is the **only** `user_zone_change` event in the entire log. There is no subsequent active→cool transition.

**HR readings after zone change (all hr=100):**

| Time | HR |
|------|----|
| 05:25:47.149 | 100 (aggregated: 228 readings in 60s, avg=89.0) |
| 05:25:47.390 | 100 |
| 05:25:47.636 | 100 |
| 05:25:47.883 | 100 |
| 05:25:48.131 | 100 |

Every individual HR reading after the zone change is exactly 100. HR is stable, solidly in the Active zone. The user's zone **never changes back to cool**.

### Yet Phase Oscillates 31 Times

Despite:
- HR stable at 100
- Zone stable in Active
- Zero reverse zone changes
- `satisfied: true` on every pending→unlocked transition

The governance engine still flips unlocked→pending 16 times. Each unlocked→pending transition shows `satisfied: false` — but this is not because the zone data changed. It's because Path A (`_triggerPulse`) calls `evaluate()` with an empty `userZoneMap`, causing the ghost participant filter to remove all participants, which makes the engine think nobody is there.

**This is a data race, not a zone boundary problem.**

---

## Section 4: Session Aftermath

After the thrashing subsides (~05:26:14), the session enters a degraded state:

| Time | Event | Significance |
|------|-------|--------------|
| 05:26:14.865 | `zone_led.grace_period.started` | LED grace period begins (30s) |
| 05:26:43.668 | fitness-profile sample 5 | rosterSize: 0, deviceCount: 0 |
| 05:26:44.870 | `zone_led.grace_period.expired` | LEDs turned off (garage_led_off) |
| 05:26:46.855 | `build_profile.aggregated` | 28,844 rebuilds in last 60s |
| 05:27:34.864 | Last tick timer event | Session winding down |

The session effectively ends with an empty roster. The HR device disconnected (deviceCount drops from 1 to 0), likely because the repeated state churn destabilized the BLE connection or the user gave up.

---

## Section 5: Interaction Effects

The working fixes interact with the broken ghost oscillation in a way that makes the UX **worse** than before the fixes:

```
Before fixes:
  Ghost oscillation → phase flips → BUT video keeps playing (no videoLocked in pending)
  → User sees: occasional lock overlay flash, but video continues
  → Annoying but tolerable

After fixes:
  Ghost oscillation → phase flips → videoLocked activates during pending (FIX 1A)
  → media.pause() fires on each lock (FIX 1B)
  → Video stutters 7 times in 8 seconds
  → User sees: video repeatedly pausing/resuming, unwatchable
  → Session-ending UX failure
```

This is a textbook case where correctly implementing downstream behavior (video lock) amplifies an upstream bug (ghost oscillation) that was previously invisible.

---

## Section 6: Recommended Fix Priority

### P0: Ghost Participant Filter Ordering (blocks all other improvements)

Move the ghost participant filter (GovernanceEngine.js lines 1241-1253) to AFTER ZoneProfileStore population (lines 1266-1280). This is the root cause of the oscillation.

Detailed fix specification in: `docs/_wip/audits/2026-02-16-governance-ghost-participant-oscillation.md`

### P1: Unify Evaluate Paths

Ensure `_triggerPulse()` and `updateSnapshot()` both provide consistent data to `evaluate()`. Currently Path A passes empty `userZoneMap` while Path B passes populated data.

### P2: Consider removing `_hysteresisMs`

The warning zone + grace period already handles marginal HR. Hysteresis adds invisible delay without user feedback and creates edge cases where satisfaction is met but the user doesn't see the unlock.

---

## Section 7: Diagnostic Logging Added

The two "unable to verify" features lacked prod-visible logging. The following events were added to enable verification on the next prod session.

### 7A. Transition Tightness — "Waiting for participant data" flash

**Problem:** No way to know from logs whether the lock overlay renders with populated rows or the empty "Waiting" fallback.

**Added events:**

1. **`governance.phase_change`** (GovernanceEngine.js) — added 4 fields:
   - `lockRowCount`: number of lock rows in composed state (-1 if unavailable)
   - `activeParticipantCount`: number of active participants at evaluation time
   - `videoLocked`: final videoLocked value from composed state
   - `evaluatePath`: `"pulse"` (from `_triggerPulse`, no args) or `"snapshot"` (from `updateSnapshot`, with args)

2. **`governance.overlay.waiting_for_participants`** (GovernanceStateOverlay.jsx) — fires when the overlay renders the "Waiting for participant data..." fallback (i.e., `hasRows === false && status === 'pending'`). Rate-limited to max 6/min.
   - `status`: governance status at render time
   - `displayRowCount`: rows from `useGovernanceDisplay`
   - `lockRowCount`: raw lockRows from props
   - `hasDisplay`: whether the display prop was present

**How to verify post-deploy:**
- Grep for `governance.overlay.waiting_for_participants` — if this event appears, the "Waiting" flash is still happening
- Check `governance.phase_change` events: if `lockRowCount: 0` while `activeParticipantCount: 1`, the participant exists but lockRows are empty (the bug)
- Check `evaluatePath`: if oscillation shows `"pulse"` for every unlocked→pending, that confirms Path A is the culprit

### 7B. playObject Autoplay SSoT

**Problem:** The `session.logEvent('media_start')` only writes to the in-memory session event log, not to the structured prod logger. No way to verify from prod logs whether autoplay decisions use `governanceState.videoLocked`.

**Added event:**

1. **`fitness.media_start.autoplay`** (FitnessPlayer.jsx) — fires once per media selection alongside `session.logEvent('media_start')`, but goes to the structured prod logger.
   - `mediaId`: content identity string
   - `autoplay`: boolean — the final autoplay decision
   - `videoLocked`: value read from `governanceState.videoLocked`
   - `isGoverned`: value read from `governanceState.isGoverned`
   - `governancePhase`: current governance status
   - `labels`: media labels array

**How to verify post-deploy:**
- Grep for `fitness.media_start.autoplay` — should appear once per video selection
- Verify `autoplay === !videoLocked` in every event (confirms SSoT derivation)
- If `autoplay === true` while `videoLocked === true`, or `autoplay === false` while `videoLocked === false` and `isGoverned === true`, that would indicate a regression

---

## Cross-References

| Document | Relationship |
|----------|-------------|
| `docs/_wip/audits/2026-02-16-governance-ghost-participant-oscillation.md` | Root cause analysis of the ghost filter ordering bug |
| `docs/_wip/audits/2026-02-15-fitness-session-log-audit.md` | Broader audit covering 8 findings including render thrashing |
| `docs/_wip/audits/2026-02-14-governance-ssot-regression-audit.md` | Earlier session issues (challenge failure bypass, false offender chips) |
| `docs/_wip/plans/2026-02-13-governance-video-lock-pending-phase.md` | Plan for videoLocked fix (confirmed working) |
| `docs/_wip/plans/2026-02-13-governance-video-lock-and-log-fixes.md` | Plan for pause + log spam fix (confirmed working) |
| `docs/_wip/plans/2026-02-13-governance-transition-tightness.md` | Plan for transition tightness (unable to verify) |
| `docs/_wip/plans/2026-02-14-governance-ssot-playobject-autoplay.md` | Plan for playObject SSoT (unable to verify) |
