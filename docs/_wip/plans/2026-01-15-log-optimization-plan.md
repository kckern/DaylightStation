# Log Optimization Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Reduce production log volume by 75-80% by implementing debouncing, filtering, and sampling across frontend and backend logging systems.

**Architecture:** The backend already has a `sampled()` method on loggers that provides rate limiting with aggregation. The frontend logger lacks this capability. We'll port the sampling logic to the frontend, then apply it to the three highest-volume log sources: governance phase changes (37%), fitness tick timers (36%), and WebSocket broadcasts (13%).

**Tech Stack:** JavaScript ES modules, shared Logger class pattern, Jest for testing

---

## Task 1: Add `sampled()` Method to Frontend Logger

**Files:**
- Modify: `frontend/src/lib/logging/Logger.js:66-96`
- Test: `tests/unit/logging/frontend-sampled-logger.test.mjs` (create)

**Step 1: Write the failing test**

Create `tests/unit/logging/frontend-sampled-logger.test.mjs`:

```javascript
import { jest } from '@jest/globals';

// Mock the shared transport before importing Logger
const mockSend = jest.fn();
jest.unstable_mockModule('../../../frontend/src/lib/logging/sharedTransport.js', () => ({
  getSharedWsTransport: () => ({ send: mockSend })
}));

const { getLogger, configure } = await import('../../../frontend/src/lib/logging/Logger.js');

describe('frontend sampled logging', () => {
  beforeEach(() => {
    mockSend.mockClear();
    configure({ level: 'debug', consoleEnabled: false, websocketEnabled: true });
  });

  test('logs normally when under rate limit', () => {
    const logger = getLogger();

    for (let i = 0; i < 5; i++) {
      logger.sampled('test.event', { count: i });
    }

    expect(mockSend).toHaveBeenCalledTimes(5);
  });

  test('stops logging after exceeding rate limit', () => {
    const logger = getLogger();

    for (let i = 0; i < 25; i++) {
      logger.sampled('test.event', { count: i }, { maxPerMinute: 20 });
    }

    expect(mockSend).toHaveBeenCalledTimes(20);
  });

  test('emits aggregate summary when window expires', () => {
    const logger = getLogger();

    for (let i = 0; i < 25; i++) {
      logger.sampled('test.event', { count: 1, topic: 'fitness' }, { maxPerMinute: 20 });
    }

    expect(mockSend).toHaveBeenCalledTimes(20);

    jest.useFakeTimers();
    jest.setSystemTime(Date.now() + 61_000);

    logger.sampled('test.event', { count: 1, topic: 'fitness' }, { maxPerMinute: 20 });

    jest.useRealTimers();

    // 20 sampled + 1 aggregate + 1 new = 22
    expect(mockSend).toHaveBeenCalledTimes(22);

    const aggregateCall = mockSend.mock.calls[20][0];
    expect(aggregateCall.event).toBe('test.event.aggregated');
    expect(aggregateCall.data.sampledCount).toBe(20);
    expect(aggregateCall.data.skippedCount).toBe(5);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npm test -- tests/unit/logging/frontend-sampled-logger.test.mjs`
Expected: FAIL with "logger.sampled is not a function"

**Step 3: Write minimal implementation**

Edit `frontend/src/lib/logging/Logger.js` - add sampling state after line 25:

```javascript
// Sampling state for rate-limited logging (module-level, shared across instances)
const samplingState = new Map();
const WINDOW_MS = 60_000;

/**
 * Accumulate data for aggregation
 */
const accumulateData = (aggregated, data) => {
  for (const [key, value] of Object.entries(data)) {
    if (typeof value === 'number') {
      aggregated[key] = (aggregated[key] || 0) + value;
    } else if (typeof value === 'string') {
      if (!aggregated[key]) aggregated[key] = {};
      const counts = aggregated[key];
      if (Object.keys(counts).length < 20) {
        counts[value] = (counts[value] || 0) + 1;
      } else {
        counts['__other__'] = (counts['__other__'] || 0) + 1;
      }
    }
  }
};

/**
 * Emit a sampled log event with rate limiting
 */
const emitSampled = (eventName, data = {}, options = {}) => {
  const { maxPerMinute = 20, aggregate = true } = options;
  const now = Date.now();

  let state = samplingState.get(eventName);

  // New window or first call
  if (!state || now - state.windowStart >= WINDOW_MS) {
    // Flush previous window's aggregate
    if (state?.skipped > 0 && aggregate) {
      emit('info', `${eventName}.aggregated`, {
        sampledCount: state.count,
        skippedCount: state.skipped,
        window: '60s',
        aggregated: state.aggregated
      });
    }
    state = { count: 0, skipped: 0, aggregated: {}, windowStart: now };
    samplingState.set(eventName, state);
  }

  // Within budget: log normally
  if (state.count < maxPerMinute) {
    state.count++;
    emit('info', eventName, data);
    return;
  }

  // Over budget: accumulate for summary
  state.skipped++;
  if (aggregate) {
    accumulateData(state.aggregated, data);
  }
};
```

Then update the singleton object (around line 136) to include sampled:

```javascript
singleton = {
  log: emit,
  debug: (eventName, data, opts) => emit('debug', eventName, data, opts),
  info: (eventName, data, opts) => emit('info', eventName, data, opts),
  warn: (eventName, data, opts) => emit('warn', eventName, data, opts),
  error: (eventName, data, opts) => emit('error', eventName, data, opts),
  sampled: emitSampled,
  child,
  configure
};
```

**Step 4: Run test to verify it passes**

Run: `npm test -- tests/unit/logging/frontend-sampled-logger.test.mjs`
Expected: PASS

**Step 5: Commit**

```bash
git add frontend/src/lib/logging/Logger.js tests/unit/logging/frontend-sampled-logger.test.mjs
git commit -m "$(cat <<'EOF'
feat(logging): add sampled() method to frontend logger

Ports the rate-limited logging with aggregation from the backend logger
to the frontend. This allows high-volume frontend events to be sampled
with automatic aggregation summaries.

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: Add Debounce to Governance Phase Changes

**Files:**
- Modify: `frontend/src/hooks/fitness/GovernanceEngine.js:453-471`
- Test: `tests/unit/fitness/governance-phase-logging.unit.test.mjs` (create)

**Step 1: Write the failing test**

Create `tests/unit/fitness/governance-phase-logging.unit.test.mjs`:

```javascript
import { jest } from '@jest/globals';

// Mock logger
const mockSampled = jest.fn();
const mockInfo = jest.fn();
jest.unstable_mockModule('../../frontend/src/lib/logging/Logger.js', () => ({
  default: () => ({ sampled: mockSampled, info: mockInfo }),
  getLogger: () => ({ sampled: mockSampled, info: mockInfo })
}));

const { GovernanceEngine } = await import('../../../frontend/src/hooks/fitness/GovernanceEngine.js');

