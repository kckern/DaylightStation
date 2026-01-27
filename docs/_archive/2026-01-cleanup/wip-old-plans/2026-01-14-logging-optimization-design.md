# Logging Optimization Design

## Problem Statement

Production logs are flooding with high-frequency events:
- 76,474 log lines in 47 minutes (17MB)
- 89% from two events: `websocket.broadcast.sent` (34K) and `Broadcasted fitness payload` (34K)
- Both events log on every fitness payload, creating duplicate entries

## Goals

1. **Reduce disk usage** - 17MB/hour is unsustainable
2. **Improve signal-to-noise** - Make important events findable
3. **Reduce performance overhead** - Logging shouldn't add memory pressure

## Requirements

- All state changes logged (no sampling)
- Steady-state signals sampled at ~20/min max
- Plain files only, no new infrastructure
- Docker-friendly, simple implementation
- Post-mortem analysis is primary use case

## Design

### API

Add `sampled()` method to logger factory:

```javascript
logger.sampled('websocket.broadcast.sent', { sentCount, clientCount, topic }, {
  maxPerMinute: 20,
  aggregate: true
});
```

**Behavior:**
- First N calls within budget: log normally
- Over budget: accumulate data silently
- Window expiry: emit summary with aggregated stats

### Example Output

During busy period:
```
22:00:01 websocket.broadcast.sent { sentCount: 3, topic: 'fitness' }
... (19 more individual logs) ...
22:01:00 websocket.broadcast.sent.aggregated {
  sampledCount: 20,
  skippedCount: 1480,
  window: '60s',
  aggregated: { sentCount: 4200, topic: { fitness: 1500 } }
}
```

### Implementation

Sampling state lives in logger instance, keyed by event name:

```javascript
const samplingState = new Map();  // eventName -> { count, skipped, aggregated, windowStart }

function sampled(event, data, options = {}) {
  const { maxPerMinute = 20, aggregate = true } = options;
  const now = Date.now();
  const windowMs = 60_000;

  let state = samplingState.get(event);

  // New window or first call - flush previous aggregate
  if (!state || now - state.windowStart >= windowMs) {
    if (state?.skipped > 0 && aggregate) {
      emitAggregate(event, state);
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
}
```

### Aggregation Strategy

```javascript
function accumulateData(aggregated, data) {
  for (const [key, value] of Object.entries(data)) {
    if (typeof value === 'number') {
      // Sum numeric fields
      aggregated[key] = (aggregated[key] || 0) + value;
    } else if (typeof value === 'string') {
      // Track unique values with counts (capped at 20)
      if (!aggregated[key]) aggregated[key] = {};
      const counts = aggregated[key];
      counts[value] = (counts[value] || 0) + 1;
      if (Object.keys(counts).length > 20) {
        counts['__other__'] = (counts['__other__'] || 0) + 1;
      }
    }
  }
}
```

Uses "lazy flush" - checks timestamps on incoming calls, no timers needed.

## Call Site Changes

### websocket.mjs

**Line 56 - Remove duplicate:**
```javascript
// DELETE: logger.info('Broadcasted fitness payload', {...})
// The broadcast.sent log already captures this information
```

**Lines 198-204 - Use sampled:**
```javascript
logger.sampled('websocket.broadcast.sent', {
  sentCount, clientCount, topic: data.topic
}, { maxPerMinute: 20 });
```

### Other Events

| Event | Action |
|-------|--------|
| `governance.phase_change` | Keep as-is (state change) |
| `fitness.tick_timer.*` | Consider `sampled()` or demote to `debug` |

## Files to Modify

| File | Change |
|------|--------|
| `backend/lib/logging/logger.js` | Add `sampled()`, sampling state, aggregation |
| `backend/routers/websocket.mjs` | Remove duplicate, use `sampled()` |

## Expected Results

| Metric | Before | After | Change |
|--------|--------|-------|--------|
| broadcast.sent logs/hr | ~44,000 | 1,260 | -97% |
| Broadcasted fitness logs/hr | ~43,000 | 0 | -100% |
| **Total logs/hr** | ~87,000 | 1,260 | **-98.5%** |
| Log file size/hr | ~17MB | ~250KB | -98.5% |

## Implementation Steps

1. Add `sampled()` method and helpers to `logger.js`
2. Add unit tests for sampling behavior
3. Update `websocket.mjs` call sites
4. Test in dev with fitness session
5. Deploy and monitor log volume
