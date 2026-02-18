# Governance Warning Observability Audit

**Date:** 2026-02-17
**Session:** `fs_20260217171959` (Feb 17 ~7:19 PM local)
**Log Source:** `logs/prod-session-fs_20260217171959-full.txt`
**Prior Audit:** `2026-02-17-governance-feb17-session-audit.md`

---

## Summary

19 `governance.warning_started` events fired in 33 minutes during a 4-participant fitness session. Initial diagnosis attributed this to "zone boundary oscillation" and implemented a `warning_cooldown_seconds` config — a symptom patch that masks the real issue.

The actual root cause is a **logging deficiency**: the `warning_started` event fails to report the data needed for diagnosis. Specifically, `participantsBelowThreshold` is always `[]` due to a stale-data bug, and no per-user zone threshold or HR-vs-threshold delta is logged. The real problem — per-user zone thresholds calibrated too close to exercising HR — is invisible from logs alone and required manual inspection of user profile YAMLs.

---

## Section 1: What the Logs Show

### All 19 Warning Events

| # | Time (UTC) | Participants | Required | Actual | Missing | Triggering User | HR | Zone Change |
|---|-----------|-------------|----------|--------|---------|-----------------|-----|-------------|
| 1 | 01:20:02 | 1 | 1 | 0 | milo | Milo | 0 | Active→Cool |
| 2 | 01:25:40 | 3 | 3 | 2 | alan | Alan | 0 | Fire→Cool |
| 3 | 01:32:11 | 3 | 3 | 2 | milo | Milo | 119 | Active→Cool |
| 4 | 01:36:32 | 4 | 3 | 1 | milo,felix,alan | Milo/Felix | 119 | Active→Cool |
| 5 | 01:37:01 | 4 | 3 | 2 | milo,alan | Alan | 124 | Active→Cool |
| 6 | 01:37:14 | 4 | 3 | 2 | milo | Soren | 171 | Hot→Fire (trigger, not cause) |
| 7 | 01:37:26 | 3 | 3 | 2 | alan | Alan | 123 | Active→Cool |
| 8 | 01:38:51 | 3 | 3 | 2 | alan | Alan | 124 | Active→Cool |
| 9 | 01:41:43 | 3 | 3 | 2 | alan | Alan | 122 | Active→Cool |
| 10 | 01:43:43 | 3 | 3 | 2 | alan | Alan | 124 | Active→Cool |
| 11 | 01:46:10 | 3 | 3 | 2 | alan | Alan | 123 | Active→Cool |
| 12 | 01:47:44 | 3 | 3 | 2 | alan | Alan | 124 | Active→Cool |
| 13 | 01:48:42 | 3 | 3 | 2 | alan | Alan | 124 | Active→Cool |
| 14 | 01:50:05 | 3 | 3 | 2 | milo | Milo | 119 | Active→Cool |
| 15 | 01:50:48 | 3 | 3 | 2 | milo | Milo | 119 | Active→Cool |
| 16 | 01:51:15 | 3 | 3 | 2 | alan | Alan | 124 | Active→Cool |
| 17 | 01:51:23 | 3 | 3 | 2 | alan | Alan | 123 | Active→Cool |
| 18 | 01:51:30 | 3 | 3 | 2 | milo | Milo | 119 | Active→Cool |
| 19 | 01:51:57 | 3 | 3 | 2 | alan | Alan | 124 | Active→Cool |

### Breakdown by Trigger

| Trigger | Count | HR Values |
|---------|-------|-----------|
| Alan HR 122-124 | 12 | 122, 123, 123, 123, 124, 124, 124, 124, 124, 124, 124, 124 |
| Milo HR 119 | 5 | 119, 119, 119, 119, 119 |
| Device disconnect (HR=0) | 2 | 0, 0 |

---

## Section 2: What the Logs Don't Show

### Bug: `participantsBelowThreshold` Is Always Empty

Every `warning_started` event has `"participantsBelowThreshold": []` — even when `missingUsers` clearly lists participants. This field is supposed to be the primary diagnostic for WHO dropped below threshold and WHY.

**Root cause:** `_getParticipantsBelowThreshold()` at `GovernanceEngine.js:713-734` reads zone data from `this._latestInputs.userZoneMap`. But `_latestInputs` is updated by `_captureLatestInputs()` at line 1498, which runs AFTER `_setPhase('warning')` at line 1471. So it reads the **previous evaluation's** zone data, when all participants were above threshold (phase was `unlocked`).

