# Layout Avatar Alignment Testing Framework

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build a testing framework to detect, reproduce, and diagnose intermittent avatar-line displacement bugs in FitnessChart.

**Architecture:** Instrument LayoutManager with optional tracing to record each transformation phase. Run wide-scale exploratory unit tests (10k seeds) to surface rare edge cases. Use Playwright integration tests for end-to-end validation.

**Tech Stack:** Jest (unit tests), Playwright (integration), seeded PRNG for reproducibility, JSON reports for diagnosis.

---

## Task 1: Add Trace Instrumentation to LayoutManager

**Files:**
- Modify: `frontend/src/modules/Fitness/FitnessPlugins/plugins/FitnessChartApp/layout/LayoutManager.js`

**Step 1: Add trace infrastructure to constructor**

In the constructor, after existing options, add:

```javascript
// After line 18 (after ...config.options)
this.traceEnabled = config.trace || false;
this.traceLog = [];
```

**Step 2: Add _trace helper method**

Add this method after the constructor (around line 51):

```javascript
/**
 * Record a trace entry for debugging layout decisions.
 * @param {string} phase - Which layout phase (input, base_clamp, collision_resolve, etc.)
 * @param {string} elementId - Element being traced
 * @param {Object} data - Additional trace data
 */
_trace(phase, elementId, data) {
  if (!this.traceEnabled) return;
  this.traceLog.push({
    phase,
    elementId,
    timestamp: Date.now(),
    ...data
  });
}

/**
 * Clear trace log (call before each layout() if reusing manager)
 */
clearTrace() {
  this.traceLog = [];
}

/**
 * Get trace log
 */
getTrace() {
  return this.traceLog;
}
```

**Step 3: Add trace calls in layout() method**

Modify the `layout()` method to trace each phase. Add these trace calls:

After line 56 (after separating avatars/badges):
```javascript
// Trace input positions
if (this.traceEnabled) {
  this.clearTrace();
  avatars.forEach(a => this._trace('input', a.id, { x: a.x, y: a.y, type: 'avatar' }));
  badges.forEach(b => this._trace('input', b.id, { x: b.x, y: b.y, type: 'badge' }));
}
```

After line 77 (after _clampBasePositions):
```javascript
// Trace base clamp
if (this.traceEnabled) {
  avatars.forEach(a => {
    if (a._baseClamped) {
      this._trace('base_clamp', a.id, {
        before: { x: a.x, y: a.y },
        clampOffset: { x: a._clampOffsetX || 0, y: a._clampOffsetY || 0 }
      });
    }
  });
}
```

After line 81 (after _resolveAvatarCollisionsHorizontal):
```javascript
// Trace collision resolution
if (this.traceEnabled) {
  resolvedAvatars.forEach(a => {
    const inputA = avatars.find(i => i.id === a.id);
    const baseOffsetX = inputA?._clampOffsetX || 0;
    const additionalOffsetX = (a.offsetX || 0) - baseOffsetX;
    if (Math.abs(additionalOffsetX) > 0.1) {
      this._trace('collision_resolve', a.id, {
        before: { offsetX: baseOffsetX },
        after: { offsetX: a.offsetX || 0 },
        delta: { x: additionalOffsetX },
        reason: 'horizontal_collision_avoidance'
      });
    }
  });
}
```

After line 84 (after LabelManager.resolve):
```javascript
// Trace label resolution
if (this.traceEnabled) {
  resolvedAvatars.forEach((a, idx) => {
    const prev = resolvedAvatars[idx]; // Compare to pre-label state
    // LabelManager may adjust labelPosition - trace if changed
    if (a.labelPosition && a.labelPosition !== 'right') {
      this._trace('label_resolve', a.id, { labelPosition: a.labelPosition });
    }
  });
}
```

**Step 4: Return trace in layout() output**

Modify the return statement (around line 130) to include trace:

```javascript
return {
  elements: [...resolvedAvatars, ...resolvedBadges],
  connectors,
  trace: this.traceEnabled ? this.getTrace() : undefined
};
```

**Step 5: Verify no syntax errors**

Run: `node --check frontend/src/modules/Fitness/FitnessPlugins/plugins/FitnessChartApp/layout/LayoutManager.js`

Expected: No output (success)

**Step 6: Commit**

```bash
git add frontend/src/modules/Fitness/FitnessPlugins/plugins/FitnessChartApp/layout/LayoutManager.js
git commit -m "feat(layout): add optional trace instrumentation to LayoutManager"
```

---

## Task 2: Create Test Utilities

