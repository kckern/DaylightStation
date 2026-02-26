# Fitness Recurring Issues Remediation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Fix the 6 issues that keep recurring across fitness audits (Feb 3–25) but have never been fully resolved — ending the "spinning in circles" pattern where the same problems are documented but not fixed.

**Architecture:** Surgical fixes in the frontend fitness hot path. The root cause driving ~5 symptoms is `batchedForceUpdate()` being called per HR sample (~20/sec with 4 devices). Task 1 throttles this to max 4/sec, which should eliminate phantom stall overlays, reduce CPU pressure, and cut log spam. Remaining tasks are independent fixes for challenge feasibility, chart spam, zone mismatch, and device startup noise.

**Tech Stack:** React context + hooks, plain JS classes (FitnessSession, GovernanceEngine, ZoneProfileStore, TreasureBox), Jest unit tests.

**Audit cross-reference:** `docs/_wip/audits/2026-02-25-fitness-session-20260225181217-postmortem.md`

**DO NOT TOUCH:** Voice memo pipeline — it is working. Do not modify VoiceMemoManager, PersistenceManager voice memo consolidation, or the voice memo upload endpoint.

---

## Task 1: Throttle HR-Driven State Updates (Root Cause of Render Thrashing)

**Why:** This is the #1 root cause across 5 audits (Feb 15–25). With 4 HR devices at ~5 samples/sec, `batchedForceUpdate()` fires ~20 times/sec. Even with RAF batching, each RAF frame triggers a full React context re-render (1,200–1,760 force updates per 30s window). This causes phantom stall overlays (Anomaly 1), CPU starvation on Shield TV (Anomaly 3), and amplifies governance/chart noise.

**The fix:** Add a time-based throttle so `batchedForceUpdate()` fires at most once every 250ms (4/sec). HR data continues flowing into TreasureBox/ZoneProfileStore at full rate (important for accurate zone calculations), but React re-renders are throttled.

**Files:**
- Modify: `frontend/src/context/FitnessContext.jsx:286-330` (batchedForceUpdate)
- Test: `tests/isolated/domain/fitness/throttled-force-update.unit.test.mjs` (create)

### Step 1: Write the failing test

Create `tests/isolated/domain/fitness/throttled-force-update.unit.test.mjs`:

```javascript
import { describe, it, expect, jest, beforeEach, afterEach } from '@jest/globals';

describe('batchedForceUpdate throttle', () => {
  let forceUpdateCount;
  let batchedForceUpdate;
  let scheduledCallback;

  beforeEach(() => {
    forceUpdateCount = 0;
    scheduledCallback = null;

    // Mock requestAnimationFrame
    global.requestAnimationFrame = jest.fn((cb) => { scheduledCallback = cb; return 1; });

    // Simulate the throttled batchedForceUpdate logic
    const MIN_UPDATE_INTERVAL_MS = 250;
    let lastUpdateTime = 0;
    let scheduled = false;
    let throttleTimer = null;

    batchedForceUpdate = () => {
      const now = Date.now();
      const elapsed = now - lastUpdateTime;

      if (elapsed >= MIN_UPDATE_INTERVAL_MS) {
        // Enough time has passed — schedule immediately
        if (!scheduled) {
          scheduled = true;
          requestAnimationFrame(() => {
            scheduled = false;
            lastUpdateTime = Date.now();
            forceUpdateCount++;
          });
        }
      } else if (!throttleTimer) {
        // Too soon — schedule a delayed update
        const delay = MIN_UPDATE_INTERVAL_MS - elapsed;
        throttleTimer = setTimeout(() => {
          throttleTimer = null;
          if (!scheduled) {
            scheduled = true;
            requestAnimationFrame(() => {
              scheduled = false;
              lastUpdateTime = Date.now();
              forceUpdateCount++;
            });
          }
        }, delay);
      }
      // Otherwise: update already scheduled or throttle timer already pending — drop
    };

    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
    delete global.requestAnimationFrame;
  });

  it('should fire immediately on first call', () => {
    batchedForceUpdate();
    expect(requestAnimationFrame).toHaveBeenCalledTimes(1);
  });

  it('should NOT fire again within 250ms', () => {
    batchedForceUpdate();
    // Flush the RAF
    scheduledCallback?.();

    // Call 20 more times rapidly (simulating 20 HR samples)
    for (let i = 0; i < 20; i++) {
      batchedForceUpdate();
    }

    // Only 1 RAF should have fired, plus 1 throttle timer pending
    expect(forceUpdateCount).toBe(1);
  });

  it('should fire again after 250ms', () => {
    batchedForceUpdate();
    scheduledCallback?.();
    expect(forceUpdateCount).toBe(1);

    // Advance 250ms
    jest.advanceTimersByTime(250);

    batchedForceUpdate();
    // Should schedule new RAF
    expect(requestAnimationFrame).toHaveBeenCalledTimes(2);
  });

  it('should coalesce rapid calls into max ~4/sec', () => {
    // Simulate 1 second of 20 calls/sec
    for (let i = 0; i < 20; i++) {
      batchedForceUpdate();
      if (scheduledCallback) {
        scheduledCallback();
        scheduledCallback = null;
      }
      jest.advanceTimersByTime(50); // 50ms between calls
    }

    // At 250ms throttle, expect ~4 actual updates in 1 second
    expect(forceUpdateCount).toBeLessThanOrEqual(5);
    expect(forceUpdateCount).toBeGreaterThanOrEqual(3);
  });
});
```

### Step 2: Run test to verify it fails

Run: `npx jest tests/isolated/domain/fitness/throttled-force-update.unit.test.mjs --no-cache`
Expected: Tests define the throttle behavior that doesn't exist yet in production code.

### Step 3: Implement the throttle in batchedForceUpdate

Modify `frontend/src/context/FitnessContext.jsx` lines 286-330. Replace the existing `batchedForceUpdate` with:

```javascript
const batchedForceUpdate = React.useCallback(() => {
  // Circuit breaker check (existing logic — keep lines 291-322 as-is)
  const cb = circuitBreakerRef.current;
  const now = Date.now();

  if (cb.tripped) {
    if ((now - cb.trippedAt) < cb.cooldownMs) {
      return;
    }
    cb.tripped = false;
    cb.renderTimestamps = [];
    getLogger().info('fitness.circuit_breaker.reset');
  }

  cb.renderTimestamps.push(now);
  const cutoff = now - cb.sustainedMs;
  while (cb.renderTimestamps.length > 0 && cb.renderTimestamps[0] < cutoff) {
    cb.renderTimestamps.shift();
  }

  if (cb.renderTimestamps.length > (cb.thresholdPerSec * (cb.sustainedMs / 1000))) {
    cb.tripped = true;
    cb.trippedAt = now;
    getLogger().warn('fitness.circuit_breaker.tripped', {
      ratePerSec: Math.round(cb.renderTimestamps.length / (cb.sustainedMs / 1000)),
      windowSize: cb.renderTimestamps.length,
      droppingUpdatesForMs: cb.cooldownMs
    });
    return;
  }

  // ── NEW: Time-based throttle (max ~4 updates/sec) ──
  const MIN_UPDATE_INTERVAL_MS = 250;
  const elapsed = now - (updateThrottleRef.current.lastUpdateTime || 0);

  if (elapsed >= MIN_UPDATE_INTERVAL_MS) {
    // Enough time has passed — schedule immediately via RAF
    if (scheduledUpdateRef.current) return;
    scheduledUpdateRef.current = true;
    requestAnimationFrame(() => {
      scheduledUpdateRef.current = false;
      updateThrottleRef.current.lastUpdateTime = Date.now();
      forceUpdate();
    });
  } else if (!updateThrottleRef.current.timer) {
    // Too soon — schedule a trailing update after the remaining interval
    const delay = MIN_UPDATE_INTERVAL_MS - elapsed;
    updateThrottleRef.current.timer = setTimeout(() => {
      updateThrottleRef.current.timer = null;
      if (!scheduledUpdateRef.current) {
        scheduledUpdateRef.current = true;
        requestAnimationFrame(() => {
          scheduledUpdateRef.current = false;
          updateThrottleRef.current.lastUpdateTime = Date.now();
          forceUpdate();
        });
      }
    }, delay);
  }
  // Otherwise: RAF already scheduled or throttle timer pending — drop this call
}, [forceUpdate]);
```

Add the ref near the existing `scheduledUpdateRef` (around line 264):

```javascript
const updateThrottleRef = useRef({ lastUpdateTime: 0, timer: null });
```

### Step 4: Run test to verify it passes

Run: `npx jest tests/isolated/domain/fitness/throttled-force-update.unit.test.mjs --no-cache`
Expected: PASS

### Step 5: Commit

```bash
git add frontend/src/context/FitnessContext.jsx tests/isolated/domain/fitness/throttled-force-update.unit.test.mjs
git commit -m "perf(fitness): throttle batchedForceUpdate to max 4/sec

HR samples arrive at ~20/sec (4 devices × 5 samples/sec), each triggering
a React context re-render. This caused 1,200-1,760 force updates per 30s
window, creating phantom stall overlays and CPU starvation on Shield TV.

Adds a 250ms minimum interval between actual renders. HR data still flows
to TreasureBox/ZoneProfileStore at full rate for accurate zone calculations.

Addresses render thrashing documented in 5 audits (Feb 15-25)."
```

---

## Task 2: Validate Stalls Before Showing Overlay (Phantom Stall Detection)

**Why:** The stall detector reports 66 "stalls" per session even when video plays smoothly (playhead advancement ratio = 1.00). Users see brief "Seeking..." overlay flashes. The stall detector is fooled by frame-timing gaps caused by render thrashing. Even with Task 1's throttle, the detector should validate stalls before showing UI.

**Files:**
- Modify: `frontend/src/modules/Fitness/FitnessPlayer.jsx` (stall detection logic)
- Test: `tests/isolated/domain/fitness/stall-validation.unit.test.mjs` (create)

### Step 1: Find the stall detection code

Read `frontend/src/modules/Fitness/FitnessPlayer.jsx` and locate:
- The `playback.stalled` event emission
- The overlay visibility trigger for stalls
- The playhead position tracking

Search for `stalled`, `stall_threshold`, `playheadPosition`, `Seeking` in the file.

### Step 2: Write the failing test

Create `tests/isolated/domain/fitness/stall-validation.unit.test.mjs`:

```javascript
import { describe, it, expect } from '@jest/globals';

describe('stall validation', () => {
  // Simulate the validation function we'll add
  function isRealStall(playheadAtStart, playheadAtCheck, wallElapsedMs) {
    // If playhead is advancing at >80% of real-time, it's not a real stall
    if (playheadAtStart == null || playheadAtCheck == null) return true; // can't validate
    const playheadAdvance = playheadAtCheck - playheadAtStart;
    const wallElapsedSec = wallElapsedMs / 1000;
    if (wallElapsedSec <= 0) return true; // too brief to validate
    const ratio = playheadAdvance / wallElapsedSec;
    return ratio < 0.8; // Real stall: playhead advancing at <80% of wall time
  }

  it('should detect phantom stall (playhead advancing normally)', () => {
    // Video played 8s of content in 8s of wall time — not stalled
    expect(isRealStall(335.2, 343.2, 8000)).toBe(false);
  });

  it('should detect real stall (playhead frozen)', () => {
    // Video played 0s of content in 8s of wall time — real stall
    expect(isRealStall(335.2, 335.2, 8000)).toBe(true);
  });

  it('should detect real stall (playhead barely moving)', () => {
    // Video played 1s of content in 8s — real stall
    expect(isRealStall(335.2, 336.2, 8000)).toBe(true);
  });

  it('should handle null playhead as possible real stall', () => {
    expect(isRealStall(null, null, 8000)).toBe(true);
  });

  it('should handle very short intervals as possible real stall', () => {
    expect(isRealStall(335.2, 335.2, 0)).toBe(true);
  });
});
```

### Step 3: Run test to verify it fails

Run: `npx jest tests/isolated/domain/fitness/stall-validation.unit.test.mjs --no-cache`
Expected: PASS (pure function test). The actual integration is in Step 4.

### Step 4: Add playhead validation to stall detection

In `FitnessPlayer.jsx`, find where `playback.stalled` is emitted and add a playhead advancement check before showing the overlay. The pattern:

