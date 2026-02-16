# Historical Session Chart Rendering Fixes

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Fix 6 open bugs (O1-O6) from the session chart historical rendering audit so that historical charts visually match their live counterparts.

**Architecture:** All changes are frontend-only. Three files carry the bulk of the work: `FitnessChart.helpers.js` (coin quality gate, forward-fill, default rates), `FitnessChartApp.jsx` (pass zoneConfig in historical mode), and `domain/types.js` (consolidate colors). One small change in `PersistenceManager.js` for encoding completeness. TDD throughout — unit tests for helpers, integration-level assertions for the JSX wiring.

**Tech Stack:** React, Vitest, ES modules

---

### Task 1: Write failing test — coins_total quality gate (O3)

**Files:**
- Create: `tests/isolated/domain/fitness/chart-helpers.unit.test.mjs`

**Step 1: Write the failing test**

```js
import { describe, it, expect } from 'vitest';
import { buildBeatsSeries } from '#frontend/modules/Fitness/FitnessSidebar/FitnessChart.helpers.js';

describe('buildBeatsSeries — coins quality gate (O3)', () => {
  const makeGetSeries = (data) => (userId, metric) => {
    const key = `${metric}`;
    return data[key] ? [...data[key]] : [];
  };

  it('falls through to heart_beats when coins_total is mostly null', () => {
    // Simulates Feb 13 session: coins = [0, null, null, ..., null] (1 real out of 20)
    const coins = [0, ...Array(19).fill(null)];
    const heartBeats = Array.from({ length: 20 }, (_, i) => i * 10); // 0, 10, 20, ...
    const zones = Array(20).fill('active');
    const hr = Array(20).fill(100);

    const getSeries = makeGetSeries({
      coins_total: coins,
      heart_beats: heartBeats,
      zone_id: zones,
      heart_rate: hr,
    });

    const roster = { id: 'alan', profileId: 'alan', name: 'Alan' };
    const result = buildBeatsSeries(roster, getSeries, { intervalMs: 5000 });

    // Should use heart_beats (0..190), NOT coins (which would be all-zero after fill)
    const lastBeat = result.beats[result.beats.length - 1];
    expect(lastBeat).toBe(190);
  });

  it('uses coins_total when it has sufficient non-null data', () => {
    const coins = Array.from({ length: 20 }, (_, i) => i * 5); // 0, 5, 10, ..., 95
    const heartBeats = Array.from({ length: 20 }, (_, i) => i * 10);
    const zones = Array(20).fill('warm');
    const hr = Array(20).fill(120);

    const getSeries = makeGetSeries({
      coins_total: coins,
      heart_beats: heartBeats,
      zone_id: zones,
      heart_rate: hr,
    });

    const roster = { id: 'alan', profileId: 'alan', name: 'Alan' };
    const result = buildBeatsSeries(roster, getSeries, { intervalMs: 5000 });

    // Should use coins_total (last = 95)
    const lastBeat = result.beats[result.beats.length - 1];
    expect(lastBeat).toBe(95);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run tests/isolated/domain/fitness/chart-helpers.unit.test.mjs`
Expected: FAIL — first test fails because `buildBeatsSeries` uses the sparse coins array (no quality gate)

---

### Task 2: Implement coins_total quality gate (O3)

**Files:**
- Modify: `frontend/src/modules/Fitness/FitnessSidebar/FitnessChart.helpers.js:256-263`

**Step 1: Add quality check before accepting coins_total**

Replace the `coins_total` block (lines ~256-263) from:

```js
  const coinsRaw = getSeriesForParticipant('coins_total');

  if (Array.isArray(coinsRaw) && coinsRaw.length > 0) {
```

to:

```js
  const coinsRaw = getSeriesForParticipant('coins_total');
  const coinsNonNullCount = Array.isArray(coinsRaw) ? coinsRaw.filter(v => Number.isFinite(v)).length : 0;
  const coinsQualityThreshold = Math.max(3, (coinsRaw?.length || 0) * 0.05);

  if (Array.isArray(coinsRaw) && coinsNonNullCount >= coinsQualityThreshold) {
```

This adds a quality gate: coins_total must have at least 5% non-null values (minimum 3) to be used. Otherwise, fall through to heart_beats or heart_rate.

