# Governance Comprehensive Code Audit — 2026-02-18

> Scope: Full audit of GovernanceEngine, FitnessContext, FitnessSession, FitnessPlayer, ZoneProfileStore, UserManager, and DeviceManager against reference docs (`governance-history.md`, `governance-system-architecture.md`, `governance-engine.md`). Cross-referenced with all prior audits in `docs/_wip/audits/`.

---

## Executive Summary

The governance system has stabilized significantly since the ghost oscillation crisis (Era 9, Feb 14-17). Core mechanisms — evalContext pattern, exemption handling, videoLocked formula, challenge pausing, warning cooldown, ghost filtering order — are correctly implemented.

| Severity | Open | Fixed/Already Fixed | Total |
|----------|------|---------------------|-------|
| P0 (Critical) | 0 | 2 (CF1, CF2 already fixed) | 2 |
| P1 (High) | 0 | 2 (N1 fixed, CF3 already fixed) | 2 |
| P2 (Medium) | 3 (CF4, CF5, CF6) | 2 (N2, CF7 fixed) | 5 |
| P3+ (Low) | 6 (N3, N5, N6, CF8, CF9, CF10) | 1 (N4 fixed) | 7 |

---

## New Findings

### N1. Path B `userZoneMap` allows `null` zones, bypassing ghost filter [P1]

**Files:**
- `frontend/src/hooks/fitness/FitnessSession.js:1559-1565` (Path B)
- `frontend/src/hooks/fitness/GovernanceEngine.js:1234-1248` (Path A)

**Status:** FIXED — Path B now guards with `if (userId && zoneId)` and lowercases zones, matching Path A exactly.

---

### N2. FullscreenVitalsOverlay has local zone fallback [P2]

**File:** `frontend/src/modules/Fitness/FitnessPlayerOverlay/FullscreenVitalsOverlay.jsx:39-79`

The `resolveUserZone()` function has a fallback path that re-derives zone from raw `device.heartRate` by iterating over zone thresholds and user config overrides (lines 60-73). This bypasses ZoneProfileStore's hysteresis, cooldown, and dead-zone handling.

**Impact:** The primary path reads from context (ZoneProfileStore data). The fallback only triggers when `userCurrentZones` is missing or returns a non-canonical zone. Low probability but creates a secondary zone-resolution code path that could diverge from the SSoT.

---

### N3. UserManager regex discrepancy in name-derived userId [P3]

**File:** `frontend/src/hooks/fitness/UserManager.js:289`

UserManager uses `\\s+` (double-escaped — matches literal backslash-s, not whitespace) while the User constructor at line 11 uses `\s+` (actual whitespace regex). If a user is registered without an explicit `id` or `profileId`, the name fallback would produce different keys in each location.

**Impact:** Only affects users without explicit IDs, which triggers a warning log. If all users in the fitness config have explicit IDs (the intended configuration), this is harmless.

---

### N4. `_setPhase()` logging reads stale `activeParticipants` count [P3]

**File:** `frontend/src/hooks/fitness/GovernanceEngine.js:669, 683`

**Status:** FIXED — `activeParticipants` added to `evalContext` at line 1333; `_setPhase` logging now prefers `evalContext?.activeParticipants?.length` with fallback.

---

### N5. Zone change logging triggers re-evaluation echo [P3]

**File:** `frontend/src/hooks/fitness/GovernanceEngine.js:315, 428, 1527`

`_logZoneChanges()` is called inside `_captureLatestInputs()` at the end of `evaluate()`. It calls `notifyZoneChange()`, which schedules a debounced `evaluate()` 100ms later. Every evaluation that detects zone changes triggers another evaluation.

**Impact:** Performance waste (double evaluation). Not a correctness bug since the second evaluation sees the same data. But with 4+ participants changing zones simultaneously, this could compound.

---

### N6. Phase transitions to `locked` don't clear challenge timer [P3]

**File:** `frontend/src/hooks/fitness/GovernanceEngine.js:1464, 1490-1517`

When transitioning to `locked` from failed-challenge or grace-period paths, only `timers.governance` is cleared — not `timers.challenge`. The stale challenge timer will fire `_triggerPulse()` during locked phase. This is handled (challenge pausing logic at lines 2013-2020) but is unnecessary timer activity.

---

## Carried Forward from Prior Audits

### CF1. `_getParticipantsBelowThreshold()` always returns `[]` [P0]