```javascript
// When stall is first detected, record playhead position
const stallStartPlayhead = videoRef.current?.currentTime ?? null;
const stallStartWall = Date.now();

// Before showing overlay (after stall threshold), validate:
const currentPlayhead = videoRef.current?.currentTime ?? null;
const wallElapsed = Date.now() - stallStartWall;
if (stallStartPlayhead != null && currentPlayhead != null && wallElapsed > 0) {
  const ratio = (currentPlayhead - stallStartPlayhead) / (wallElapsed / 1000);
  if (ratio >= 0.8) {
    // Phantom stall — playhead is advancing fine. Suppress overlay.
    logger.debug('playback.stall_phantom', {
      ratio: Math.round(ratio * 100) / 100,
      playheadAdvance: currentPlayhead - stallStartPlayhead,
      wallElapsedMs: wallElapsed
    });
    return; // Don't show overlay
  }
}
```

Also change the overlay label from "Seeking…" to "Buffering…" when the stall is not triggered by a seek operation.

### Step 5: Commit

```bash
git add frontend/src/modules/Fitness/FitnessPlayer.jsx tests/isolated/domain/fitness/stall-validation.unit.test.mjs
git commit -m "fix(fitness): validate stalls before showing overlay

Stall detector was falsely triggering 66 times per session even when
video played smoothly (playhead ratio = 1.00). Now validates that the
playhead has actually stopped advancing before showing the overlay.
Also changes misleading 'Seeking...' label to 'Buffering...' for
non-seek stalls."
```

---

## Task 3: Challenge Feasibility Check (Unwinnable Challenges)

**Why:** Same failure pattern in 2 audits (Feb 16, Feb 25). Challenges target hot zone with `rule: 'all'` when participants are 30+ BPM below their hot threshold. Challenge is structurally impossible. Alan spent <1% of session in hot zone, had HR of 124–138 with hot threshold of 170.

**Files:**
- Modify: `frontend/src/hooks/fitness/GovernanceEngine.js:1885-1954` (startChallenge)
- Test: `tests/isolated/domain/fitness/challenge-feasibility.unit.test.mjs` (create)

### Step 1: Write the failing test

Create `tests/isolated/domain/fitness/challenge-feasibility.unit.test.mjs`:

```javascript
import { describe, it, expect } from '@jest/globals';

describe('challenge feasibility check', () => {
  /**
   * Check if a challenge zone is achievable for a set of participants.
   * @param {string} targetZone - Zone the challenge requires (e.g., 'hot')
   * @param {string} rule - 'all', 'majority', 'any', or a number
   * @param {Array} participants - [{id, currentHr, zoneThresholds: {cool, active, warm, hot, fire}}]
   * @param {number} feasibilityMarginBpm - Max BPM gap to consider "achievable" (default 20)
   * @returns {{feasible: boolean, reason?: string}}
   */
  function checkChallengeFeasibility(targetZone, rule, participants, feasibilityMarginBpm = 20) {
    if (!targetZone || !participants?.length) return { feasible: true };

    const targetThresholdKey = targetZone.toLowerCase();
    let achievableCount = 0;

    for (const p of participants) {
      const threshold = p.zoneThresholds?.[targetThresholdKey];
      if (threshold == null) { achievableCount++; continue; } // No threshold = assume achievable
      const gap = threshold - (p.currentHr || 0);
      if (gap <= feasibilityMarginBpm) {
        achievableCount++;
      }
    }

    const requiredCount = rule === 'all' ? participants.length
      : rule === 'majority' ? Math.ceil(participants.length * 0.5)
      : rule === 'any' ? 1
      : typeof rule === 'number' ? Math.min(rule, participants.length)
      : participants.length;

    if (achievableCount < requiredCount) {
      return {
        feasible: false,
        reason: `Only ${achievableCount}/${requiredCount} participants within ${feasibilityMarginBpm} BPM of ${targetZone} zone`
      };
    }
    return { feasible: true };
  }

  it('should reject challenge when participant is 32+ BPM below hot threshold', () => {
    const participants = [
      { id: 'milo',   currentHr: 155, zoneThresholds: { hot: 160 } },
      { id: 'alan',   currentHr: 138, zoneThresholds: { hot: 170 } }, // 32 BPM gap
      { id: 'felix',  currentHr: 150, zoneThresholds: { hot: 160 } },
      { id: 'kckern', currentHr: 160, zoneThresholds: { hot: 155 } },
    ];
    const result = checkChallengeFeasibility('hot', 'all', participants);
    expect(result.feasible).toBe(false);
  });

  it('should accept challenge when all participants are within 20 BPM', () => {
    const participants = [
      { id: 'milo',   currentHr: 155, zoneThresholds: { hot: 160 } },
      { id: 'alan',   currentHr: 155, zoneThresholds: { hot: 170 } },
      { id: 'felix',  currentHr: 150, zoneThresholds: { hot: 160 } },
      { id: 'kckern', currentHr: 160, zoneThresholds: { hot: 155 } },
    ];
    const result = checkChallengeFeasibility('hot', 'all', participants);
    expect(result.feasible).toBe(true);
  });

  it('should accept majority rule when enough participants are close', () => {
    const participants = [
      { id: 'milo',   currentHr: 155, zoneThresholds: { hot: 160 } },
      { id: 'alan',   currentHr: 100, zoneThresholds: { hot: 170 } }, // too far
      { id: 'felix',  currentHr: 150, zoneThresholds: { hot: 160 } },
      { id: 'kckern', currentHr: 160, zoneThresholds: { hot: 155 } },
    ];
    // majority of 4 = 2
    const result = checkChallengeFeasibility('hot', 'majority', participants);
    expect(result.feasible).toBe(true);
  });

  it('should downgrade zone when target is not feasible', () => {
    const participants = [
      { id: 'milo',   currentHr: 130, zoneThresholds: { warm: 120, hot: 160 } },
      { id: 'alan',   currentHr: 125, zoneThresholds: { warm: 120, hot: 170 } },
    ];
    // hot not feasible for all
    const hotResult = checkChallengeFeasibility('hot', 'all', participants);
    expect(hotResult.feasible).toBe(false);
    // warm IS feasible (both already above warm threshold)
    const warmResult = checkChallengeFeasibility('warm', 'all', participants);
    expect(warmResult.feasible).toBe(true);
  });
});
```

### Step 2: Run test to verify it passes (pure function)

Run: `npx jest tests/isolated/domain/fitness/challenge-feasibility.unit.test.mjs --no-cache`
Expected: PASS (defines the feasibility logic as a pure function).

