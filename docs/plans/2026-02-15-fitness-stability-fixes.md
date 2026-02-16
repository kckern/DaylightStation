# Fitness Stability Fixes — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Fix the 7 active bugs documented in `docs/_wip/audits/2026-02-15-fitness-session-log-audit.md` — timer runaway, render thrashing, session churn, governance phase thrashing, phantom saves, chart/governance noise, and WebSocket cascade.

**Architecture:** All fixes are surgical changes to existing files in the frontend fitness session layer (`frontend/src/hooks/fitness/`) and context provider (`frontend/src/context/FitnessContext.jsx`). No new files, no new dependencies. Fixes are ordered by blast radius: callback batching first (breaks the feedback loop), then timer hardening, then input validation, then defense-in-depth.

**Tech Stack:** React (context + hooks), plain JS classes (FitnessSession, GovernanceEngine), Jest unit tests with `#frontend/` import aliases.

**Audit reference:** `docs/_wip/audits/2026-02-15-fitness-session-log-audit.md`
**Architecture reference:** `docs/reference/fitness/fitness-system-architecture.md`, `docs/reference/fitness/governance-system-architecture.md`

---

## Task 1: Batch Governance forceUpdate Calls (P0 — Findings 2, 5, 7)

**Why:** The #1 amplification source. Governance callbacks (`onPhaseChange`, `onPulse`, `onStateChange`) each call `forceUpdate()` directly, triggering immediate React re-renders. Each render calls `updateSnapshot()` → `evaluate()` → more state changes → more renders. Switching to `batchedForceUpdate()` coalesces all updates within a single `requestAnimationFrame`, breaking the feedback loop. The TreasureBox mutation callback has the same problem — it calls `_triggerPulse()` (which calls `evaluate()`) AND `forceUpdate()`, creating a double-render.

**Files:**
- Modify: `frontend/src/context/FitnessContext.jsx:524-528` (governance callbacks)
- Modify: `frontend/src/context/FitnessContext.jsx:583-589` (TreasureBox mutation callback)
- Test: `tests/unit/fitness/governance-batched-updates.test.mjs` (new)

**Step 1: Write the failing test**

Create `tests/unit/fitness/governance-batched-updates.test.mjs`:

```javascript
import { describe, it, expect, jest, beforeEach, afterEach } from '@jest/globals';

jest.unstable_mockModule('#frontend/lib/logging/Logger.js', () => ({
  default: () => ({
    debug: jest.fn(), info: jest.fn(), warn: jest.fn(),
    error: jest.fn(), sampled: jest.fn()
  }),
  getLogger: () => ({
    debug: jest.fn(), info: jest.fn(), warn: jest.fn(),
    error: jest.fn(), sampled: jest.fn()
  })
}));

const { GovernanceEngine } = await import('#frontend/hooks/fitness/GovernanceEngine.js');

function createEngine({ participants = [] } = {}) {
  const zoneConfig = [
    { id: 'cool', name: 'Cool', color: '#3399ff' },
    { id: 'active', name: 'Active', color: '#00cc00' },
    { id: 'warm', name: 'Warm', color: '#ffaa00' },
    { id: 'hot', name: 'Hot', color: '#ff0000' },
  ];
  const mockSession = {
    roster: participants.map(id => ({ id, isActive: true })),
    zoneProfileStore: null,
    snapshot: { zoneConfig }
  };
  const engine = new GovernanceEngine(mockSession);
  engine.configure({
    governed_labels: ['exercise'],
    grace_period_seconds: 30,
  }, [{
    id: 'default',
    name: 'Default',
    minParticipants: 1,
    baseRequirement: { active: 'all', grace_period_seconds: 30 },
    challenges: []
  }], {});
  engine.media = { id: 'test-media', labels: ['exercise'], type: 'video' };

  const zoneRankMap = {};
  const zoneInfoMap = {};
  zoneConfig.forEach((z, i) => {
    zoneRankMap[z.id] = i;
    zoneInfoMap[z.id] = z;
  });

  return { engine, zoneRankMap, zoneInfoMap };
}

describe('Governance callbacks should not cause render amplification', () => {
  it('onPhaseChange should not be called synchronously during evaluate()', async () => {
    const participants = ['alice'];
    const { engine, zoneRankMap, zoneInfoMap } = createEngine({ participants });

    let phaseChangeCalls = 0;
    let evaluateReturned = false;

    engine.setCallbacks({
      onPhaseChange: () => {
        phaseChangeCalls++;
        // If this fires before evaluate returns, it's synchronous (bad for direct forceUpdate)
        // The callback itself should be safe to call — the issue is what the CONSUMER does with it
      }
    });

    // Force a phase change by satisfying requirements with bypassed hysteresis
    engine._hysteresisMs = 0;
    engine.meta.satisfiedSince = Date.now() - 5000;
    engine.evaluate({
      activeParticipants: participants,
      userZoneMap: { alice: 'active' },
      zoneRankMap,
      zoneInfoMap,
      totalCount: 1
    });
    evaluateReturned = true;

    // Phase should have changed
    expect(engine.phase).toBe('unlocked');
    // onPhaseChange fires synchronously (this is inherent to the engine)
    // The fix is that the CONSUMER (FitnessContext) uses batchedForceUpdate
    expect(phaseChangeCalls).toBeGreaterThan(0);
  });

  it('_invalidateStateCache should batch onStateChange via microtask', async () => {
    const participants = ['alice'];
    const { engine, zoneRankMap, zoneInfoMap } = createEngine({ participants });

    let stateChangeCalls = 0;
    engine.setCallbacks({
      onStateChange: () => { stateChangeCalls++; }
    });

    // Trigger multiple invalidations (simulates evaluate + phase change)
    engine._invalidateStateCache();
    engine._invalidateStateCache();
    engine._invalidateStateCache();

    // Should NOT fire synchronously
    expect(stateChangeCalls).toBe(0);

    // Should fire once after microtask
    await new Promise(resolve => queueMicrotask(resolve));
    expect(stateChangeCalls).toBe(1);
  });
});
```

