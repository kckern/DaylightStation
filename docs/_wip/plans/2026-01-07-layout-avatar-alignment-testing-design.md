# Layout Avatar Alignment Testing Framework

## Problem

Avatars sometimes appear moderately displaced from their line endpoints in the FitnessChart. The bug:
- Occurs more frequently in early frames (< 30 seconds)
- Happens with 3+ users
- Results in moderate displacement (avatar clearly not touching line, but in general area)
- Is intermittent and hard to reproduce

Likely cause: `LayoutManager` collision resolution being too aggressive or triggering on false positives.

## Solution

A hybrid testing framework with instrumented `LayoutManager` that enables:
1. **Detection** - Flag when avatar position doesn't match line endpoint
2. **Reproduction** - Save reproducible test cases (seed, HR sequence)
3. **Diagnosis** - Trace through LayoutManager to identify which step caused displacement

---

## Design

### 1. LayoutManager Instrumentation

Add optional `trace` mode to `LayoutManager` that records each transformation step.

```javascript
// In LayoutManager constructor
this.traceEnabled = config.trace || false;
this.traceLog = [];

// Helper to record trace entries
_trace(phase, elementId, data) {
  if (!this.traceEnabled) return;
  this.traceLog.push({ phase, elementId, ...data });
}
```

**Phases to trace:**
| Phase | Description |
|-------|-------------|
| `input` | Original x/y from FitnessChartApp |
| `base_clamp` | After `_clampBasePositions` |
| `collision_resolve` | After `_resolveAvatarCollisionsHorizontal` |
| `label_resolve` | After `LabelManager.resolve` |
| `final_clamp` | After `_clampToBounds` |
| `output` | Final x + offsetX, y + offsetY |

Each trace entry includes:
- `elementId` - Which avatar/badge
- `before` - Position entering this phase
- `after` - Position exiting this phase
- `delta` - How much it moved
- `reason` - Why (e.g., "collision with avatar X")

Return trace alongside `elements` and `connectors` when enabled.

---

### 2. Unit Test Structure

Create `tests/unit/layout/LayoutManager.test.mjs` with edge-case coverage.

**Test Categories:**
1. Single avatar, no collision - output matches input
2. Two avatars, no overlap - both stay at original positions
3. Two avatars, overlapping - lower avatar moves left correctly
4. Three+ avatars, clustered - cascade resolution doesn't over-displace
5. Boundary cases:
   - Avatar at exact left/right margin
   - Avatar with x > width (should clamp)
6. Low tick scenarios (early frames):
   - All avatars at same x position (tick 0)
   - Avatars at ticks 0, 1, 2 with small chart width

**Test Pattern:**
```javascript
test('clustered avatars resolve without excessive displacement', () => {
  const manager = new LayoutManager({
    bounds: { width: 420, height: 390, margin: CHART_MARGIN },
    trace: true
  });

  const input = generateClusteredAvatars(3, { xRange: [350, 360], yRange: [100, 120] });
  const { elements, trace } = manager.layout(input);

  // Assert: no avatar displaced more than maxDisplacement
  // Assert: all avatars still within bounds
  // Assert: trace shows reasonable collision resolution
});
```

Use seeded PRNG for deterministic reproduction of failing tests.

---

### 3. Wide-Scale Exploratory Testing

Run thousands of randomized scenarios concurrently to find rare edge cases.

```javascript
// tests/unit/layout/LayoutManager.wide.test.mjs
const SEEDS = 10000;
const PARALLEL_BATCH = 100;

test('wide exploration: detect displacement anomalies', async () => {
  const anomalies = [];

  for (let batch = 0; batch < SEEDS / PARALLEL_BATCH; batch++) {
    const batchPromises = Array.from({ length: PARALLEL_BATCH }, (_, i) => {
      const seed = batch * PARALLEL_BATCH + i;
      return runSimulation(seed);
    });

    const results = await Promise.all(batchPromises);
    anomalies.push(...results.filter(r => r.hasAnomaly));
  }

  if (anomalies.length > 0) {
    await writeAnomalyReport(anomalies);
  }
  expect(anomalies.length).toBe(0);
});
```

**Simulation Parameters (randomly varied per seed):**
- User count: 1-6
- Tick count: 1-50 (weighted toward low values)
- Chart dimensions: 300-600px width
- HR values: 60-200 BPM (clustered vs spread)
- Overlap scenarios: 0%, 25%, 50%, 75% of avatars overlapping

