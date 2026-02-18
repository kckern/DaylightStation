# Governance Engine: Bugfix & Improvement History

A chronological record of the GovernanceEngine's evolution, covering where we came from, how we got here, stubborn recurring issues, and hard-won lessons for future work.

For API reference and configuration, see `governance-engine.md`.
For event-driven architecture and SSoT boundaries, see `governance-system-architecture.md`.

---

## Table of Contents

- [Era Overview](#era-overview)
- [Chronological History](#chronological-history)
  - [Era 1: Foundation (Dec 2025)](#era-1-foundation-dec-2025)
  - [Era 2: EntityId Crisis (Jan 2-3)](#era-2-entityid-crisis-jan-2-3)
  - [Era 3: Performance Crisis (Jan 5-7)](#era-3-performance-crisis-jan-5-7)
  - [Era 4: Render Thrashing & Zone SSoT (Jan 15-19)](#era-4-render-thrashing--zone-ssot-jan-15-19)
  - [Era 5: Lock Screen Hydration (Feb 2-3)](#era-5-lock-screen-hydration-feb-2-3)
  - [Era 6: Test Infrastructure (Feb 3)](#era-6-test-infrastructure-feb-3)
  - [Era 7: SSoT Consolidation (Feb 9-13)](#era-7-ssot-consolidation-feb-9-13)
  - [Era 8: Video Lock Correctness (Feb 13-14)](#era-8-video-lock-correctness-feb-13-14)
  - [Era 9: Ghost Oscillation Saga (Feb 14-17)](#era-9-ghost-oscillation-saga-feb-14-17)
  - [Era 10: Warning Cooldown & Observability (Feb 17-18)](#era-10-warning-cooldown--observability-feb-17-18)
- [Recurring Bug Patterns](#recurring-bug-patterns)
- [Optimal Patterns vs Antipatterns](#optimal-patterns-vs-antipatterns)
- [Mechanisms Added Then Removed](#mechanisms-added-then-removed)
- [Tactics & Tips for Future Work](#tactics--tips-for-future-work)
- [Current Architecture Snapshot](#current-architecture-snapshot)
- [Commit Reference](#commit-reference)

---

## Era Overview

| Era | Dates | Theme | Key Outcome |
|-----|-------|-------|-------------|
| 1 | Dec 2025 | Foundation | GovernanceEngine created, basic phase logic |
| 2 | Jan 2-3 | EntityId crisis | 3-hour outage from identifier mismatch |
| 3 | Jan 5-7 | Performance | FPS 50->9 from CSS filters, fixed with overlay approach |
| 4 | Jan 15-19 | Render thrashing | 2,427 wasted renders/hr; zone SSoT moved to ZoneProfileStore |
| 5 | Feb 2-3 | Lock screen hydration | 1.1s "Target zone" placeholder; fixed with zone map seeding |
| 6 | Feb 3 | Test infrastructure | Playwright governance tests stabilized |
| 7 | Feb 9-13 | SSoT consolidation | 5 SSOT violations fixed; exemption logic unified |
| 8 | Feb 13-14 | Video lock correctness | `videoLocked` extended to pending/locked phases |
| 9 | Feb 14-17 | Ghost oscillation | Dual-path data race caused 31 phase flips in 85s |
| 10 | Feb 17-18 | Warning observability | Stale logging fixed; HR/threshold/delta enrichment |

---

## Chronological History

### Era 1: Foundation (Dec 2025)

The GovernanceEngine was created as part of the FitnessSession refactor (`c1de85b3`). Initial capabilities:

- Basic phase state machine: pending -> unlocked -> warning -> locked
- Grace period countdown with configurable `grace_period_seconds`
- Governance by media label (Plex labels like "KidsFun")
- Requirement evaluation: "all participants must be in zone X"
- Challenge system with timed zone requirements

Key early commits:
- `8c4e144c` -- Added governance by media type (show, movie)
- `e0402247` -- Deduplicate and normalize governance requirements
- `e90a532d` -- Optimize governance overlay performance
- `427737a1` -- Handle exemptions in required participant count

---

### Era 2: EntityId Crisis (Jan 2-3)

**The problem:** Complete governance failure after introducing entityId-based participant tracking. Lock overlay showed "Waiting for participants" despite 5 active users with visible HR data. Three hours to diagnose and resolve.

**Root cause chain:**
1. `updateSnapshot()` hung in `ensureSeriesCapacity()` -- an unbounded `while` loop computed millions of array entries when `startAbsMs` was epoch 0
2. `activeParticipants` used entityIds but `userZoneMap` was keyed by display names
3. `normalizeName()` lowercased "Alan" to "alan" but `userZoneMap` had key "Alan"

**Fix:** Both `activeParticipants` and `userZoneMap` switched to use userId (`entry.id || entry.profileId`) consistently. Added bounds checking to `ensureSeriesCapacity()`.

**Lesson established:** **Use stable identifiers (userId) everywhere.** Never use display names as dictionary keys. This lesson was reinforced repeatedly in later eras.

---

### Era 3: Performance Crisis (Jan 5-7)

**The problem:** FPS dropped from 50 to 9-11 during governance warning state.

**Root cause:** Three stacked CSS compositing layers:
1. `filter: sepia(0.65) brightness(0.8) contrast(1.2)` on `<video>` element
2. `backdrop-filter: blur(2px)` on `::before` pseudo-element
3. `backdrop-filter: blur(12px)` on governance panel

CSS `filter` on a `<video>` element forces per-frame software compositing. Combined with stacked `backdrop-filter`, GPU cost was multiplicative.

**Fix (`1aec09bc`):** Removed all CSS filters from video elements. Replaced with semi-transparent tinted overlay (`rgba(139, 92, 42, 0.25)`) with single `backdrop-filter: blur(2px)`.

**Also identified (not yet fixed):**
- Phantom warnings with zero offenders
- Challenge trigger failures (regression from phase renaming)
- FPS profiler adopted `window.__fitnessVideoElement` for stable reference

**Lesson established:** **Never apply CSS `filter` to `<video>` elements.** Use overlay-only visual effects. Even a single `backdrop-filter` over active video can degrade performance on low-end hardware.

---

### Era 4: Render Thrashing & Zone SSoT (Jan 15-19)

**Problem 1: Double phase transitions (2,427/hr)**

`evaluate()` called `this.reset()` then `this._setPhase(null)` when media was not governed. But `reset()` internally called `_setPhase('pending')`, so each evaluation fired TWO phase change callbacks, each triggering `forceUpdate()`.

**Fix:** Created `_resetToIdle()` that clears state and only calls `_setPhase(null)` if phase isn't already null. Added early-return guard when already idle.

**Problem 2: Zone state oscillation (47 phase changes in 15 min)**

GovernanceEngine read zones from `TreasureBox.lastZoneId` (updated every ~100ms). TreasureBox's interval reset mechanism cleared `highestZone` at each 5-second boundary, causing momentary zone drops.

**Fix (5 commits, bb6a27d5 primary):** GovernanceEngine now reads zone state exclusively from ZoneProfileStore (stable, tick-aligned at 5s boundaries) instead of volatile TreasureBox data. Deprecated `_evaluateFromTreasureBox()`.

**Problem 3: 60 global re-renders/min from countdown**

A 1-second `setInterval` heartbeat in FitnessContext forced the entire context tree to re-render just to update countdown display text.

**Fix (designed):** Pass raw `deadline` timestamp in governance state; let leaf components manage their own countdown intervals via `useDeadlineCountdown` hook.

**Lessons established:**
- **Governance and UI must read from the same zone source.** ZoneProfileStore is the SSoT.
- **Calling two state-changing methods in sequence triggers two render cycles.** Guard phase transitions.
- **Push stable timestamps, not computed values, through context.**

---

### Era 5: Lock Screen Hydration (Feb 2-3)

**The problem:** Lock screen showed "Target zone" and "HR 60" placeholders for ~1.1 seconds before real zone labels appeared.

**Root cause:** Three attempts to fix, each building on the last:

| Attempt | Approach | Result |
|---------|----------|--------|
| v1 (Feb 2) | Seed zone maps in `configure()` from session snapshot | Partial fix -- snapshot populated async via useEffect |
| v2 (Feb 3) | Pass `zoneConfig` directly to `configure()`, identity roster | Working but duct tape |
| v3 (Feb 3) | Expose `baseZoneId` in governance state, fix PHASE 6B fallback | More duct tape |

**Definitive fix (d37a2e20, bbc574ff, 57c5d9b5):** Added `_getZoneInfo()` and `_getZoneRank()` helper methods that normalize zone IDs before lookup. Replaced ALL direct `zoneInfoMap[key]` and `zoneRankMap[key]` accesses. Removed all duct tape (~130 lines deleted).

The actual bug was a **key normalization mismatch**: `zoneInfoMap` keys were normalized (lowercase) but lookups used raw zone IDs.

**Also added:** `_buildRequirementShell()` to pre-populate requirement structure from policy config when no participants exist, ensuring proper zone labels on the lock screen immediately.

**Lesson established:** **Don't layer duct tape.** When a fix doesn't fully resolve the issue, investigate the root cause deeper rather than adding another fallback layer. The third attempt found the actual bug (normalization mismatch) and deleted the previous two attempts.

---

### Era 6: Test Infrastructure (Feb 3)

**The problem:** 4 of 6 governance Playwright tests failed intermittently.

**Root cause:** Tests checked overlay visibility but not engine phase. The overlay could disappear before `satisfiedOnce` was set (500ms hysteresis). Subsequent zone drops went to `pending` instead of `warning`.

**Deeper root cause:** A React dependency array bug in FitnessContext -- `fitnessDevices` was a Map reference that never changed even when internal items updated. WebSocket HR updates never triggered re-evaluation.

**Fix (`8c72d84c`):** Added `version` (incremented by `batchedForceUpdate()`) to the useEffect dependency array. Exposed `window.__fitnessGovernance` for test inspection.

**Additional test fixes:**
- `sim.stopAll()` at test start to clear persistent HR data between runs
- `UNIVERSAL_HR` constants exceeding all user age-adjusted zone thresholds (e.g., `hot: 185` to exceed children's 180 BPM threshold)
- `unlockVideo()` rewritten to poll both overlay visibility AND governance phase

**Lesson established:** **Always verify engine state, not just UI state.** When testing state machines with hysteresis, the UI can disagree with the engine for the duration of the debounce window.

---

### Era 7: SSoT Consolidation (Feb 9-13)

Five SSoT violations were identified and fixed in a systematic sweep:

| # | Violation | Fix |
|---|-----------|-----|
| 1 | `getUserVitals().zoneId` raw zone | Now reads from ZoneProfileStore first |
| 2 | FitnessPlayer dual governance check | Removed local label matching; `videoLocked` is sole authority |
| 3 | Heart rate triple-storage | Documented chain; removed stale snapshot fallback |
| 4 | Progress bar data source split | Fallback prefers snapshot HR over raw HR |
| 5 | HR structure inconsistency | Removed dead `hr.value` checks; standardized on flat `heartRate` |

**Exemption SSOT fix (`0bcc485e`):** Challenge evaluation and base requirement evaluation had independent exemption logic. Unified so exempt users are consistently excluded from both `requiredCount` and `metUsers` across all code paths.

**Exempt user free-pass leak (found Feb 17):** After the consolidation, a subtler bug emerged: exempt users' above-threshold status counted toward `metUsers`, allowing them to substitute for a non-exempt user who dropped. Fixed by tracking `nonExemptMetCount` separately.

**Lesson established:** **Large SSoT refactors can change rule priority.** Consolidating data sources is structurally correct but can inadvertently alter behavioral semantics. Test both structure and behavior.

---

### Era 8: Video Lock Correctness (Feb 13-14)

**The fundamental gap:** `videoLocked` was only `true` during failed challenges. The `pending` and `locked` phases from base requirements never triggered `videoLocked`. Kids could play governed content without any exercise requirement by simply not connecting an HR monitor.

**Fix (`04327823`, `942ed689`):**
```javascript
// Before:
videoLocked: !!(this.challengeState && this.challengeState.videoLocked)

// After:
videoLocked: (this.challengeState?.videoLocked || this._mediaIsGoverned())
  && this.phase !== 'unlocked' && this.phase !== 'warning'
```

**Additional fixes in this era:**
- Video `pause()` added alongside `mute` on governance lock (`933b94c2`)
- `playObject.autoplay` switched from local label matching to `governanceState.videoLocked` SSoT (`b0c9680d`)
- Challenge `minParticipants` guard added to `_evaluateChallenges()` (`62cfa3de`)
- Challenge failure now respects base requirement satisfaction (`0cb7cb96`)

**Lesson established:** **Phase state and playback lock must be coupled.** When media is governed, `pending` and `locked` phases must lock video. The phase name tells you the governance state; `videoLocked` tells the player what to do.

---

### Era 9: Ghost Oscillation Saga (Feb 14-17)

The most complex and multi-day debugging effort in governance history. The problem manifested as rapid phase flipping (31 transitions in 85 seconds), video stutter-pausing (7 times in 8 seconds), and premature session termination.

#### Day 1 (Feb 14): Regression Fixes

Identified seven regressions from the Feb 13 SSoT refactor. Applied six fixes including:
- Challenge failure bypassing warning grace period (1-line fix: `if (challengeForcesRed && !allSatisfied)`)
- Ghost participant filter (filter by `id in userZoneMap`)
- `_invalidateStateCache` debounced with `queueMicrotask`
- Hysteresis increased from 500ms to 1500ms

#### Day 2 (Feb 15): Stability Fixes

Addressed feedback loop cascade:
- `batchedForceUpdate()` replaced direct `forceUpdate()` in all governance callbacks
- Timer generation counter to prevent stale interval callbacks
- Relock grace period added (5000ms after unlock, hold phase even if requirements briefly fail)
- Session buffer debounce (5s after session end before allowing new session)
- Render circuit breaker (100 renders/sec for 5s -> drop updates for 2s)

#### Day 3 (Feb 16): Root Cause Found

**The actual root cause:** Two paths called `evaluate()` with different data completeness:

| Path | Trigger | userZoneMap | Result |
|------|---------|-------------|--------|
| A: `_triggerPulse()` | Timer tick | Empty `{}` | Ghost filter removes everyone -> `pending` |
| B: `updateSnapshot()` | React re-render | Populated from roster | Proper evaluation -> `unlocked` |

The oscillation cycle:
```
Path A -> empty map -> pending -> phase change callback -> React re-render
  -> Path B -> populated map -> unlocked -> triggers pulse -> Path A -> ...
```

**Fix:** Three changes:
1. **Reorder ghost filter** to run AFTER ZoneProfileStore population (not before)
2. **Remove hysteresis** (1500ms, added 2 days prior) -- redundant with grace period
3. **Remove relock grace** (5000ms, added 1 day prior) -- also redundant with grace period

#### Day 4 (Feb 17): Defense-in-Depth

Post-fix production verification confirmed ghost oscillation was eliminated (46 phase changes in 33 min vs 31 in 85s). But Path A still started with empty `userZoneMap` and relied on ZoneProfileStore.

**Defense-in-depth fix:** Pre-populate `userZoneMap` from roster entries in Path A, matching Path B's behavior:
```javascript
roster.forEach((entry) => {
  const userId = entry.id || entry.profileId;
  const zoneId = entry.zoneId || entry.currentZoneId;
  if (userId && zoneId) {
    userZoneMap[userId] = zoneId.toLowerCase();
  }
});
```

**Lesson established:** **Multiple paths to the same state machine are a data race.** The fix is not to synchronize callers but to make the engine self-populate from authoritative sources regardless of caller. Also: **invisible mechanisms create invisible bugs** -- hysteresis (1500ms) and relock grace (5000ms) were added and removed within 48 hours. The visible grace period countdown was superior because users could see and understand it.

---

### Era 10: Warning Cooldown & Observability (Feb 17-18)

**Problem 1: Broken logging**

`_getParticipantsBelowThreshold()` always returned `[]` because it read `this._latestInputs.userZoneMap` (stale from previous evaluation) while being called from `_setPhase()` (during current evaluation, before `_captureLatestInputs()`).

**Fix (`cc80a9cb`):** Added `evalContext` parameter to `_setPhase()`. All call sites within `evaluate()` pass `{ userZoneMap, zoneRankMap, zoneInfoMap }`. Logging methods prefer `evalContext` over `_latestInputs`.

**Problem 2: Missing diagnostic fields**

Warning events logged `zone: "active"` and `missingUsers: ["alan"]` but not Alan's personal threshold (125), current HR (124), or delta (-1).

**Fix (`170cac93`):** Enriched `_getParticipantsBelowThreshold()` to look up `hr`, `threshold`, and `delta` from session roster and ZoneProfileStore.

**Problem 3: Zone boundary warning spam (19 warnings in 33 min)**

Alan's HR oscillated 119-127 around his 125 BPM threshold. Each 1-2 BPM dip triggered a warning.

**Fix (`96fb78bf`):** Added `_warningCooldownUntil` timestamp. After warning/locked -> unlocked transition, suppress re-entry to warning for `warning_cooldown_seconds` (default 30). Extended to locked -> unlocked path on Feb 18 (`9320da21`).

**Problem 4: HR=0 device disconnect false warnings (2 of 19)**

BLE devices send `heartRate: 0` on disconnect. `UserManager.#updateHeartRateData()` recomputed the zone snapshot with HR=0, dropping the user to "cool" zone.

**Fix (`4b007ee7`):** When `heartRate <= 0`, skip zone snapshot update entirely. User keeps last known zone. Ghost participant filter handles truly disconnected users.

**Lesson established:** **Broken logging led to broken diagnosis.** The `participantsBelowThreshold: []` field was designed to answer "who dropped and why" but always returned empty, forcing manual log correlation. If the warning event had logged `hr: 124, threshold: 125`, the fix would have been "lower Alan's threshold" (a 1-line YAML change). Instead, 5 code changes were made before the root cause was identified as threshold calibration.

---

## Recurring Bug Patterns

These patterns have caused repeated failures across multiple eras. Understanding them prevents regression.

### 1. Dual Data Source Divergence

**Pattern:** Two code paths compute the same truth from different sources, producing different answers.

**Instances:**
- Era 2: `activeParticipants` (entityIds) vs `userZoneMap` (display names)
- Era 4: GovernanceEngine (TreasureBox zones) vs UI (ZoneProfileStore zones)
- Era 7: FitnessPlayer (local label matching) vs GovernanceEngine (`_mediaIsGoverned()`)
- Era 9: Path A (`_triggerPulse`, empty map) vs Path B (`updateSnapshot`, populated map)

**Prevention:** Single authoritative source per data type. GovernanceEngine reads from ZoneProfileStore. Consumers read from GovernanceEngine state. No local re-derivation.

### 2. Stale Data in Phase Transition Logging

**Pattern:** Logging methods read `this._latestInputs` during a phase transition, but `_captureLatestInputs()` runs AFTER the transition.

**Instances:**
- Era 10: `_getParticipantsBelowThreshold()` always returned `[]`
- Era 10: `_getParticipantStates()` showed previous-evaluation zones

**Prevention:** Pass current evaluation data as a parameter to `_setPhase()`. Never read `_latestInputs` for current-evaluation diagnostics.

### 3. Render Feedback Loops

**Pattern:** State change -> callback -> forceUpdate -> render -> useEffect -> evaluate -> state change -> ...

**Instances:**
- Era 4: `_setPhase(null)` after `reset()` (double callback)
- Era 9: `_invalidateStateCache()` -> `onStateChange` -> render -> `updateSnapshot` -> `evaluate`
- Era 10: batchedForceUpdate breaks the loop

**Prevention:** Use `batchedForceUpdate()` for all governance callbacks. Debounce state change notifications with `queueMicrotask`.

### 4. CSS Performance Cliffs Over Video

**Pattern:** CSS filter/backdrop-filter combinations over `<video>` elements cause GPU compositing to become multiplicatively expensive.

**Instance:** Era 3: three stacked compositing layers dropped FPS from 50 to 9.

**Prevention:** Never apply CSS `filter` to `<video>` elements. Use overlay-only approaches with single `backdrop-filter`.

### 5. Ghost Participants

**Pattern:** Disconnected users remain in the roster, causing governance to enforce requirements against stale entries.

**Instances:**
- Era 9: Ghost filter ran before ZoneProfileStore population, removing everyone
- Era 10: HR=0 device disconnect dropping user to "cool" zone

**Prevention:** Ghost filter runs AFTER zone data population. HR=0 preserves last known zone.

---

## Optimal Patterns vs Antipatterns

Hard-won lessons distilled into concrete do/don't pairs. Each antipattern caused at least one production incident.

### Data Sources

| Optimal Pattern | Antipattern | Why |
|----------------|-------------|-----|
| Read zone from `ZoneProfileStore.getProfile(userId)` | Read zone from `TreasureBox.lastZoneId` or `DeviceManager.getDevice(id).zone` | TreasureBox resets `highestZone` at interval boundaries, causing momentary zone drops. ZoneProfileStore is tick-aligned and stable (Era 4). |
| Read `governanceState.videoLocked` for lock decisions | Locally re-derive "is governed?" from label sets or media types | Local re-derivation creates SSoT violations. GovernanceEngine is the sole authority (Era 8). |
| Use `userId` (`entry.id \|\| entry.profileId`) for all dictionary keys | Use display names, entityIds, or mixed identifiers as keys | Case-sensitive name lookups silently return `undefined`. Identifier scheme mismatches caused a 3-hour outage (Era 2). |
| Read from `evalContext` parameter during phase transitions | Read from `this._latestInputs` during evaluation | `_latestInputs` is stale until `_captureLatestInputs()` runs at the end of `evaluate()`. Caused `participantsBelowThreshold: []` for weeks (Era 10). |

### State Machine Design

| Optimal Pattern | Antipattern | Why |
|----------------|-------------|-----|
| Single `evaluate()` entry point that self-populates from authoritative sources | Multiple callers passing different data subsets to `evaluate()` | Two paths with different data completeness caused the ghost oscillation saga — 31 phase flips in 85 seconds (Era 9). |
| Guard `_setPhase()` against no-op transitions (`if (newPhase === this.phase) return`) | Call `_setPhase()` unconditionally on every evaluation | Unconditional calls trigger render callbacks even when phase hasn't changed. Caused 2,427 wasted renders/hr (Era 4). |
| Use `batchedForceUpdate()` for all governance callbacks | Call `forceUpdate()` directly from `onPhaseChange` / `onStateChange` | Direct calls create evaluate-render-evaluate feedback loops. `batchedForceUpdate` coalesces within a single frame (Era 9). |
| Debounce `_invalidateStateCache()` with `queueMicrotask` | Call `_invalidateStateCache()` synchronously on every state change | A single `evaluate()` can trigger multiple state changes. Without debounce, each fires `onStateChange` → render → re-evaluate (Era 9). |
| `_resetToIdle()` with early-return when already idle | `this.reset(); this._setPhase(null);` in sequence | `reset()` internally sets phase to `pending`, then `_setPhase(null)` sets it again — two callbacks, two renders, per evaluation (Era 4). |

### Timing & Phase Stability

| Optimal Pattern | Antipattern | Why |
|----------------|-------------|-----|
| Visible grace period with countdown UI | Hidden hysteresis delay (`_hysteresisMs`) with no user feedback | Hidden delays are impossible to debug in production. Users can't tell if the system is "thinking" or broken. Grace period was superior in every case (Era 9). |
| `warning_cooldown_seconds` config to suppress re-entry after recovery | Per-evaluation threshold checks with no cooldown | HR oscillating 1-2 BPM around a zone boundary triggers warning on every dip. Cooldown suppresses noise without hiding real drops (Era 10). |
| Preserve last known zone on HR=0 (device disconnect) | Recompute zone snapshot with HR=0, dropping user to "cool" | BLE devices send HR=0 on disconnect. Treating it as real drops the user's zone, triggering false warnings. Ghost filter handles truly gone users (Era 10). |
| Immediate unlock when requirements met; immediate warning when they fail | Add debounce delays (`_relockGraceMs`, `_hysteresisMs`) between state changes | Both mechanisms were added and removed within 48 hours. The warning grace period already covers the "brief dip" scenario with visible UI feedback (Era 9). |

### Rendering & CSS

| Optimal Pattern | Antipattern | Why |
|----------------|-------------|-----|
| Semi-transparent overlay div for warning visual effect | CSS `filter` on `<video>` element | `filter` on `<video>` forces per-frame software compositing. FPS dropped from 50 to 9. Overlays leave video decoding untouched (Era 3). |
| Single `backdrop-filter: blur()` on one overlay layer | Stacked `backdrop-filter` on multiple layers over video | Each additional blur layer multiplies GPU compositing cost. One blur is tolerable; three caused 80% FPS degradation (Era 3). |
| `transform: scaleX()` for progress bar animation | `width` transition for progress bar animation | `width` triggers layout recalculation. `scaleX()` is GPU-accelerated and avoids layout thrashing (Era 3). |
| Push `deadline` timestamp through context; let leaf components manage countdown intervals | Push `countdownSecondsRemaining` through context with 1s heartbeat | The heartbeat forces global re-render 60x/min just for countdown display. Leaf-owned intervals re-render only the countdown component (Era 4). |

### Requirement Evaluation

| Optimal Pattern | Antipattern | Why |
|----------------|-------------|-----|
| Count only `nonExemptMetCount` against `requiredCount` | Include exempt users in `metUsers` total | Exempt users above threshold silently substitute for non-exempt users who drop, hiding real violations (Era 7). |
| Keep challenge requirements separate from base requirements in state output | Merge `combinedRequirements` from both challenge and base | Merged requirements show challenge-failing users as base-requirement offenders on the lock screen (Era 8). |
| `_buildRequirementShell()` to pre-populate requirements from static policy config | Only populate requirements after dynamic HR data arrives | Static data (zone labels, policy rules) is available at configure time. Deferring it creates 1-2 second placeholder text on the lock screen (Era 5). |
| Run ghost participant filter AFTER zone data population | Run ghost filter BEFORE ZoneProfileStore populates `userZoneMap` | When `userZoneMap` is empty, the ghost filter removes everyone because no one has zone data. Order of operations matters (Era 9). |

### Debugging & Observability

| Optimal Pattern | Antipattern | Why |
|----------------|-------------|-----|
| Log `hr`, `threshold`, `delta` per user in warning events | Log only zone name and user list | Without threshold/delta, a 1 BPM calibration problem looks like a code bug. Missing 3 characters in logs cost hours of investigation (Era 10). |
| Include `evaluatePath` field in phase change events | Log phase changes without identifying the caller | Without knowing which path triggered a transition, dual-path data races are invisible in logs (Era 9). |
| Expose `window.__fitnessGovernance` with full engine state | Rely on UI observation for debugging | UI and engine can disagree (overlay hidden but phase still `pending`). Direct engine state inspection catches this immediately (Era 6). |
| Write failing test that reproduces the oscillation pattern | Attempt manual debugging of timing-dependent bugs | Ghost oscillation required specific interleaving of Path A and Path B. A deterministic test that alternates paths catches regressions automatically (Era 9). |

---

## Mechanisms Added Then Removed

These mechanisms were introduced during debugging and later removed when the actual root cause was found. Documenting them prevents re-introduction.

| Mechanism | Added | Removed | Why Removed |
|-----------|-------|---------|-------------|
| `_hysteresisMs` (500ms) | Foundation | Feb 16 | Redundant with warning grace period; added invisible delay without UI feedback |
| `_hysteresisMs` (1500ms) | Feb 14 | Feb 16 | Same reason; increased value didn't fix the actual bug (ghost oscillation) |
| `_relockGraceMs` (5000ms) | Feb 15 | Feb 16 | Redundant with grace period; created edge cases harder to debug than the problem |
| `_lastUnlockTime` | Feb 15 | Feb 16 | Supported `_relockGraceMs`, removed with it |
| `satisfiedSince` | Foundation | Feb 16 | Supported hysteresis, removed with it |
| `baseZoneId` in state | Feb 3 | Feb 3 | Duct tape for zone label hydration; removed by proper zone lookup fix |
| PHASE 6B fallback | Feb 3 | Feb 3 | Duct tape for lock screen display; removed by proper zone lookup fix |
| Identity roster | Feb 3 | Feb 3 | Duct tape for early participant display; removed by proper zone lookup fix |
| TreasureBox governance callback | Foundation | Jan 19 | Replaced by ZoneProfileStore-driven evaluation |
| `_evaluateFromTreasureBox()` | Foundation | Jan 19 | Deprecated when zone source moved to ZoneProfileStore |

**Lesson:** If you add a timing-based mechanism (hysteresis, grace, cooldown) and the bug persists, the root cause is likely data correctness, not timing.

---

## Tactics & Tips for Future Work

### Debugging Governance Issues

1. **Start with production logs.** Look for `governance.phase_change` events. The `evaluatePath` field tells you whether the change came from "pulse" (timer) or "snapshot" (React render). Rapid alternation between paths is a data race.

2. **Check `participantsBelowThreshold`.** If it's `[]` during a warning, the logging bug has regressed -- check that `_setPhase()` is receiving `evalContext`.

3. **Inspect `window.__fitnessGovernance`** in browser console. It exposes phase, satisfiedOnce, userZoneMap, activeParticipants, and zoneRankMap for real-time debugging.

4. **Zone rank 0 is dangerous.** If `zoneRankMap` is empty, all zone rank lookups return `null`, and `_evaluateZoneRequirement()` returns `null` (requirement skipped). This silently makes governance think there are no requirements.

5. **Log the `evaluatePath` field.** If most transitions come from "pulse" and produce different results than "snapshot", you have a data race between the two evaluation paths.

### Common Pitfalls

1. **Don't add invisible delays.** If a timing mechanism has no user-facing indication (countdown, progress bar), it will be impossible to debug in production. Prefer the visible grace period over hidden hysteresis.

2. **Don't layer duct tape.** If a fix doesn't fully resolve the issue, find the actual root cause. Three partial fixes create more complexity than one correct fix.

3. **Don't re-derive governance decisions.** If you need to know whether media is governed or whether video should be locked, read from `governanceState`. Never locally compute it from labels/types.

4. **Don't read `_latestInputs` during evaluation.** Use the local variables from the current evaluation. `_latestInputs` is stale until `_captureLatestInputs()` runs at the end of `evaluate()`.

5. **Don't add mechanisms that are redundant with existing ones.** Before adding a new timing buffer, check whether `grace_period_seconds`, `warning_cooldown_seconds`, or ZoneProfileStore hysteresis already covers the case.

### Testing Governance

1. **Use `UNIVERSAL_HR` constants** that exceed all user age-adjusted thresholds (e.g., hot: 185 for children's 180 threshold).

2. **Call `sim.stopAll()`** at the start of test scenarios to clear persistent HR data from previous runs.

3. **Verify engine state, not just UI.** Use `extractGovernanceState(page)` to check `phase` and `satisfiedOnce` alongside overlay visibility.

4. **Continuously send HR** through the hysteresis/propagation window. A single `setZone()` call may not trigger re-evaluation; poll in a loop with delays.

5. **Check `participantCount` in assertions.** Ghost participants can cause requirements to fail even when all real participants are above threshold.

---

## Current Architecture Snapshot

As of Feb 18, 2026:

```
Sensor -> DeviceManager -> UserManager -> ZoneProfileStore (SSoT: zone)
                                              |
                                              v
Media Labels -> GovernanceEngine.evaluate() (SSoT: phase, videoLocked)
                     |
                     v
              _composeState() -> governance.state
                     |
          +----------+----------+
          |          |          |
    FitnessPlayer  Overlay  Sidebar
    (pause/mute)   (lock)   (badges)
```

**Phase determination (simplified):**
```
challengeFailed && !baseSatisfied -> locked
baseSatisfied -> unlocked (immediate)
!satisfiedOnce -> pending
satisfiedOnce && inCooldown -> unlocked (suppressed)
satisfiedOnce && graceExpired -> locked
satisfiedOnce && graceActive -> warning
```

**Key state fields:**
- `phase`: null | pending | unlocked | warning | locked
- `videoLocked`: true when governed AND phase is not unlocked/warning
- `satisfiedOnce`: set true on first satisfaction, used for pending vs warning distinction
- `_warningCooldownUntil`: timestamp suppressing re-entry to warning after recovery
- `deadline`: grace period expiry timestamp (passed to UI for countdown display)

**Evaluation paths:**
- **Snapshot path:** React re-render -> `updateSnapshot()` -> `evaluate()` with roster data
- **Pulse path:** Timer tick or zone change -> `_triggerPulse()` -> `evaluate()` (reads from session.roster)
- Both paths now produce equivalent data thanks to roster zone fallback

---

## Commit Reference

57 commits touching GovernanceEngine.js, organized by theme. See git log for full details.

### Foundation
`c1de85b3` `8c4e144c` `e0402247` `e90a532d` `427737a1`

### Render Thrashing & Zone SSoT
`821d0fb8` `39fbb276` `bb6a27d5` `48bf78a8` `338c1f05` `755abd9b`

### Timer Coordination & Reactive Evaluation
`a13b544c` `3c5f78f2` `ccd46516` `6c4ab7b9` `6c8797e7` `fc420b90` `062e3392`

### Lock Screen Hydration & Zone Config
`8effb40d` `a3839d37` `d37a2e20` `bbc574ff` `57c5d9b5` `952984cd`

### SSoT Consolidation
`8c72d84c` `0bcc485e` `e825a90a` `45857f08` `7f8b055e`

### Video Lock Correctness
`04327823` `3326132f` `942ed689` `b0c9680d` `933b94c2`

### Challenge System
`095695f3` `62cfa3de` `0cb7cb96` `d4afcefb` `c885e79c`

### Ghost Participants & Hysteresis
`e483c67c` `1fea8ecc` `449bdf45` `7c8faa31` `04234a4e` `34da1865`

### Stability & Lifecycle
`05c8a101` `cd292646`

### Warning Cooldown & Observability
`96fb78bf` `96420bd7` `9320da21` `cc80a9cb` `170cac93` `f9c17b9c` `ba9d5d1a`

---

## See Also

- `governance-engine.md` -- API reference, configuration, testing patterns
- `governance-system-architecture.md` -- Event-driven architecture, SSoT boundaries, data flow sequences
- `docs/plans/2026-02-18-governance-remaining-fixes.md` -- Most recent implementation plan