**Files:**
- Create: `tests/unit/layout/testUtils.mjs`

**Step 1: Create seeded PRNG and generators**

```javascript
/**
 * Layout Testing Utilities
 * Seeded PRNG, avatar generators, and anomaly detection for layout testing.
 */

/**
 * Seeded pseudo-random number generator (Mulberry32)
 * Deterministic - same seed always produces same sequence.
 */
export function createPRNG(seed) {
  let state = seed;
  return {
    seed,
    /** Returns float in [0, 1) */
    random() {
      state |= 0;
      state = (state + 0x6D2B79F5) | 0;
      let t = Math.imul(state ^ (state >>> 15), 1 | state);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    },
    /** Returns integer in [min, max] inclusive */
    randomInt(min, max) {
      return Math.floor(this.random() * (max - min + 1)) + min;
    },
    /** Returns float in [min, max) */
    randomFloat(min, max) {
      return this.random() * (max - min) + min;
    },
    /** Pick random element from array */
    pick(arr) {
      return arr[this.randomInt(0, arr.length - 1)];
    },
    /** Shuffle array in place */
    shuffle(arr) {
      for (let i = arr.length - 1; i > 0; i--) {
        const j = this.randomInt(0, i);
        [arr[i], arr[j]] = [arr[j], arr[i]];
      }
      return arr;
    }
  };
}

/** Default chart constants (match FitnessChartApp) */
export const CHART_DEFAULTS = {
  width: 420,
  height: 390,
  margin: { top: 10, right: 90, bottom: 38, left: 4 },
  avatarRadius: 30,
  badgeRadius: 10
};

/**
 * Generate random avatar elements for testing.
 * @param {Object} prng - Seeded PRNG
 * @param {Object} options - Generation options
 */
export function generateAvatars(prng, options = {}) {
  const {
    count = prng.randomInt(1, 6),
    width = CHART_DEFAULTS.width,
    height = CHART_DEFAULTS.height,
    margin = CHART_DEFAULTS.margin,
    xCluster = null, // { center, spread } for clustered X positions
    yCluster = null, // { center, spread } for clustered Y positions
    tickCount = prng.randomInt(1, 50)
  } = options;

  const innerWidth = width - margin.left - margin.right;
  const innerHeight = height - margin.top - margin.bottom;
  const avatars = [];

  for (let i = 0; i < count; i++) {
    let x, y;

    if (xCluster) {
      x = xCluster.center + prng.randomFloat(-xCluster.spread, xCluster.spread);
    } else {
      // Simulate tick-based X positioning
      const tick = prng.randomInt(0, tickCount - 1);
      x = tickCount <= 1
        ? margin.left
        : margin.left + (tick / (tickCount - 1)) * innerWidth;
    }

    if (yCluster) {
      y = yCluster.center + prng.randomFloat(-yCluster.spread, yCluster.spread);
    } else {
      y = margin.top + prng.randomFloat(0.1, 0.9) * innerHeight;
    }

    avatars.push({
      type: 'avatar',
      id: `user-${i}`,
      x,
      y,
      name: `User ${i}`,
      color: '#4ade80',
      avatarUrl: `/img/user-${i}.png`,
      value: prng.randomInt(100, 5000)
    });
  }

  return avatars;
}

/**
 * Generate clustered avatars (common early-frame scenario).
 */
export function generateClusteredAvatars(prng, count, options = {}) {
  const { width = CHART_DEFAULTS.width, margin = CHART_DEFAULTS.margin } = options;
  const rightEdge = width - margin.right;

  return generateAvatars(prng, {
    count,
    xCluster: { center: rightEdge - 20, spread: 15 },
    yCluster: { center: 150, spread: 40 },
    tickCount: prng.randomInt(1, 6), // Low tick count = early frame
    ...options
  });
}

/**
 * Generate badges (dropout markers).
 */
export function generateBadges(prng, options = {}) {
  const {
    count = prng.randomInt(0, 3),
    width = CHART_DEFAULTS.width,
    height = CHART_DEFAULTS.height,
    margin = CHART_DEFAULTS.margin
  } = options;

  const innerWidth = width - margin.left - margin.right;
  const badges = [];

  for (let i = 0; i < count; i++) {
    const tick = prng.randomInt(0, 30);
    const x = margin.left + (tick / 30) * innerWidth;
    const y = margin.top + prng.randomFloat(0.2, 0.8) * (height - margin.top - margin.bottom);

    badges.push({
      type: 'badge',
      id: `badge-${i}`,
      participantId: `user-dropout-${i}`,
      x,
      y,
      tick,
      initial: String.fromCharCode(65 + i),
      name: `Dropout ${i}`
    });
  }

  return badges;
}

/**
 * Detect layout anomalies by comparing input to output.
 * @param {Array} input - Original elements passed to layout()
 * @param {Array} output - Elements returned from layout()
 * @param {Array} trace - Trace log from LayoutManager
 * @returns {{ hasAnomaly: boolean, anomalies: Array }}
 */
export function detectAnomalies(input, output, trace = []) {
  const anomalies = [];
  const DISPLACEMENT_THRESHOLD = 5; // pixels

  for (const outEl of output) {
    if (outEl.type !== 'avatar') continue;

    const inEl = input.find(i => i.id === outEl.id);
    if (!inEl) continue;

    const finalX = outEl.x + (outEl.offsetX || 0);
    const finalY = outEl.y + (outEl.offsetY || 0);
    const displacement = Math.hypot(finalX - inEl.x, finalY - inEl.y);

    if (displacement <= DISPLACEMENT_THRESHOLD) continue;

    // Check if displacement was justified by collision
    const collisionTrace = trace.filter(t =>
      t.elementId === outEl.id && t.phase === 'collision_resolve'
    );

    const wasCollisionJustified = collisionTrace.some(t => t.reason);

    if (!wasCollisionJustified) {
      anomalies.push({
        type: 'unexplained_displacement',
        avatarId: outEl.id,
        inputPosition: { x: inEl.x, y: inEl.y },
        outputPosition: { x: finalX, y: finalY },
        displacement,
        trace: collisionTrace
      });
    }

    // Check for excessive displacement even if justified
    if (displacement > 100) {
      anomalies.push({
        type: 'excessive_displacement',
        avatarId: outEl.id,
        displacement,
        threshold: 100
      });
    }
  }

  // Check for out-of-bounds
  for (const outEl of output) {
    const finalX = outEl.x + (outEl.offsetX || 0);
    const finalY = outEl.y + (outEl.offsetY || 0);
    const radius = outEl.type === 'avatar' ? CHART_DEFAULTS.avatarRadius : CHART_DEFAULTS.badgeRadius;

    if (finalX - radius < 0 || finalX + radius > CHART_DEFAULTS.width ||
        finalY - radius < 0 || finalY + radius > CHART_DEFAULTS.height) {
      anomalies.push({
        type: 'out_of_bounds',
        elementId: outEl.id,
        position: { x: finalX, y: finalY },
        radius
      });
    }
  }

  return {
    hasAnomaly: anomalies.length > 0,
    anomalies
  };
}

/**
 * Generate a reproducible test scenario.
 */
export function generateScenario(seed) {
  const prng = createPRNG(seed);

  const scenario = {
    seed,
    userCount: prng.randomInt(1, 6),
    tickCount: prng.randomInt(1, 50),
    chartWidth: prng.randomInt(300, 600),
    chartHeight: prng.randomInt(250, 500),
    clustered: prng.random() < 0.3 // 30% chance of clustered positions
  };

  const margin = { ...CHART_DEFAULTS.margin };

  let avatars;
  if (scenario.clustered) {
    avatars = generateClusteredAvatars(prng, scenario.userCount, {
      width: scenario.chartWidth,
      height: scenario.chartHeight,
      margin,
      tickCount: scenario.tickCount
    });
  } else {
    avatars = generateAvatars(prng, {
      count: scenario.userCount,
      width: scenario.chartWidth,
      height: scenario.chartHeight,
      margin,
      tickCount: scenario.tickCount
    });
  }

  const badges = generateBadges(prng, {
    count: prng.randomInt(0, 2),
    width: scenario.chartWidth,
    height: scenario.chartHeight,
    margin
  });

  return {
    ...scenario,
    margin,
    elements: [...avatars, ...badges]
  };
}
```