**Source:** 2026-02-17-governance-warning-observability-audit.md
**File:** `GovernanceEngine.js:713-734`
**Status:** ALREADY FIXED — Code review confirms `_getParticipantsBelowThreshold()` uses `evalContext?.userZoneMap` (line 716) and is called with `evalContext` from `_setPhase()` (line 677). The `requirementSummary` is populated (line 1450) before `_setPhase` calls, so `missingUsers` arrays are available.

### CF2. `_getParticipantStates()` reads stale data [P0]

**Source:** 2026-02-17-governance-warning-observability-audit.md
**File:** `GovernanceEngine.js:739-749`
**Status:** ALREADY FIXED — `_getParticipantStates()` uses `evalContext?.userZoneMap` (line 766) and `evalContext?.zoneInfoMap` (line 767). Called with `evalContext` from `_setPhase()` (line 696).

### CF3. Missing per-user thresholds/deltas in warning logs [P1]

**Source:** 2026-02-17-governance-warning-observability-audit.md
**Status:** ALREADY FIXED — `_getParticipantsBelowThreshold()` already includes `hr` (line 731), `threshold` (line 734-742), and `delta` (line 745) in its output. Per-user zone thresholds are read from ZoneProfileStore.

### CF4. Challenge failure bypasses warning grace period [P2]

**Source:** 2026-02-14-governance-ssot-regression-audit.md
**File:** `GovernanceEngine.js:1394-1399`
**Status:** OPEN — `challengeForcesRed` locks even when base requirements are satisfied. Should enter warning first.

### CF5. Warning runs concurrently with active challenge [P2]

**Source:** 2026-02-14-governance-ssot-regression-audit.md
**Status:** OPEN — Warning and challenge timers race. Warning's 30s grace period can expire before the challenge finishes.

### CF6. False offender chips on lock screen [P2]

**Source:** 2026-02-14-governance-ssot-regression-audit.md
**File:** `GovernanceEngine.js:1077-1102`
**Status:** OPEN — `combinedRequirements` merges challenge and base requirements, showing users who meet base requirements as offenders.

### CF7. Zone boundary warning spam (threshold calibration) [P2]

**Source:** 2026-02-17-governance-feb17-session-audit.md
**Status:** FIXED — Alan's `active` threshold lowered from 125→118, Milo's from 120→112 in their profile.yml files.

### CF8. Premature warning-phase video pause [P3]

**Source:** 2026-02-17-governance-feb17-session-audit.md
**Status:** OPEN — Video paused during `warning` phase (should only pause during `locked`/`pending`).

### CF9. Voice memo / governance coordination [P4]

**Source:** 2026-02-17-governance-feb17-session-audit.md
**Status:** OPEN — Voice memo pauses video; governance never resumes it. No "pause owner" concept.

### CF10. Render thrashing at scale [P5]

**Source:** 2026-02-17-governance-feb17-session-audit.md
**Status:** OPEN — 169 renders/sec with 4 participants. ZoneProfileStore rebuilds profiles for all 17 household users, not just 4 active. `syncFromUsers` signature includes `progress` (a float), so any HR fluctuation within a zone triggers downstream change detection.

---

## Verified Clean Areas

These areas were audited and found correctly implemented:

| Area | Status | Detail |
|------|--------|--------|
| `version` in React dependency array | **PASS** | `FitnessContext.jsx:2018` includes `version` |
| `batchedForceUpdate` for callbacks | **PASS** | All high-frequency paths batched; raw `forceUpdate` only for user actions |
| `evalContext` in `_setPhase()` callers | **PASS** | All callers within `evaluate()` pass `evalContext` |
| Ghost filter ordering | **PASS** | ZoneProfileStore population at :1293-1306 runs before ghost filter at :1308-1321 |
| `videoLocked` formula | **PASS** | Matches docs: `(challengeState?.videoLocked \|\| _mediaIsGoverned()) && phase !== 'unlocked' && phase !== 'warning'` at both :1194 and :270 |
| Exemption handling | **PASS** | `nonExemptMetCount` tracks only non-exempt users. `requiredCount` reduces denominator for exemptions. Consistent across base and challenge requirements |
| Challenge timer pausing | **PASS** | Challenges pause during non-unlocked phases (:2012-2021), resume correctly (:2023-2030) |
| Warning cooldown | **PASS** | Set on warning/locked→unlocked transition (:636-641), checked before warning re-entry (:1482), cleared on reset |
| No re-introduced mechanisms | **PASS** | `_hysteresisMs` > 500, `_relockGraceMs`, `_lastUnlockTime` all absent |
| HR=0 handling | **PASS** | UserManager early-returns, preserves last known zone |
| Empty zoneRankMap protection | **PASS** | Five defense layers; empty map → requirements evaluate as unsatisfied |
| Session lifecycle cleanup | **PASS** | All timers cleared in reset/destroy chain |
| Countdown display | **PASS** | Notch-gated rAF, no global heartbeat |
| FitnessPlayer SSoT | **PASS** | `governanceState.videoLocked` is sole lock authority; no local label check |
| pauseDecision arbiter | **PASS** | Reads `governanceState.videoLocked` only |
| autoplay derivation | **PASS** | `canAutoplay = !governanceState?.videoLocked` |
| ZoneProfileStore hysteresis | **PASS** | 5s cooldown, 3s stability, instant first transition — matches docs |
| WebSocket → governance chain | **PASS** | Dual path (fast 100ms debounce + render-cycle updateSnapshot) both verified |

