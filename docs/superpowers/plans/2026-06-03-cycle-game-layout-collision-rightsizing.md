# CycleGame Layout — Active Collision/Overlap Prevention & Rightsizing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the cycle-game layout manager *deterministically rightsize* each panel to its zone and *actively prevent overflow/overlap*, eliminating the ResizeObserver feedback-loop class and honoring each panel's `sizeHint`, with overflow + thrash detection logged.

**Architecture:** The layout currently lets each panel self-measure (its own `ResizeObserver`) and uses equal `1fr` columns regardless of `sizeHint` — that's the thrash source and ignores panel size intent. This plan inverts the flow: the **layout owns measurement**. `RaceLayoutManager` makes the grid rows/columns *deterministic* (stable bottom band when the speedo row is present; top columns weighted by `sizeHint`); `PanelSlot` measures each zone box once and passes a stable `{width,height}` down; panels become **pure functions of their given box** (no self-measuring). A pure `fitScale` guard scales any panel's content to fit its zone (never overflowing into a neighbor), and a pure thrash detector warns when layout churn spikes. New logic lives in two pure, unit-tested modules (`layoutSizing.js`, `layoutMonitor.js`); the React wiring is thin.

**Tech Stack:** React (JSX), SCSS, Vitest + @testing-library/react. Run one test file:
`./node_modules/.bin/vitest run --config vitest.config.mjs <path>`

**Conventions (do not reinvent):**
- Structured logging only (`getLogger().child({component})`), never raw console.
- `sizeHint` values in `racePanels.js` are `'wide'` (speedoRow, bottom), `'standard'` (distanceChart/rankings/lapTable/ovalTrack), `'focus'` (cameraZoom).
- The race tick is 1 Hz; `RaceLayoutManager` re-renders every tick with a fresh `decision`, so any per-render work must be change-guarded.
- `Date.now()` is fine in component effects here (this is presentational, not the pure director).

---

## File Structure

| File | Responsibility | Tasks |
|------|----------------|-------|
| `frontend/src/modules/Fitness/lib/cycleGame/layoutSizing.js` (new) | Pure sizing math: column weights, fit-scale, gauge-row size from a given box | 1, 2 |
| `frontend/src/modules/Fitness/lib/cycleGame/layoutSizing.test.js` (new) | Unit tests | 1, 2 |
| `frontend/src/modules/Fitness/lib/cycleGame/layoutMonitor.js` (new) | Pure rolling-window thrash detector | 3 |
| `frontend/src/modules/Fitness/lib/cycleGame/layoutMonitor.test.js` (new) | Unit tests | 3 |
| `frontend/src/modules/Fitness/widgets/CycleGame/panels/PanelSlot.jsx` | Measure zone box once; pass `zoneBox` to the panel | 4 |
| `frontend/src/modules/Fitness/widgets/CycleGame/panels/PanelSlot.test.jsx` (new) | Component test | 4 |
| `frontend/src/modules/Fitness/widgets/CycleGame/RaceLayoutManager.jsx` | Deterministic rows + `sizeHint`-weighted columns + thrash warn | 5 |
| `frontend/src/modules/Fitness/widgets/CycleGame/RaceLayoutManager.scss` | Grid uses CSS vars for rows/cols | 5 |
| `frontend/src/modules/Fitness/widgets/CycleGame/RaceLayoutManager.test.jsx` | Component test | 5 |
| `frontend/src/modules/Fitness/widgets/CycleGame/panels/SpeedoRow.jsx` | Size gauges from the provided `zoneBox` (drop own ResizeObserver) | 6 |
| `frontend/src/modules/Fitness/widgets/CycleGame/panels/SpeedoRow.test.jsx` | Component test | 6 |
| `frontend/src/modules/Fitness/widgets/CycleGame/panels/useFitGuard.js` (new) | Hook: scale content to fit its zone + log overflow | 7 |
| `frontend/src/modules/Fitness/widgets/CycleGame/panels/DistanceChart.jsx` | Apply the fit guard | 7 |

---

## Task 1: Pure column-weight + fit-scale helpers

**Files:**
- Create: `frontend/src/modules/Fitness/lib/cycleGame/layoutSizing.js`
- Test: `frontend/src/modules/Fitness/lib/cycleGame/layoutSizing.test.js`

- [ ] **Step 1: Write the failing test**

Create `layoutSizing.test.js`:

