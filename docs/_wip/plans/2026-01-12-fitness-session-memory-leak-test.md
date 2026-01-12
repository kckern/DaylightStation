# FitnessSession Memory Leak Detection Test

## Overview

Detect memory leaks in FitnessSession by running an active session with HR simulation and monitoring heap growth, timer counts, and allocation patterns over 5+ minutes.

**Problem:** Browser freezes and crashes after 3-5 minutes with an active FitnessSession and HR users streaming. The leak occurs regardless of which frontend view is displayed (Menu, Player, etc.), indicating the issue is in FitnessSession.js or its related modules.

**Approach:** Hybrid profiling combining:
- Performance.memory API polling (lightweight trend detection)
- CDP heap snapshots (detailed leak identification)
- Timer/interval instrumentation (catch leaked setInterval/setTimeout)

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    Playwright Test Runner                    │
├─────────────────────────────────────────────────────────────┤
│  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────┐ │
│  │ FitnessTest     │  │ MemoryProfiler  │  │ TimerTracker│ │
│  │ Simulator       │  │ (CDP + perf API)│  │ (injected)  │ │
│  │ (HR streaming)  │  │                 │  │             │ │
│  └────────┬────────┘  └────────┬────────┘  └──────┬──────┘ │
│           │                    │                   │        │
│           ▼                    ▼                   ▼        │
│  ┌─────────────────────────────────────────────────────────┐│
│  │                   Browser (Chromium)                    ││
│  │  ┌───────────────────────────────────────────────────┐  ││
│  │  │  FitnessApp + FitnessSession Hook                 │  ││
│  │  │  - SessionLifecycle (timers)                      │  ││
│  │  │  - MetricsRecorder (data accumulation)            │  ││
│  │  │  - TimelineRecorder (unbounded growth?)           │  ││
│  │  │  - ParticipantRoster (subscription leaks?)        │  ││
│  │  └───────────────────────────────────────────────────┘  ││
│  └─────────────────────────────────────────────────────────┘│
└─────────────────────────────────────────────────────────────┘
```

## Test Scenarios

### Primary Test: Long-Running Session Memory Stability

```javascript
test('FitnessSession memory stability over 5 minutes', async () => {
  // 1. Start HR simulation (alice @ 120bpm steady)
  // 2. Navigate to /fitness (any view - menu is fine)
  // 3. Wait for session to auto-start from HR data
  // 4. Sample memory every 10 seconds for 5 minutes
  // 5. Take CDP heap snapshots at 0s, 150s, 300s
  // 6. Track timer count throughout
  // 7. Assert: no threshold breaches
});
```

### Thresholds

| Metric | Warning | Failure |
|--------|---------|---------|
| Heap growth | > 30MB | > 50MB |
| Growth rate | > 1.5MB/min | > 2.5MB/min |
| Active timers | +2 from baseline | +5 from baseline |
| Detached DOM nodes | > 100 | > 500 |

### Secondary Scenarios

1. **Session start/stop churn** - Start and end session 10 times in 2 minutes, check for timer/subscription accumulation

2. **Multi-user stress** - 3 users streaming HR simultaneously, verify memory scales linearly not exponentially

3. **View navigation during session** - Navigate Menu → Player → Menu → Player while session active, check for component unmount cleanup

## Implementation Details

### MemoryProfiler

```javascript
// tests/_fixtures/profiling/MemoryProfiler.mjs

export class MemoryProfiler {
  constructor(page, cdpSession) {
    this.page = page;
    this.cdp = cdpSession;
    this.samples = [];        // { timestamp, heapUsed, heapTotal }
    this.snapshots = [];      // CDP heap snapshot summaries
    this.baseline = null;
  }

  // Lightweight polling via performance.memory API
  async startSampling(intervalMs = 10000) {
    this._sampler = setInterval(async () => {
      const mem = await this.page.evaluate(() => ({
        heapUsed: performance.memory?.usedJSHeapSize,
        heapTotal: performance.memory?.totalJSHeapSize,
        timestamp: Date.now()
      }));
      this.samples.push(mem);
    }, intervalMs);
  }