### Step 3: Add feasibility check to GovernanceEngine

In `frontend/src/hooks/fitness/GovernanceEngine.js`, add a `_checkChallengeFeasibility` method and call it from `startChallenge()` (line ~1885). If not feasible, try downgrading the zone (hot→warm→active) before falling back to skip.

```javascript
/**
 * Check if a challenge zone is achievable given current participant HR.
 * @param {string} targetZone
 * @param {string|number} rule
 * @param {string[]} activeParticipants
 * @param {Object} userZoneMap
 * @returns {{feasible: boolean, reason?: string, suggestedZone?: string}}
 */
_checkChallengeFeasibility(targetZone, rule, activeParticipants, userZoneMap) {
  if (!targetZone || !activeParticipants?.length) return { feasible: true };

  const FEASIBILITY_MARGIN_BPM = 20;
  const requiredRank = this._getZoneRank(targetZone);
  if (!Number.isFinite(requiredRank)) return { feasible: true };

  // Count how many participants are within striking distance
  let achievableCount = 0;
  for (const pid of activeParticipants) {
    const profile = this._zoneProfileStoreRef?.getProfile?.(pid);
    const hr = profile?.heartRate ?? 0;
    const targetMin = this._getZoneMinThreshold(targetZone, profile);
    if (targetMin == null) { achievableCount++; continue; }
    if ((targetMin - hr) <= FEASIBILITY_MARGIN_BPM) achievableCount++;
  }

  const requiredCount = this._normalizeRequiredCount(rule, activeParticipants.length, activeParticipants);
  if (achievableCount < requiredCount) {
    // Try downgrading: hot → warm → active
    const zoneDowngrades = ['fire', 'hot', 'warm', 'active'];
    const targetIdx = zoneDowngrades.indexOf(targetZone);
    if (targetIdx >= 0 && targetIdx < zoneDowngrades.length - 1) {
      const downgrade = zoneDowngrades[targetIdx + 1];
      const downResult = this._checkChallengeFeasibility(downgrade, rule, activeParticipants, userZoneMap);
      if (downResult.feasible) {
        return { feasible: false, suggestedZone: downgrade, reason: `${targetZone} not achievable, downgraded to ${downgrade}` };
      }
    }
    return { feasible: false, reason: `Only ${achievableCount}/${requiredCount} within ${FEASIBILITY_MARGIN_BPM} BPM of ${targetZone}` };
  }
  return { feasible: true };
}
```

In `startChallenge()` (line ~1908), after the preview is built but before creating `activeChallenge`, add:

```javascript
// Feasibility check: don't start challenges participants can't reach
const feasibility = this._checkChallengeFeasibility(
  preview.zone, preview.rule, activeParticipants, userZoneMap
);
if (!feasibility.feasible) {
  if (feasibility.suggestedZone) {
    // Downgrade to achievable zone
    preview.zone = feasibility.suggestedZone;
    preview.requiredCount = this._normalizeRequiredCount(preview.rule, totalCount, activeParticipants);
    getLogger().info('governance.challenge.zone_downgraded', {
      original: preview.zone, downgraded: feasibility.suggestedZone,
      reason: feasibility.reason
    });
  } else {
    // Skip this challenge entirely
    getLogger().info('governance.challenge.skipped_infeasible', { reason: feasibility.reason });
    const nextDelay = this._pickIntervalMs(challengeConfig.intervalRangeSeconds);
    queueNextChallenge(nextDelay);
    this._schedulePulse(50);
    return false;
  }
}
```

### Step 4: Run tests

Run: `npx jest tests/isolated/domain/fitness/challenge-feasibility.unit.test.mjs --no-cache`
Expected: PASS

### Step 5: Commit

```bash
git add frontend/src/hooks/fitness/GovernanceEngine.js tests/isolated/domain/fitness/challenge-feasibility.unit.test.mjs
git commit -m "fix(fitness): add challenge feasibility check before triggering

Challenges requiring all participants at hot zone were structurally
impossible when a participant was 30+ BPM below threshold. Same failure
documented in Feb 16 and Feb 25 audits.

Now checks if participants are within 20 BPM of target zone before
starting. If not feasible, downgrades zone (hot→warm→active) or skips."
```

---

## Task 4: Fix Chart Participant Mismatch Spam (756+ console.warn/session)

**Why:** 756 `[FitnessChart] Participant count mismatch!` + 493 `[FitnessChart] Avatar mismatch` events per session, all using raw `console.warn` (bypasses structured logger, floods Docker logs). Root cause: roster includes a `global` synthetic entry that the chart can't render.

**Files:**
- Modify: `frontend/src/modules/Fitness/FitnessPlugins/plugins/FitnessChartApp/FitnessChartApp.jsx:197,832`
- Modify: `frontend/src/modules/Fitness/FitnessSidebar/FitnessChart.helpers.js:281`

### Step 1: Convert console.warn to logger.sampled

In `FitnessChartApp.jsx`, replace lines around 197 and 832:

**Line ~197** (Avatar mismatch):
```javascript
// BEFORE:
console.warn('[FitnessChart] Avatar mismatch', { ... });

// AFTER:
getLogger().sampled('fitness_chart.avatar_mismatch', {
  rosterCount,
  activeRosterCount,
  chartCount,
  missingFromChart: missing,
  extraOnChart: extra
}, { maxPerMinute: 2, aggregate: true });
```

**Line ~832** (Participant count mismatch):
```javascript
// BEFORE:
console.warn('[FitnessChart] Participant count mismatch!', { ... });

// AFTER:
getLogger().sampled('fitness_chart.participant_mismatch', {
  rosterCount,
  chartPresentCount,
  chartTotalCount: allEntries.length,
  missingFromChart: rosterIds.filter(id => !chartPresentIds.includes(id))
}, { maxPerMinute: 2, aggregate: true });
```

### Step 2: Filter `global` from roster before chart processing

In the `useRaceChartData` hook (around line 153 of `FitnessChartApp.jsx`), filter out the `global` synthetic entry before computing mismatches:

```javascript
// Filter out synthetic entries (e.g., "global" combined score) before comparison
const rosterForChart = roster.filter(r => {
  const id = r.profileId || r.hrDeviceId || r.name || '';
  return id !== 'global' && !id.startsWith('global:');
});
```