describe('governance phase change logging', () => {
  beforeEach(() => {
    mockSampled.mockClear();
    mockInfo.mockClear();
  });

  test('uses sampled logging for phase changes', () => {
    const engine = new GovernanceEngine();
    engine._setPhase('pending');
    engine._setPhase('unlocked');

    // Should use sampled() not info()
    expect(mockSampled).toHaveBeenCalledWith(
      'governance.phase_change',
      expect.objectContaining({ from: 'pending', to: 'unlocked' }),
      expect.objectContaining({ maxPerMinute: expect.any(Number) })
    );
  });

  test('does not log null to null transitions', () => {
    const engine = new GovernanceEngine();
    // Initial phase is null
    engine._setPhase(null); // null -> null (no-op)

    expect(mockSampled).not.toHaveBeenCalled();
  });

  test('does not log rapid same-state bounces', () => {
    const engine = new GovernanceEngine();
    engine._setPhase('pending');
    mockSampled.mockClear();

    // Rapid bounce: pending -> pending (should not log)
    engine._setPhase('pending');

    expect(mockSampled).not.toHaveBeenCalled();
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npm test -- tests/unit/fitness/governance-phase-logging.unit.test.mjs`
Expected: FAIL (uses info() instead of sampled())

**Step 3: Write minimal implementation**

Edit `frontend/src/hooks/fitness/GovernanceEngine.js` around line 453:

Replace:
```javascript
_setPhase(newPhase) {
  if (this.phase !== newPhase) {
    const oldPhase = this.phase;
    this.phase = newPhase;
    this._invalidateStateCache();

    getLogger().info('governance.phase_change', {
      from: oldPhase,
      to: newPhase,
      mediaId: this.media?.id,
      deadline: this.meta?.deadline,
      satisfiedOnce: this.meta?.satisfiedOnce
    });
```

With:
```javascript
_setPhase(newPhase) {
  if (this.phase !== newPhase) {
    const oldPhase = this.phase;
    this.phase = newPhase;
    this._invalidateStateCache();

    // Skip logging for null-to-null (no-op) transitions
    if (oldPhase !== null || newPhase !== null) {
      getLogger().sampled('governance.phase_change', {
        from: oldPhase,
        to: newPhase,
        mediaId: this.media?.id,
        deadline: this.meta?.deadline,
        satisfiedOnce: this.meta?.satisfiedOnce
      }, { maxPerMinute: 30 });
    }
```

**Step 4: Run test to verify it passes**

Run: `npm test -- tests/unit/fitness/governance-phase-logging.unit.test.mjs`
Expected: PASS

**Step 5: Commit**

```bash
git add frontend/src/hooks/fitness/GovernanceEngine.js tests/unit/fitness/governance-phase-logging.unit.test.mjs
git commit -m "$(cat <<'EOF'
fix(logging): use sampled logging for governance phase changes

Reduces log volume from phase change events by ~95% using rate-limited
sampling. Also skips null-to-null transitions which provide no
diagnostic value.

Expected impact: -2,200 logs/hour (-34% total volume)

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: Filter Zero-Tick Timer Logs

**Files:**
- Modify: `frontend/src/hooks/fitness/FitnessSession.js:2104-2114`
- Test: `tests/unit/fitness/tick-timer-logging.unit.test.mjs` (create)

**Step 1: Write the failing test**

Create `tests/unit/fitness/tick-timer-logging.unit.test.mjs`:

```javascript
import { jest } from '@jest/globals';

const mockInfo = jest.fn();
jest.unstable_mockModule('../../frontend/src/lib/logging/Logger.js', () => ({
  default: () => ({ info: mockInfo, error: jest.fn() }),
  getLogger: () => ({ info: mockInfo, error: jest.fn() })
}));

describe('tick timer logging', () => {
  beforeEach(() => {
    mockInfo.mockClear();
  });

  test('does not log stopped events for zero-tick short timers', async () => {
    const { FitnessSession } = await import('../../../frontend/src/hooks/fitness/FitnessSession.js');

    const session = new FitnessSession();
    session._tickTimerStartedAt = Date.now();
    session._tickTimerTickCount = 0;
    session._tickTimer = setInterval(() => {}, 5000);

    // Stop after 500ms with 0 ticks
    session._stopTickTimer();

    // Should NOT log stopped event (zero ticks, short duration)
    const stoppedCalls = mockInfo.mock.calls.filter(
      call => call[0] === 'fitness.tick_timer.stopped'
    );
    expect(stoppedCalls).toHaveLength(0);
  });

  test('logs stopped events when ticks occurred', async () => {
    const { FitnessSession } = await import('../../../frontend/src/hooks/fitness/FitnessSession.js');

    const session = new FitnessSession();
    session._tickTimerStartedAt = Date.now() - 10000;
    session._tickTimerTickCount = 2;
    session._tickTimer = setInterval(() => {}, 5000);

    session._stopTickTimer();

    const stoppedCalls = mockInfo.mock.calls.filter(
      call => call[0] === 'fitness.tick_timer.stopped'
    );
    expect(stoppedCalls).toHaveLength(1);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npm test -- tests/unit/fitness/tick-timer-logging.unit.test.mjs`
Expected: FAIL (logs all stopped events)

**Step 3: Write minimal implementation**

Edit `frontend/src/hooks/fitness/FitnessSession.js` around line 2104:

Replace:
```javascript
_stopTickTimer() {
  if (this._tickTimer) {
    // TELEMETRY: Log timer stop for memory leak debugging
    getLogger().info('fitness.tick_timer.stopped', {
      sessionId: this.sessionId,
      tickCount: this._tickTimerTickCount || 0,
      ranForMs: Date.now() - (this._tickTimerStartedAt || Date.now())
    });
    clearInterval(this._tickTimer);
    this._tickTimer = null;
  }
}
```

With:
```javascript
_stopTickTimer() {
  if (this._tickTimer) {
    const tickCount = this._tickTimerTickCount || 0;
    const ranForMs = Date.now() - (this._tickTimerStartedAt || Date.now());

    // Only log meaningful timer stops (had ticks OR ran for >2s)
    // Zero-tick short timers are just restarts with no work done
    if (tickCount > 0 || ranForMs >= 2000) {
      getLogger().info('fitness.tick_timer.stopped', {
        sessionId: this.sessionId,
        tickCount,
        ranForMs
      });
    }

    clearInterval(this._tickTimer);
    this._tickTimer = null;
  }
}
```

**Step 4: Run test to verify it passes**

Run: `npm test -- tests/unit/fitness/tick-timer-logging.unit.test.mjs`
Expected: PASS

**Step 5: Commit**

```bash
git add frontend/src/hooks/fitness/FitnessSession.js tests/unit/fitness/tick-timer-logging.unit.test.mjs
git commit -m "$(cat <<'EOF'
fix(logging): filter zero-tick short timer logs

Suppresses fitness.tick_timer.stopped events when tickCount is 0 and
runtime is under 2 seconds. These represent cancelled/restarted timers
with no meaningful work done.

Expected impact: -2,000 logs/hour (-31% total volume)

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: Use Sampled Logging for Timer Start Events

**Files:**
- Modify: `frontend/src/hooks/fitness/FitnessSession.js:2076-2079`

**Step 1: Write the failing test**

Add to `tests/unit/fitness/tick-timer-logging.unit.test.mjs`:

```javascript
test('uses sampled logging for timer start events', async () => {
  const mockSampled = jest.fn();
  jest.unstable_mockModule('../../frontend/src/lib/logging/Logger.js', () => ({
    default: () => ({ info: mockInfo, sampled: mockSampled, error: jest.fn() }),
    getLogger: () => ({ info: mockInfo, sampled: mockSampled, error: jest.fn() })
  }));

  // Re-import to get new mock
  jest.resetModules();
  const { FitnessSession } = await import('../../../frontend/src/hooks/fitness/FitnessSession.js');

  const session = new FitnessSession();
  session.timeline = { timebase: { intervalMs: 5000 } };
  session._tickIntervalMs = 5000;

  session._startTickTimer();

  expect(mockSampled).toHaveBeenCalledWith(
    'fitness.tick_timer.started',
    expect.objectContaining({ intervalMs: 5000 }),
    expect.objectContaining({ maxPerMinute: expect.any(Number) })
  );

  session._stopTickTimer();
});
```

**Step 2: Run test to verify it fails**

Run: `npm test -- tests/unit/fitness/tick-timer-logging.unit.test.mjs`
Expected: FAIL (uses info() instead of sampled())

**Step 3: Write minimal implementation**

Edit `frontend/src/hooks/fitness/FitnessSession.js` around line 2076:

Replace:
```javascript
getLogger().info('fitness.tick_timer.started', {
  sessionId: this.sessionId,
  intervalMs: interval
});
```

With:
```javascript
getLogger().sampled('fitness.tick_timer.started', {
  sessionId: this.sessionId,
  intervalMs: interval
}, { maxPerMinute: 10 });
```

**Step 4: Run test to verify it passes**

Run: `npm test -- tests/unit/fitness/tick-timer-logging.unit.test.mjs`
Expected: PASS

**Step 5: Commit**

```bash
git add frontend/src/hooks/fitness/FitnessSession.js tests/unit/fitness/tick-timer-logging.unit.test.mjs
git commit -m "$(cat <<'EOF'
fix(logging): use sampled logging for timer start events

Rate-limits fitness.tick_timer.started events to 10/minute with
aggregation. Combined with zero-tick filtering, this should reduce
tick timer log volume by ~95%.

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 5: Add Sampled Logging to Home Assistant Scene Activation

**Files:**
- Modify: `backend/lib/homeassistant.mjs:70-81`
- Test: `tests/unit/logging/homeassistant-logging.unit.test.mjs` (create)

**Step 1: Write the failing test**

Create `tests/unit/logging/homeassistant-logging.unit.test.mjs`:

```javascript
import { jest } from '@jest/globals';
import { initializeLogging, resetLogging, getDispatcher } from '../../../backend/lib/logging/dispatcher.js';

describe('home assistant logging', () => {
  let dispatchSpy;

  beforeEach(() => {
    resetLogging();
    initializeLogging({ defaultLevel: 'debug' });
    dispatchSpy = jest.spyOn(getDispatcher(), 'dispatch');
  });

  afterEach(() => {
    resetLogging();
  });

  test('uses sampled logging for scene activation', async () => {
    // Import after mocking
    const { activateScene } = await import('../../../backend/lib/homeassistant.mjs');

    // Call multiple times
    for (let i = 0; i < 25; i++) {
      await activateScene('test_scene');
    }

    // Should have sampled the activating calls
    const activatingCalls = dispatchSpy.mock.calls.filter(
      call => call[0].event === 'homeassistant.scene.activating'
    );

    // With maxPerMinute: 30, all 25 should log in first window
    expect(activatingCalls.length).toBeLessThanOrEqual(30);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npm test -- tests/unit/logging/homeassistant-logging.unit.test.mjs`
Expected: FAIL (all 25 calls logged individually)

**Step 3: Write minimal implementation**

Edit `backend/lib/homeassistant.mjs` around line 70:

Replace:
```javascript
haLogger.debug('homeassistant.scene.activating', { entityId });
```

With:
```javascript
haLogger.sampled('homeassistant.scene.activating', { entityId }, { maxPerMinute: 30 });
```

Keep the `haLogger.info('homeassistant.scene.activated'...)` call unchanged since successful activations are important to track.

**Step 4: Run test to verify it passes**

Run: `npm test -- tests/unit/logging/homeassistant-logging.unit.test.mjs`
Expected: PASS

**Step 5: Commit**

```bash
git add backend/lib/homeassistant.mjs tests/unit/logging/homeassistant-logging.unit.test.mjs
git commit -m "$(cat <<'EOF'
fix(logging): use sampled logging for HA scene activation debug logs

Rate-limits homeassistant.scene.activating debug events to 30/minute.
Keeps activated/failed/error events unsampled for diagnostics.

Expected impact: -50 logs/hour (-1% total volume)

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 6: Add Timer Health Logging Filter

**Files:**
- Modify: `frontend/src/hooks/fitness/FitnessSession.js:2121-2129`

**Step 1: Write the failing test**

Add to `tests/unit/fitness/tick-timer-logging.unit.test.mjs`:

```javascript
test('uses sampled logging for timer health checks', async () => {
  const mockSampled = jest.fn();
  const mockInfo = jest.fn();
  jest.unstable_mockModule('../../frontend/src/lib/logging/Logger.js', () => ({
    default: () => ({ info: mockInfo, sampled: mockSampled, error: jest.fn() }),
    getLogger: () => ({ info: mockInfo, sampled: mockSampled, error: jest.fn() })
  }));

  jest.resetModules();
  const { FitnessSession } = await import('../../../frontend/src/hooks/fitness/FitnessSession.js');

  const session = new FitnessSession();
  session.sessionId = 'test-session';
  session._tickTimerStartedAt = Date.now();
  session._tickTimerTickCount = 60;
  session.getMemoryStats = () => ({ rosterSize: 2, deviceCount: 3 });

  session._logTickTimerHealth();

  expect(mockSampled).toHaveBeenCalledWith(
    'fitness.tick_timer.health',
    expect.any(Object),
    expect.objectContaining({ maxPerMinute: expect.any(Number) })
  );
});
```

**Step 2: Run test to verify it fails**

Run: `npm test -- tests/unit/fitness/tick-timer-logging.unit.test.mjs`
Expected: FAIL (uses info() instead of sampled())

**Step 3: Write minimal implementation**

Edit `frontend/src/hooks/fitness/FitnessSession.js` around line 2121:

Replace:
```javascript
_logTickTimerHealth() {
  const stats = this.getMemoryStats();
  getLogger().info('fitness.tick_timer.health', {
    sessionId: this.sessionId,
    tickCount: this._tickTimerTickCount,
    runningForMs: Date.now() - (this._tickTimerStartedAt || Date.now()),
    ...stats
  });
}
```

With:
```javascript
_logTickTimerHealth() {
  const stats = this.getMemoryStats();
  getLogger().sampled('fitness.tick_timer.health', {
    sessionId: this.sessionId,
    tickCount: this._tickTimerTickCount,
    runningForMs: Date.now() - (this._tickTimerStartedAt || Date.now()),
    ...stats
  }, { maxPerMinute: 5 });
}
```

**Step 4: Run test to verify it passes**

Run: `npm test -- tests/unit/fitness/tick-timer-logging.unit.test.mjs`
Expected: PASS

**Step 5: Commit**

```bash
git add frontend/src/hooks/fitness/FitnessSession.js
git commit -m "$(cat <<'EOF'
fix(logging): use sampled logging for timer health checks

Rate-limits fitness.tick_timer.health events to 5/minute. These are
already infrequent (every 60 ticks ~5min) but sampling adds protection
against multiple concurrent sessions.

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 7: Reduce Fitness Profile Logging Frequency

**Files:**
- Modify: Search for `fitness-profile` logging calls
- Test: Add to existing test file

**Step 1: Search for fitness-profile logging**

Run: `grep -rn "fitness-profile\|fitness\.profile" frontend/src/`

Locate the profile logging and apply sampled() with `maxPerMinute: 2` (roughly 5-minute intervals).

**Step 2: Apply sampled logging**

Replace any `logger.info('fitness-profile', ...)` with:

```javascript
logger.sampled('fitness-profile', profileData, { maxPerMinute: 2 });
```

**Step 3: Commit**

```bash
git add <modified-files>
git commit -m "$(cat <<'EOF'
fix(logging): reduce fitness profile logging to 2/minute

Profile snapshots are now rate-limited to roughly one every 30 seconds,
down from every 5 seconds. Stable production systems don't need
frequent profiling.

Expected impact: -90 logs/hour (-1.4% total volume)

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 8: Add Zone LED Deduplication

**Files:**
- Modify: `frontend/src/hooks/fitness/useZoneLedSync.js` (or wherever zone LED logging occurs)

**Step 1: Find zone LED logging**

Run: `grep -rn "zone_led\|fitness\.zone" frontend/src/`

**Step 2: Apply sampled logging with debounce**

For any `zone_led.activated` logging:

```javascript
logger.sampled('fitness.zone_led.activated', {
  scene: sceneName,
  zoneId,
  userId
}, { maxPerMinute: 20 });
```

**Step 3: Commit**

```bash
git add <modified-files>
git commit -m "$(cat <<'EOF'
fix(logging): deduplicate zone LED activation logs

Rate-limits fitness.zone_led.activated events to prevent rapid
LED color changes from flooding logs.

Expected impact: -50 logs/hour (-1% total volume)

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 9: Verify WebSocket Broadcast Sampling

**Files:**
- Review: `backend/routers/websocket.mjs:197-201`

**Step 1: Verify existing implementation**

The WebSocket broadcast already uses sampled logging:

```javascript
logger.sampled('websocket.broadcast.sent', {
  sentCount,
  clientCount,
  topic: data.topic
}, { maxPerMinute: 20 });
```

**Step 2: Consider lowering rate if needed**

If 20/minute is still too verbose, change to:

```javascript
}, { maxPerMinute: 10 });
```

**Step 3: Commit (if changed)**

```bash
git add backend/routers/websocket.mjs
git commit -m "$(cat <<'EOF'
fix(logging): reduce websocket broadcast sampling rate

Lowered maxPerMinute from 20 to 10 for websocket.broadcast.sent events.
Aggregation summaries still capture full volume.

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 10: Run Full Test Suite and Verify

**Step 1: Run all tests**

Run: `npm test`
Expected: All tests PASS

**Step 2: Build frontend**

Run: `npm run build` (or equivalent)
Expected: Build succeeds with no errors

**Step 3: Manual verification**

- Start the application in development mode
- Trigger a fitness session
- Monitor logs for ~5 minutes
- Verify log volume is significantly reduced
- Verify aggregated summaries appear for high-volume events

**Step 4: Final commit**

```bash
git add -A
git commit -m "$(cat <<'EOF'
chore: verify log optimization implementation

All tests pass. Log volume optimizations applied:
- Frontend sampled() method added
- Governance phase changes: sampled at 30/min
- Tick timer start/stop: filtered + sampled
- HA scene activation: sampled at 30/min
- Timer health: sampled at 5/min
- WebSocket broadcast: already sampled at 20/min

Expected total reduction: 75-80% log volume

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>
EOF
)"
```

---

## Validation Checklist

After implementation, verify:

- [ ] Log volume reduced by 70%+ in production
- [ ] All error conditions still logged at appropriate levels
- [ ] Session start/end events preserved
- [ ] User action events (navigation, commands) preserved
- [ ] Home Assistant state changes logged (deduplicated)
- [ ] Debug logs accessible when needed (via log level config)
- [ ] Aggregated summaries show skipped counts and data

---

## Files Modified Summary

| File | Change |
|------|--------|
| `frontend/src/lib/logging/Logger.js` | Added `sampled()` method |
| `frontend/src/hooks/fitness/GovernanceEngine.js` | Use sampled logging for phase changes |
| `frontend/src/hooks/fitness/FitnessSession.js` | Filter zero-tick timers, sample timer events |
| `backend/lib/homeassistant.mjs` | Sample scene activation debug logs |
| `backend/routers/websocket.mjs` | Verify/tune existing sampling |

## Tests Created

| Test File | Coverage |
|-----------|----------|
| `tests/unit/logging/frontend-sampled-logger.test.mjs` | Frontend sampled() method |
| `tests/unit/fitness/governance-phase-logging.unit.test.mjs` | Phase change logging |
| `tests/unit/fitness/tick-timer-logging.unit.test.mjs` | Timer logging filters |
| `tests/unit/logging/homeassistant-logging.unit.test.mjs` | HA logging sampling |