  stopSampling() {
    if (this._sampler) {
      clearInterval(this._sampler);
      this._sampler = null;
    }
  }

  // CDP heap snapshot at key moments
  async takeSnapshot(label) {
    await this.cdp.send('HeapProfiler.collectGarbage');
    await this.cdp.send('HeapProfiler.takeHeapSnapshot');
    // Parse and store summary (top retained objects, sizes)
  }

  // Analysis methods
  getTotalGrowth() {
    if (this.samples.length < 2) return 0;
    const first = this.samples[0].heapUsed;
    const last = this.samples[this.samples.length - 1].heapUsed;
    return (last - first) / (1024 * 1024); // MB
  }

  getGrowthRate() {
    if (this.samples.length < 2) return 0;
    const first = this.samples[0];
    const last = this.samples[this.samples.length - 1];
    const durationMin = (last.timestamp - first.timestamp) / 60000;
    const growthMB = (last.heapUsed - first.heapUsed) / (1024 * 1024);
    return growthMB / durationMin; // MB/min
  }
}
```

### TimerTracker

```javascript
// tests/_fixtures/profiling/TimerTracker.mjs

// Script to inject via page.addInitScript()
export const TIMER_TRACKER_SCRIPT = `
window.__timerTracker = {
  intervals: new Map(),
  timeouts: new Map(),

  install() {
    const origSetInterval = window.setInterval;
    const origClearInterval = window.clearInterval;
    const origSetTimeout = window.setTimeout;
    const origClearTimeout = window.clearTimeout;

    window.setInterval = (fn, ms, ...args) => {
      const id = origSetInterval(fn, ms, ...args);
      this.intervals.set(id, {
        created: Date.now(),
        ms,
        stack: new Error().stack
      });
      return id;
    };

    window.clearInterval = (id) => {
      this.intervals.delete(id);
      return origClearInterval(id);
    };

    window.setTimeout = (fn, ms, ...args) => {
      const id = origSetTimeout(fn, ms, ...args);
      this.timeouts.set(id, {
        created: Date.now(),
        ms,
        stack: new Error().stack
      });
      return id;
    };

    window.clearTimeout = (id) => {
      this.timeouts.delete(id);
      return origClearTimeout(id);
    };
  },

  getStats() {
    return {
      activeIntervals: this.intervals.size,
      activeTimeouts: this.timeouts.size,
      intervalDetails: [...this.intervals.entries()].map(([id, info]) => ({
        id,
        ms: info.ms,
        age: Date.now() - info.created,
        stack: info.stack.split('\\n').slice(1, 5).join('\\n')
      }))
    };
  }
};
window.__timerTracker.install();
`;

export class TimerTracker {
  constructor(page) {
    this.page = page;
    this.baselineCount = 0;
    this.finalCount = 0;
    this.leakedStacks = [];
  }

  async captureBaseline() {
    const stats = await this.page.evaluate(() => window.__timerTracker?.getStats());
    this.baselineCount = stats?.activeIntervals || 0;
    return this.baselineCount;
  }

  async captureFinal() {
    const stats = await this.page.evaluate(() => window.__timerTracker?.getStats());
    this.finalCount = stats?.activeIntervals || 0;
    this.leakedStacks = stats?.intervalDetails || [];
    return this.finalCount;
  }

  getGrowth() {
    return this.finalCount - this.baselineCount;
  }

  getLeakedStacks() {
    return this.leakedStacks;
  }
}
```

### LeakAssertions

```javascript
// tests/_fixtures/profiling/LeakAssertions.mjs

export class LeakAssertions {
  constructor(profiler, timerTracker, config = {}) {
    this.profiler = profiler;
    this.timers = timerTracker;
    this.thresholds = {
      maxHeapGrowthMB: config.maxHeapGrowthMB ?? 50,
      maxGrowthRateMBPerMin: config.maxGrowthRateMBPerMin ?? 2.5,
      maxTimerGrowth: config.maxTimerGrowth ?? 5,
      maxDetachedNodes: config.maxDetachedNodes ?? 500,
      ...config
    };
  }