```
Execution order during evaluate():
  1. ZoneProfileStore populates userZoneMap (local var)  ← CURRENT data
  2. _evaluateZoneRequirement() → finds missingUsers      ← uses local var
  3. _setPhase('warning')                                  ← triggers log
     └─ _getParticipantsBelowThreshold()                   ← reads this._latestInputs (STALE)
  4. _captureLatestInputs({ userZoneMap })                  ← updates this._latestInputs (TOO LATE)
```

The local `userZoneMap` variable has the correct current data. `this._latestInputs.userZoneMap` has the previous evaluation's data. The logging reads the stale one.

### Missing: Per-User Zone Thresholds

The `warning_started` event logs `zone: "active"` and `missingUsers: ["alan"]` but never logs Alan's personal `active` zone threshold (125 BPM). To discover this, you must:

1. Find `data/users/alan/profile.yml`
2. Read `apps.fitness.heart_rate_zones.active: 125`
3. Cross-reference with the HR from the zone_change event (124)
4. Compute the delta manually: 124 - 125 = -1 BPM

This made the root cause invisible from logs alone.

### Missing: HR-vs-Threshold Delta

If the warning event logged `{user: "alan", hr: 124, threshold: 125, delta: -1}`, the problem would be immediately obvious: 12 of 19 warnings are from a 1-3 BPM margin. Instead, this required correlating separate events and reading external files.

---

## Section 3: The Actual Root Cause

### Per-User Zone Thresholds

From user profile YAMLs (`data/users/{id}/profile.yml`):

| User | Birth Year | `active` Threshold | Session HR Range | Gap |
|------|-----------|-------------------|-----------------|-----|
| Alan | 2021 | 125 | 121-127 | 1-3 BPM below |
| Milo | 2018 | 120 | 117-127 | 1 BPM below |
| Felix | 2018 | 120 | 119-150+ | rarely below |

Alan's active threshold of 125 sits in the middle of his natural exercising HR range (121-127). His HR crosses the boundary repeatedly during normal exercise. Milo's threshold of 120 is similarly tight at his lower end (119).

### How Per-User Thresholds Work

`UserManager.js:21` → `buildZoneConfig(globalZones, zoneOverrides)` → merges per-user `heart_rate_zones` overrides into the global zone config, replacing each zone's `min` value. For Alan:

| Zone | Global min | Override | Final min |
|------|-----------|----------|-----------|
| cool | 0 | — | 85 (inferred: 125 - 40 margin) |
| active | 100 | 125 | 125 |
| warm | 130 | 150 | 150 |
| hot | 150 | 170 | 170 |
| fire | 170 | 190 | 190 |

So HR=124 for Alan → `cool` zone (< 125). HR=125 → `active` zone (≥ 125).

### Governance Rule

From `data/household/config/fitness.yml:420`:

```yaml
base_requirement:
  - active: all
```

ALL non-exempt participants must be in the `active` zone (or above). When Alan dips to 124 (1 BPM below his personal threshold of 125), governance fires a warning for the entire session.

### Hysteresis Is Working

The ZoneProfileStore hysteresis (`HYSTERESIS_COOLDOWN_MS=5000`, `HYSTERESIS_STABILITY_MS=3000`) IS applied before governance evaluates. Governance reads from `ZoneProfileStore.getProfile().currentZoneId` (line 1265-1279), which is the hysteresis-filtered value. The dips pass through because they are sustained (10-40+ seconds), not sub-second glitches.

---

## Section 4: The Misdiagnosis

### What Was Built

A `warning_cooldown_seconds` config value (Task 1 of the remediation plan) that suppresses re-warning for N seconds after a warning dismisses. This was a **symptom patch**: it reduces warning frequency but doesn't fix why warnings fire.

### Why It's Wrong

1. **Masks the root cause.** The real issue is threshold calibration, not warning frequency.
2. **Redundant with `grace_period_seconds`.** Both are 30-second timers. The grace period already provides a window; adding another window on top doesn't address the fundamental mismatch.
3. **Doesn't trigger on the common path.** The cooldown only activates on `warning→unlocked` transitions. But 5 of 19 warnings escalated to `warning→locked→unlocked`, bypassing the cooldown entirely.
4. **Would have been unnecessary** if the logs had surfaced the per-user thresholds and deltas — the fix would have been adjusting Alan's `active: 125` to a value below his exercising HR floor.