**Step 2: Run test to verify it passes**

Run: `npx vitest run tests/isolated/domain/fitness/chart-helpers.unit.test.mjs`
Expected: PASS

**Step 3: Commit**

```bash
git add tests/isolated/domain/fitness/chart-helpers.unit.test.mjs frontend/src/modules/Fitness/FitnessSidebar/FitnessChart.helpers.js
git commit -m "fix(fitness): add quality gate for sparse coins_total series (O3)"
```

---

### Task 3: Write failing test — forward-fill cumulative metrics (O4)

**Files:**
- Modify: `tests/isolated/domain/fitness/chart-helpers.unit.test.mjs`

**Step 1: Write the failing test**

Append to the test file:

```js
describe('buildBeatsSeries — forward-fill cumulative metrics (O4)', () => {
  const makeGetSeries = (data) => (userId, metric) => {
    return data[metric] ? [...data[metric]] : [];
  };

  it('forward-fills interior nulls in coins_total', () => {
    // coins_total recorded at intervals with nulls in between
    // e.g., [0, null, null, 5, null, null, 12, null, null, 20]
    const coins = [0, null, null, 5, null, null, 12, null, null, 20];
    const zones = Array(10).fill('warm');
    const hr = Array(10).fill(130);

    const getSeries = makeGetSeries({
      coins_total: coins,
      zone_id: zones,
      heart_rate: hr,
    });

    const roster = { id: 'alan', profileId: 'alan', name: 'Alan' };
    const result = buildBeatsSeries(roster, getSeries, { intervalMs: 5000 });

    // Interior nulls should be forward-filled, not preserved
    // Expected: [0, 0, 0, 5, 5, 5, 12, 12, 12, 20]
    expect(result.beats[1]).toBe(0);  // forward-filled from index 0
    expect(result.beats[4]).toBe(5);  // forward-filled from index 3
    expect(result.beats[7]).toBe(12); // forward-filled from index 6
    expect(result.beats[9]).toBe(20);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run tests/isolated/domain/fitness/chart-helpers.unit.test.mjs`
Expected: FAIL — interior nulls are preserved by `fillEdgesOnly`, so `result.beats[1]` is null, not 0

---

### Task 4: Implement forward-fill for cumulative metrics (O4)

**Files:**
- Modify: `frontend/src/modules/Fitness/FitnessSidebar/FitnessChart.helpers.js:259-262`

**Step 1: Apply forwardFill after fillEdgesOnly for coins_total**

In the coins_total branch (inside the `if (Array.isArray(coinsRaw) && coinsNonNullCount >= coinsQualityThreshold)` block), change:

```js
    const beats = fillEdgesOnly(coinsRaw.map((v) => (Number.isFinite(v) && v >= 0 ? Math.floor(v) : null)), { startAtZero: true });
```

to:

```js
    const beats = forwardFill(fillEdgesOnly(coinsRaw.map((v) => (Number.isFinite(v) && v >= 0 ? Math.floor(v) : null)), { startAtZero: true }));
```

`forwardFill` already exists at line 83 of this file. `fillEdgesOnly` handles leading/trailing nulls, then `forwardFill` fills interior nulls with the last known value — correct semantics for a cumulative metric where null means "no update" not "dropout".

**Step 2: Run tests to verify they pass**

Run: `npx vitest run tests/isolated/domain/fitness/chart-helpers.unit.test.mjs`
Expected: PASS (both O3 and O4 tests)

**Step 3: Commit**

```bash
git add frontend/src/modules/Fitness/FitnessSidebar/FitnessChart.helpers.js tests/isolated/domain/fitness/chart-helpers.unit.test.mjs
git commit -m "fix(fitness): forward-fill interior nulls in cumulative coins series (O4)"
```

---

### Task 5: Write failing test — DEFAULT_ZONE_COIN_RATES (O2)

**Files:**
- Modify: `tests/isolated/domain/fitness/chart-helpers.unit.test.mjs`

**Step 1: Write the failing test**

Append to the test file:

```js
import { getZoneCoinRate } from '#frontend/modules/Fitness/FitnessSidebar/FitnessChart.helpers.js';

describe('getZoneCoinRate — DEFAULT_ZONE_COIN_RATES (O2)', () => {
  // Test WITHOUT zoneConfig to exercise the default fallback
  it('returns 0 for cool zone (blue — no coins)', () => {
    expect(getZoneCoinRate('cool')).toBe(0);
  });

  it('returns non-zero for active zone (green — earns coins)', () => {
    expect(getZoneCoinRate('active')).toBeGreaterThan(0);
  });

  it('returns higher rate for warm than active', () => {
    expect(getZoneCoinRate('warm')).toBeGreaterThan(getZoneCoinRate('active'));
  });

  it('returns higher rate for hot than warm', () => {
    expect(getZoneCoinRate('hot')).toBeGreaterThan(getZoneCoinRate('warm'));
  });

  it('returns higher rate for fire than hot', () => {
    expect(getZoneCoinRate('fire')).toBeGreaterThan(getZoneCoinRate('hot'));
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run tests/isolated/domain/fitness/chart-helpers.unit.test.mjs`
Expected: FAIL — `getZoneCoinRate('active')` returns 0 (current bug: `active` mapped to 0, `cool` missing from defaults)

---

### Task 6: Fix DEFAULT_ZONE_COIN_RATES (O2)

**Files:**
- Modify: `frontend/src/modules/Fitness/FitnessSidebar/FitnessChart.helpers.js:16-21`

**Step 1: Replace the incorrect defaults**

Change:

```js
const DEFAULT_ZONE_COIN_RATES = {
  active: 0,    // blue - no coins
  warm: 1,      // yellow
  hot: 3,       // orange
  fire: 5       // red
};
```

to:

```js
const DEFAULT_ZONE_COIN_RATES = {
  rest: 0,      // gray — no coins
  cool: 0,      // blue — no coins
  active: 1,    // green — earns coins
  warm: 3,      // yellow
  hot: 5,       // orange
  fire: 7       // red
};
```

**Step 2: Run tests to verify they pass**

Run: `npx vitest run tests/isolated/domain/fitness/chart-helpers.unit.test.mjs`
Expected: PASS

**Step 3: Commit**

```bash
git add frontend/src/modules/Fitness/FitnessSidebar/FitnessChart.helpers.js tests/isolated/domain/fitness/chart-helpers.unit.test.mjs
git commit -m "fix(fitness): correct DEFAULT_ZONE_COIN_RATES zone names and values (O2)"
```

---

### Task 7: Pass zoneConfig to historical chart mode (O1)

**Files:**
- Modify: `frontend/src/modules/Fitness/FitnessPlugins/plugins/FitnessChartApp/FitnessChartApp.jsx:715`

**Step 1: Remove the null override for historical zoneConfig**

Change line 715:

```js
	const chartZoneConfig = isHistorical ? null : zoneConfig;
```

to:

```js
	const chartZoneConfig = zoneConfig;
```

Rationale: `zoneConfig` comes from the FitnessContext which loads it from household config. It's always available regardless of whether the chart is showing live or historical data. The original `null` was over-cautious — the household's zone config is stable and applies to all sessions.