---

## Priority Action Matrix

### Must Fix (production correctness)

| # | Issue | Fix Effort | Risk if Unfixed |
|---|-------|------------|-----------------|
| CF1 | `_getParticipantsBelowThreshold()` stale data | Small (pass evalContext) | Warning logs always show `[]` — impossible to diagnose threshold issues |
| CF2 | `_getParticipantStates()` stale data | Small (pass evalContext) | Lock events show previous-evaluation states |
| N1 | Path B null zones bypass ghost filter | Small (add guard) | Users without zone data pass ghost filter, potentially causing false warnings |

### Should Fix (operational quality)

| # | Issue | Fix Effort | Risk if Unfixed |
|---|-------|------------|-----------------|
| CF3 | Missing per-user thresholds in warning logs | Small (enrich log) | Threshold calibration problems invisible in production logs |
| CF7 | Threshold calibration (config) | Trivial (YAML change) | 19 false warnings per 33-min session for Alan |

### Consider Fixing

| # | Issue | Fix Effort | Risk if Unfixed |
|---|-------|------------|-----------------|
| CF4 | Challenge bypasses warning grace | Medium (state machine redesign) | Abrupt lock without warning countdown |
| CF5 | Warning/challenge timer race | Medium (coordination redesign) | Warning can expire while challenge still has time |
| CF6 | False offender chips | Small (separate requirements) | Lock screen shows wrong offenders |
| N2 | FullscreenVitalsOverlay zone fallback | Small (remove fallback) | Zone display could diverge from SSoT |
| CF10 | Render thrashing at scale | Medium (scope ZoneProfileStore to active) | 169 renders/sec with 4 participants, worsens with more |

### Low Priority

| # | Issue | Notes |
|---|-------|-------|
| N3 | UserManager regex discrepancy | Only affects users without explicit IDs |
| N4 | Stale participant count in phase logs | Diagnostic inaccuracy only |
| N5 | Re-evaluation echo from zone logging | Performance waste, not correctness |
| N6 | Challenge timer not cleared on lock | Handled by pause logic |
| CF8 | Warning-phase video pause | Needs investigation — may be related to pause arbiter |
| CF9 | Voice memo / governance coordination | Needs "pause owner" concept |

---

## Architectural Observations

### What's Working Well

1. **evalContext pattern** — Threading evaluation-cycle data through `_setPhase()` was the right fix. All callers within `evaluate()` pass it correctly.

2. **Dual evaluation paths** — The fast path (zone change → 100ms debounce → evaluate) and render path (batchedForceUpdate → updateSnapshot → evaluate) provide both responsiveness and data completeness.

3. **Five-layer zoneRankMap protection** — Seeding during configure, fallback to cached, diagnostic warning, null-rank guard, and empty-summaries guard make empty-map scenarios safely fail.

4. **Countdown architecture** — The notch-gated rAF with `deadline` timestamp is elegant. No global heartbeat, no unnecessary re-renders.

5. **batchedForceUpdate discipline** — All high-frequency paths (WS messages, governance callbacks, TreasureBox) use batched updates. Raw forceUpdate only for user-initiated actions.

### Systemic Risks

1. **Challenge/warning coordination gap** — Three related issues (CF4, CF5, CF6) stem from the same architectural problem: challenges and base governance operate as independent subsystems. This needs a unified state machine, not individual patches.

2. **Logging stale-data anti-pattern** — CF1, CF2, and N4 are all instances of the same problem: logging methods reading `this._latestInputs` during an evaluation cycle. The evalContext fix was partially applied but not to all consumers.

3. **ZoneProfileStore signature granularity** — Including `progress` (a float) in the change signature means every HR fluctuation within a zone triggers downstream change detection, contributing to CF10.

4. **No pause ownership model** — Multiple systems (governance, voice memo, resilience, user) can all pause video independently. There is no arbitration for who "owns" the current pause state, leading to CF9.