**Step 2: Verify syntax**

Run: `node --check tests/unit/layout/testUtils.mjs`

Expected: No output (success)

**Step 3: Commit**

```bash
mkdir -p tests/unit/layout
git add tests/unit/layout/testUtils.mjs
git commit -m "feat(tests): add layout testing utilities with seeded PRNG"
```

---

## Task 3: Write Core Unit Tests

**Files:**
- Create: `tests/unit/layout/LayoutManager.unit.test.mjs`

**Step 1: Write the test file**

```javascript
import { describe, it, expect, beforeEach } from '@jest/globals';
import { LayoutManager } from '../../../frontend/src/modules/Fitness/FitnessPlugins/plugins/FitnessChartApp/layout/LayoutManager.js';
import { CHART_DEFAULTS, createPRNG, generateAvatars, generateClusteredAvatars, detectAnomalies } from './testUtils.mjs';

const MARGIN = CHART_DEFAULTS.margin;

describe('LayoutManager', () => {
  let manager;

  beforeEach(() => {
    manager = new LayoutManager({
      bounds: { width: 420, height: 390, margin: MARGIN },
      avatarRadius: 30,
      badgeRadius: 10,
      trace: true
    });
  });

  describe('single avatar', () => {
    it('should not displace a single avatar', () => {
      const input = [{
        type: 'avatar',
        id: 'user-0',
        x: 300,
        y: 150,
        name: 'Test User',
        color: '#4ade80',
        value: 1000
      }];

      const { elements, trace } = manager.layout(input);
      const avatar = elements.find(e => e.id === 'user-0');

      expect(avatar.offsetX || 0).toBe(0);
      expect(avatar.offsetY || 0).toBe(0);
    });

    it('should clamp avatar at right edge', () => {
      const input = [{
        type: 'avatar',
        id: 'user-0',
        x: 450, // Beyond right margin
        y: 150,
        name: 'Test User',
        color: '#4ade80',
        value: 1000
      }];

      const { elements } = manager.layout(input);
      const avatar = elements.find(e => e.id === 'user-0');
      const finalX = avatar.x + (avatar.offsetX || 0);

      expect(finalX).toBeLessThanOrEqual(420 - MARGIN.right);
    });
  });

  describe('two avatars', () => {
    it('should not displace non-overlapping avatars', () => {
      const input = [
        { type: 'avatar', id: 'user-0', x: 100, y: 100, name: 'A', color: '#4ade80', value: 1000 },
        { type: 'avatar', id: 'user-1', x: 300, y: 250, name: 'B', color: '#4ade80', value: 2000 }
      ];

      const { elements } = manager.layout(input);

      const a = elements.find(e => e.id === 'user-0');
      const b = elements.find(e => e.id === 'user-1');

      // Neither should have significant offset
      expect(Math.abs(a.offsetX || 0)).toBeLessThan(1);
      expect(Math.abs(b.offsetX || 0)).toBeLessThan(1);
    });

    it('should displace overlapping avatars horizontally', () => {
      // Two avatars at nearly same position
      const input = [
        { type: 'avatar', id: 'user-0', x: 300, y: 150, name: 'A', color: '#4ade80', value: 1000 },
        { type: 'avatar', id: 'user-1', x: 305, y: 155, name: 'B', color: '#4ade80', value: 2000 }
      ];

      const { elements, trace } = manager.layout(input);

      // Lower avatar (user-1, y=155 > y=150) should be displaced left
      const displaced = elements.find(e => e.id === 'user-1');
      expect(displaced.offsetX || 0).toBeLessThan(0); // Moved left

      // Trace should show collision resolution
      const collisionTraces = trace.filter(t => t.phase === 'collision_resolve');
      expect(collisionTraces.length).toBeGreaterThan(0);
    });
  });

  describe('three+ avatars clustered', () => {
    it('should resolve without excessive displacement', () => {
      const prng = createPRNG(12345);
      const input = generateClusteredAvatars(prng, 4, { tickCount: 3 });

      const { elements, trace } = manager.layout(input);
      const { anomalies } = detectAnomalies(input, elements, trace);

      // No unexplained or excessive displacement
      const excessiveAnomalies = anomalies.filter(a => a.type === 'excessive_displacement');
      expect(excessiveAnomalies).toEqual([]);
    });

    it('should keep all avatars within bounds', () => {
      const prng = createPRNG(54321);
      const input = generateClusteredAvatars(prng, 5, { tickCount: 2 });

      const { elements } = manager.layout(input);
      const { anomalies } = detectAnomalies(input, elements, []);

      const outOfBounds = anomalies.filter(a => a.type === 'out_of_bounds');
      expect(outOfBounds).toEqual([]);
    });
  });

  describe('early frame scenarios (low tick count)', () => {
    it('should handle tick count of 1', () => {
      // All avatars at same X (tick 0 of 1)
      const input = [
        { type: 'avatar', id: 'user-0', x: MARGIN.left, y: 100, name: 'A', color: '#4ade80', value: 1000 },
        { type: 'avatar', id: 'user-1', x: MARGIN.left, y: 110, name: 'B', color: '#4ade80', value: 1500 },
        { type: 'avatar', id: 'user-2', x: MARGIN.left, y: 120, name: 'C', color: '#4ade80', value: 2000 }
      ];

      const { elements, trace } = manager.layout(input);
      const { anomalies } = detectAnomalies(input, elements, trace);

      // Should resolve collisions, but no excessive displacement
      const excessive = anomalies.filter(a => a.type === 'excessive_displacement');
      expect(excessive).toEqual([]);
    });

    it('should handle tick count of 2 with avatars at ticks 0 and 1', () => {
      const width = 420;
      const innerWidth = width - MARGIN.left - MARGIN.right;

      const input = [
        { type: 'avatar', id: 'user-0', x: MARGIN.left, y: 150, name: 'A', color: '#4ade80', value: 1000 },
        { type: 'avatar', id: 'user-1', x: MARGIN.left + innerWidth, y: 155, name: 'B', color: '#4ade80', value: 1500 }
      ];

      const { elements, trace } = manager.layout(input);

      // Far apart - should not collide
      const a = elements.find(e => e.id === 'user-0');
      const b = elements.find(e => e.id === 'user-1');

      expect(Math.abs(a.offsetX || 0)).toBeLessThan(5);
      expect(Math.abs(b.offsetX || 0)).toBeLessThan(5);
    });
  });

  describe('boundary conditions', () => {
    it('should flip label to left when avatar near right edge', () => {
      const input = [{
        type: 'avatar',
        id: 'user-0',
        x: 400, // Near right edge
        y: 150,
        name: 'Test',
        color: '#4ade80',
        value: 1000
      }];

      const { elements } = manager.layout(input);
      const avatar = elements.find(e => e.id === 'user-0');

      expect(avatar.labelPosition).toBe('left');
    });

    it('should handle avatar exactly at left margin', () => {
      const input = [{
        type: 'avatar',
        id: 'user-0',
        x: MARGIN.left,
        y: 150,
        name: 'Test',
        color: '#4ade80',
        value: 1000
      }];

      const { elements } = manager.layout(input);
      const avatar = elements.find(e => e.id === 'user-0');
      const finalX = avatar.x + (avatar.offsetX || 0);

      expect(finalX).toBeGreaterThanOrEqual(MARGIN.left);
    });
  });

  describe('trace functionality', () => {
    it('should record input phase for all elements', () => {
      const input = [
        { type: 'avatar', id: 'user-0', x: 300, y: 150, name: 'A', color: '#4ade80', value: 1000 },
        { type: 'badge', id: 'badge-0', x: 200, y: 200, initial: 'X', name: 'Dropout' }
      ];

      const { trace } = manager.layout(input);
      const inputTraces = trace.filter(t => t.phase === 'input');

      expect(inputTraces.length).toBe(2);
      expect(inputTraces.some(t => t.elementId === 'user-0')).toBe(true);
      expect(inputTraces.some(t => t.elementId === 'badge-0')).toBe(true);
    });

    it('should not generate trace when disabled', () => {
      const noTraceManager = new LayoutManager({
        bounds: { width: 420, height: 390, margin: MARGIN },
        trace: false
      });

      const input = [{ type: 'avatar', id: 'user-0', x: 300, y: 150, name: 'A', color: '#4ade80', value: 1000 }];
      const { trace } = noTraceManager.layout(input);

      expect(trace).toBeUndefined();
    });
  });
});
```

