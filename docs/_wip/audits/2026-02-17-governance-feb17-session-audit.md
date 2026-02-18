# Governance Feb 17 Session Audit (Follow-Up)

**Date:** 2026-02-17
**Session Under Review:** `fs_20260217171959` (prod, Feb 17 ~7:19 PM local / 01:19 UTC Feb 18)
**Media:** Mario Kart 8 (Game Cycling - Mario Kart), `plex:606442`
**Log Source:** `logs/prod-session-fs_20260217171959-full.txt` (11,913 lines, 7.2MB)
**Duration:** 01:19:59 - 01:53:12 UTC (~33 minutes)
**Prior Audit:** `2026-02-17-governance-post-fix-prod-verification.md` (Feb 15 session)

---

## Purpose

Follow-up verification of governance fixes against the Feb 17 session, which had multiple active participants (vs Feb 15's single participant). Evaluates whether the P0 ghost oscillation bug is fixed and identifies any new issues.

### Participants

| User | Active Threshold | Warm Threshold | Status |
|------|-----------------|----------------|--------|
| Alan | 125 | 150 | Active participant |
| Milo | 120 | 140 | Active participant |
| Felix | 120 | 140 | Active participant |
| Soren | 125 | 150 | Intermittent (exempt user) |
| kckern | 120 (default) | — | Background, not governed |

---

## Verdict Summary

| Fix / Issue | Feb 15 Status | Feb 17 Status | Evidence |
|-------------|--------------|---------------|----------|
| Ghost participant oscillation (P0) | **BROKEN** | **FIXED** | 46 transitions in 33min vs 31 in 85s; min gap 91ms vs 0ms |
| Video lock during pending | **WORKING** | **WORKING** | `videoState:"governance-locked"` in fitness-profile samples during locked phase |
| Video pause on governance lock | **WORKING** | **WORKING** | `playback.paused` events follow lock transitions |
| Log spam reduction | **WORKING** | **WORKING** | `build_profile.aggregated` present, 60k-66k skipped/60s |
| Transition tightness (no "Waiting" flash) | **UNABLE TO VERIFY** | **CONFIRMED WORKING** | 0 `waiting_for_participants` events |
| playObject SSoT autoplay | **UNABLE TO VERIFY** | **CONFIRMED WORKING** | `autoplay:true, videoLocked:false` — correct derivation |
| Zone boundary hysteresis | N/A (single user) | **NEW ISSUE** | 19 warning flashes in 33min from HR boundary crossing |
| Exempt user free-pass leak | N/A (single user) | **NEW BUG (FIXED)** | Exempt user inflated `metUsers`, masking non-exempt drops |
| Premature warning-phase pause | N/A | **NEW BUG** | Video paused during warning (not locked) at 01:25:50 |
| Voice memo / governance uncoordinated | N/A | **NEW BUG** | Voice memo pause not resumed after governance unlock |

---

## Section 1: P0 Fix — Ghost Oscillation Eliminated

### Feb 15 Pattern (BROKEN)
```
31 phase changes in 85 seconds
pending↔unlocked rapid flips at 0ms gaps
evaluatePath: "pulse" on every unlocked→pending transition
Empty userZoneMap causing false-negative evaluation
7 video stutter-pause cycles in 8 seconds
```

### Feb 17 Pattern (FIXED)
```
46 phase changes in 33 minutes (~1.4/min vs ~22/sec)
No pending↔unlocked rapid flips
evaluatePath breakdown: 42 snapshot (91%), 4 pulse (9%)
All transitions backed by real zone data
Minimum inter-transition gap: 91ms (all >0ms)
```

**Evidence: evaluatePath distribution**

| evaluatePath | Count | Percentage |
|-------------|-------|------------|
| `"snapshot"` | 42 | 91% |
| `"pulse"` | 4 | 9% |

All 4 pulse-path transitions are legitimate:
- Line 389: `unlocked → null` (media unload, 0 participants)
- Line 393: `null → unlocked` (media load, satisfied)
- Line 11568: `locked → unlocked` (session resume)
- Line 11742: `pending → null` (session end, 0 participants)

**Verdict:** Ghost oscillation is **definitively fixed**. Path A (`_triggerPulse`) no longer causes spurious phase flips.

---

## Section 2: Previously "Unable to Verify" — Now Confirmed

### 2A. Transition Tightness (No "Waiting for Participant Data" Flash)

**Diagnostic event:** `governance.overlay.waiting_for_participants`
**Count in Feb 17 session:** **0**

Every `governance.phase_change` that creates a lock has `lockRowCount: 1` and `activeParticipantCount: ≥1`, confirming the overlay renders with populated participant rows, never the empty "Waiting" fallback.

**Verdict:** **CONFIRMED WORKING.** The transition tightness fix eliminates the flash.

### 2B. playObject SSoT Autoplay

**Diagnostic event:** `fitness.media_start.autoplay` (line 394)

```json
{
  "mediaId": "606442",
  "autoplay": true,
  "videoLocked": false,
  "isGoverned": false,
  "governancePhase": "idle",
  "labels": ["kidsfun", "resumable", "sequential"]
}
```

`autoplay === true` while `videoLocked === false` — the autoplay decision correctly derives from `governanceState.videoLocked`. Since governance was idle (no active policy yet), `isGoverned: false` and video autoplays correctly.

**Verdict:** **CONFIRMED WORKING.** Autoplay reads `videoLocked` as SSoT.

---

## Section 3: New Issue — Zone Boundary Hysteresis

### The Problem

19 `governance.warning_started` events in 33 minutes — a warning overlay flash roughly every 1.7 minutes. Users report frequent visual disruption from the warning countdown appearing and disappearing.

### Root Cause

Alan's HR oscillates at 119-127, straddling his active threshold of 125. Milo's HR oscillates at 117-127, straddling his threshold of 120. Every time either drops 1-2 BPM below threshold, the governance engine triggers a warning. When they cross back above, the warning dismisses.

### Evidence: Zone Drop to Cool Events

| Count | User | HR Range | Phase When Dropped |
|-------|------|----------|--------------------|
| 14 | Alan | 107-124 | 11 during warning, 3 during unlocked |
| 6 | Milo | 117-119 | 4 during warning, 2 during unlocked |
| 3 | Felix | 0-119 | all during warning |
| 1 | Soren | 0 | unlocked (absent, hr:0) |

Alan accounts for 56% of all cool zone drops, with HR consistently at 122-124 — just 1-3 BPM below his 125 threshold.

### Warning-to-Unlock Cycle Timing

| Transition | Count | Avg Duration |
|------------|-------|-------------|
| unlocked → warning | 19 | — |
| warning → unlocked | 14 | 7-30s (most resolve quickly) |
| warning → locked | 5 | 30s (grace period expired) |

**Recommendation:** Add hysteresis buffer (e.g., 5 BPM) or require sustained cool zone for N seconds before triggering warning.

---

## Section 4: New Bug — Exempt User Free-Pass Leak

### The Problem

The governance "all" rule was supposed to exempt only the configured exempt user (Soren) from requirements. Instead, the exempt user's above-threshold status masked ANY single non-exempt user dropping below threshold.

### Mechanism

In `GovernanceEngine._evaluateZoneRequirement()`:

```
metUsers     = ALL participants above threshold (including exempt Soren)
requiredCount = non-exempt participant count (effectiveCount)
satisfied     = metUsers.length >= requiredCount  ← BUG
```

With 4 participants (milo, felix, alan, soren-exempt):
- `requiredCount = 3` (non-exempt: milo, felix, alan)
- If Alan drops but Soren is above: `metUsers = [milo, felix, soren] = 3 ≥ 3 = SATISFIED`
- Alan's drop silently ignored

### Evidence

At 01:35:56 Alan drops to cool (hr:107) during unlocked phase. No warning fires. Felix (hr:140) and Milo (hr:148) still above threshold. Soren (hr:159) above threshold pads `metUsers` to 3, satisfying `requiredCount:3`.

Warning doesn't fire until 01:36:32 when Milo AND Felix also drop — then `metUsers = [soren] = 1 < 3`.

### Fix Applied

`GovernanceEngine.js` lines 1594-1634 and 1912-1943: changed `satisfied` check to count only non-exempt users in the met threshold:

```javascript
// Before (buggy):
const satisfied = metUsers.length >= requiredCount;

// After (fixed):
const satisfied = nonExemptMetCount >= requiredCount;
```

Same fix applied in `buildChallengeSummary`. All 34 existing governance tests pass.

---

## Section 5: New Bug — Premature Warning-Phase Video Pause

### The Problem

Video paused at 01:25:50 during the **warning** phase (not locked). The video should only pause when `videoLocked: true` (locked or pending phase).

### Timeline

| Time | Event | Phase | videoLocked |
|------|-------|-------|-------------|
| 01:25:40.560 | unlocked → warning | warning | false |
| **01:25:50.267** | **playback.paused** | **warning** | **false** |
| 01:25:50.277 | paused-visibility: visible=true | warning | — |
| 01:26:10.561 | warning → locked | locked | true |
| 01:26:34.652 | locked → unlocked | unlocked | false |
| 01:26:34.777 | playback.resumed | unlocked | false |

**Total pause:** 44.5 seconds. But the first **20 seconds** (01:25:50 to 01:26:10) were during warning phase when video should have been playing. The pause was visible (`p=true` in overlay-summary) throughout.

### Possible Cause

The trigger at 01:25:40 was Alan going from **fire to cool** with hr:0 — a device disconnection artifact, not a real HR drop. With Alan's device dropping (hr:0), the remaining 2 active participants (milo, felix) were above threshold but `requiredCount:3` with Alan counted as non-exempt. The warning fires, but something causes `media.pause()` to fire during warning rather than waiting for locked.

**Needs further investigation:** Check if the playback pause code checks for `videoLocked` or `phase !== 'unlocked'`.

---

## Section 6: New Bug — Voice Memo / Governance Uncoordinated Pause

### The Problem

At 01:51:22, the voice memo overlay triggers `playback.paused`. Video is never resumed.

### Timeline

| Time | Event |
|------|-------|
| 01:51:22.149 | `playback.voice-memo` overlay-open-capture (autoAccept:true, fromFitnessVideoEnd:true) |
| 01:51:22.196 | `playback.paused` (currentTime: 4855.5s) |
| 01:51:22-01:51:30 | Voice memo recording + review + accept |
| 01:51:30.332 | Voice memo overlay closed |
| 01:51:30 onwards | Governance cycles through multiple warning/unlocked transitions |
| **Never** | **playback.resumed never fires** |

The voice memo pauses the video, but after the memo closes, governance is in warning or unlocked phase. Governance only resumes video on lock→unlock transitions, but it doesn't know the video was paused by the voice memo. The video stays paused for the remainder of the session.

**Root cause:** No coordination between voice memo pause and governance resume. Each system assumes it owns the video pause state independently.

---

## Section 7: Performance and Computation

### Render Thrashing

| Metric | Feb 15 | Feb 17 |
|--------|--------|--------|
| `render_thrashing` events | N/A | 444 |
| `fitness-profile-excessive-renders` | N/A | 167 |
| Peak render rate | ~36/s | 169.4/s (FitnessChart) |
| Sustained thrashing duration | ~60s | 755+ seconds |

Render thrashing is significantly worse on Feb 17, likely because 4 participants generate 4x the state changes vs 1 participant.

### ZoneProfileStore Waste

| Metric | Feb 15 | Feb 17 |
|--------|--------|--------|
| `build_profile.aggregated` skippedCount | 28,844/60s | 60,345-66,669/60s |
| Users rebuilt | 17 | 17 |
| Per-user rebuild rate | 28/s | 62-65/s |

Profile rebuild rate more than doubled with 4 active participants. All 17 household users are still rebuilt on every cycle, not just the 4 active ones.

### Playback Stalls

82 `playback.stalled` events throughout the session. These correlate with high render rates — when FitnessChart renders at 169/s, the video element loses CPU time and stalls.

---

## Section 8: Challenge System

15 challenges issued, **all completed** (0 failures). Most complete instantly (12-70ms). Two required sustained effort:

| Challenge | Duration | Zone | Result |
|-----------|----------|------|--------|
| `default_challenge_0_1771378515823` | 20.4s | warm (all) | completed |
| `default_challenge_0_1771378803675` | 27.8s | warm (all) | completed |

Challenge completion rate: 100%. No challenge failures triggered governance lock, unlike previous sessions.

---

## Section 9: Summary of Video Pause Episodes

| # | Time | Duration | Cause | Phase | Legitimate? |
|---|------|----------|-------|-------|-------------|
| 1 | 01:25:50-01:26:34 | 44.5s | Unknown (warning phase) | warning→locked→unlocked | **No** — first 20s during warning |
| 2 | 01:37:56-01:38:07 | 11s | Governance lock (grace expired) | locked→unlocked | **Yes** |
| 3 | 01:44:13-01:44:17 | 3.7s | Governance lock (grace expired) | locked→unlocked | **Yes** |
| 4 | 01:51:22-end | ~1:50+ | Voice memo triggered | unlocked (voice memo) | **Bug** — never resumed |

Plus 19 warning overlay flashes (no video pause, but visible countdown overlay) from zone boundary hysteresis.

**Total overlay interruptions users experienced:** 23 (4 video pauses + 19 warning flashes) in 33 minutes = ~1 every 86 seconds.

---

## Section 10: Fix Priority

### P0 (Ghost Oscillation) — RESOLVED

The ghost participant oscillation that caused 7 video stutter-pauses in 8 seconds on Feb 15 is confirmed fixed.

### P1: Exempt User Free-Pass Leak — FIXED (this session)

Changed `_evaluateZoneRequirement` and `buildChallengeSummary` to count only non-exempt users toward `satisfied`. Tests pass.

### P2: Zone Boundary Hysteresis

19 warning flashes in 33 minutes is too disruptive. Options:
1. **Hysteresis buffer:** Require HR to be ≥N BPM below threshold for M seconds before triggering warning
2. **Raise thresholds:** Alan's active=125 with HR oscillating 119-127 is too tight
3. **Warning cooldown:** After dismissing a warning, don't re-warn for N seconds

### P3: Premature Warning-Phase Pause

Video paused during warning phase at 01:25:50 (20s before locked). Investigate whether the pause code checks `videoLocked` or just `phase !== 'unlocked'`.

### P4: Voice Memo / Governance Coordination

Voice memo pause at 01:51:22 was never resumed. Need a "pause owner" concept so governance knows to resume video after voice memo closes, or voice memo resumes its own pause.

### P5: Render Thrashing / ZoneProfileStore Waste

169 renders/sec and 66k profile rebuilds/60s with 4 participants. Profile rebuilds should filter to active participants only (4 vs 17). Render rate should be throttled.

---

## Cross-References

| Document | Relationship |
|----------|-------------|
| `2026-02-17-governance-post-fix-prod-verification.md` | Previous audit (Feb 15 session) |
| `2026-02-16-governance-ghost-participant-oscillation.md` | Ghost oscillation root cause (now fixed) |
| `frontend/src/hooks/fitness/GovernanceEngine.js:1594` | Exempt user fix location |
| `frontend/src/hooks/fitness/GovernanceEngine.js:1912` | Challenge summary fix location |
| `tests/unit/governance/GovernanceEngine.test.mjs` | 34 tests passing after fix |