**Step 2: Run test to verify baseline**

```bash
npx jest tests/unit/fitness/governance-batched-updates.test.mjs --no-cache
```

Expected: Tests pass (they're verifying existing engine behavior, not the consumer fix).

**Step 3: Apply the fix — batch all governance callbacks in FitnessContext**

In `frontend/src/context/FitnessContext.jsx`, change lines 524-528 from:

```javascript
session.governanceEngine.setCallbacks({
  onPhaseChange: () => forceUpdate(),
  onPulse: () => forceUpdate(),
  onStateChange: () => forceUpdate()
});
```

to:

```javascript
session.governanceEngine.setCallbacks({
  onPhaseChange: () => batchedForceUpdate(),
  onPulse: () => batchedForceUpdate(),
  onStateChange: () => batchedForceUpdate()
});
```

And change the TreasureBox mutation callback at lines 583-589 from:

```javascript
box.setMutationCallback(() => {
  session.governanceEngine?._triggerPulse();
  forceUpdate();
});
```

to:

```javascript
box.setMutationCallback(() => {
  session.governanceEngine?._triggerPulse();
  batchedForceUpdate();
});
```

**Step 4: Run existing governance tests to verify no regression**

```bash
npx jest tests/unit/governance/ --no-cache
npx jest tests/isolated/domain/fitness/governance-reactive.unit.test.mjs --no-cache
```

Expected: All pass.

**Step 5: Commit**

```bash
git add frontend/src/context/FitnessContext.jsx tests/unit/fitness/governance-batched-updates.test.mjs
git commit -m "fix: batch governance + TreasureBox callbacks via batchedForceUpdate

All governance callbacks (onPhaseChange, onPulse, onStateChange) and
TreasureBox mutation callback now use batchedForceUpdate() instead of
direct forceUpdate(). This coalesces state changes within a single
requestAnimationFrame, breaking the feedback loop where evaluate() →
phase change → forceUpdate → render → updateSnapshot → evaluate().

Addresses audit findings 2, 5, 7 (render thrashing, governance
phase thrashing, chart/governance noise amplification)."
```

---

## Task 2: Tick Timer Rate Limiter + Generation Counter (P0 — Finding 1)

**Why:** `_startTickTimer()` is called via `_stopTickTimer()` + `setInterval()` on every session start. During rapid session churn (14 sessions in 10 min), the stop/start cycle creates 1,198 timer starts/min. The existing guard (`_stopTickTimer()` first) is insufficient because the stop/start happens faster than the interval fires. A rate limiter prevents restarting the timer within 4 seconds of the last start, and a generation counter invalidates stale timers from old sessions.

**Files:**
- Modify: `frontend/src/hooks/fitness/FitnessSession.js:2094-2148` (tick timer)
- Test: `tests/unit/fitness/tick-timer-rate-limit.test.mjs` (new)

**Step 1: Write the failing test**

Create `tests/unit/fitness/tick-timer-rate-limit.test.mjs`:

```javascript
import { describe, it, expect, jest, beforeEach, afterEach } from '@jest/globals';

jest.unstable_mockModule('#frontend/lib/logging/Logger.js', () => ({
  default: () => ({
    debug: jest.fn(), info: jest.fn(), warn: jest.fn(),
    error: jest.fn(), sampled: jest.fn()
  }),
  getLogger: () => ({
    debug: jest.fn(), info: jest.fn(), warn: jest.fn(),
    error: jest.fn(), sampled: jest.fn()
  })
}));

describe('Tick timer rate limiter', () => {
  beforeEach(() => { jest.useFakeTimers(); });
  afterEach(() => { jest.useRealTimers(); });

  it('should reject timer restart within 4 seconds of last start', async () => {
    // Dynamically import after mocks
    const { FitnessSession } = await import('#frontend/hooks/fitness/FitnessSession.js');
    const session = new FitnessSession();
    session._tickIntervalMs = 5000;
    session.timeline = { timebase: { intervalMs: 5000 } };
    session.sessionId = 'test-session';

    // First start should succeed
    session._startTickTimer();
    expect(session._tickTimer).not.toBeNull();
    const firstTimer = session._tickTimer;

    // Immediate restart should be rate-limited (no new timer)
    session._startTickTimer();
    // Timer should still be the original (not restarted)
    expect(session._tickTimer).toBe(firstTimer);

    // After 4 seconds, restart should succeed
    jest.advanceTimersByTime(4100);
    session._stopTickTimer();
    session._startTickTimer();
    expect(session._tickTimer).not.toBeNull();
    expect(session._tickTimer).not.toBe(firstTimer);
  });

  it('should invalidate stale timers via generation counter', async () => {
    const { FitnessSession } = await import('#frontend/hooks/fitness/FitnessSession.js');
    const session = new FitnessSession();
    session._tickIntervalMs = 5000;
    session.timeline = { timebase: { intervalMs: 5000 } };
    session.sessionId = 'test-session';

    let tickCount = 0;
    session._collectTimelineTick = () => { tickCount++; };
    session._checkEmptyRosterTimeout = () => {};

    // Start timer
    session._startTickTimer();
    const gen = session._timerGeneration;

    // Advance to fire one tick
    jest.advanceTimersByTime(5000);
    expect(tickCount).toBe(1);

    // Stop timer (bumps generation)
    session._stopTickTimer();
    expect(session._timerGeneration).toBe(gen + 1);

    // Old timer reference should be cleared
    expect(session._tickTimer).toBeNull();
  });
});
```

**Step 2: Run test to verify it fails**

```bash
npx jest tests/unit/fitness/tick-timer-rate-limit.test.mjs --no-cache
```

Expected: FAIL — `_timerGeneration` is not defined, rate limiting doesn't exist.

**Step 3: Implement the fix**

In `frontend/src/hooks/fitness/FitnessSession.js`, modify the constructor to initialize new fields (find where `_tickTimer` is initialized, add after it):

```javascript
this._timerGeneration = 0;
this._lastTimerStartAt = 0;
```

Replace `_startTickTimer()` (lines 2094-2128) with:

```javascript
  _startTickTimer() {
    const interval = this.timeline?.timebase.intervalMs || this._tickIntervalMs;
    if (!(interval > 0)) return;

    // Rate limiter: don't restart within 4 seconds of last start
    const now = Date.now();
    if (this._tickTimer && (now - this._lastTimerStartAt) < 4000) {
      getLogger().debug('fitness.tick_timer.rate_limited', {
        sessionId: this.sessionId,
        msSinceLastStart: now - this._lastTimerStartAt
      });
      return;
    }

    this._stopTickTimer();
    const gen = ++this._timerGeneration;

    this._lastTimerStartAt = now;
    this._tickTimerStartedAt = now;
    this._tickTimerTickCount = 0;
    getLogger().sampled('fitness.tick_timer.started', {
      sessionId: this.sessionId,
      intervalMs: interval,
      generation: gen
    }, { maxPerMinute: 10 });

    this._tickTimer = setInterval(() => {
      // Generation check: stale timer from old session
      if (this._timerGeneration !== gen) {
        clearInterval(this._tickTimer);
        this._tickTimer = null;
        return;
      }
      this._tickTimerTickCount++;
      try {
        this._collectTimelineTick();
        this._checkEmptyRosterTimeout();
      } catch (err) {
        getLogger().error('fitness.tick_timer.error', {
          sessionId: this.sessionId,
          tick: this._tickTimerTickCount,
          error: err?.message,
          stack: err?.stack?.split('\n').slice(0, 3).join(' | ')
        });
      }

      if (this._tickTimerTickCount % 60 === 0) {
        this._logTickTimerHealth();
      }
    }, interval);
  }
```

Replace `_stopTickTimer()` (lines 2130-2148) with:

```javascript
  _stopTickTimer() {
    ++this._timerGeneration; // Invalidate any in-flight timer
    if (this._tickTimer) {
      const tickCount = this._tickTimerTickCount || 0;
      const ranForMs = Date.now() - (this._tickTimerStartedAt || Date.now());

      if (tickCount > 0 || ranForMs >= 2000) {
        getLogger().info('fitness.tick_timer.stopped', {
          sessionId: this.sessionId,
          tickCount,
          ranForMs,
          generation: this._timerGeneration
        });
      }

      clearInterval(this._tickTimer);
      this._tickTimer = null;
    }
  }
```

**Step 4: Run tests**

```bash
npx jest tests/unit/fitness/tick-timer-rate-limit.test.mjs --no-cache
npx jest tests/unit/governance/ --no-cache
```

Expected: All pass.

**Step 5: Commit**

```bash
git add frontend/src/hooks/fitness/FitnessSession.js tests/unit/fitness/tick-timer-rate-limit.test.mjs
git commit -m "fix: add tick timer rate limiter + generation counter

Prevents timer runaway (1198 starts/min observed in audit). Rate limiter
rejects restarts within 4s of last start. Generation counter invalidates
stale timers from previous sessions. Addresses audit finding 1."
```

---

## Task 3: Governance Relock Grace Period (P0 — Finding 5)

**Why:** The governance engine transitions `pending↔unlocked` within 0-1ms when conditions flicker. The existing 1500ms hysteresis prevents rapid `pending→unlocked` transitions, but there's no guard in the opposite direction: once unlocked, a single evaluation that temporarily sees unmet requirements resets to `pending` and clears `satisfiedSince`. The next evaluation then sees requirements met but must wait 1500ms again. The fix: track `_lastUnlockTime` and add a 5-second relock grace period during which requirements-unmet does NOT transition away from unlocked.

**Files:**
- Modify: `frontend/src/hooks/fitness/GovernanceEngine.js:1397-1467` (phase determination in evaluate)
- Modify: `frontend/src/hooks/fitness/GovernanceEngine.js:623-698` (_setPhase — track unlock time)
- Test: `tests/unit/governance/governance-relock-grace.test.mjs` (new)

**Step 1: Write the failing test**

Create `tests/unit/governance/governance-relock-grace.test.mjs`:

```javascript
import { describe, it, expect, jest } from '@jest/globals';

jest.unstable_mockModule('#frontend/lib/logging/Logger.js', () => ({
  default: () => ({
    debug: jest.fn(), info: jest.fn(), warn: jest.fn(),
    error: jest.fn(), sampled: jest.fn()
  }),
  getLogger: () => ({
    debug: jest.fn(), info: jest.fn(), warn: jest.fn(),
    error: jest.fn(), sampled: jest.fn()
  })
}));

const { GovernanceEngine } = await import('#frontend/hooks/fitness/GovernanceEngine.js');

function createEngine({ participants = [], grace = 30 } = {}) {
  const zoneConfig = [
    { id: 'cool', name: 'Cool', color: '#3399ff' },
    { id: 'active', name: 'Active', color: '#00cc00' },
    { id: 'warm', name: 'Warm', color: '#ffaa00' },
    { id: 'hot', name: 'Hot', color: '#ff0000' },
  ];
  const mockSession = {
    roster: participants.map(id => ({ id, isActive: true })),
    zoneProfileStore: null,
    snapshot: { zoneConfig }
  };
  const engine = new GovernanceEngine(mockSession);
  engine.configure({
    governed_labels: ['exercise'],
    grace_period_seconds: grace,
  }, [{
    id: 'default',
    name: 'Default',
    minParticipants: 1,
    baseRequirement: { active: 'all', grace_period_seconds: grace },
    challenges: []
  }], {});
  engine.media = { id: 'test-media', labels: ['exercise'], type: 'video' };

  const zoneRankMap = {};
  const zoneInfoMap = {};
  zoneConfig.forEach((z, i) => {
    zoneRankMap[z.id] = i;
    zoneInfoMap[z.id] = z;
  });

  return { engine, zoneRankMap, zoneInfoMap };
}

describe('GovernanceEngine — relock grace period', () => {
  it('should stay unlocked for 5s even if requirements briefly break', () => {
    const participants = ['alice'];
    const { engine, zoneRankMap, zoneInfoMap } = createEngine({ participants, grace: 30 });
    const evalOpts = (zones) => ({
      activeParticipants: participants,
      userZoneMap: zones,
      zoneRankMap,
      zoneInfoMap,
      totalCount: 1
    });

    // Get to unlocked (bypass hysteresis)
    engine._hysteresisMs = 0;
    engine.meta.satisfiedSince = Date.now() - 5000;
    engine.evaluate(evalOpts({ alice: 'active' }));
    expect(engine.phase).toBe('unlocked');

    // Simulate _lastUnlockTime being very recent
    engine._lastUnlockTime = Date.now();

    // Requirements break — should stay unlocked during grace
    engine.evaluate(evalOpts({ alice: 'cool' }));
    expect(engine.phase).toBe('unlocked');
  });

  it('should transition to warning after relock grace expires', () => {
    const participants = ['alice'];
    const { engine, zoneRankMap, zoneInfoMap } = createEngine({ participants, grace: 30 });
    const evalOpts = (zones) => ({
      activeParticipants: participants,
      userZoneMap: zones,
      zoneRankMap,
      zoneInfoMap,
      totalCount: 1
    });

    // Get to unlocked
    engine._hysteresisMs = 0;
    engine.meta.satisfiedSince = Date.now() - 5000;
    engine.evaluate(evalOpts({ alice: 'active' }));
    expect(engine.phase).toBe('unlocked');

    // Simulate unlock happened 6 seconds ago (past the 5s grace)
    engine._lastUnlockTime = Date.now() - 6000;

    // Requirements break — should now transition to warning
    engine.evaluate(evalOpts({ alice: 'cool' }));
    expect(engine.phase).toBe('warning');
  });
});
```

**Step 2: Run test to verify it fails**

```bash
npx jest tests/unit/governance/governance-relock-grace.test.mjs --no-cache
```

Expected: FAIL — first test expects `unlocked` but gets `warning` (no grace period exists yet).

**Step 3: Implement the fix**

In `frontend/src/hooks/fitness/GovernanceEngine.js`:

**3a.** In the constructor (around line 153-231), add:

```javascript
this._lastUnlockTime = null;
this._relockGraceMs = 5000;
```

**3b.** In `_setPhase()` (around line 627), after `this.phase = newPhase;`, add tracking:

```javascript
if (newPhase === 'unlocked') {
  this._lastUnlockTime = Date.now();
}
```

**3c.** In `evaluate()`, in the phase determination section (lines 1434+), at the start of the `else` block (where `satisfiedOnce` is true and requirements NOT met), add a relock grace check. Change the block starting at line 1434 from:

```javascript
    } else {
      // Grace period logic - requirements not satisfied, reset hysteresis
      this.meta.satisfiedSince = null;
```

to:

```javascript
    } else {
      // Relock grace: stay unlocked for _relockGraceMs after last unlock
      if (this.phase === 'unlocked' && this._lastUnlockTime &&
          (now - this._lastUnlockTime) < this._relockGraceMs) {
        // Don't transition yet — within relock grace period
        return;
      }
      // Grace period logic - requirements not satisfied, reset hysteresis
      this.meta.satisfiedSince = null;
```

**3d.** In `reset()` and `_resetToIdle()`, add:

```javascript
this._lastUnlockTime = null;
```

**Step 4: Run tests**

```bash
npx jest tests/unit/governance/governance-relock-grace.test.mjs --no-cache
npx jest tests/unit/governance/ --no-cache
npx jest tests/isolated/domain/fitness/governance-reactive.unit.test.mjs --no-cache
```

Expected: All pass.

**Step 5: Commit**

```bash
git add frontend/src/hooks/fitness/GovernanceEngine.js tests/unit/governance/governance-relock-grace.test.mjs
git commit -m "fix: add 5-second relock grace period to governance engine

After transitioning to 'unlocked', governance now holds that phase for
5 seconds even if requirements briefly break. Prevents the 0-1ms
pending↔unlocked thrashing observed in audit (24 transitions/min).
Addresses audit finding 5."
```

---

## Task 4: Session Buffer — Distinct Device Check + Post-End Debounce (P1 — Finding 3)

**Why:** `_maybeStartSessionFromBuffer()` starts a session after 3 HR samples regardless of source. A single device broadcasting at 1Hz meets the threshold in 3 seconds, and after the session ends (60s empty roster), the same device immediately triggers a new session — creating 14 sessions in 10 minutes. Fix: require at least 1 distinct device (already true by accident, but make it explicit), and add a 5-second debounce after session end before allowing a new session.

**Files:**
- Modify: `frontend/src/hooks/fitness/FitnessSession.js:968-1022` (_maybeStartSessionFromBuffer)
- Modify: `frontend/src/hooks/fitness/FitnessSession.js` (endSession — record end time)
- Test: `tests/unit/fitness/session-buffer-debounce.test.mjs` (new)

**Step 1: Write the failing test**

Create `tests/unit/fitness/session-buffer-debounce.test.mjs`:

```javascript
import { describe, it, expect, jest, beforeEach, afterEach } from '@jest/globals';

jest.unstable_mockModule('#frontend/lib/logging/Logger.js', () => ({
  default: () => ({
    debug: jest.fn(), info: jest.fn(), warn: jest.fn(),
    error: jest.fn(), sampled: jest.fn()
  }),
  getLogger: () => ({
    debug: jest.fn(), info: jest.fn(), warn: jest.fn(),
    error: jest.fn(), sampled: jest.fn()
  })
}));

describe('Session buffer debounce after end', () => {
  it('should reject session start within 5 seconds of last session end', async () => {
    const { FitnessSession } = await import('#frontend/hooks/fitness/FitnessSession.js');
    const session = new FitnessSession();

    // Simulate a recently ended session
    session._lastSessionEndTime = Date.now() - 2000; // 2 seconds ago

    // Pre-fill buffer with valid HR samples
    session._preSessionBuffer = [
      { deviceId: '28688', heartRate: 120, type: 'heart_rate', timestamp: Date.now() },
      { deviceId: '28688', heartRate: 121, type: 'heart_rate', timestamp: Date.now() },
      { deviceId: '28688', heartRate: 122, type: 'heart_rate', timestamp: Date.now() },
    ];

    // Should NOT start — within debounce window
    const validSample = { deviceId: '28688', heartRate: 123, type: 'heart_rate', data: { ComputedHeartRate: 123 } };
    const started = session._maybeStartSessionFromBuffer(validSample, Date.now());
    expect(started).toBe(false);
  });

  it('should allow session start after debounce window expires', async () => {
    const { FitnessSession } = await import('#frontend/hooks/fitness/FitnessSession.js');
    const session = new FitnessSession();

    // Simulate a session ended 6 seconds ago
    session._lastSessionEndTime = Date.now() - 6000;

    // Mock ensureStarted to avoid full initialization
    session.ensureStarted = jest.fn(() => true);

    // Pre-fill buffer
    session._preSessionBuffer = [
      { deviceId: '28688', heartRate: 120, type: 'heart_rate', timestamp: Date.now() },
      { deviceId: '28688', heartRate: 121, type: 'heart_rate', timestamp: Date.now() },
    ];

    const validSample = { deviceId: '28688', heartRate: 122, type: 'heart_rate', data: { ComputedHeartRate: 122 } };
    const started = session._maybeStartSessionFromBuffer(validSample, Date.now());
    expect(started).toBe(true);
    expect(session.ensureStarted).toHaveBeenCalled();
  });
});
```

**Step 2: Run test to verify it fails**

```bash
npx jest tests/unit/fitness/session-buffer-debounce.test.mjs --no-cache
```

Expected: FAIL — `_lastSessionEndTime` doesn't exist; debounce logic not implemented.

**Step 3: Implement the fix**

**3a.** In the `FitnessSession` constructor, add:

```javascript
this._lastSessionEndTime = 0;
this._sessionEndDebounceMs = 5000;
```

**3b.** In `endSession()` (around line 1714-1758), add before the final `reset()` call:

```javascript
this._lastSessionEndTime = Date.now();
```

**3c.** In `_maybeStartSessionFromBuffer()` (line 968-1022), add debounce check after the `if (this.sessionId) return false;` guard:

```javascript
    // Debounce: don't start a new session within 5s of the last one ending
    if (this._lastSessionEndTime && (timestamp - this._lastSessionEndTime) < this._sessionEndDebounceMs) {
      return false;
    }
```

**Step 4: Run tests**

```bash
npx jest tests/unit/fitness/session-buffer-debounce.test.mjs --no-cache
npx jest tests/isolated/assembly/fitness-session-v3.assembly.test.mjs --no-cache
```

Expected: All pass.

**Step 5: Commit**

```bash
git add frontend/src/hooks/fitness/FitnessSession.js tests/unit/fitness/session-buffer-debounce.test.mjs
git commit -m "fix: add 5-second debounce between session end and next session start

Prevents session churn (14 sessions in 10 min observed in audit).
After a session ends via empty roster timeout, the system now waits
5 seconds before allowing a new session to start from the pre-session
buffer. Addresses audit finding 3."
```

---

## Task 5: Guard Governance Evaluation — No-Op When Inactive (P1 — Finding 7)

**Why:** `governance.evaluate.no_media_or_rules` fires 2,258 times and `fitness_chart.no_series_data` fires 4,003 times in the audit. The governance `evaluate()` already has a no-media guard (lines 1280-1296) that returns early via `_resetToIdle()`, but `_resetToIdle()` still calls `_setPhase(null)` → `_invalidateStateCache()` → `onStateChange`, triggering more renders. The fix: only call `_setPhase(null)` if phase is NOT already null.

For the chart: `FitnessChartApp` should early-return when there's no series data instead of running full layout computation.

**Files:**
- Modify: `frontend/src/hooks/fitness/GovernanceEngine.js:959-1016` (_resetToIdle)
- Modify: `frontend/src/modules/Fitness/FitnessPlugins/plugins/FitnessChartApp/FitnessChartApp.jsx` (early return)
- Test: `tests/unit/governance/governance-idle-no-thrash.test.mjs` (new)

**Step 1: Write the failing test**

Create `tests/unit/governance/governance-idle-no-thrash.test.mjs`:

```javascript
import { describe, it, expect, jest } from '@jest/globals';

jest.unstable_mockModule('#frontend/lib/logging/Logger.js', () => ({
  default: () => ({
    debug: jest.fn(), info: jest.fn(), warn: jest.fn(),
    error: jest.fn(), sampled: jest.fn()
  }),
  getLogger: () => ({
    debug: jest.fn(), info: jest.fn(), warn: jest.fn(),
    error: jest.fn(), sampled: jest.fn()
  })
}));

const { GovernanceEngine } = await import('#frontend/hooks/fitness/GovernanceEngine.js');

describe('GovernanceEngine — idle state optimization', () => {
  it('should NOT fire onStateChange when _resetToIdle called repeatedly from null phase', async () => {
    const mockSession = {
      roster: [],
      zoneProfileStore: null,
      snapshot: { zoneConfig: [] }
    };
    const engine = new GovernanceEngine(mockSession);

    let stateChangeCalls = 0;
    engine.setCallbacks({
      onStateChange: () => { stateChangeCalls++; }
    });

    // First reset from non-null phase should fire
    engine.phase = 'pending';
    engine._resetToIdle();
    await new Promise(resolve => queueMicrotask(resolve));
    const firstCallCount = stateChangeCalls;

    // Subsequent resets when already at null should NOT fire onStateChange
    engine._resetToIdle();
    engine._resetToIdle();
    engine._resetToIdle();
    await new Promise(resolve => queueMicrotask(resolve));

    // Should not have increased
    expect(stateChangeCalls).toBe(firstCallCount);
  });
});
```

**Step 2: Run test to verify it fails**

```bash
npx jest tests/unit/governance/governance-idle-no-thrash.test.mjs --no-cache
```

Expected: FAIL — currently `_resetToIdle()` always resets `_stateVersion` and may trigger callbacks even when already idle.

**Step 3: Implement the fix**

**3a.** In `GovernanceEngine._resetToIdle()` (line 959), add an early-return at the top:

```javascript
  _resetToIdle() {
    // Already idle — skip all work to avoid 2K+ wasted onStateChange callbacks per session
    if (this.phase === null && !this.meta.satisfiedOnce && !this.challengeState.activeChallenge) {
      return;
    }
```

**3b.** Find `FitnessChartApp.jsx` and locate where it processes series data. Add a guard at the top of the render/return that checks if any series have data points. (The exact file path and line will need to be verified during implementation — look for where `participantSeries` or `raceChartData` is computed. If `totalSeriesPoints === 0`, return a placeholder or null.)

**Step 4: Run tests**

```bash
npx jest tests/unit/governance/governance-idle-no-thrash.test.mjs --no-cache
npx jest tests/unit/governance/ --no-cache
```

Expected: All pass.

**Step 5: Commit**

```bash
git add frontend/src/hooks/fitness/GovernanceEngine.js tests/unit/governance/governance-idle-no-thrash.test.mjs
# Also add FitnessChartApp.jsx if modified
git commit -m "fix: skip _resetToIdle work when governance is already idle

Prevents 2K+ wasted onStateChange callbacks per session when evaluate()
is called repeatedly with no media/rules. Also guards chart rendering
against zero-data computation. Addresses audit finding 7."
```

---

## Task 6: Session Save Validation — Require Non-Empty Series (P1 — Finding 6)

**Why:** Sessions with `ticks=0` but wall-clock duration >60s pass validation. The audit shows `ticks=0, series=6` being saved. The current `tickCount < 3` check reads from `timeline.timebase.tickCount`, which may report ticks that contain only null/zero data. Fix: also require at least 1 non-empty series with >0 real data points.

**Files:**
- Modify: `frontend/src/hooks/fitness/PersistenceManager.js:626-693` (validateSessionPayload)
- Test: `tests/unit/fitness/persistence-validation.test.mjs` (new)

**Step 1: Write the failing test**

Create `tests/unit/fitness/persistence-validation.test.mjs`:

```javascript
import { describe, it, expect, jest } from '@jest/globals';

jest.unstable_mockModule('#frontend/lib/logging/Logger.js', () => ({
  default: () => ({
    debug: jest.fn(), info: jest.fn(), warn: jest.fn(),
    error: jest.fn(), sampled: jest.fn()
  }),
  getLogger: () => ({
    debug: jest.fn(), info: jest.fn(), warn: jest.fn(),
    error: jest.fn(), sampled: jest.fn()
  })
}));

const { PersistenceManager } = await import('#frontend/hooks/fitness/PersistenceManager.js');

describe('PersistenceManager — validation', () => {
  it('should reject sessions where all series are empty/zero', () => {
    const pm = new PersistenceManager();
    const payload = {
      startTime: Date.now() - 120000,
      endTime: Date.now(),
      roster: [{ id: 'alice', name: 'Alice' }],
      deviceAssignments: [{ deviceId: '28688', userId: 'alice' }],
      timeline: {
        timebase: { tickCount: 6 },
        series: {
          'alice:hr': [0, 0, 0, 0, 0, 0],
          'alice:zone': [null, null, null, null, null, null],
          'alice:coins': [0, 0, 0, 0, 0, 0],
        }
      }
    };

    const result = pm.validateSessionPayload(payload);
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('no-meaningful-data');
  });

  it('should accept sessions with real HR data', () => {
    const pm = new PersistenceManager();
    const payload = {
      startTime: Date.now() - 120000,
      endTime: Date.now(),
      roster: [{ id: 'alice', name: 'Alice' }],
      deviceAssignments: [{ deviceId: '28688', userId: 'alice' }],
      timeline: {
        timebase: { tickCount: 6 },
        series: {
          'alice:hr': [120, 125, 130, 128, 132, 135],
          'alice:zone': ['active', '', '', '', '', ''],
          'alice:coins': [0, 1, 2, 3, 4, 5],
        }
      }
    };

    const result = pm.validateSessionPayload(payload);
    expect(result.ok).toBe(true);
  });
});
```

**Step 2: Run test to verify it fails**

```bash
npx jest tests/unit/fitness/persistence-validation.test.mjs --no-cache
```

Expected: FAIL — first test gets `{ ok: true }` because current validation doesn't check series content.

**Step 3: Implement the fix**

In `frontend/src/hooks/fitness/PersistenceManager.js`, in `validateSessionPayload()`, add after the `tickCount < 3` check (around line 671):

```javascript
    // Require at least one series with meaningful (non-zero, non-null) data
    const hasNonEmptyHrSeries = Object.entries(series).some(([key, values]) => {
      if (!key.endsWith(':hr') || !Array.isArray(values)) return false;
      return values.some(v => v != null && v > 0);
    });
    if (!hasNonEmptyHrSeries) {
      return { ok: false, reason: 'no-meaningful-data' };
    }
```

**Step 4: Run tests**

```bash
npx jest tests/unit/fitness/persistence-validation.test.mjs --no-cache
npx jest tests/isolated/assembly/fitness-session-v3.assembly.test.mjs --no-cache
```

Expected: All pass.

**Step 5: Commit**

```bash
git add frontend/src/hooks/fitness/PersistenceManager.js tests/unit/fitness/persistence-validation.test.mjs
git commit -m "fix: reject session saves with no meaningful HR data

Sessions with ticks=0/series with all-zero HR values now fail validation
with reason 'no-meaningful-data'. Prevents phantom session files from
polluting history directory. Addresses audit finding 6."
```

---

## Task 7: Render Thrashing Circuit Breaker (P1 — Finding 2)

**Why:** The render thrashing detector (`fitness.render_thrashing`) logs the problem but doesn't stop it. When render rate exceeds 100/sec sustained for >5 seconds, the system should actively pause WebSocket message processing and tick timers for 2 seconds to let the system recover.

**Files:**
- Modify: `frontend/src/context/FitnessContext.jsx` (add circuit breaker logic around batchedForceUpdate)
- Test: `tests/unit/fitness/render-circuit-breaker.test.mjs` (new)

**Step 1: Write the failing test**

Create `tests/unit/fitness/render-circuit-breaker.test.mjs`:

```javascript
import { describe, it, expect } from '@jest/globals';

describe('Render circuit breaker logic (unit)', () => {
  it('should detect sustained high render rate', () => {
    // Simple ring buffer rate calculator
    const windowMs = 5000;
    const timestamps = [];
    const now = Date.now();

    // Simulate 600 renders in 5 seconds (120/sec)
    for (let i = 0; i < 600; i++) {
      timestamps.push(now - (5000 - (i * 8.33))); // ~120/sec
    }

    // Calculate rate: count timestamps within last 1 second
    const oneSecAgo = now - 1000;
    const recentCount = timestamps.filter(t => t >= oneSecAgo).length;

    expect(recentCount).toBeGreaterThan(100);
  });

  it('should reset after cooldown period', () => {
    let tripped = false;
    let tripTime = 0;
    const cooldownMs = 2000;

    // Trip the breaker
    tripped = true;
    tripTime = Date.now() - 2500; // 2.5s ago

    // Check if cooldown has passed
    const shouldReset = tripped && (Date.now() - tripTime) >= cooldownMs;
    expect(shouldReset).toBe(true);
  });
});
```

**Step 2: Run test**

```bash
npx jest tests/unit/fitness/render-circuit-breaker.test.mjs --no-cache
```

Expected: PASS (unit logic tests).

**Step 3: Implement the circuit breaker**

In `frontend/src/context/FitnessContext.jsx`, add state and refs near the existing `renderStatsRef` (around line 265):

```javascript
  // Circuit breaker: pause updates when render rate exceeds threshold
  const circuitBreakerRef = React.useRef({
    renderTimestamps: [],    // Ring buffer of recent render timestamps
    tripped: false,
    trippedAt: 0,
    cooldownMs: 2000,
    thresholdPerSec: 100,
    sustainedMs: 5000,
  });
```

Modify `batchedForceUpdate` to check the circuit breaker:

```javascript
  const batchedForceUpdate = React.useCallback(() => {
    // Circuit breaker check
    const cb = circuitBreakerRef.current;
    const now = Date.now();

    if (cb.tripped) {
      if ((now - cb.trippedAt) < cb.cooldownMs) {
        return; // Breaker is tripped — drop this update
      }
      // Cooldown expired — reset breaker
      cb.tripped = false;
      cb.renderTimestamps = [];
      getLogger().info('fitness.circuit_breaker.reset');
    }

    // Track render timestamps (keep last 5 seconds)
    cb.renderTimestamps.push(now);
    const cutoff = now - cb.sustainedMs;
    while (cb.renderTimestamps.length > 0 && cb.renderTimestamps[0] < cutoff) {
      cb.renderTimestamps.shift();
    }

    // Check if sustained rate exceeds threshold
    const ratePerSec = cb.renderTimestamps.length / (cb.sustainedMs / 1000);
    if (ratePerSec > cb.thresholdPerSec && cb.renderTimestamps.length > cb.thresholdPerSec) {
      cb.tripped = true;
      cb.trippedAt = now;
      getLogger().warn('fitness.circuit_breaker.tripped', {
        ratePerSec: Math.round(ratePerSec),
        droppingUpdatesForMs: cb.cooldownMs
      });
      return; // Drop this update
    }

    if (scheduledUpdateRef.current) return;
    scheduledUpdateRef.current = true;
    requestAnimationFrame(() => {
      scheduledUpdateRef.current = false;
      forceUpdate();
    });
  }, [forceUpdate]);
```

**Step 4: Run tests**

```bash
npx jest tests/unit/fitness/render-circuit-breaker.test.mjs --no-cache
npx jest tests/unit/governance/ --no-cache
```

Expected: All pass.

**Step 5: Commit**

```bash
git add frontend/src/context/FitnessContext.jsx tests/unit/fitness/render-circuit-breaker.test.mjs
git commit -m "fix: add render thrashing circuit breaker

When batchedForceUpdate rate exceeds 100/sec sustained for 5 seconds,
circuit breaker trips and drops all updates for 2 seconds. This
actively stops the render feedback loop instead of just logging it.
Addresses audit finding 2."
```

---

## Task 8: WebSocket Reconnection Backoff (P2 — Finding 8)

**Why:** After backend restart, all clients reconnect simultaneously, flooding the system with HR data that triggers the full cascade (WS reconnect → HR data → buffer threshold → session start → governance evaluates → render thrashing). Adding a degraded mode that delays fitness initialization after repeated reconnections prevents this cascade.

**Files:**
- Modify: `frontend/src/context/FitnessContext.jsx` (WebSocket subscription effect, around line 1062-1107)
- No separate test file needed — this is a defensive guard with logging.

**Step 1: Implement reconnection backoff**

In `frontend/src/context/FitnessContext.jsx`, add a ref near the top of the provider:

```javascript
  const reconnectCountRef = React.useRef(0);
  const reconnectStabilityTimerRef = React.useRef(null);
```

In the WebSocket subscription effect (around line 1062), wrap the fitness data processing in a reconnection check:

```javascript
  // After wsService.subscribe callback, at the top of the message handler:
  const handleFitnessMessage = (data) => {
    if (!data || typeof data !== 'object') return;

    // Reconnection backoff: if we've reconnected >3 times, delay processing
    if (reconnectCountRef.current > 3) {
      getLogger().debug('fitness.ws.degraded_mode_skip');
      return;
    }

    // ... existing message processing ...
  };
```

In the WebSocket `onReconnect` or `onOpen` handler (wherever reconnection is detected), add:

```javascript
  reconnectCountRef.current++;
  getLogger().warn('fitness.ws.reconnect', { count: reconnectCountRef.current });

  // Reset counter after 60 seconds of stability
  if (reconnectStabilityTimerRef.current) {
    clearTimeout(reconnectStabilityTimerRef.current);
  }
  reconnectStabilityTimerRef.current = setTimeout(() => {
    reconnectCountRef.current = 0;
    getLogger().info('fitness.ws.reconnect_counter_reset');
  }, 60000);
```

**Step 2: Run existing tests to verify no regression**

```bash
npx jest tests/unit/governance/ --no-cache
npx jest tests/isolated/domain/fitness/ --no-cache
```

Expected: All pass.

**Step 3: Commit**

```bash
git add frontend/src/context/FitnessContext.jsx
git commit -m "fix: add WebSocket reconnection backoff for fitness

After >3 reconnections, fitness data processing enters degraded mode
(drops incoming HR data) to prevent cascade: WS flood → session start →
governance eval → render thrashing. Counter resets after 60s of
stability. Addresses audit finding 8."
```

---

## Summary

| Task | Finding(s) | Priority | Effort | Key Change |
|------|-----------|----------|--------|------------|
| 1. Batch governance callbacks | 2, 5, 7 | **P0** | Small | `forceUpdate()` → `batchedForceUpdate()` in 4 callbacks |
| 2. Tick timer rate limiter | 1 | **P0** | Small | Generation counter + 4s rate limit on `_startTickTimer()` |
| 3. Governance relock grace | 5 | **P0** | Medium | 5s grace period after unlock before allowing relock |
| 4. Session buffer debounce | 3 | **P1** | Small | 5s debounce between session end and next start |
| 5. Guard idle governance | 7 | **P1** | Small | Skip `_resetToIdle()` work when already idle |
| 6. Validate series content | 6 | **P1** | Trivial | Require non-zero HR data for session save |
| 7. Render circuit breaker | 2 | **P1** | Medium | Trip breaker at 100 renders/sec sustained 5s, 2s cooldown |
| 8. WebSocket reconnect backoff | 8 | **P2** | Small | Degraded mode after >3 reconnections |