**Anomaly Detection:**
```javascript
function detectAnomaly(input, output, trace) {
  for (const avatar of output.filter(e => e.type === 'avatar')) {
    const original = input.find(i => i.id === avatar.id);
    const displacement = Math.hypot(
      (avatar.x + avatar.offsetX) - original.x,
      (avatar.y + avatar.offsetY) - original.y
    );

    const hadCollision = trace.some(t =>
      t.elementId === avatar.id &&
      t.phase === 'collision_resolve' &&
      t.reason
    );

    if (displacement > 5 && !hadCollision) {
      return { hasAnomaly: true, type: 'unexplained_displacement', avatar, displacement };
    }
  }
  return { hasAnomaly: false };
}
```

---

### 4. Playwright Integration Tests

End-to-end validation with `FitnessTestSimulator`.

**File:** `tests/runtime/chart/chart-avatar-alignment.runtime.test.mjs`

```javascript
const SCENARIOS = 50;

test.describe('Avatar-Line Alignment', () => {
  for (let seed = 0; seed < SCENARIOS; seed++) {
    test(`seed ${seed}: avatars align with line endpoints`, async ({ page }) => {
      const sim = new FitnessTestSimulator({ seed });

      const userCount = sim.randomInt(3, 5);
      await sim.startSession(userCount);

      for (let tick = 0; tick < 12; tick++) {
        await sim.advanceTicks(5);

        const alignment = await extractAlignmentData(page);
        const anomalies = detectMisalignment(alignment);

        if (anomalies.length > 0) {
          await saveReproCase(seed, tick, alignment, anomalies);
          expect(anomalies).toEqual([]);
        }
      }
    });
  }
});
```

**DOM Extraction:**
```javascript
async function extractAlignmentData(page) {
  return page.evaluate(() => {
    const svg = document.querySelector('.race-chart__svg');
    const paths = [...svg.querySelectorAll('.race-chart__paths path')];
    const avatars = [...svg.querySelectorAll('.race-chart__avatar-group')];

    return {
      paths: extractPathEndpoints(paths),
      avatars: extractAvatarPositions(avatars)
    };
  });
}
```

---

### 5. Diagnosis & Reporting

**Anomaly Report Structure:**
```json
{
  "seed": 7342,
  "tick": 3,
  "scenario": {
    "userCount": 4,
    "chartWidth": 420,
    "tickCount": 6
  },
  "anomalies": [{
    "avatarId": "user-charlie",
    "expectedPosition": { "x": 358, "y": 142 },
    "actualPosition": { "x": 312, "y": 142 },
    "displacement": 46,
    "lineEndpoint": { "x": 358, "y": 142 }
  }],
  "trace": [
    { "phase": "input", "elementId": "user-charlie", "x": 358, "y": 142 },
    { "phase": "base_clamp", "elementId": "user-charlie", "delta": { "x": 0, "y": 0 } },
    { "phase": "collision_resolve", "elementId": "user-charlie", "delta": { "x": -46, "y": 0 },
      "reason": "collision with user-alice", "otherPosition": { "x": 355, "y": 138 } }
  ],
  "allInputs": [],
  "replayCommand": "npm test -- --seed=7342 --tick=3"
}
```

**Aggregate Analysis:** After running 10,000 seeds, summarize:
- Which phase causes most anomalies?
- Which input patterns trigger anomalies?
- Statistical distribution of displacement amounts

---

## File Structure

```
tests/
├── unit/
│   └── layout/
│       ├── LayoutManager.test.mjs        # Core edge-case tests
│       ├── LayoutManager.wide.test.mjs   # Wide-scale exploratory (10k seeds)
│       └── testUtils.mjs                 # Seeded PRNG, generators, detection
├── runtime/
│   └── chart/
│       ├── chart-avatar-alignment.runtime.test.mjs
│       └── reports/                      # Anomaly reports (gitignored)
└── _fixtures/
    └── layout/
        └── LayoutTestSimulator.mjs       # Generates synthetic inputs

frontend/src/.../layout/
└── LayoutManager.js                      # Add trace instrumentation
```

---

## Implementation Order

1. Add instrumentation to `LayoutManager` (trace flag + `_trace()` calls)
2. Create `testUtils.mjs` with seeded PRNG and anomaly detection
3. Write unit tests for known edge cases
4. Write wide-scale exploratory test (parallel seeds)
5. Write Playwright integration test
6. Run wide-scale tests, collect anomalies, analyze patterns

---

## Run Commands

```bash
# Unit tests (fast, 10k seeds in ~30 seconds)
npm test -- tests/unit/layout/

# Integration tests (slower, 50 sessions)
npx playwright test tests/runtime/chart/chart-avatar-alignment.runtime.test.mjs

# Full analysis run
npm run test:layout-analysis
```