### Other Changes Made (Still Valid)

| Task | Change | Status |
|------|--------|--------|
| Task 2: videoLocked during warning | Gate `challengeState.videoLocked` behind phase check | Valid fix — prevents premature pause |
| Task 3: Voice memo coordination | Check `governancePaused` before voice memo resume | Valid fix — prevents permanent pause |
| Task 4: Profile rebuild scoping | Filter `_syncZoneProfiles` to active participants | Valid perf fix — reduces rebuild volume ~4x |
| Task 5: Config + UI | Added `warning_cooldown_seconds` to admin UI | Should be reverted or reconsidered |

---

## Section 5: Required Fixes

### P0: Fix `_getParticipantsBelowThreshold()` Stale Data

**File:** `frontend/src/hooks/fitness/GovernanceEngine.js:713-734`

The method reads `this._latestInputs.userZoneMap` which is stale at the time `_setPhase` calls it. It needs access to the current evaluation's `userZoneMap`.

**Options:**
1. Pass the current `userZoneMap` to `_setPhase()` and forward to `_getParticipantsBelowThreshold()`
2. Move `_captureLatestInputs()` to BEFORE the phase-setting block
3. Store the current `userZoneMap` in a transient field before phase-setting

### P1: Log Per-User Thresholds in Warning Events

Add to `governance.warning_started` data:
- Each missing user's HR at evaluation time
- Each missing user's zone threshold (the `min` value of the required zone from their personal zone config)
- The delta (HR - threshold)

This would produce log entries like:
```json
"participantsBelowThreshold": [
  {"name": "alan", "hr": 124, "threshold": 125, "delta": -1, "zone": "cool", "requiredZone": "active"}
]
```

From this alone, the diagnosis is immediate: "Alan is 1 BPM below his threshold. Lower his threshold or adjust his profile."

### P2: Revert or Reconsider `warning_cooldown_seconds`

The `warning_cooldown_seconds` mechanism (Task 1) should be reconsidered. It adds complexity without addressing the root cause. If kept, it should be documented as a UX smoothing feature, not a fix for zone oscillation.

### P3: Threshold Calibration (Config Change)

After fixing the logging, review per-user thresholds against actual session HR data. For this session:
- **Alan:** `active: 125` → consider `active: 115` (his HR floor during exercise is ~121)
- **Milo:** `active: 120` → consider `active: 115` (his HR floor during exercise is ~117)

---

## Section 6: Lessons

1. **Broken logging led to a broken diagnosis.** The `participantsBelowThreshold` field was designed to answer "who dropped and why" but always returned `[]`. This forced manual log correlation and external file reads, which delayed finding the root cause.

2. **A missing 3 characters in the logs cost hours of investigation.** If the warning event had logged `hr: 124, threshold: 125`, the fix would have been "lower Alan's threshold" — a 1-line YAML change. Instead, 5 code changes were made.

3. **Symptom patches are attractive when observability is poor.** Without knowing the thresholds, "zone boundary oscillation" looked like a code problem requiring a code fix. With thresholds visible, it's obviously a calibration problem requiring a config fix.

---

## Cross-References

| Document | Relationship |
|----------|-------------|
| `2026-02-17-governance-feb17-session-audit.md` | Previous audit (identified 19 warnings, proposed cooldown) |
| `docs/plans/2026-02-17-governance-remediation.md` | Remediation plan (Tasks 1-6) |
| `frontend/src/hooks/fitness/GovernanceEngine.js:713-734` | `_getParticipantsBelowThreshold()` stale data bug |
| `frontend/src/hooks/fitness/GovernanceEngine.js:1498` | `_captureLatestInputs()` — called too late |
| `frontend/src/hooks/fitness/GovernanceEngine.js:666-676` | `warning_started` log event |
| `data/users/alan/profile.yml` | Alan's zone thresholds |
| `data/users/milo/profile.yml` | Milo's zone thresholds |

---

## Addendum: Second Opinion Review

**Reviewer:** Claude (independent review, Feb 17 2026)
**Scope:** Code-verified review of all claims, plus additional observations.

### Verdict

The audit is **correct on all major claims**. The stale-data bug, the missing threshold data in logs, and the misdiagnosis narrative are all verified against the source code. A few refinements and additional findings follow.