**Step 2: Run tests to verify they work with instrumented LayoutManager**

Run: `npm run test:unit -- --testPathPattern=layout`

Expected: All tests pass (assuming Task 1 instrumentation is complete)

**Step 3: Commit**

```bash
git add tests/unit/layout/LayoutManager.unit.test.mjs
git commit -m "test(layout): add core unit tests for LayoutManager"
```

---

## Task 4: Write Wide-Scale Exploratory Tests

**Files:**
- Create: `tests/unit/layout/LayoutManager.wide.test.mjs`

**Step 1: Write the wide-scale test**

```javascript
import { describe, it, expect } from '@jest/globals';
import { LayoutManager } from '../../../frontend/src/modules/Fitness/FitnessPlugins/plugins/FitnessChartApp/layout/LayoutManager.js';
import { createPRNG, generateScenario, detectAnomalies, CHART_DEFAULTS } from './testUtils.mjs';
import fs from 'fs';
import path from 'path';

const TOTAL_SEEDS = 10000;
const BATCH_SIZE = 100;
const REPORT_DIR = path.join(process.cwd(), 'tests/runtime/chart/reports');

/**
 * Run a single simulation with the given seed.
 */
function runSimulation(seed) {
  const scenario = generateScenario(seed);

  const manager = new LayoutManager({
    bounds: {
      width: scenario.chartWidth,
      height: scenario.chartHeight,
      margin: scenario.margin
    },
    avatarRadius: CHART_DEFAULTS.avatarRadius,
    badgeRadius: CHART_DEFAULTS.badgeRadius,
    trace: true
  });

  const { elements, trace } = manager.layout(scenario.elements);
  const { hasAnomaly, anomalies } = detectAnomalies(scenario.elements, elements, trace);

  return {
    seed,
    scenario: {
      userCount: scenario.userCount,
      tickCount: scenario.tickCount,
      chartWidth: scenario.chartWidth,
      clustered: scenario.clustered
    },
    hasAnomaly,
    anomalies,
    trace: hasAnomaly ? trace : undefined,
    input: hasAnomaly ? scenario.elements : undefined
  };
}

/**
 * Run batch of simulations concurrently.
 */
async function runBatch(startSeed, count) {
  const promises = Array.from({ length: count }, (_, i) => {
    return Promise.resolve(runSimulation(startSeed + i));
  });
  return Promise.all(promises);
}

describe('LayoutManager Wide-Scale Exploration', () => {
  it(`should find no anomalies across ${TOTAL_SEEDS} random seeds`, async () => {
    const allAnomalies = [];
    const batchCount = Math.ceil(TOTAL_SEEDS / BATCH_SIZE);

    for (let batch = 0; batch < batchCount; batch++) {
      const startSeed = batch * BATCH_SIZE;
      const count = Math.min(BATCH_SIZE, TOTAL_SEEDS - startSeed);

      const results = await runBatch(startSeed, count);
      const anomalous = results.filter(r => r.hasAnomaly);
      allAnomalies.push(...anomalous);

      // Progress logging every 10 batches
      if (batch % 10 === 0) {
        console.log(`Batch ${batch + 1}/${batchCount}: ${allAnomalies.length} anomalies found so far`);
      }
    }

    // Write anomaly report if any found
    if (allAnomalies.length > 0) {
      fs.mkdirSync(REPORT_DIR, { recursive: true });
      const reportPath = path.join(REPORT_DIR, `anomaly-${Date.now()}.json`);

      const report = {
        timestamp: new Date().toISOString(),
        totalSeeds: TOTAL_SEEDS,
        anomalyCount: allAnomalies.length,
        anomalyRate: (allAnomalies.length / TOTAL_SEEDS * 100).toFixed(4) + '%',
        anomalies: allAnomalies.map(a => ({
          seed: a.seed,
          scenario: a.scenario,
          anomalies: a.anomalies,
          replayCommand: `npm run test:unit -- --testPathPattern=layout -t "seed ${a.seed}"`
        }))
      };

      fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
      console.log(`\nAnomaly report written to: ${reportPath}`);

      // Summarize by anomaly type
      const byType = {};
      allAnomalies.forEach(a => {
        a.anomalies.forEach(anomaly => {
          byType[anomaly.type] = (byType[anomaly.type] || 0) + 1;
        });
      });
      console.log('\nAnomaly types:', byType);
    }

    expect(allAnomalies.length).toBe(0);
  }, 120000); // 2 minute timeout

  // Individual seed replay tests (add failing seeds here for debugging)
  describe.skip('replay specific seeds', () => {
    const failingSeeds = [
      // Add seeds from anomaly reports here for targeted debugging
      // 7342,
      // 1234,
    ];

    failingSeeds.forEach(seed => {
      it(`seed ${seed}: should not have anomalies`, () => {
        const result = runSimulation(seed);

        if (result.hasAnomaly) {
          console.log('Scenario:', result.scenario);
          console.log('Anomalies:', JSON.stringify(result.anomalies, null, 2));
          console.log('Trace:', JSON.stringify(result.trace, null, 2));
        }

        expect(result.anomalies).toEqual([]);
      });
    });
  });
});
```