```js
import { describe, it, expect } from 'vitest';
import { columnTemplateFor, fitScale } from './layoutSizing.js';

describe('columnTemplateFor', () => {
  it('weights a focus panel wider than standard ones', () => {
    expect(columnTemplateFor(['focus', 'standard'])).toBe('2fr 1fr');
  });
  it('gives equal columns to all-standard zones', () => {
    expect(columnTemplateFor(['standard', 'standard', 'standard'])).toBe('1fr 1fr 1fr');
  });
  it('falls back to a single full column when empty', () => {
    expect(columnTemplateFor([])).toBe('1fr');
  });
  it('treats unknown hints as standard weight', () => {
    expect(columnTemplateFor(['mystery', 'focus'])).toBe('1fr 2fr');
  });
});

describe('fitScale', () => {
  it('returns 1 when content already fits', () => {
    expect(fitScale({ width: 100, height: 80 }, { width: 200, height: 200 })).toBe(1);
  });
  it('returns the limiting ratio (<1) when content overflows', () => {
    expect(fitScale({ width: 400, height: 100 }, { width: 200, height: 200 })).toBe(0.5);
  });
  it('returns 1 for any non-positive dimension (nothing to scale)', () => {
    expect(fitScale({ width: 0, height: 0 }, { width: 200, height: 200 })).toBe(1);
    expect(fitScale({ width: 100, height: 100 }, { width: 0, height: 0 })).toBe(1);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `./node_modules/.bin/vitest run --config vitest.config.mjs frontend/src/modules/Fitness/lib/cycleGame/layoutSizing.test.js`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

Create `layoutSizing.js`:

```js
// Pure layout sizing math for the race screen.
//
// columnTemplateFor: a panel's sizeHint → its relative weight in the top grid
// row, so a 'focus' panel (the broadcast camera) gets more width than a
// 'standard' one. Returns a CSS grid-template-columns string.
const HINT_WEIGHT = { focus: 2, wide: 1, standard: 1 };

export function columnTemplateFor(sizeHints = []) {
  const list = (Array.isArray(sizeHints) ? sizeHints : []).filter(Boolean);
  if (list.length === 0) return '1fr';
  return list.map((h) => `${HINT_WEIGHT[h] || 1}fr`).join(' ');
}

// fitScale: the largest uniform scale (≤ 1) that fits `content` inside `zone`
// without overflow. 1 when it already fits or when a dimension is unknown.
export function fitScale(content = {}, zone = {}) {
  const cw = Number(content.width) || 0;
  const ch = Number(content.height) || 0;
  const zw = Number(zone.width) || 0;
  const zh = Number(zone.height) || 0;
  if (cw <= 0 || ch <= 0 || zw <= 0 || zh <= 0) return 1;
  return Math.min(1, zw / cw, zh / ch);
}

export default { columnTemplateFor, fitScale };
```

- [ ] **Step 4: Run it to verify it passes**

Run: `./node_modules/.bin/vitest run --config vitest.config.mjs frontend/src/modules/Fitness/lib/cycleGame/layoutSizing.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/modules/Fitness/lib/cycleGame/layoutSizing.js frontend/src/modules/Fitness/lib/cycleGame/layoutSizing.test.js
git commit -m "feat(cycle-game): pure layout sizing helpers (column weights + fit-scale)"
```

---

## Task 2: Pure gauge-row sizing from a given zone box

This moves SpeedoRow's sizing into a pure function that takes the **parent-measured** zone box — the foundation for killing the self-measuring loop (Task 6).

**Files:**
- Modify: `frontend/src/modules/Fitness/lib/cycleGame/layoutSizing.js`
- Test: `frontend/src/modules/Fitness/lib/cycleGame/layoutSizing.test.js`

- [ ] **Step 1: Write the failing test** — append to `layoutSizing.test.js`:

```js
import { gaugeRowSize } from './layoutSizing.js';