### 1. Stale Data Bug — Confirmed, With a Nuance

The execution-order analysis is exactly right. But there's a subtlety worth noting: the bug is actually *worse* than described.

`_getParticipantsBelowThreshold()` does TWO lookups:
- `this.requirementSummary.requirements` (line 714) — **current**, because `requirementSummary` is set at line 1421, BEFORE `_setPhase` at line 1488.
- `this._latestInputs.userZoneMap` (line 715) — **stale**, previous evaluation's data.

So the method gets the correct `missingUsers` list from the current `requirementSummary`, then immediately *filters them back out* at line 724 by re-checking against the stale `userZoneMap` — which still shows everyone above threshold from the previous (passing) evaluation. The result: always `[]`.

This means the method is *self-defeating*: it has the right answer in hand (`missingUsers`), then discards it by cross-referencing against stale data.

### 2. `_getParticipantStates()` Has the Same Bug

The audit focuses on `warning_started`, but `_getParticipantStates()` (line 739-749) also reads `this._latestInputs.userZoneMap` and is called during the `governance.lock_triggered` event (line 695). This means the `locked` event's `participantStates` field is ALSO stale — it shows zone states from the evaluation *before* the one that triggered the lock.

This should be added to the P0 fix scope.

### 3. Fix Recommendation

Of the three options listed in Section 5, **Option 1 (pass current `userZoneMap` to `_setPhase`)** is the safest. Option 2 (move `_captureLatestInputs` earlier) risks side effects — other code between lines 1421-1498 may depend on `_latestInputs` still holding the *previous* evaluation's data. Option 1 is surgical: it threads the current data through only for logging purposes without changing the evaluation semantics.

### 4. P2 (warning_cooldown_seconds) — Mostly Agree, Slight Nuance

The audit calls the cooldown "redundant with `grace_period_seconds`." They're not quite the same mechanism: the grace period governs the `warning→locked` transition delay, while the cooldown suppresses re-entering `warning` after an `unlocked→warning→unlocked` cycle. They operate at different edges of the state machine.

That said, the audit's core point stands: the cooldown is a symptom patch. If thresholds are calibrated correctly, the rapid `unlocked→warning→unlocked` oscillation disappears and the cooldown never fires. Keep it as a UX safety net if desired, but don't treat it as a fix.

### 5. P3 (Threshold Calibration) — Consider a Smaller Adjustment

The suggested drop from `active: 125` to `active: 115` for Alan is a 10 BPM swing. With a floor of ~121 during exercise, 115 gives a 6 BPM buffer — which might be more than needed and could make the governance requirement too easy to satisfy (Alan would need to barely move to stay in the active zone).

Consider `active: 118` instead: gives a 3 BPM buffer below his observed floor, still requires meaningful exertion, and eliminates the 1-BPM oscillation problem. Same logic for Milo — `active: 115` with a floor of ~117 gives only a 2 BPM buffer, which might still oscillate. Consider `active: 112` for a 5 BPM buffer.

### 6. Lesson the Audit Doesn't State Explicitly

**The verification filter in `_getParticipantsBelowThreshold` is an anti-pattern.** The method already receives `missingUsers` from a freshly-evaluated `requirementSummary`. Re-verifying those users against a second data source (that may be at a different point in time) creates a consistency window bug. If the method trusts `_evaluateZoneRequirement()` to compute `missingUsers` correctly — and it should, since that method uses the current local `userZoneMap` — then the re-check is defensive code that actively causes the bug. The fix should either pass fresh data for the verification OR remove the re-verification and trust the source of truth.

### Summary of Agreements and Additions

| Audit Claim | Verdict |
|-------------|---------|
| `participantsBelowThreshold` always `[]` due to stale data | **Confirmed** |
| `_captureLatestInputs` called after `_setPhase` | **Confirmed** (line 1498 vs 1488) |
| Missing per-user thresholds/deltas in logs | **Confirmed** |
| Cooldown is a symptom patch | **Agree** |
| Tasks 2-4 are valid fixes | **Agree** |
| Hysteresis is working correctly | **Agree** |
| Root cause is threshold calibration | **Agree** |
| *Additional:* `_getParticipantStates()` also reads stale data | **New finding** — same bug affects `lock_triggered` event |
| *Additional:* Threshold adjustment magnitudes | **Suggest smaller drops** (118/112 vs 115/115) |