**Step 2: Run the wide-scale test**

Run: `npm run test:unit -- --testPathPattern="LayoutManager.wide" --verbose`

Expected: Either passes (no anomalies) or generates report in `tests/runtime/chart/reports/`

**Step 3: Add reports directory to gitignore**

Check if already ignored, if not add:
```bash
echo "tests/runtime/chart/reports/" >> .gitignore
```

**Step 4: Commit**

```bash
git add tests/unit/layout/LayoutManager.wide.test.mjs
git add .gitignore
git commit -m "test(layout): add wide-scale exploratory testing (10k seeds)"
```

---

## Task 5: Write Playwright Integration Tests

**Files:**
- Create: `tests/runtime/chart/chart-avatar-alignment.runtime.test.mjs`

**Step 1: Write the integration test**

```javascript
/**
 * Chart Avatar-Line Alignment Test
 *
 * Verifies that avatars render at the endpoints of their corresponding lines.
 * Uses seeded HR simulation to create reproducible test scenarios.
 *
 * Usage:
 *   npx playwright test tests/runtime/chart/chart-avatar-alignment.runtime.test.mjs --headed
 */

import { test, expect } from '@playwright/test';
import { FitnessTestSimulator } from '../../_fixtures/fitness/FitnessTestSimulator.mjs';
import fs from 'fs';
import path from 'path';

const FRONTEND_URL = 'http://localhost:3111';
const WS_URL = 'ws://localhost:3111/ws';
const SCENARIOS = 20; // Number of seeded scenarios to run
const REPORT_DIR = path.join(process.cwd(), 'tests/runtime/chart/reports');

/**
 * Seeded PRNG for reproducible scenarios (same as unit tests)
 */
function createPRNG(seed) {
  let state = seed;
  return {
    seed,
    random() {
      state |= 0;
      state = (state + 0x6D2B79F5) | 0;
      let t = Math.imul(state ^ (state >>> 15), 1 | state);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    },
    randomInt(min, max) {
      return Math.floor(this.random() * (max - min + 1)) + min;
    }
  };
}

/**
 * Extract avatar and path endpoint positions from the chart SVG.
 */
async function extractAlignmentData(page) {
  return page.evaluate(() => {
    const svg = document.querySelector('.race-chart__svg');
    if (!svg) return { error: 'No chart SVG found' };

    const results = { avatars: [], pathEndpoints: [], margin: { left: 4, right: 90 } };

    // Extract avatar positions from transform
    const avatarGroups = svg.querySelectorAll('.race-chart__avatar-group');
    avatarGroups.forEach((group, idx) => {
      const transform = group.getAttribute('transform');
      if (!transform) return;

      const match = transform.match(/translate\(([^,]+),\s*([^)]+)\)/);
      if (!match) return;

      const x = parseFloat(match[1]);
      const y = parseFloat(match[2]);

      // Try to get avatar ID from clip path
      const clipPath = group.querySelector('clipPath');
      const id = clipPath?.id?.replace('race-clip-', '').replace(/-\d+$/, '') || `avatar-${idx}`;

      results.avatars.push({ id, x, y });
    });

    // Extract path endpoints (last point of each path)
    const paths = svg.querySelectorAll('.race-chart__paths path');
    paths.forEach((pathEl, idx) => {
      const d = pathEl.getAttribute('d');
      if (!d) return;

      // Parse SVG path to get last point
      // Paths are typically "M x,y L x,y L x,y ..."
      const commands = d.match(/[ML]\s*[\d.]+,[\d.]+/g);
      if (!commands || commands.length === 0) return;

      const lastCmd = commands[commands.length - 1];
      const coords = lastCmd.match(/[\d.]+/g);
      if (!coords || coords.length < 2) return;

      const x = parseFloat(coords[0]);
      const y = parseFloat(coords[1]);

      results.pathEndpoints.push({ pathIndex: idx, x, y });
    });

    return results;
  });
}

/**
 * Detect misalignment between avatars and path endpoints.
 * Each avatar should be within THRESHOLD pixels of a path endpoint.
 */
function detectMisalignment(alignmentData, threshold = 10) {
  const { avatars, pathEndpoints } = alignmentData;
  if (!avatars || !pathEndpoints) return [];

  const anomalies = [];

  avatars.forEach(avatar => {
    // Find closest path endpoint
    let minDist = Infinity;
    let closestEndpoint = null;

    pathEndpoints.forEach(endpoint => {
      const dist = Math.hypot(avatar.x - endpoint.x, avatar.y - endpoint.y);
      if (dist < minDist) {
        minDist = dist;
        closestEndpoint = endpoint;
      }
    });

    if (minDist > threshold) {
      anomalies.push({
        type: 'avatar_misaligned',
        avatarId: avatar.id,
        avatarPosition: { x: avatar.x, y: avatar.y },
        closestEndpoint,
        distance: minDist,
        threshold
      });
    }
  });

  return anomalies;
}

/**
 * Save reproduction case for debugging.
 */
async function saveReproCase(seed, tick, alignmentData, anomalies) {
  fs.mkdirSync(REPORT_DIR, { recursive: true });
  const filename = `repro-seed${seed}-tick${tick}-${Date.now()}.json`;
  const filepath = path.join(REPORT_DIR, filename);

  const reproCase = {
    seed,
    tick,
    timestamp: new Date().toISOString(),
    alignmentData,
    anomalies,
    replayInstructions: [
      `1. Start dev server: npm run dev`,
      `2. Run test with seed: npx playwright test chart-avatar-alignment -g "seed ${seed}"`,
      `3. Or replay in browser console with FitnessTestSimulator({ seed: ${seed} })`
    ]
  };

  fs.writeFileSync(filepath, JSON.stringify(reproCase, null, 2));
  console.log(`Repro case saved to: ${filepath}`);
}

test.describe('Avatar-Line Alignment', () => {
  test.beforeAll(async () => {
    // Verify dev server is running
    try {
      const response = await fetch(`${FRONTEND_URL}/api/fitness`);
      if (!response.ok) throw new Error('Dev server not responding');
    } catch (e) {
      throw new Error(`Dev server must be running at ${FRONTEND_URL}. Run: npm run dev`);
    }
  });

  for (let seed = 0; seed < SCENARIOS; seed++) {
    test(`seed ${seed}: avatars align with line endpoints`, async ({ page }) => {
      const prng = createPRNG(seed);
      const userCount = prng.randomInt(3, 5);

      // Navigate to fitness app
      await page.goto(`${FRONTEND_URL}/fitness`);
      await page.waitForSelector('.fitness-chart-app', { timeout: 10000 });

      // Create simulator and start session
      const sim = new FitnessTestSimulator({ wsUrl: WS_URL });
      await sim.connect();

      // Build user config with randomized HR
      const users = {};
      const userNames = ['alice', 'bob', 'charlie', 'diana', 'evan'];
      for (let i = 0; i < userCount; i++) {
        const name = userNames[i];
        users[name] = {
          hr: prng.randomInt(100, 170),
          variance: prng.randomInt(0, 10)
        };
      }

      // Start scenario
      await sim.startSession({ users });

      // Check alignment at multiple ticks (early frames are more likely to have issues)
      const checkpoints = [2, 5, 10, 15, 30]; // seconds

      for (const checkpoint of checkpoints) {
        // Advance simulation
        await sim.advanceTime(checkpoint * 1000);
        await page.waitForTimeout(500); // Let UI update

        // Extract and check alignment
        const alignmentData = await extractAlignmentData(page);

        if (alignmentData.error) {
          console.warn(`Checkpoint ${checkpoint}s: ${alignmentData.error}`);
          continue;
        }

        const anomalies = detectMisalignment(alignmentData);

        if (anomalies.length > 0) {
          await saveReproCase(seed, checkpoint, alignmentData, anomalies);

          // Take screenshot for debugging
          await page.screenshot({
            path: path.join(REPORT_DIR, `screenshot-seed${seed}-tick${checkpoint}.png`)
          });

          expect(anomalies).toEqual([]);
        }
      }

      // Cleanup
      await sim.endSession();
      await sim.disconnect();
    });
  }
});
```