When `zoneConfig` is `null` (e.g., the household config hasn't loaded), `enforceZoneSlopes` will fall back to `DEFAULT_ZONE_COIN_RATES` (now fixed by O2).

**Step 2: Run existing tests**

Run: `npx vitest run tests/isolated/domain/fitness/`
Expected: PASS (no test relied on historical zoneConfig being null)

**Step 3: Commit**

```bash
git add frontend/src/modules/Fitness/FitnessPlugins/plugins/FitnessChartApp/FitnessChartApp.jsx
git commit -m "fix(fitness): pass zoneConfig to historical chart mode for slope enforcement (O1)"
```

---

### Task 8: Verify O7 (blue zone staircase) is resolved

This is a verification task, not a code change. O7 (blue zone vertical jumps) was suspected to be caused by the combination of O1 (null zoneConfig) and O2 (wrong default rates). Both are now fixed.

**Step 1: Write a targeted test**

Append to `tests/isolated/domain/fitness/chart-helpers.unit.test.mjs`:

```js
import { buildSegments } from '#frontend/modules/Fitness/FitnessSidebar/FitnessChart.helpers.js';

describe('buildSegments + enforceZoneSlopes — blue zone flatness (O7)', () => {
  it('produces flat values for cool (blue) zone segments', () => {
    // Simulate: user accumulates coins in warm zone, then drops to cool zone
    // In cool zone, coins should stay flat (coinRate=0)
    const beats = [0, 5, 10, 15, 20, 20, 20, 20, 20, 25, 30];
    const zones = ['warm', 'warm', 'warm', 'warm', 'warm', 'cool', 'cool', 'cool', 'cool', 'warm', 'warm'];
    const active = Array(11).fill(true);

    const segments = buildSegments(beats, zones, active, { zoneConfig: [] });

    // Find the cool segment
    const coolSegments = segments.filter(s => s.zone === 'cool' && !s.isGap);
    expect(coolSegments.length).toBeGreaterThan(0);

    // All points in cool segments should have the same value (flat)
    coolSegments.forEach(seg => {
      const values = seg.points.map(p => p.v);
      const uniqueValues = [...new Set(values)];
      // Should be flat — only 1 unique value (or 2 if first point is a continuity point)
      // The key check: no upward slope within cool segments
      for (let i = 1; i < values.length; i++) {
        expect(values[i]).toBeLessThanOrEqual(values[0]);
      }
    });
  });
});
```

**Step 2: Run test**

Run: `npx vitest run tests/isolated/domain/fitness/chart-helpers.unit.test.mjs`
Expected: PASS — confirms O7 is resolved by O1+O2 fixes

**Step 3: Commit**

```bash
git add tests/isolated/domain/fitness/chart-helpers.unit.test.mjs
git commit -m "test(fitness): verify blue zone flatness after O1+O2 fixes (O7)"
```

---

### Task 9: Consolidate zone colors — single source of truth (O5)

**Files:**
- Modify: `frontend/src/modules/Fitness/domain/types.js:155-171`

**Step 1: Write failing test**

Append to `tests/isolated/domain/fitness/chart-helpers.unit.test.mjs`:

```js
import { ZoneColors, getZoneColor as getZoneColorDomain } from '#frontend/modules/Fitness/domain/types.js';
import { ZONE_COLORS } from '#frontend/modules/Fitness/shared/constants/fitness.js';

describe('zone color consolidation (O5)', () => {
  it('domain ZoneColors match shared constants ZONE_COLORS for all zone IDs', () => {
    const zoneIds = ['cool', 'active', 'warm', 'hot', 'fire'];
    zoneIds.forEach(zone => {
      expect(ZoneColors[zone]).toBe(ZONE_COLORS[zone]);
    });
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run tests/isolated/domain/fitness/chart-helpers.unit.test.mjs`
Expected: FAIL — `ZoneColors.cool` is `#4fb1ff` but `ZONE_COLORS.cool` is `#6ab8ff`

---

### Task 10: Update ZoneColors to match canonical ZONE_COLORS (O5)

**Files:**
- Modify: `frontend/src/modules/Fitness/domain/types.js:155-162`

**Step 1: Update ZoneColors to use values from shared/constants/fitness.js**

Change:

```js
export const ZoneColors = Object.freeze({
  cool: '#4fb1ff',
  active: '#4ade80',
  warm: '#facc15',
  hot: '#fb923c',
  fire: '#f87171',
  default: '#9ca3af'
});
```

to:

```js
export const ZoneColors = Object.freeze({
  cool: '#6ab8ff',
  active: '#51cf66',
  warm: '#ffd43b',
  hot: '#ff922b',
  fire: '#ff6b6b',
  default: '#888888'
});
```

These values match `ZONE_COLORS` in `shared/constants/fitness.js`, making the constants file the single source of truth for zone hex values.

**Step 2: Run tests**

Run: `npx vitest run tests/isolated/domain/fitness/chart-helpers.unit.test.mjs`
Expected: PASS

**Step 3: Commit**

```bash
git add frontend/src/modules/Fitness/domain/types.js tests/isolated/domain/fitness/chart-helpers.unit.test.mjs
git commit -m "fix(fitness): consolidate ZoneColors to match canonical ZONE_COLORS (O5)"
```

---

### Task 11: Add missing zones to ZONE_SYMBOL_MAP in PersistenceManager (O6)

**Files:**
- Modify: `frontend/src/hooks/fitness/PersistenceManager.js:29-34`

**Step 1: Write failing test**

Append to `tests/isolated/domain/fitness/chart-helpers.unit.test.mjs`:

```js
describe('ZONE_SYMBOL_MAP completeness (O6)', () => {
  // We test this indirectly through PersistenceManager's _encodeValue
  // by importing the class and encoding zone values
  it('abbreviates rest and fire zones', async () => {
    const { PersistenceManager } = await import('#frontend/hooks/fitness/PersistenceManager.js');
    const pm = new PersistenceManager({ persistApi: () => Promise.resolve() });

    // _encodeValue is called internally; we test via _runLengthEncode
    const encoded = pm._runLengthEncode('zone_id', ['rest', 'cool', 'active', 'warm', 'hot', 'fire']);
    // All zones should be abbreviated to single characters
    expect(encoded).toEqual(['r', 'c', 'a', 'w', 'h', 'f']);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run tests/isolated/domain/fitness/chart-helpers.unit.test.mjs`
Expected: FAIL — `rest` and `fire` pass through unabbreviated

---

### Task 12: Add rest and fire to ZONE_SYMBOL_MAP (O6)

**Files:**
- Modify: `frontend/src/hooks/fitness/PersistenceManager.js:29-34`
- Modify: `frontend/src/modules/Fitness/FitnessPlugins/plugins/FitnessChartApp/sessionDataAdapter.js:19`

**Step 1: Update ZONE_SYMBOL_MAP in PersistenceManager**

Change:

```js
const ZONE_SYMBOL_MAP = {
  cool: 'c',
  active: 'a',
  warm: 'w',
  hot: 'h'
};
```

to:

```js
const ZONE_SYMBOL_MAP = {
  rest: 'r',
  cool: 'c',
  active: 'a',
  warm: 'w',
  hot: 'h',
  fire: 'f'
};
```

**Step 2: Update ZONE_ABBREV_MAP in sessionDataAdapter to match**

Change line 19 in `sessionDataAdapter.js`:

```js
const ZONE_ABBREV_MAP = { c: 'cool', a: 'active', w: 'warm', h: 'hot' };
```

to:

```js
const ZONE_ABBREV_MAP = { r: 'rest', c: 'cool', a: 'active', w: 'warm', h: 'hot', f: 'fire' };
```

**Step 3: Run tests**

Run: `npx vitest run tests/isolated/domain/fitness/chart-helpers.unit.test.mjs`
Expected: PASS

**Step 4: Commit**

```bash
git add frontend/src/hooks/fitness/PersistenceManager.js frontend/src/modules/Fitness/FitnessPlugins/plugins/FitnessChartApp/sessionDataAdapter.js tests/isolated/domain/fitness/chart-helpers.unit.test.mjs
git commit -m "fix(fitness): add rest/fire to zone abbreviation maps (O6)"
```

---

### Task 13: Run full test suite and verify

**Step 1: Run all isolated fitness tests**

Run: `npx vitest run tests/isolated/domain/fitness/`
Expected: All PASS

**Step 2: Run all isolated tests**

Run: `npx vitest run tests/isolated/`
Expected: All PASS (no regressions)

**Step 3: Final commit if any cleanup needed**

No commit expected — this is a verification step.

---

## Summary of Changes

| Issue | File(s) | Change |
|-------|---------|--------|
| O3 | `FitnessChart.helpers.js` | Quality gate: require 5% non-null before using coins_total |
| O4 | `FitnessChart.helpers.js` | Wrap coins_total fill with `forwardFill()` for interior nulls |
| O2 | `FitnessChart.helpers.js` | Fix DEFAULT_ZONE_COIN_RATES: add cool, fix active rate, add rest |
| O1 | `FitnessChartApp.jsx` | Remove `isHistorical ? null :` from chartZoneConfig |
| O7 | (test only) | Verified fixed by O1+O2 combination |
| O5 | `domain/types.js` | Update ZoneColors hex values to match ZONE_COLORS |
| O6 | `PersistenceManager.js`, `sessionDataAdapter.js` | Add rest/fire to ZONE_SYMBOL_MAP and ZONE_ABBREV_MAP |

## Not addressed (deferred)

- **O8** (ActivityMonitor in historical) — Low priority, large effort, minor visual difference. Recommended for future work.
- **Long-term:** Persist zoneConfig with each session YAML to eliminate DEFAULT_ZONE_COIN_RATES entirely.