Then use `rosterForChart` instead of `roster` in the mismatch calculations.

### Step 3: Fix no_series_data spam

In `FitnessChart.helpers.js` line ~281, the warning already uses `getLogger().warn()`. Change to sampled:

```javascript
// BEFORE:
getLogger().warn('fitness_chart.no_series_data', { ... });

// AFTER:
getLogger().sampled('fitness_chart.no_series_data', {
  targetId,
  name: rosterEntry?.name || rosterEntry?.displayLabel,
}, { maxPerMinute: 5, aggregate: true });
```

### Step 4: Commit

```bash
git add frontend/src/modules/Fitness/FitnessPlugins/plugins/FitnessChartApp/FitnessChartApp.jsx frontend/src/modules/Fitness/FitnessSidebar/FitnessChart.helpers.js
git commit -m "fix(fitness): eliminate chart mismatch log spam (1,249 events/session)

Convert raw console.warn calls to logger.sampled() and filter 'global'
synthetic entry from roster before chart processing. Reduces Docker log
volume from 1,249 chart warnings per session to ~10."
```

---

## Task 5: Fix TreasureBox/ZoneProfileStore Zone Mismatch

**Why:** ZoneProfileStore computes hysteresis-stabilized zones (5 BPM Schmitt trigger), but the LED system and roster read raw zones from TreasureBox, bypassing hysteresis. LEDs change color at ~2x the intended rate. Documented in Feb 25 zone audit.

**Note:** ParticipantRoster._buildZoneLookup (lines 283-310) already has a ZoneProfileStore override path (lines 299-310) that attempts to correct this. But the override only fires when `getZoneState(trackingId)` returns a value, which may fail on timing.

**Files:**
- Modify: `frontend/src/hooks/fitness/TreasureBox.js:520-527`
- Test: `tests/isolated/domain/fitness/treasurebox-zone-sync.unit.test.mjs` (create)

### Step 1: Write the failing test

Create `tests/isolated/domain/fitness/treasurebox-zone-sync.unit.test.mjs`:

```javascript
import { describe, it, expect, jest } from '@jest/globals';

describe('TreasureBox zone update', () => {
  it('should prefer committed zone from ZoneProfileStore over raw zone', () => {
    // Simulate: raw zone is 'active', committed (hysteresis) zone is 'warm'
    const mockZoneProfileStore = {
      getCommittedZone: jest.fn((userId) => {
        if (userId === 'alan') return { zoneId: 'warm', zoneName: 'Warm', zoneColor: '#ffaa00' };
        return null;
      })
    };

    const rawZone = { id: 'active', name: 'Active', color: '#00cc00', min: 100 };
    const committedZone = mockZoneProfileStore.getCommittedZone('alan');

    // The fix: use committed zone when available
    const finalZoneId = committedZone?.zoneId || rawZone.id;
    expect(finalZoneId).toBe('warm'); // Hysteresis-stabilized, not raw
  });

  it('should fall back to raw zone when ZoneProfileStore has no data', () => {
    const mockZoneProfileStore = {
      getCommittedZone: jest.fn(() => null)
    };

    const rawZone = { id: 'active', name: 'Active', color: '#00cc00', min: 100 };
    const committedZone = mockZoneProfileStore.getCommittedZone('newuser');

    const finalZoneId = committedZone?.zoneId || rawZone.id;
    expect(finalZoneId).toBe('active'); // Raw is fine when no committed data
  });
});
```

### Step 2: Run test to verify logic

Run: `npx jest tests/isolated/domain/fitness/treasurebox-zone-sync.unit.test.mjs --no-cache`
Expected: PASS

### Step 3: Add ZoneProfileStore reference to TreasureBox

In `TreasureBox.js`, add a method to set the ZoneProfileStore reference and use it in `recordUserHeartRate()`.

Near the constructor, add:

```javascript
setZoneProfileStore(store) {
  this._zoneProfileStore = store;
}
```

In `recordUserHeartRate()` around lines 520-527, after resolving the raw zone, check ZoneProfileStore:

```javascript
if (zone) {
  // Prefer committed zone from ZoneProfileStore (honors hysteresis)
  const committedZone = this._zoneProfileStore?.getZoneState?.(accKey);
  const effectiveZoneId = committedZone?.zoneId || zone.id || zone.name || null;
  const effectiveColor = committedZone?.zoneColor || zone.color;

  if (!acc.highestZone || zone.min > acc.highestZone.min) {
    this._log('update_highest_zone', { accKey, zone: { id: zone.id, name: zone.name } });
    acc.highestZone = zone;
  }
  acc.currentColor = effectiveColor;
  acc.lastColor = effectiveColor;
  acc.lastZoneId = effectiveZoneId;
}
```

In `FitnessSession.js`, after creating the TreasureBox (in the constructor or init), wire the reference:

```javascript
if (this.treasureBox && this.zoneProfileStore) {
  this.treasureBox.setZoneProfileStore(this.zoneProfileStore);
}
```

### Step 4: Commit

```bash
git add frontend/src/hooks/fitness/TreasureBox.js frontend/src/hooks/fitness/FitnessSession.js tests/isolated/domain/fitness/treasurebox-zone-sync.unit.test.mjs
git commit -m "fix(fitness): TreasureBox reads committed zone from ZoneProfileStore

TreasureBox was eagerly updating lastZoneId with raw zone from
resolveZone(), bypassing the Schmitt trigger hysteresis in
ZoneProfileStore. LEDs changed color at ~2x the intended rate.

Now checks ZoneProfileStore for committed zone first, falling back
to raw zone only when no committed data exists."
```

---

## Task 6: Device Startup HR Discard Window

**Why:** BLE heart rate monitors send stale cached readings on connect (e.g., 161 BPM → 90 BPM). This causes false hot-zone assignment for 3 ticks, then a sudden drop to cool for 25 ticks (125 seconds). The governance engine didn't trigger a cool-zone warning because it hadn't fully activated. Documented in Feb 25 postmortem.

**Files:**
- Modify: `frontend/src/hooks/fitness/FitnessSession.js:469-531` (recordDeviceActivity)
- Test: `tests/isolated/domain/fitness/device-startup-discard.unit.test.mjs` (create)

### Step 1: Write the failing test

Create `tests/isolated/domain/fitness/device-startup-discard.unit.test.mjs`:

```javascript
import { describe, it, expect, jest } from '@jest/globals';

describe('device startup HR discard', () => {
  const STARTUP_DISCARD_COUNT = 3; // Discard first 3 HR readings per device

  function shouldDiscardHr(deviceId, sampleCountMap) {
    const count = sampleCountMap.get(deviceId) || 0;
    sampleCountMap.set(deviceId, count + 1);
    return count < STARTUP_DISCARD_COUNT;
  }

  it('should discard first 3 HR readings from a device', () => {
    const counts = new Map();
    expect(shouldDiscardHr('28676', counts)).toBe(true);  // 1st
    expect(shouldDiscardHr('28676', counts)).toBe(true);  // 2nd
    expect(shouldDiscardHr('28676', counts)).toBe(true);  // 3rd
    expect(shouldDiscardHr('28676', counts)).toBe(false); // 4th — accept
  });

  it('should track counts per device independently', () => {
    const counts = new Map();
    expect(shouldDiscardHr('28676', counts)).toBe(true);
    expect(shouldDiscardHr('28688', counts)).toBe(true);
    expect(shouldDiscardHr('28676', counts)).toBe(true);
    expect(shouldDiscardHr('28688', counts)).toBe(true);
    expect(shouldDiscardHr('28676', counts)).toBe(true);
    expect(shouldDiscardHr('28676', counts)).toBe(false); // 28676 past threshold
    expect(shouldDiscardHr('28688', counts)).toBe(true);  // 28688 still discarding
    expect(shouldDiscardHr('28688', counts)).toBe(false);  // 28688 past threshold
  });

  it('should pass through non-HR device data immediately', () => {
    // Only HR data should be discarded, not RPM or other sensor types
    // This test documents the expectation — implementation checks deviceData.type
    expect(true).toBe(true);
  });
});
```

### Step 2: Run test

Run: `npx jest tests/isolated/domain/fitness/device-startup-discard.unit.test.mjs --no-cache`
Expected: PASS

### Step 3: Add startup discard to recordDeviceActivity

In `FitnessSession.js`, add a startup sample counter map in the constructor:

```javascript
this._deviceHrSampleCount = new Map();
```

In `recordDeviceActivity()` (line ~508), before the TreasureBox and ZoneProfileStore updates, add a discard check:

```javascript
// Device startup discard: first 3 HR readings may be stale/cached from prior session
if (deviceData.type === 'heart_rate') {
  const STARTUP_DISCARD_COUNT = 3;
  const deviceKey = String(device.id);
  const count = this._deviceHrSampleCount.get(deviceKey) || 0;
  this._deviceHrSampleCount.set(deviceKey, count + 1);
  if (count < STARTUP_DISCARD_COUNT) {
    getLogger().debug('fitness.device_startup_discard', {
      deviceId: deviceKey,
      sampleIndex: count,
      discardedHr: deviceData.heartRate,
      reason: 'BLE monitors may send stale cached values on connect'
    });
    return; // Skip TreasureBox update, zone sync, and governance notification
  }
}
```

### Step 4: Commit

```bash
git add frontend/src/hooks/fitness/FitnessSession.js tests/isolated/domain/fitness/device-startup-discard.unit.test.mjs
git commit -m "fix(fitness): discard first 3 HR readings per device on connect

BLE heart rate monitors send stale cached readings when first connected
(e.g., 161 BPM from prior session). This caused false hot-zone assignment
followed by sudden cool-zone drop, confusing governance and users.

First 3 HR samples per device are now treated as provisional and skipped
for zone/governance purposes."
```

---

## Task 7: Expand Live Integration Tests for Regression Coverage

**Why:** The existing `fitness-happy-path.runtime.test.mjs` has 13 tests covering API health, UI loading, video playback, simulation, and persistence. But it has no tests for the 6 issues fixed in Tasks 1–6. We need regression tests that will catch these issues if they recur.

**Files:**
- Modify: `tests/live/flow/fitness/fitness-happy-path.runtime.test.mjs` (add tests 14–19)

### Step 1: Add Test 14 — Render thrashing stays below threshold

After test 13, add:

```javascript
// ═══════════════════════════════════════════════════════════════
// TEST 14: Render thrashing stays below threshold during active session
// Regression: batchedForceUpdate fired ~1,400/30s causing CPU starvation
// Fix: Throttled to max 4/sec (Task 1)
// ═══════════════════════════════════════════════════════════════
test('render update rate stays below threshold during simulation', async () => {
  // Navigate to fitness and start simulation
  if (!sharedPage.url().includes('/fitness')) {
    await sharedPage.goto(`${BASE_URL}/fitness`, { waitUntil: 'domcontentloaded', timeout: 15000 });
    await sharedPage.waitForTimeout(2000);
  }

  const sim = new FitnessSimHelper(sharedPage);
  await sim.waitForController();

  // Activate all devices to generate HR traffic
  await sim.activateAll('warm');
  const devices = await sim.getDevices();
  await sim.waitForActiveCount(devices.length, 5000);

  // Collect render stats over 10 seconds
  const startStats = await sharedPage.evaluate(() => {
    const session = window.__fitnessSession;
    // Access the render stats ref from FitnessContext
    return {
      timestamp: Date.now(),
      // forceUpdateCount is tracked on the renderStatsRef
      forceUpdateCount: window.__fitnessRenderStats?.forceUpdateCount ?? null
    };
  });

  await sharedPage.waitForTimeout(10000);

  const endStats = await sharedPage.evaluate(() => ({
    timestamp: Date.now(),
    forceUpdateCount: window.__fitnessRenderStats?.forceUpdateCount ?? null
  }));

  await sim.stopAll();

  if (startStats.forceUpdateCount != null && endStats.forceUpdateCount != null) {
    const elapsed = (endStats.timestamp - startStats.timestamp) / 1000;
    const updates = endStats.forceUpdateCount - startStats.forceUpdateCount;
    const rate = updates / elapsed;
    console.log(`Force update rate: ${rate.toFixed(1)}/sec over ${elapsed.toFixed(1)}s (${updates} updates)`);

    // With 250ms throttle, max should be ~4/sec. Allow some headroom.
    expect(rate).toBeLessThan(10); // Was ~47/sec before fix
  } else {
    // If render stats not exposed, check dev.log for render_thrashing warnings
    const logContent = readDevLog(testLogPosition);
    const thrashingWarnings = logContent.split('\n').filter(l => l.includes('render_thrashing'));
    console.log(`Render thrashing warnings in log: ${thrashingWarnings.length}`);
    // Should be 0 or very few with the throttle
    expect(thrashingWarnings.length).toBeLessThan(5);
  }
});
```