**Step 2: Run integration tests**

Run: `npx playwright test tests/runtime/chart/chart-avatar-alignment.runtime.test.mjs --workers=4`

Note: Requires dev server running (`npm run dev`)

**Step 3: Commit**

```bash
git add tests/runtime/chart/chart-avatar-alignment.runtime.test.mjs
git commit -m "test(layout): add Playwright avatar alignment integration tests"
```

---

## Task 6: Add npm Script for Full Analysis

**Files:**
- Modify: `package.json`

**Step 1: Add test:layout-analysis script**

Add to scripts section:
```json
"test:layout": "npm run test:unit -- --testPathPattern=layout",
"test:layout-analysis": "npm run test:layout && npx playwright test tests/runtime/chart/chart-avatar-alignment.runtime.test.mjs"
```

**Step 2: Commit**

```bash
git add package.json
git commit -m "chore: add test:layout-analysis npm script"
```

---

## Summary

After completing all tasks:

1. **LayoutManager** has optional trace instrumentation
2. **Unit tests** cover edge cases (single avatar, collisions, boundaries, early frames)
3. **Wide-scale tests** run 10,000 seeds to find rare anomalies
4. **Integration tests** validate end-to-end in browser with Playwright
5. **Reports** are generated for any anomalies found

**Run commands:**
```bash
# Quick unit tests
npm run test:layout

# Full analysis (unit + integration)
npm run test:layout-analysis

# Just wide-scale exploration
npm run test:unit -- --testPathPattern="LayoutManager.wide"
```
