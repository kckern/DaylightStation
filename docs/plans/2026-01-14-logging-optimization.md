# Logging Optimization Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add sampled logging to reduce log volume by 98% while preserving signal for post-mortem analysis.

**Architecture:** Add `sampled()` method to logger factory that rate-limits high-frequency events to 20/min, aggregating skipped entries into periodic summaries. Uses lazy flush (timestamp checks on calls) to avoid timer overhead.

**Tech Stack:** Node.js, ES modules, Jest for testing

**Design Doc:** `docs/_wip/plans/2026-01-14-logging-optimization-design.md`

---

## Task 1: Add Sampling Infrastructure to Logger

**Files:**
- Modify: `backend/lib/logging/logger.js`
- Create: `tests/unit/logging/sampled-logger.test.mjs`

**Step 1: Write the failing test for basic sampling**

Create `tests/unit/logging/sampled-logger.test.mjs`:

```javascript
import { jest } from '@jest/globals';
import { createLogger } from '../../../backend/lib/logging/logger.js';
import { initializeLogging, resetLogging, getDispatcher } from '../../../backend/lib/logging/dispatcher.js';

describe('sampled logging', () => {
  let dispatchSpy;

  beforeEach(() => {
    resetLogging();
    initializeLogging({ defaultLevel: 'debug' });
    dispatchSpy = jest.spyOn(getDispatcher(), 'dispatch');
  });

  afterEach(() => {
    resetLogging();
  });

  test('logs normally when under rate limit', () => {
    const logger = createLogger({ source: 'test', app: 'test' });

    // Log 5 events (under default 20/min limit)
    for (let i = 0; i < 5; i++) {
      logger.sampled('test.event', { count: i });
    }

    expect(dispatchSpy).toHaveBeenCalledTimes(5);
  });

  test('stops logging after exceeding rate limit', () => {
    const logger = createLogger({ source: 'test', app: 'test' });

    // Log 25 events (over 20/min limit)
    for (let i = 0; i < 25; i++) {
      logger.sampled('test.event', { count: i }, { maxPerMinute: 20 });
    }

    // Should only have 20 dispatched (the first 20)
    expect(dispatchSpy).toHaveBeenCalledTimes(20);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npm run test:unit -- --testPathPattern=sampled-logger`

Expected: FAIL with "logger.sampled is not a function"

**Step 3: Write minimal sampled() implementation**

In `backend/lib/logging/logger.js`, add after line 124 (before `export default`):

```javascript
/**
 * Accumulate data for aggregation
 * @param {Object} aggregated - Accumulator object
 * @param {Object} data - New data to merge
 */
function accumulateData(aggregated, data) {
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
}
```

In the `createLogger` function, add after line 27 (after `baseContext` definition):

```javascript
  // Sampling state for rate-limited logging
  const samplingState = new Map();
  const WINDOW_MS = 60_000;
```

In the returned object (after the `getContext()` method, before the closing brace), add:

```javascript
    /**
     * Log with rate limiting and aggregation
     * @param {string} event - Event name
     * @param {Object} data - Event data
     * @param {Object} options - { maxPerMinute?: number, aggregate?: boolean }
     */
    sampled(event, data = {}, options = {}) {
      const { maxPerMinute = 20, aggregate = true } = options;
      const now = Date.now();

      let state = samplingState.get(event);

      // New window or first call
      if (!state || now - state.windowStart >= WINDOW_MS) {
        // Flush previous window's aggregate
        if (state?.skipped > 0 && aggregate) {
          log('info', `${event}.aggregated`, {
            sampledCount: state.count,
            skippedCount: state.skipped,
            window: '60s',
            aggregated: state.aggregated
          });
        }
        state = { count: 0, skipped: 0, aggregated: {}, windowStart: now };
        samplingState.set(event, state);
      }

      // Within budget: log normally
      if (state.count < maxPerMinute) {
        state.count++;
        log('info', event, data);
        return;
      }

      // Over budget: accumulate for summary
      state.skipped++;
      if (aggregate) {
        accumulateData(state.aggregated, data);
      }
    },
```

**Step 4: Run test to verify it passes**

Run: `npm run test:unit -- --testPathPattern=sampled-logger`

Expected: PASS (2 tests)

**Step 5: Commit**

```bash
git add backend/lib/logging/logger.js tests/unit/logging/sampled-logger.test.mjs
git commit -m "feat(logging): add sampled() method for rate-limited logging"
```

---

## Task 2: Add Aggregation Tests

**Files:**
- Modify: `tests/unit/logging/sampled-logger.test.mjs`

**Step 1: Write failing test for aggregation**

Add to `tests/unit/logging/sampled-logger.test.mjs`:

```javascript
  test('emits aggregate summary when window expires', () => {
    const logger = createLogger({ source: 'test', app: 'test' });

    // Log 25 events in first window
    for (let i = 0; i < 25; i++) {
      logger.sampled('test.event', { count: 1, topic: 'fitness' }, { maxPerMinute: 20 });
    }

    // 20 sampled logs
    expect(dispatchSpy).toHaveBeenCalledTimes(20);

    // Simulate window expiry by manipulating time
    jest.useFakeTimers();
    jest.setSystemTime(Date.now() + 61_000);

    // Log one more to trigger flush
    logger.sampled('test.event', { count: 1, topic: 'fitness' }, { maxPerMinute: 20 });

    jest.useRealTimers();

    // Should have: 20 sampled + 1 aggregate + 1 new = 22
    expect(dispatchSpy).toHaveBeenCalledTimes(22);

    // Check aggregate was emitted
    const aggregateCall = dispatchSpy.mock.calls[20][0];
    expect(aggregateCall.event).toBe('test.event.aggregated');
    expect(aggregateCall.data.sampledCount).toBe(20);
    expect(aggregateCall.data.skippedCount).toBe(5);
    expect(aggregateCall.data.aggregated.count).toBe(5); // sum of skipped
    expect(aggregateCall.data.aggregated.topic.fitness).toBe(5);
  });

  test('caps unique string values at 20', () => {
    const logger = createLogger({ source: 'test', app: 'test' });

    // Log 50 events with different topics (30 over limit)
    for (let i = 0; i < 50; i++) {
      logger.sampled('test.event', { topic: `topic-${i}` }, { maxPerMinute: 20 });
    }

    // Trigger flush
    jest.useFakeTimers();
    jest.setSystemTime(Date.now() + 61_000);
    logger.sampled('test.event', { topic: 'final' }, { maxPerMinute: 20 });
    jest.useRealTimers();

    const aggregateCall = dispatchSpy.mock.calls[20][0];
    const topicCounts = aggregateCall.data.aggregated.topic;

    // Should have 20 unique topics + __other__
    expect(Object.keys(topicCounts).length).toBeLessThanOrEqual(21);
    expect(topicCounts['__other__']).toBeGreaterThan(0);
  });
```

**Step 2: Run tests**

Run: `npm run test:unit -- --testPathPattern=sampled-logger`

Expected: PASS (4 tests)

**Step 3: Commit**

```bash
git add tests/unit/logging/sampled-logger.test.mjs
git commit -m "test(logging): add aggregation tests for sampled logger"
```

---

## Task 3: Update WebSocket Broadcast Logging

**Files:**
- Modify: `backend/routers/websocket.mjs`

**Step 1: Remove duplicate log**

In `backend/routers/websocket.mjs`, delete line 56:

```javascript
// DELETE THIS LINE:
logger.info('Broadcasted fitness payload', { topic: 'fitness', source: data.source });
```

**Step 2: Convert broadcast.sent to sampled**

In `backend/routers/websocket.mjs`, replace lines 198-204:

```javascript
// BEFORE:
logger.info('websocket.broadcast.sent', {
  sentCount,
  clientCount,
  topic: data.topic,
  action: data.action,
  summary: data.topic ? null : msg.substring(0, 100)
});

// AFTER:
logger.sampled('websocket.broadcast.sent', {
  sentCount,
  clientCount,
  topic: data.topic
}, { maxPerMinute: 20 });
```

**Step 3: Verify no syntax errors**

Run: `node --check backend/routers/websocket.mjs`

Expected: No output (success)

**Step 4: Commit**

```bash
git add backend/routers/websocket.mjs
git commit -m "fix(logging): reduce websocket broadcast log spam by 98%

- Remove duplicate 'Broadcasted fitness payload' log
- Use sampled() for broadcast.sent (20/min cap with aggregation)"
```

---

## Task 4: Manual Integration Test

**Files:** None (manual verification)

**Step 1: Start dev server**

Run: `npm run dev`

**Step 2: Trigger fitness broadcasts**

Open browser to fitness app or use websocket client to send fitness payloads.

**Step 3: Observe logs**

Watch `dev.log` for:
- `websocket.broadcast.sent` appearing max ~20 times per minute
- `websocket.broadcast.sent.aggregated` appearing after 60s with summary
- No `Broadcasted fitness payload` events

**Step 4: Stop dev server**

Ctrl+C

---

## Task 5: Final Commit and Summary

**Step 1: Verify all tests pass**

Run tests from main repo (worktree Jest limitation):

```bash
cd /Users/kckern/Documents/GitHub/DaylightStation
npm run test:unit -- --testPathPattern=sampled-logger
```

**Step 2: Review changes**

```bash
git log --oneline -5
git diff main..HEAD --stat
```

**Step 3: Ready for merge**

Branch `feature/logging-optimization` is ready to merge to main.

---

## Summary

| Before | After |
|--------|-------|
| 87,000 logs/hour | 1,260 logs/hour |
| 17MB/hour | ~250KB/hour |
| 2 duplicate logs per broadcast | 1 sampled log + periodic aggregate |