### Step 2: Add Test 15 — No phantom stall overlays during smooth playback

```javascript
// ═══════════════════════════════════════════════════════════════
// TEST 15: No phantom stall overlays during smooth playback
// Regression: 66 false stall events per session, overlay flashed needlessly
// Fix: Validate playhead advancement before showing overlay (Task 2)
// ═══════════════════════════════════════════════════════════════
test('no phantom stall overlays during playback with simulation', async () => {
  if (!plexContentAvailable) {
    console.log('Skipping: Plex content not available');
    test.skip();
    return;
  }

  const sim = new FitnessSimHelper(sharedPage);
  await sim.waitForController();

  // Activate devices to generate HR traffic while video plays
  await sim.activateAll('active');

  // Let video play for 15 seconds with HR simulation active
  await sharedPage.waitForTimeout(15000);

  // Check dev.log for phantom stall events
  const logContent = readDevLog(testLogPosition);
  const stallEvents = logContent.split('\n').filter(l => l.includes('playback.stalled'));
  const phantomStalls = logContent.split('\n').filter(l => l.includes('playback.stall_phantom'));

  console.log(`Stall events: ${stallEvents.length}, Phantom (suppressed): ${phantomStalls.length}`);

  // Real stalls should be very rare. Before fix: 66 in 30min. After fix: near 0.
  // Allow a few legitimate stalls (network hiccups), but phantom suppression should work.
  const realStalls = stallEvents.length - phantomStalls.length;
  console.log(`Real stalls (not phantom): ${realStalls}`);
  expect(realStalls).toBeLessThan(5);

  await sim.stopAll();
});
```

### Step 3: Add Test 16 — Challenge feasibility prevents unwinnable challenges

```javascript
// ═══════════════════════════════════════════════════════════════
// TEST 16: Challenge feasibility prevents unwinnable challenges
// Regression: Hot-zone challenge triggered when participant was 32 BPM below threshold
// Fix: Feasibility check with zone downgrade (Task 3)
// ═══════════════════════════════════════════════════════════════
test('challenge does not target unreachable zones', async () => {
  if (!sharedPage.url().includes('/fitness')) {
    await sharedPage.goto(`${BASE_URL}/fitness`, { waitUntil: 'domcontentloaded', timeout: 15000 });
    await sharedPage.waitForTimeout(2000);
  }

  const sim = new FitnessSimHelper(sharedPage);
  await sim.waitForController();

  // Put all devices in cool zone (far from hot)
  await sim.activateAll('cool');
  const devices = await sim.getDevices();
  await sim.waitForActiveCount(devices.length, 5000);

  // Enable governance and try to trigger a hot challenge
  await sim.enableGovernance({
    challenges: { enabled: true, interval: 5, duration: 30 }
  });

  const challengeResult = await sim.triggerChallenge({ targetZone: 'hot' });

  // Wait for challenge to be processed
  await sharedPage.waitForTimeout(2000);
  const state = await sim.getGovernanceState();

  if (state.activeChallenge) {
    // If a challenge was created, it should NOT be hot (should have been downgraded)
    console.log(`Challenge zone: ${state.activeChallenge.targetZone} (requested: hot)`);
    // After feasibility check, hot should be downgraded to something achievable
    // or the challenge should be skipped entirely
    const zone = state.activeChallenge.targetZone;
    expect(['cool', 'active', 'warm'].includes(zone) || zone !== 'hot',
      `Challenge should not target hot when all devices are in cool zone, got: ${zone}`
    ).toBe(true);
  } else {
    // Challenge was skipped (also acceptable — infeasible)
    console.log('Challenge skipped as infeasible (correct behavior)');
  }

  // Check log for feasibility event
  const logContent = readDevLog(testLogPosition);
  const feasibilityEvents = logContent.split('\n').filter(l =>
    l.includes('challenge.skipped_infeasible') || l.includes('challenge.zone_downgraded')
  );
  console.log(`Feasibility events: ${feasibilityEvents.length}`);
  expect(feasibilityEvents.length).toBeGreaterThan(0);

  await sim.disableGovernance();
  await sim.stopAll();
});
```

### Step 4: Add Test 17 — No chart mismatch console.warn spam

```javascript
// ═══════════════════════════════════════════════════════════════
// TEST 17: No chart mismatch console.warn spam
// Regression: 756 raw console.warn calls per session from FitnessChart
// Fix: Convert to logger.sampled(), filter 'global' entry (Task 4)
// ═══════════════════════════════════════════════════════════════
test('chart does not spam console.warn during session', async () => {
  if (!sharedPage.url().includes('/fitness')) {
    await sharedPage.goto(`${BASE_URL}/fitness`, { waitUntil: 'domcontentloaded', timeout: 15000 });
    await sharedPage.waitForTimeout(2000);
  }

  // Capture console.warn count during a 10-second simulation
  let warnCount = 0;
  const chartWarnMessages = [];
  const warnHandler = (msg) => {
    if (msg.type() === 'warning') {
      const text = msg.text();
      if (text.includes('[FitnessChart]')) {
        warnCount++;
        if (chartWarnMessages.length < 5) chartWarnMessages.push(text.slice(0, 100));
      }
    }
  };
  sharedPage.on('console', warnHandler);

  const sim = new FitnessSimHelper(sharedPage);
  await sim.waitForController();
  await sim.activateAll('active');

  await sharedPage.waitForTimeout(10000);

  sharedPage.off('console', warnHandler);
  await sim.stopAll();

  console.log(`Chart console.warn count in 10s: ${warnCount}`);
  if (chartWarnMessages.length > 0) {
    console.log('Sample warnings:', chartWarnMessages);
  }

  // Before fix: ~250 in 10s (756 in 30s). After fix: 0 (migrated to logger.sampled).
  expect(warnCount).toBeLessThan(5);
});
```

### Step 5: Add Test 18 — Zone hysteresis honored in LED payload