describe('gaugeRowSize', () => {
  it('fits N gauges across the zone width (minus gaps), capped by height', () => {
    // width path: (900 - 28*2)/3 ≈ 281 → clamped to 280; height 400-50=350 → min(280,350)=280
    expect(gaugeRowSize({ zoneW: 900, zoneH: 400, count: 3, gap: 28 })).toBe(280);
  });
  it('is limited by height when the band is short', () => {
    // height path: 180-50 = 130; width path large → min = 130
    expect(gaugeRowSize({ zoneW: 1200, zoneH: 180, count: 2, gap: 28 })).toBe(130);
  });
  it('clamps to the floor for a tiny zone', () => {
    expect(gaugeRowSize({ zoneW: 50, zoneH: 50, count: 6, gap: 28 })).toBe(96);
  });
  it('defaults to the floor for an unmeasured (zero) box', () => {
    expect(gaugeRowSize({ zoneW: 0, zoneH: 0, count: 1 })).toBe(96);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `./node_modules/.bin/vitest run --config vitest.config.mjs frontend/src/modules/Fitness/lib/cycleGame/layoutSizing.test.js -t gaugeRowSize`
Expected: FAIL — `gaugeRowSize` is not exported.

- [ ] **Step 3: Implement** — add to `layoutSizing.js` (before the default export):

```js
// gaugeRowSize: the per-gauge pixel size for the speedo row, derived from the
// zone box the LAYOUT measured (not the row's own content height — that
// self-measuring is the thrash loop). Fits N gauges across the width minus gaps,
// capped by the available height, clamped to [min, max].
export function gaugeRowSize({ zoneW = 0, zoneH = 0, count = 1, gap = 28, min = 96, max = 280 } = {}) {
  const n = Math.max(1, count);
  const byWidth = (zoneW - gap * (n - 1)) / n;
  const byHeight = zoneH - 50; // room for the odometer pill beneath the gauge
  const raw = Math.floor(Math.min(byWidth, byHeight));
  return Math.max(min, Math.min(max, Number.isFinite(raw) && raw > 0 ? raw : min));
}
```

And update the default export line to:

```js
export default { columnTemplateFor, fitScale, gaugeRowSize };
```

- [ ] **Step 4: Run it to verify it passes**

Run: `./node_modules/.bin/vitest run --config vitest.config.mjs frontend/src/modules/Fitness/lib/cycleGame/layoutSizing.test.js`
Expected: PASS (all describe blocks).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/modules/Fitness/lib/cycleGame/layoutSizing.js frontend/src/modules/Fitness/lib/cycleGame/layoutSizing.test.js
git commit -m "feat(cycle-game): gaugeRowSize — pure speedo sizing from a measured zone box"
```

---

## Task 3: Pure thrash detector

**Files:**
- Create: `frontend/src/modules/Fitness/lib/cycleGame/layoutMonitor.js`
- Test: `frontend/src/modules/Fitness/lib/cycleGame/layoutMonitor.test.js`

- [ ] **Step 1: Write the failing test**

Create `layoutMonitor.test.js`:

```js
import { describe, it, expect } from 'vitest';
import { createThrashDetector } from './layoutMonitor.js';

describe('createThrashDetector', () => {
  it('trips when >= threshold events fall within the window', () => {
    const d = createThrashDetector({ windowMs: 1000, threshold: 4 });
    d.record(0); d.record(100); d.record(200);
    expect(d.tripped(300)).toBe(false); // only 3 in window
    d.record(300);
    expect(d.tripped(300)).toBe(true);  // 4 within 1000ms
  });
  it('forgets events older than the window', () => {
    const d = createThrashDetector({ windowMs: 1000, threshold: 3 });
    d.record(0); d.record(100);
    d.record(2000); // 0 and 100 are now stale (>1000ms before 2000)
    expect(d.count(2000)).toBe(1);
    expect(d.tripped(2000)).toBe(false);
  });
  it('reports a count for the current window', () => {
    const d = createThrashDetector({ windowMs: 500, threshold: 99 });
    d.record(0); d.record(400); d.record(450);
    expect(d.count(450)).toBe(3);
    expect(d.count(1000)).toBe(0);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `./node_modules/.bin/vitest run --config vitest.config.mjs frontend/src/modules/Fitness/lib/cycleGame/layoutMonitor.test.js`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

Create `layoutMonitor.js`:

```js
// Pure rolling-window thrash detector. record(now) timestamps a layout/resize
// event; tripped(now) is true once >= threshold events fall within windowMs.
// Clock is passed in (no Date.now) so it's deterministically testable.
export function createThrashDetector({ windowMs = 2000, threshold = 8 } = {}) {
  let stamps = [];
  const prune = (now) => { stamps = stamps.filter((t) => now - t <= windowMs); };
  return {
    record(now) { stamps.push(now); prune(now); return stamps.length; },
    count(now) { prune(now); return stamps.length; },
    tripped(now) { return this.count(now) >= threshold; }
  };
}

export default { createThrashDetector };
```

- [ ] **Step 4: Run it to verify it passes**

Run: `./node_modules/.bin/vitest run --config vitest.config.mjs frontend/src/modules/Fitness/lib/cycleGame/layoutMonitor.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/modules/Fitness/lib/cycleGame/layoutMonitor.js frontend/src/modules/Fitness/lib/cycleGame/layoutMonitor.test.js
git commit -m "feat(cycle-game): pure rolling-window layout thrash detector"
```

---

## Task 4: `PanelSlot` measures the zone box and passes it down

The layout now owns measurement: each slot measures its grid-cell box **once per size change** and injects a stable `zoneBox` prop into its panel. Panels stop self-measuring (Task 6).

**Files:**
- Modify: `frontend/src/modules/Fitness/widgets/CycleGame/panels/PanelSlot.jsx`
- Test: `frontend/src/modules/Fitness/widgets/CycleGame/panels/PanelSlot.test.jsx` (new)

- [ ] **Step 1: Write the failing test**

Create `PanelSlot.test.jsx`:

```jsx
import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import PanelSlot from './PanelSlot.jsx';

function Probe({ zoneBox }) {
  return <div data-testid="probe">{zoneBox ? `${zoneBox.width}x${zoneBox.height}` : 'no-box'}</div>;
}

describe('PanelSlot', () => {
  it('injects a zoneBox prop into its panel child', () => {
    // jsdom reports 0x0 for clientWidth/Height, so the box is {width:0,height:0}.
    const { getByTestId } = render(
      <PanelSlot panelId="distanceChart"><Probe /></PanelSlot>
    );
    // The slot renders and the child receives a zoneBox object (not undefined).
    expect(getByTestId('probe').textContent).toBe('0x0');
  });
  it('keeps the data-panel attribute on the slot element', () => {
    const { container } = render(<PanelSlot panelId="rankings"><Probe /></PanelSlot>);
    expect(container.querySelector('[data-panel="rankings"]')).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `./node_modules/.bin/vitest run --config vitest.config.mjs frontend/src/modules/Fitness/widgets/CycleGame/panels/PanelSlot.test.jsx`
Expected: FAIL — current `PanelSlot` renders `no-box` (it doesn't pass `zoneBox`).

- [ ] **Step 3: Implement** — replace the whole `PanelSlot.jsx`:

```jsx
import React, { useEffect, useRef, useState, cloneElement, isValidElement } from 'react';
import PropTypes from 'prop-types';

/**
 * Per-zone mount + enter animation. The layout owns measurement: the slot
 * measures its own grid-cell box and injects a stable `zoneBox` ({width,height})
 * into the panel, so panels size from a parent-provided box instead of running
 * their own ResizeObserver (which caused measure→resize→measure thrash). The box
 * only updates when it actually changes. Keyed by panelId so a swap remounts.
 */
export default function PanelSlot({ panelId, children }) {
  const ref = useRef(null);
  const [box, setBox] = useState({ width: 0, height: 0 });

  useEffect(() => {
    const el = ref.current;
    if (!el) return undefined;
    const measure = () => {
      const w = Math.round(el.clientWidth);
      const h = Math.round(el.clientHeight);
      setBox((prev) => (prev.width === w && prev.height === h ? prev : { width: w, height: h }));
    };
    measure();
    let ro;
    if (typeof ResizeObserver !== 'undefined') { ro = new ResizeObserver(measure); ro.observe(el); }
    return () => { if (ro) ro.disconnect(); };
  }, [panelId]);

  const child = isValidElement(children) ? cloneElement(children, { zoneBox: box }) : children;
  return (
    <div ref={ref} className="race-layout__slot" data-panel={panelId}>{child}</div>
  );
}
PanelSlot.propTypes = { panelId: PropTypes.string, children: PropTypes.node };
```

- [ ] **Step 4: Run it to verify it passes**

Run: `./node_modules/.bin/vitest run --config vitest.config.mjs frontend/src/modules/Fitness/widgets/CycleGame/panels/PanelSlot.test.jsx`
Expected: PASS.

- [ ] **Step 5: Run the existing screen suite to confirm no regression**

Run: `./node_modules/.bin/vitest run --config vitest.config.mjs frontend/src/modules/Fitness/widgets/CycleGame/`
Expected: PASS (panels ignore the extra `zoneBox` prop until Task 6 uses it).

- [ ] **Step 6: Commit**

```bash
git add frontend/src/modules/Fitness/widgets/CycleGame/panels/PanelSlot.jsx frontend/src/modules/Fitness/widgets/CycleGame/panels/PanelSlot.test.jsx
git commit -m "feat(cycle-game): PanelSlot measures zone box, injects stable zoneBox into panels"
```

---

## Task 5: `RaceLayoutManager` — deterministic rows + sizeHint columns + thrash warn

Make the grid deterministic (stable bottom band when the speedo row is present, so its zone box is stable) and weight the top columns by `sizeHint`. Wire the thrash detector to warn on layout churn.

**Files:**
- Modify: `frontend/src/modules/Fitness/widgets/CycleGame/RaceLayoutManager.jsx`
- Modify: `frontend/src/modules/Fitness/widgets/CycleGame/RaceLayoutManager.scss`
- Test: `frontend/src/modules/Fitness/widgets/CycleGame/RaceLayoutManager.test.jsx`

- [ ] **Step 1: Write the failing test** — add to `RaceLayoutManager.test.jsx` (inside its existing `describe`):

```jsx
it('weights the top columns by the assigned panels\' sizeHint', () => {
  // cameraZoom is 'focus' (weight 2), rankings is 'standard' (weight 1)
  const decision = { zones: { topLeft: 'rankings', topCenter: 'cameraZoom', topRight: null, bottom: 'speedoRow' } };
  const panels = {
    rankings: () => <div data-testid="p-rankings" />,
    cameraZoom: () => <div data-testid="p-camera" />,
    speedoRow: () => <div data-testid="p-speedo" />
  };
  const { container } = render(<RaceLayoutManager decision={decision} panels={panels} />);
  const top = container.querySelector('.race-layout__top');
  expect(top.style.getPropertyValue('--top-cols')).toBe('1fr 2fr'); // rankings(1) + camera(2)
});
it('reserves a stable bottom band when the speedo row is present, collapses it when absent', () => {
  const withSpeedo = { zones: { topLeft: 'rankings', bottom: 'speedoRow' } };
  const noSpeedo = { zones: { topLeft: 'rankings', bottom: null } };
  const panels = { rankings: () => <div />, speedoRow: () => <div /> };
  const a = render(<RaceLayoutManager decision={withSpeedo} panels={panels} />);
  expect(a.container.querySelector('.race-layout').style.getPropertyValue('--rows')).toBe('1fr 38%');
  const b = render(<RaceLayoutManager decision={noSpeedo} panels={panels} />);
  expect(b.container.querySelector('.race-layout').style.getPropertyValue('--rows')).toBe('1fr 0px');
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `./node_modules/.bin/vitest run --config vitest.config.mjs frontend/src/modules/Fitness/widgets/CycleGame/RaceLayoutManager.test.jsx -t "sizeHint"`
Expected: FAIL — no `--top-cols` / `--rows` vars are set.

- [ ] **Step 3: Implement** — replace `RaceLayoutManager.jsx` with:

```jsx
import React, { useEffect, useMemo, useRef } from 'react';
import PropTypes from 'prop-types';
import PanelSlot from './panels/PanelSlot.jsx';
import { panelById } from '@/modules/Fitness/lib/cycleGame/racePanels.js';
import { columnTemplateFor } from '@/modules/Fitness/lib/cycleGame/layoutSizing.js';
import { createThrashDetector } from '@/modules/Fitness/lib/cycleGame/layoutMonitor.js';
import getLogger from '@/lib/logging/Logger.js';
import './RaceLayoutManager.scss';

const TOP = ['topLeft', 'topCenter', 'topRight'];
const BOTTOM_BAND = '38%'; // stable speedo-band height (collapses to 0 when empty)

export default function RaceLayoutManager({ decision, panels }) {
  const zones = decision?.zones || {};
  const filledTop = TOP.filter((z) => zones[z]);
  // Columns weighted by each filled top panel's sizeHint (focus wider than standard).
  const topCols = columnTemplateFor(filledTop.map((z) => panelById(zones[z])?.sizeHint || 'standard'));
  // Deterministic rows: a stable bottom band when the speedo row is present (so its
  // zone box doesn't depend on content), collapsed when absent.
  const rows = `1fr ${zones.bottom ? BOTTOM_BAND : '0px'}`;

  // Telemetry + thrash warn: log the layout on change; warn if it churns too fast.
  const log = useMemo(() => getLogger().child({ component: 'cycle-race-layout' }), []);
  const detector = useMemo(() => createThrashDetector({ windowMs: 2000, threshold: 8 }), []);
  const sig = `${rows}|${topCols}|${TOP.map((z) => zones[z] || '-').join(',')}|${zones.bottom || '-'}`;
  const lastSigRef = useRef(null);
  useEffect(() => {
    if (lastSigRef.current === sig) return;
    lastSigRef.current = sig;
    const now = Date.now();
    log.debug('cycle_game.layout', { rows, topCols, zones });
    if (detector.record(now) >= 8) {
      log.warn('cycle_game.layout_thrash', { count: detector.count(now), windowMs: 2000, zones });
    }
  }, [sig, rows, topCols, zones, log, detector]);

  const renderZone = (zone) => {
    const id = zones[zone];
    const Panel = id ? panels[id] : null;
    return (
      <div key={zone} data-testid={`zone-${zone}`}
        className={`race-layout__zone race-layout__zone--${zone}${Panel ? '' : ' race-layout__zone--empty'}`}>
        {Panel ? <PanelSlot key={id} panelId={id}><Panel /></PanelSlot> : null}
      </div>
    );
  };
  return (
    <div className="race-layout" style={{ '--rows': rows }}>
      <div className="race-layout__top" style={{ '--top-cols': topCols }}>{TOP.map(renderZone)}</div>
      {renderZone('bottom')}
    </div>
  );
}
RaceLayoutManager.propTypes = { decision: PropTypes.object, panels: PropTypes.object };
```

- [ ] **Step 4: Update the SCSS to consume the vars** — in `RaceLayoutManager.scss`, replace the `.race-layout` and `.race-layout__top` rule bodies:

Find:
```scss
.race-layout {
  display: grid; grid-template-rows: 1fr auto; gap: 16px;
  flex: 1 1 auto; min-height: 0; width: 100%;
  &__top {
    display: grid; gap: 16px; min-height: 0;
    grid-template-columns: repeat(var(--top-filled, 3), 1fr);
  }
```
Replace with:
```scss
.race-layout {
  display: grid; grid-template-rows: var(--rows, 1fr 38%); gap: 16px;
  flex: 1 1 auto; min-height: 0; width: 100%;
  &__top {
    display: grid; gap: 16px; min-height: 0;
    grid-template-columns: var(--top-cols, 1fr);
  }
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `./node_modules/.bin/vitest run --config vitest.config.mjs frontend/src/modules/Fitness/widgets/CycleGame/RaceLayoutManager.test.jsx`
Expected: PASS (new + existing tests; if an existing test asserted `--top-filled`, update it to `--top-cols`).

- [ ] **Step 6: Commit**

```bash
git add frontend/src/modules/Fitness/widgets/CycleGame/RaceLayoutManager.jsx frontend/src/modules/Fitness/widgets/CycleGame/RaceLayoutManager.scss frontend/src/modules/Fitness/widgets/CycleGame/RaceLayoutManager.test.jsx
git commit -m "feat(cycle-game): deterministic grid rows + sizeHint-weighted columns + thrash warn"
```

---

## Task 6: `SpeedoRow` sizes from the provided `zoneBox`

Drop SpeedoRow's own `ResizeObserver` entirely; size the gauges from the stable parent-provided box via `gaugeRowSize`. This removes the last self-measuring loop.

**Files:**
- Modify: `frontend/src/modules/Fitness/widgets/CycleGame/panels/SpeedoRow.jsx`
- Test: `frontend/src/modules/Fitness/widgets/CycleGame/panels/SpeedoRow.test.jsx`

- [ ] **Step 1: Write the failing test** — add to `SpeedoRow.test.jsx`:

```jsx
it('sizes gauges from the provided zoneBox (no self-measuring)', () => {
  const riders = { a: { userId: 'a', displayName: 'A', cumulativeDistanceM: 0 } };
  const { container } = render(
    <SpeedoRow riderIds={['a']} riders={riders} riderLive={{ a: { rpm: 0 } }} cadenceBands={[]}
      zoneBox={{ width: 900, height: 400 }} />
  );
  // 1 gauge in a 900-wide band → clamped to the 280 max; the gauge wrapper width follows.
  const gauge = container.querySelector('.cycle-speedometer');
  expect(gauge).toBeTruthy();
  expect(gauge.style.width).toBe('280px');
});
```

(If `SpeedoRow.test.jsx` doesn't import `SpeedoRow`/`render` yet, mirror the existing imports at the top of that file.)

- [ ] **Step 2: Run it to verify it fails**

Run: `./node_modules/.bin/vitest run --config vitest.config.mjs frontend/src/modules/Fitness/widgets/CycleGame/panels/SpeedoRow.test.jsx -t "zoneBox"`
Expected: FAIL — SpeedoRow ignores `zoneBox` (size comes from its own observer, 240 default in jsdom).

- [ ] **Step 3: Implement** — replace the top of `SpeedoRow.jsx` (imports through the size derivation) with:

```jsx
import React from 'react';
import PropTypes from 'prop-types';
import CycleSpeedometer from '../CycleSpeedometer.jsx';
import { LINE_COLORS } from '@/modules/Fitness/lib/cycleGame/lineColors.js';
import { gaugeRowSize } from '@/modules/Fitness/lib/cycleGame/layoutSizing.js';

const SPEEDO_GAP = 28; // keep in sync with .cycle-race-screen__speedos gap

/**
 * Bottom row of CycleSpeedometers — one gauge per rider on a single line. The
 * gauge size is computed PURELY from the zone box the layout measured
 * (`zoneBox`), so there's no self-measuring ResizeObserver loop. Falls back to a
 * reasonable size before the first measurement.
 */
export default function SpeedoRow({ riderIds, riders, riderLive, cadenceBands, zoneBox }) {
  const speedoSize = gaugeRowSize({
    zoneW: zoneBox?.width || 0,
    zoneH: zoneBox?.height || 0,
    count: riderIds.length,
    gap: SPEEDO_GAP
  });

  return (
    <div className="cycle-race-screen__speedos">
```

Then update the `propTypes` block at the bottom of the file to add `zoneBox`:

```jsx
SpeedoRow.propTypes = {
  riderIds: PropTypes.array.isRequired,
  riders: PropTypes.object.isRequired,
  riderLive: PropTypes.object.isRequired,
  cadenceBands: PropTypes.array,
  zoneBox: PropTypes.shape({ width: PropTypes.number, height: PropTypes.number })
};
```

(Remove the now-unused `useEffect/useRef/useState`, the `speedosRef`, `lastSizeRef`, the `getLogger` import + `log`, and the whole measuring `useEffect`. The `<div className="cycle-race-screen__speedos">` no longer needs a `ref`. Keep the `{riderIds.map(...)}` gauge-render block exactly as-is.)

- [ ] **Step 4: Run the test to verify it passes**

Run: `./node_modules/.bin/vitest run --config vitest.config.mjs frontend/src/modules/Fitness/widgets/CycleGame/panels/SpeedoRow.test.jsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/modules/Fitness/widgets/CycleGame/panels/SpeedoRow.jsx frontend/src/modules/Fitness/widgets/CycleGame/panels/SpeedoRow.test.jsx
git commit -m "feat(cycle-game): SpeedoRow sizes from layout-provided zoneBox (no self-measure loop)"
```

---

## Task 7: Overflow guard — scale content to fit its zone + warn

A reusable hook that scales a panel's content down (CSS `transform: scale`) so it never overflows its zone into a neighbor (active overlap prevention), logging when it has to.

**Files:**
- Create: `frontend/src/modules/Fitness/widgets/CycleGame/panels/useFitGuard.js`
- Modify: `frontend/src/modules/Fitness/widgets/CycleGame/panels/DistanceChart.jsx`
- Test: `frontend/src/modules/Fitness/widgets/CycleGame/panels/useFitGuard.test.jsx` (new)

- [ ] **Step 1: Write the failing test**

Create `useFitGuard.test.jsx`:

```jsx
import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import React, { useRef } from 'react';
import { useFitGuard } from './useFitGuard.js';

function Harness({ zoneBox }) {
  const ref = useRef(null);
  const scale = useFitGuard(ref, zoneBox, 'distanceChart');
  return <div data-testid="scale">{String(scale)}</div>;
}

describe('useFitGuard', () => {
  it('returns a scale of 1 when there is no zone box yet (jsdom content is 0)', () => {
    const { getByTestId } = render(<Harness zoneBox={{ width: 0, height: 0 }} />);
    expect(getByTestId('scale').textContent).toBe('1');
  });
  it('returns 1 when content fits (jsdom reports 0x0 content → fits any zone)', () => {
    const { getByTestId } = render(<Harness zoneBox={{ width: 300, height: 200 }} />);
    expect(getByTestId('scale').textContent).toBe('1');
  });
});
```

(jsdom can't produce real overflow — `fitScale`'s overflow math is unit-tested in Task 1. This test pins the hook's no-op/default behavior; visual overflow is verified live.)

- [ ] **Step 2: Run it to verify it fails**

Run: `./node_modules/.bin/vitest run --config vitest.config.mjs frontend/src/modules/Fitness/widgets/CycleGame/panels/useFitGuard.test.jsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

Create `useFitGuard.js`:

```js
import { useEffect, useMemo, useState } from 'react';
import { fitScale } from '@/modules/Fitness/lib/cycleGame/layoutSizing.js';
import getLogger from '@/lib/logging/Logger.js';

/**
 * Active overflow guard: measures the content element against its zone box and
 * returns a uniform scale (≤ 1) so the content never overflows its zone (which
 * would visually collide with a neighbouring panel). Logs `cycle_game.layout_overflow`
 * (warn) when it has to scale, with the measured boxes. Re-measures when the zone
 * box changes. Returns 1 until measured / when content fits.
 */
export function useFitGuard(ref, zoneBox, panelId) {
  const [scale, setScale] = useState(1);
  const log = useMemo(() => getLogger().child({ component: 'cycle-race-layout' }), []);
  const zw = zoneBox?.width || 0;
  const zh = zoneBox?.height || 0;
  useEffect(() => {
    const el = ref.current;
    if (!el || zw <= 0 || zh <= 0) { setScale(1); return; }
    const content = { width: el.scrollWidth, height: el.scrollHeight };
    const next = fitScale(content, { width: zw, height: zh });
    setScale((prev) => (prev === next ? prev : next));
    if (next < 1) {
      log.warn('cycle_game.layout_overflow', { panelId, content, zone: { width: zw, height: zh }, scale: next });
    }
  }, [ref, zw, zh, panelId, log]);
  return scale;
}

export default useFitGuard;
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `./node_modules/.bin/vitest run --config vitest.config.mjs frontend/src/modules/Fitness/widgets/CycleGame/panels/useFitGuard.test.jsx`
Expected: PASS.

- [ ] **Step 5: Apply the guard in `DistanceChart`** — in `DistanceChart.jsx`:

Add the import after the existing imports:
```jsx
import { useFitGuard } from './useFitGuard.js';
```

Change the component signature to accept `zoneBox`:
```jsx
export default function DistanceChart({ riderIds, riders, riderLive, winCondition, goalM, events = [], zoneBox }) {
```

Right after the existing `const chartRef = useRef(null);` line, add a fit ref + guard:
```jsx
  const fitRef = useRef(null);
  const fitScaleVal = useFitGuard(fitRef, zoneBox, 'distanceChart');
```

Wrap the returned root: change the outer element from
```jsx
  return (
    <div className="cycle-race-screen__chart-wrap" ref={chartRef}>
```
to
```jsx
  return (
    <div className="cycle-race-screen__chart-wrap" ref={chartRef}>
      <div ref={fitRef} style={fitScaleVal < 1 ? { transform: `scale(${fitScaleVal})`, transformOrigin: 'top left' } : undefined}>
```
and add a matching closing `</div>` immediately before the final `</div>` that closes `cycle-race-screen__chart-wrap`.

Add `zoneBox` to `DistanceChart.propTypes`:
```jsx
  zoneBox: PropTypes.shape({ width: PropTypes.number, height: PropTypes.number }),
```

- [ ] **Step 6: Run the chart + screen suites**

Run: `./node_modules/.bin/vitest run --config vitest.config.mjs frontend/src/modules/Fitness/widgets/CycleGame/panels/DistanceChart.test.jsx frontend/src/modules/Fitness/widgets/CycleGame/CycleRaceScreen.test.jsx`
Expected: PASS (scale is 1 in jsdom, so markup is unchanged structurally).

- [ ] **Step 7: Commit**

```bash
git add frontend/src/modules/Fitness/widgets/CycleGame/panels/useFitGuard.js frontend/src/modules/Fitness/widgets/CycleGame/panels/useFitGuard.test.jsx frontend/src/modules/Fitness/widgets/CycleGame/panels/DistanceChart.jsx
git commit -m "feat(cycle-game): overflow fit-guard scales panel content to its zone + warns"
```

---

## Final verification

- [ ] **Run the full Fitness suite**

Run: `./node_modules/.bin/vitest run --config vitest.config.mjs frontend/src/modules/Fitness/`
Expected: PASS (all files green; new tests in Tasks 1–7).

- [ ] **Deploy + visual smoke (operator):** rebuild + `deploy-daylight`, then on a live race confirm: the camera/focus zone is visibly wider than standard zones; the speedo band height is stable (no tall/short thrash); panels never overflow their zone into a neighbor; and a debug-level session JSONL shows `cycle_game.layout` settling (no sustained `cycle_game.layout_thrash` / `layout_overflow` warns).

---

## Notes for the implementer

- **Why this kills the thrash class:** panels no longer self-measure. The *layout* measures each zone box (stable, driven by the deterministic grid), and panels are pure functions of that box. A box can only change when the grid geometry changes (window resize, panel swap), never as a reaction to its own content — so there's no feedback loop to oscillate.
- **`sizeHint` was already declared** in `racePanels.js` (`wide`/`standard`/`focus`) but unused by the layout; Task 5 finally honors it.
- **Collision/overlap** in this codebase is logical (one panel per grid zone) + now geometric-fit (content scaled to never overflow its zone). There is no free-floating/absolute panel positioning, so there's no N-body overlap problem to solve — the guard is per-zone fit, which is sufficient.
- **Don't reintroduce a per-panel `ResizeObserver`** for sizing — that's the anti-pattern this plan removes. Measurement belongs to `PanelSlot`/the layout.