  async runAllAssertions() {
    const results = {
      passed: true,
      failures: [],
      warnings: [],
      metrics: {}
    };

    // 1. Heap growth check
    const growth = this.profiler.getTotalGrowth();
    results.metrics.heapGrowthMB = growth;
    if (growth > this.thresholds.maxHeapGrowthMB) {
      results.passed = false;
      results.failures.push(
        `Heap grew ${growth.toFixed(1)}MB (max: ${this.thresholds.maxHeapGrowthMB}MB)`
      );
    } else if (growth > this.thresholds.maxHeapGrowthMB * 0.6) {
      results.warnings.push(
        `Heap grew ${growth.toFixed(1)}MB (warning threshold)`
      );
    }

    // 2. Growth rate check
    const rate = this.profiler.getGrowthRate();
    results.metrics.growthRateMBPerMin = rate;
    if (rate > this.thresholds.maxGrowthRateMBPerMin) {
      results.passed = false;
      results.failures.push(
        `Growth rate ${rate.toFixed(2)}MB/min (max: ${this.thresholds.maxGrowthRateMBPerMin})`
      );
    }

    // 3. Timer leak check
    const timerGrowth = this.timers.getGrowth();
    results.metrics.timerGrowth = timerGrowth;
    if (timerGrowth > this.thresholds.maxTimerGrowth) {
      results.passed = false;
      results.failures.push(
        `Timer count grew by ${timerGrowth} (max: ${this.thresholds.maxTimerGrowth})`
      );
      results.metrics.leakedTimerStacks = this.timers.getLeakedStacks();
    }

    return results;
  }
}
```

## File Structure

```
tests/
├── _fixtures/
│   └── profiling/                          # NEW directory
│       ├── MemoryProfiler.mjs              # CDP + performance.memory sampling
│       ├── TimerTracker.mjs                # setInterval/setTimeout instrumentation
│       ├── LeakAssertions.mjs              # Threshold checks + result aggregation
│       └── index.mjs                       # Re-exports all utilities
│
└── runtime/
    └── fitness-session/
        ├── memory-leak.runtime.test.mjs    # NEW - Main test file
        └── reports/                        # NEW - Generated diagnostics (gitignored)
            └── .gitkeep
```

## Diagnostic Report Format

```json
{
  "testName": "FitnessSession memory stability",
  "timestamp": "2026-01-12T10:30:00Z",
  "duration": 300,
  "passed": false,
  "failures": ["Timer count grew by 12 (max: 5)"],
  "warnings": [],
  "metrics": {
    "heapGrowthMB": 34.2,
    "growthRateMBPerMin": 1.8,
    "timerGrowth": 12,
    "detachedNodes": 45
  },
  "samples": [
    { "timestamp": 1736678400000, "heapUsed": 52428800, "heapTotal": 67108864 }
  ],
  "leakedTimerStacks": [
    "at FitnessSession.startTick (FitnessSession.js:2072)\nat SessionLifecycle._startTickTimer (SessionLifecycle.js:308)"
  ]
}
```

## Run Command

```bash
npx playwright test tests/runtime/fitness-session/memory-leak.runtime.test.mjs --workers=1
```

## Suspected Leak Sources

Based on code analysis of FitnessSession.js:

1. **Line 2072: `_tickTimer`** - setInterval that may not be cleared on all unmount paths
2. **Line 2114: `_autosaveTimer`** - setInterval for autosave
3. **SessionLifecycle.js:308** - `_startTickTimer` creates intervals
4. **TimelineRecorder** - May have unbounded data accumulation
5. **MetricsRecorder** - Series data growth without pruning

## Success Criteria

- All 4 test scenarios pass with thresholds defined above
- Diagnostic reports generated for each run
- Stack traces identify exact leak locations when failures occur