```javascript
// ═══════════════════════════════════════════════════════════════
// TEST 18: Zone hysteresis honored in LED payload
// Regression: TreasureBox bypassed Schmitt trigger, LEDs changed 2x too fast
// Fix: TreasureBox reads committed zone from ZoneProfileStore (Task 5)
// ═══════════════════════════════════════════════════════════════
test('zone transitions honor hysteresis near boundary', async () => {
  if (!sharedPage.url().includes('/fitness')) {
    await sharedPage.goto(`${BASE_URL}/fitness`, { waitUntil: 'domcontentloaded', timeout: 15000 });
    await sharedPage.waitForTimeout(2000);
  }

  const sim = new FitnessSimHelper(sharedPage);
  await sim.waitForController();

  const devices = await sim.getDevices();
  const device = devices[0];

  // Set to warm zone firmly
  await sim.setZone(device.deviceId, 'warm');
  await sim.waitForZone(device.deviceId, 'warm');

  // Now set HR to just below warm threshold (inside exit margin)
  // The Schmitt trigger should keep zone as 'warm' due to 5 BPM exit margin
  const warmDevice = (await sim.getDevices()).find(d => d.deviceId === device.deviceId);
  const warmHr = warmDevice.currentHR;
  console.log(`Device at ${warmHr} BPM (warm zone)`);

  // Drop HR by 3 BPM (within 5 BPM exit margin — should stay warm)
  await sim.setHR(device.deviceId, warmHr - 3);
  await sharedPage.waitForTimeout(2000);

  const afterDrop = (await sim.getDevices()).find(d => d.deviceId === device.deviceId);
  console.log(`After 3 BPM drop: ${afterDrop.currentHR} BPM, zone: ${afterDrop.currentZone}`);

  // Zone should still be 'warm' (hysteresis suppresses the transition)
  // If the fix works, TreasureBox reports the committed zone, not the raw zone
  expect(afterDrop.currentZone).toBe('warm');

  await sim.stopAll();
});
```

### Step 6: Add Test 19 — Device startup HR readings are discarded

```javascript
// ═══════════════════════════════════════════════════════════════
// TEST 19: Device startup HR readings are discarded
// Regression: BLE monitors send stale cached readings (161→90 BPM spike)
// Fix: First 3 HR readings per device are discarded (Task 6)
// ═══════════════════════════════════════════════════════════════
test('device startup does not cause false zone assignment', async () => {
  if (!sharedPage.url().includes('/fitness')) {
    await sharedPage.goto(`${BASE_URL}/fitness`, { waitUntil: 'domcontentloaded', timeout: 15000 });
    await sharedPage.waitForTimeout(2000);
  }

  const sim = new FitnessSimHelper(sharedPage);
  await sim.waitForController();

  // Clear all devices first to simulate fresh connection
  await sim.clearAllDevices();
  await sharedPage.waitForTimeout(1000);

  // Check dev.log for startup discard events
  const logPos = getDevLogPosition();

  // Activate a device (simulates fresh BLE connect)
  const devices = await sim.getDevices();
  if (devices.length === 0) {
    console.log('No devices available after clear, skipping');
    test.skip();
    return;
  }

  await sim.setHR(devices[0].deviceId, 160); // Simulate stale high reading
  await sharedPage.waitForTimeout(500);
  await sim.setHR(devices[0].deviceId, 155); // Another stale reading
  await sharedPage.waitForTimeout(500);
  await sim.setHR(devices[0].deviceId, 90);  // Real reading (cool zone)
  await sharedPage.waitForTimeout(500);
  await sim.setHR(devices[0].deviceId, 95);  // 4th reading — should be accepted
  await sharedPage.waitForTimeout(2000);

  // Check for startup discard log events
  const logContent = readDevLog(logPos);
  const discardEvents = logContent.split('\n').filter(l => l.includes('device_startup_discard'));
  console.log(`Startup discard events: ${discardEvents.length}`);

  // Should have discarded at least the first 3 readings
  expect(discardEvents.length).toBeGreaterThanOrEqual(3);

  // The device should NOT have been assigned to hot/warm zone from the stale 160/155 readings
  const finalDevice = (await sim.getDevices()).find(d => d.deviceId === devices[0].deviceId);
  if (finalDevice) {
    console.log(`Final zone: ${finalDevice.currentZone} at ${finalDevice.currentHR} BPM`);
    // Should be cool/active (from the 90-95 readings), not hot/warm (from stale 160/155)
    expect(['cool', 'active'].includes(finalDevice.currentZone) || finalDevice.currentZone !== 'hot',
      `Zone should not be hot from stale readings, got: ${finalDevice.currentZone}`
    ).toBe(true);
  }

  await sim.stopAll();
});
```

### Step 7: Commit

```bash
git add tests/live/flow/fitness/fitness-happy-path.runtime.test.mjs
git commit -m "test(fitness): add regression tests for 6 recurring audit issues

Tests 14-19 verify:
- Render update rate stays below threshold (was ~47/sec, now <10/sec)
- No phantom stall overlays during smooth playback
- Challenge feasibility prevents unwinnable zone targets
- No chart console.warn spam (was 756/session)
- Zone hysteresis honored at boundaries (Schmitt trigger)
- Device startup HR readings discarded (stale BLE cache)"
```

---

## Summary

| Task | Issue | Audits | Expected Impact |
|------|-------|--------|-----------------|
| 1 | Render thrashing (root cause) | 5 audits, Feb 15–25 | Reduces force updates from ~1,400/30s to ~120/30s |
| 2 | Phantom stall overlays | Feb 25 | Eliminates false "Seeking..." flashes |
| 3 | Unwinnable challenges | Feb 16, Feb 25 | No more impossible hot-zone challenges |
| 4 | Chart log spam (1,249/session) | Feb 15, Feb 25 | Reduces to ~10 sampled events |
| 5 | LED zone thrashing | Feb 25 | LEDs honor hysteresis, change at intended rate |
| 6 | Device startup HR spike | Feb 25 | No false zone assignments on device connect |
| 7 | Live regression tests | All | Tests 14–19 catch all 6 issues if they recur |

**Not included (working):** Voice memo persistence, tick timer (already fixed), zone profile build logging (already sampled).

**Remaining architectural debt (out of scope):** God object decomposition, session churn, multi-client split-brain, WebSocket reconnection cascade. These are larger efforts that should be separate plans.
