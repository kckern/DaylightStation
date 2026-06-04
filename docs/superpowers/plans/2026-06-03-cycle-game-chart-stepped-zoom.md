# DistanceChart Stepped Zoom-Out Camera + Lin/Log Grid — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the race chart's free-form auto-fit with a stepped, doubling "zoom-out camera" (fixed window that doubles in 2× steps at a 90% edge threshold) plus decimating, transform-aware gridlines, while keeping the existing linear→log crowding transform.

**Architecture:** A new pure `chartZoom.js` module computes the monotonic zoom level and the decimated gridline values. `DistanceChart` holds the level in a sticky ref (like the existing `logRef`), maps X over a time window `T = 30s·2ᴸ` and Y over a distance window `D = 250m·2ᴸ`, draws gridlines through the active Y transform, and plays a 400ms scale transition on each level bump.

**Tech Stack:** React (JSX), SVG, SCSS, Vitest + @testing-library/react. Run one test file: `./node_modules/.bin/vitest run --config vitest.config.mjs <path>`.

**Spec:** `docs/superpowers/specs/2026-06-03-cycle-game-chart-stepped-zoom-design.md`

**Conventions:** the engine ticks at 1 Hz; `DistanceChart` viewBox is `W=600 × H=200`, `preserveAspectRatio="none"`; distance 0 maps to `y=H` (bottom), time 0 to `x=0` (left). Coordinates are computed in JS, so rendered SVG attributes are assertable in jsdom.

---

## File Structure

| File | Responsibility | Tasks |
|------|----------------|-------|
| `frontend/src/modules/Fitness/lib/cycleGame/chartZoom.js` (new) | Pure: `nextZoomLevel`, `gridUnit`, `gridValues` | 1, 2 |
| `frontend/src/modules/Fitness/lib/cycleGame/chartZoom.test.js` (new) | Unit tests | 1, 2 |
| `frontend/src/modules/Fitness/widgets/CycleGame/panels/DistanceChart.jsx` | Windowed xFor/yFor + level + gridlines + animation | 3, 4, 5 |
| `frontend/src/modules/Fitness/widgets/CycleGame/panels/DistanceChart.test.jsx` | Component tests | 3, 4 |
| `frontend/src/modules/Fitness/widgets/CycleGame/CycleRaceScreen.jsx` | Pass `elapsedS` to DistanceChart | 3 |
| `frontend/src/modules/Fitness/widgets/CycleGame/CycleRaceScreen.scss` | Gridline + zoomable-group styles | 4, 5 |

---

## Task 1: `nextZoomLevel` (pure)

**Files:** Create `frontend/src/modules/Fitness/lib/cycleGame/chartZoom.js` + `chartZoom.test.js`.

- [ ] **Step 1: Write the failing test** — create `chartZoom.test.js`:

```js
import { describe, it, expect } from 'vitest';
import { nextZoomLevel } from './chartZoom.js';

describe('nextZoomLevel', () => {
  const base = { xBaseS: 30, yBaseM: 250, threshold: 0.9 };
  it('stays at level 0 early in a race', () => {
    expect(nextZoomLevel(0, { leaderDistanceM: 50, elapsedS: 5, ...base })).toBe(0);
  });
  it('doubles when distance crosses 90% of the Y window', () => {
    // 0.9 * 250 = 225; 240 >= 225 → must grow to level 1 (D=500)
    expect(nextZoomLevel(0, { leaderDistanceM: 240, elapsedS: 5, ...base })).toBe(1);
  });
  it('doubles when elapsed crosses 90% of the X window', () => {
    // 0.9 * 30 = 27; 28 >= 27 → level 1 (T=60)
    expect(nextZoomLevel(0, { leaderDistanceM: 10, elapsedS: 28, ...base })).toBe(1);
  });
  it('multi-steps when the data leaps past several windows', () => {
    // distance 2000: L0..L3 windows 250/500/1000/2000 all fail 90%; L4 (4000) fits → 4
    expect(nextZoomLevel(0, { leaderDistanceM: 2000, elapsedS: 5, ...base })).toBe(4);
  });
  it('is monotonic — never drops below the previous level', () => {
    expect(nextZoomLevel(3, { leaderDistanceM: 10, elapsedS: 1, ...base })).toBe(3);
  });
});
```

- [ ] **Step 2: Run it → FAIL** (module not found)
`./node_modules/.bin/vitest run --config vitest.config.mjs frontend/src/modules/Fitness/lib/cycleGame/chartZoom.test.js`

- [ ] **Step 3: Implement** — create `chartZoom.js`:

```js
// Stepped zoom-out "camera" math for the race distance chart. Pure, no DOM.
//
// The chart shows a window T = xBaseS·2^L (time) and D = yBaseM·2^L (distance).
// nextZoomLevel returns the smallest level L >= prevLevel that keeps BOTH the
// leader's distance and the elapsed time under `threshold` of their windows — so
// the window doubles in 2x steps as the data approaches the edges, and never
// re-tightens mid-race (monotonic).
export function nextZoomLevel(prevLevel, { leaderDistanceM = 0, elapsedS = 0, xBaseS = 30, yBaseM = 250, threshold = 0.9 } = {}) {
  let L = Math.max(0, Math.floor(Number.isFinite(prevLevel) ? prevLevel : 0));
  const fits = (lvl) => {
    const T = xBaseS * 2 ** lvl;
    const D = yBaseM * 2 ** lvl;
    return elapsedS < threshold * T && leaderDistanceM < threshold * D;
  };
  let guard = 0;
  while (!fits(L) && guard < 32) { L += 1; guard += 1; }
  return L;
}

export default { nextZoomLevel };
```

- [ ] **Step 4: Run it → PASS**
`./node_modules/.bin/vitest run --config vitest.config.mjs frontend/src/modules/Fitness/lib/cycleGame/chartZoom.test.js`

- [ ] **Step 5: Commit**
```bash
git add frontend/src/modules/Fitness/lib/cycleGame/chartZoom.js frontend/src/modules/Fitness/lib/cycleGame/chartZoom.test.js
git commit -m "feat(cycle-game): nextZoomLevel — monotonic doubling zoom level for the chart"
```

---

## Task 2: `gridUnit` + `gridValues` (pure)

**Files:** Modify `chartZoom.js` + `chartZoom.test.js`.

- [ ] **Step 1: Append the failing tests** to `chartZoom.test.js`:

```js
import { gridUnit, gridValues } from './chartZoom.js';

describe('gridUnit', () => {
  it('uses the base unit when its on-screen spacing clears the pixel floor', () => {
    // 250/500 * 600 = 300 px >= 32 → unit stays 250
    expect(gridUnit(500, 600, 250, 32)).toBe(250);
  });
  it('coarsens (doubles) the unit when lines would crowd below the floor', () => {
    // window 8000, px 600: 250/8000*600 = 18.75 < 32 → k=1 → 500 (37.5px ok)
    expect(gridUnit(8000, 600, 250, 32)).toBe(500);
  });
});

describe('gridValues', () => {
  it('returns ascending multiples of the unit up to the window span', () => {
    expect(gridValues(500, 250, 600, 32)).toEqual([0, 250, 500]);
  });
  it('uses the coarsened unit so values never crowd below the floor', () => {
    // window 8000 → unit 500 → [0,500,...,8000]; spacing 37.5px each
    const v = gridValues(8000, 250, 600, 32);
    expect(v[0]).toBe(0);
    expect(v[1]).toBe(500);
    expect(v[v.length - 1]).toBe(8000);
  });
});
```

- [ ] **Step 2: Run it → FAIL** (`gridUnit` not exported)
`./node_modules/.bin/vitest run --config vitest.config.mjs frontend/src/modules/Fitness/lib/cycleGame/chartZoom.test.js -t grid`

- [ ] **Step 3: Implement** — add to `chartZoom.js` before the default export, and update the default export:

```js
// gridUnit: gridline spacing in data units = baseUnit·2^k, the smallest k whose
// on-screen spacing (pxSpan · unit/windowSpan) >= minPx. Coarsens as the window
// grows so lines never crowd below minPx (a "bottom cap" — drops the dense level).
export function gridUnit(windowSpan, pxSpan, baseUnit = 250, minPx = 32) {
  const span = Number(windowSpan) > 0 ? Number(windowSpan) : baseUnit;
  let k = 0, guard = 0;
  while (((baseUnit * 2 ** k) / span) * pxSpan < minPx && guard < 32) { k += 1; guard += 1; }
  return baseUnit * 2 ** k;
}

// gridValues: ascending data values [0, unit, 2·unit, … <= windowSpan] at the
// decimated unit — used for both the X (time) and Y (distance) gridlines.
export function gridValues(windowSpan, baseUnit, pxSpan, minPx = 32) {
  const span = Number(windowSpan) > 0 ? Number(windowSpan) : baseUnit;
  const unit = gridUnit(span, pxSpan, baseUnit, minPx);
  const out = [];
  for (let v = 0; v <= span + 1e-6 && out.length < 256; v += unit) out.push(Math.round(v));
  return out;
}
```

Update the export default line to:
```js
export default { nextZoomLevel, gridUnit, gridValues };
```

- [ ] **Step 4: Run it → PASS**
`./node_modules/.bin/vitest run --config vitest.config.mjs frontend/src/modules/Fitness/lib/cycleGame/chartZoom.test.js`

- [ ] **Step 5: Commit**
```bash
git add frontend/src/modules/Fitness/lib/cycleGame/chartZoom.js frontend/src/modules/Fitness/lib/cycleGame/chartZoom.test.js
git commit -m "feat(cycle-game): gridUnit + gridValues — decimating gridline math"
```

---

## Task 3: DistanceChart — windowed X/Y over the zoom level

**Files:** Modify `DistanceChart.jsx` and `CycleRaceScreen.jsx` (+ test in `DistanceChart.test.jsx`).

- [ ] **Step 1: Write the failing test** — add to `DistanceChart.test.jsx` (mirror its existing imports — `render`, `DistanceChart`):

```jsx
it('frames the chart in the fixed window at level 0 (point not pegged to the right)', () => {
  // 5s into a 30s window → newest point at ~1/6 across, not slammed to the right.
  const riders = { a: { userId: 'a', displayName: 'A', cumulativeDistanceM: 50, distanceSeries: [10, 20, 30, 40, 50, 60], isGhost: false } };
  const { container } = render(
    <DistanceChart riderIds={['a']} riders={riders} riderLive={{ a: {} }}
      winCondition="time" goalM={3000} elapsedS={5} />
  );
  const line = container.querySelector('[data-testid="race-line"]');
  const xs = line.getAttribute('points').trim().split(' ').map((p) => parseFloat(p.split(',')[0]));
  // last x should be well under the 600 width (≈ 5/30 * 600 = 100), not pegged near 600
  expect(Math.max(...xs)).toBeLessThan(200);
});
it('doubles the Y window when the leader passes 90% of it (distance race)', () => {
  // leader at 240m: 0.9*250=225 → level 1, D=500 → 240 maps to y = H - 240/500*H
  const riders = { a: { userId: 'a', displayName: 'A', cumulativeDistanceM: 240, distanceSeries: [240], isGhost: false } };
  const { container } = render(
    <DistanceChart riderIds={['a']} riders={riders} riderLive={{ a: {} }}
      winCondition="distance" goalM={5000} elapsedS={5} />
  );
  // With D=500, 240m is below mid-height: y > 100 (H=200, lower half). At the old
  // D=250 it would be near the top (y≈4). So y in (90, 110) confirms the doubled window.
  const line = container.querySelector('[data-testid="race-line"]');
  const y = parseFloat(line.getAttribute('points').trim().split(',')[1]);
  expect(y).toBeGreaterThan(90);
  expect(y).toBeLessThan(110);
});
```

- [ ] **Step 2: Run it → FAIL** (`elapsedS` ignored; X auto-fits so the point pegs near 600; Y uses goalM/maxDistance so the scale is wrong)
`./node_modules/.bin/vitest run --config vitest.config.mjs frontend/src/modules/Fitness/widgets/CycleGame/panels/DistanceChart.test.jsx -t window`

- [ ] **Step 3: Add the imports + constants** at the top of `DistanceChart.jsx`. After the existing `import { useFitGuard } from './useFitGuard.js';` line add:

```jsx
import { nextZoomLevel } from '@/modules/Fitness/lib/cycleGame/chartZoom.js';

const X_BASE_S = 30;       // level-0 time window (seconds; 1 sample = 1s at the 1Hz tick)
const Y_BASE_M = 250;      // level-0 distance window (metres)
const ZOOM_THRESHOLD = 0.9; // grow the window when data hits 90% of it
```

- [ ] **Step 4: Replace the scaling block.** Change the component signature to accept `elapsedS`. Find:
```jsx
export default function DistanceChart({ riderIds, riders, riderLive, winCondition, goalM, events = [], zoneBox }) {
```
replace with:
```jsx
export default function DistanceChart({ riderIds, riders, riderLive, winCondition, goalM, events = [], zoneBox, elapsedS = 0 }) {
```

Then find the entire `// chart scaling` block (from `const maxSeriesLen = …` through the `const yFor = (d) => { … };` that closes it) and replace it with:

```jsx
  // chart scaling — stepped zoom-out camera. The window doubles in 2x steps as
  // the leader's distance or the elapsed time nears the edge (monotonic level in
  // a sticky ref, like logRef). X maps over a time window T, Y over a distance
  // window D; the lin↔log crowding transform (below) is orthogonal and kept.
  const maxSeriesLen = Math.max(1, ...riderIds.map((id) => (riders[id].distanceSeries || []).length));
  const leaderDistanceM = Math.max(0, ...riderIds.map((id) => riders[id].cumulativeDistanceM || 0));
  const zoomRef = useRef(0);
  zoomRef.current = nextZoomLevel(zoomRef.current, {
    leaderDistanceM, elapsedS, xBaseS: X_BASE_S, yBaseM: Y_BASE_M, threshold: ZOOM_THRESHOLD
  });
  const L = zoomRef.current;
  const W = 600, H = 200;
  const T = X_BASE_S * 2 ** L;   // seconds visible
  const D = Y_BASE_M * 2 ** L;   // metres visible
  const stepS = maxSeriesLen > 1 ? elapsedS / (maxSeriesLen - 1) : 1;
  const xForTime = (t) => Math.min(W, ((t || 0) / T) * W);
  const xFor = (i) => xForTime(i * stepS);

  // Lin↔log crowding transform (kept): switch to log when adjacent leaders bunch
  // within the window, with hysteresis so it doesn't flap.
  const lastDists = riderIds.map((id) => (riders[id].distanceSeries || []).slice(-1)[0] || 0);
  const logRef = useRef(false);
  if (riderIds.length >= 2) {
    const sorted = [...lastDists].sort((a, b) => a - b);
    let minGap = Infinity;
    for (let i = 1; i < sorted.length; i++) minGap = Math.min(minGap, sorted[i] - sorted[i - 1]);
    if (!logRef.current && minGap < D * 0.05) logRef.current = true;
    else if (logRef.current && minGap > D * 0.14) logRef.current = false;
  } else {
    logRef.current = false;
  }
  const useLog = logRef.current;
  const yFor = (d) => {
    if (useLog) {
      const Dd = Math.max(1, D);
      return H - (Math.log1p(Math.max(0, d || 0)) / Math.log1p(Dd)) * H;
    }
    return H - Math.min(1, (d || 0) / D) * H;
  };
```

(Note: `W`/`H` move into this block; delete the old standalone `const W = 600, H = 200;` line that was below the old `maxDistance`. The `fitRef`/`useFitGuard`/`chartRef`/`chartH` lines above this block stay unchanged.)

- [ ] **Step 5: Pass `elapsedS` from CycleRaceScreen.** In `CycleRaceScreen.jsx`, find the `distanceChart` entry in the `panels` map:
```jsx
    distanceChart: () => (
      <DistanceChart riderIds={riderIds} riders={riders} riderLive={riderLive}
        winCondition={winCondition} goalM={goalM} events={events} />
    ),
```
replace with:
```jsx
    distanceChart: () => (
      <DistanceChart riderIds={riderIds} riders={riders} riderLive={riderLive}
        winCondition={winCondition} goalM={goalM} events={events} elapsedS={elapsedS} />
    ),
```
(`elapsedS` is already a prop of `CycleRaceScreen`.)

Add `elapsedS` to `DistanceChart.propTypes`:
```jsx
  elapsedS: PropTypes.number,
```

- [ ] **Step 6: Run the chart + screen suites → PASS**
`./node_modules/.bin/vitest run --config vitest.config.mjs frontend/src/modules/Fitness/widgets/CycleGame/panels/DistanceChart.test.jsx frontend/src/modules/Fitness/widgets/CycleGame/CycleRaceScreen.test.jsx`
(Existing race-line-trim and event-marker tests must stay green — they call `xFor`/`yFor`, which still exist.)

- [ ] **Step 7: Commit**
```bash
git add frontend/src/modules/Fitness/widgets/CycleGame/panels/DistanceChart.jsx frontend/src/modules/Fitness/widgets/CycleGame/CycleRaceScreen.jsx frontend/src/modules/Fitness/widgets/CycleGame/panels/DistanceChart.test.jsx
git commit -m "feat(cycle-game): chart stepped zoom-out window for X (time) + Y (distance)"
```

---

## Task 4: DistanceChart — decimating, transform-aware gridlines

**Files:** Modify `DistanceChart.jsx`, `CycleRaceScreen.scss` (+ test).

- [ ] **Step 1: Write the failing test** — add to `DistanceChart.test.jsx`:

```jsx
it('renders decimating gridlines for the current window', () => {
  const riders = { a: { userId: 'a', displayName: 'A', cumulativeDistanceM: 120, distanceSeries: [120], isGhost: false } };
  const { container } = render(
    <DistanceChart riderIds={['a']} riders={riders} riderLive={{ a: {} }}
      winCondition="distance" goalM={5000} elapsedS={10} />
  );
  const grid = container.querySelector('[data-testid="chart-grid"]');
  expect(grid).toBeTruthy();
  // level 0 (D=250): Y gridlines at 0/250 → at least 2 horizontal lines
  expect(grid.querySelectorAll('.cycle-race-screen__gridline--y').length).toBeGreaterThanOrEqual(2);
  expect(grid.querySelectorAll('.cycle-race-screen__gridline--x').length).toBeGreaterThanOrEqual(2);
});
```

- [ ] **Step 2: Run it → FAIL** (no grid group)
`./node_modules/.bin/vitest run --config vitest.config.mjs frontend/src/modules/Fitness/widgets/CycleGame/panels/DistanceChart.test.jsx -t gridlines`

- [ ] **Step 3: Import the grid helper.** In `DistanceChart.jsx`, change the chartZoom import to:
```jsx
import { nextZoomLevel, gridValues } from '@/modules/Fitness/lib/cycleGame/chartZoom.js';
```
And add a grid-pixel-floor constant beside the others:
```jsx
const GRID_MIN_PX = 32;    // never draw gridlines closer than this (bottom cap)
```

- [ ] **Step 4: Compute + render gridlines.** Just before the `return (` of the component, add:
```jsx
  // Gridlines at decimated fixed units, positioned through the active transforms
  // (Y via yFor, so log mode compresses them toward the top — the grid morph
  // signals the scale change alongside the line shapes).
  const xGrid = gridValues(T, X_BASE_S, W, GRID_MIN_PX).map((t) => ({ t, x: xForTime(t) }));
  const yGrid = gridValues(D, Y_BASE_M, H, GRID_MIN_PX).map((d) => ({ d, y: yFor(d) }));
```

Then, inside the `<svg …>` and **immediately after** the `<defs>…</defs>` block (so the grid sits behind the goal line, fills, and lanes), insert:
```jsx
        <g className="cycle-race-screen__grid" data-testid="chart-grid">
          {xGrid.map(({ t, x }) => (
            <line key={`gx-${t}`} className="cycle-race-screen__gridline cycle-race-screen__gridline--x"
              x1={x.toFixed(1)} y1="0" x2={x.toFixed(1)} y2={H} vectorEffect="non-scaling-stroke" />
          ))}
          {yGrid.map(({ d, y }) => (
            <line key={`gy-${d}`} className="cycle-race-screen__gridline cycle-race-screen__gridline--y"
              x1="0" y1={y.toFixed(1)} x2={W} y2={y.toFixed(1)} vectorEffect="non-scaling-stroke" />
          ))}
        </g>
```

- [ ] **Step 5: Style the gridlines.** In `CycleRaceScreen.scss`, after the `&__goal` rule (search for `cycle-race-screen__goal`), add:
```scss
  &__gridline { stroke: rgba(122, 162, 255, 0.14); stroke-width: 1; }
  &__gridline--y { stroke: rgba(122, 162, 255, 0.18); }
```

- [ ] **Step 6: Run the chart + screen suites → PASS**
`./node_modules/.bin/vitest run --config vitest.config.mjs frontend/src/modules/Fitness/widgets/CycleGame/panels/DistanceChart.test.jsx frontend/src/modules/Fitness/widgets/CycleGame/CycleRaceScreen.test.jsx`

- [ ] **Step 7: Commit**
```bash
git add frontend/src/modules/Fitness/widgets/CycleGame/panels/DistanceChart.jsx frontend/src/modules/Fitness/widgets/CycleGame/CycleRaceScreen.scss frontend/src/modules/Fitness/widgets/CycleGame/panels/DistanceChart.test.jsx
git commit -m "feat(cycle-game): chart gridlines (decimating, transform-aware) behind the lanes"
```

---

## Task 5: DistanceChart — zoom-out animation on each level bump

A 400ms ease-out scale transition: on a level increase the world has just halved, so we start the chart group scaled up by the jump ratio (looks like the old scale) and ease it to 1× (shrinks into the new frame) about the bottom-left fixed point `(0, H)`.

**Files:** Modify `DistanceChart.jsx`, `CycleRaceScreen.scss`.

- [ ] **Step 1: Write the failing test** — add to `DistanceChart.test.jsx`:

```jsx
it('wraps the plotted content in a zoomable group that carries the transition', () => {
  const riders = { a: { userId: 'a', displayName: 'A', cumulativeDistanceM: 50, distanceSeries: [50], isGhost: false } };
  const { container } = render(
    <DistanceChart riderIds={['a']} riders={riders} riderLive={{ a: {} }}
      winCondition="distance" goalM={5000} elapsedS={5} />
  );
  const g = container.querySelector('[data-testid="chart-zoomable"]');
  expect(g).toBeTruthy();
  expect(g.getAttribute('class')).toContain('cycle-race-screen__zoomable');
});
```

- [ ] **Step 2: Run it → FAIL** (no zoomable group)
`./node_modules/.bin/vitest run --config vitest.config.mjs frontend/src/modules/Fitness/widgets/CycleGame/panels/DistanceChart.test.jsx -t zoomable`

- [ ] **Step 3: Add the animation state.** In `DistanceChart.jsx`, after the `const L = zoomRef.current;` line add:
```jsx
  // Zoom-out animation: when the level jumps, start the content scaled up by the
  // jump ratio (so it looks like the pre-zoom scale) then ease to 1x — the world
  // shrinks into the new, wider frame about the bottom-left origin.
  const prevLevelRef = useRef(L);
  const [animScale, setAnimScale] = useState(1);
  useEffect(() => {
    if (L > prevLevelRef.current) {
      setAnimScale(2 ** (L - prevLevelRef.current));
      const id = requestAnimationFrame(() => requestAnimationFrame(() => setAnimScale(1)));
      prevLevelRef.current = L;
      return () => cancelAnimationFrame(id);
    }
    prevLevelRef.current = L;
    return undefined;
  }, [L]);
```
(`useState`/`useEffect`/`useRef`/`useMemo` are already imported at the top of the file.)

- [ ] **Step 4: Wrap the plotted content** in the zoomable group. Find the SVG body — the grid group, goal line, area fills, and lane lines all live directly inside `<svg>` after `<defs>`. Wrap **the grid group through the lane-lines block** (everything except `<defs>`) in:
```jsx
        <g
          data-testid="chart-zoomable"
          className="cycle-race-screen__zoomable"
          style={{ transform: `scale(${animScale})`, transformOrigin: `0px ${H}px`, transformBox: 'view-box' }}
        >
          {/* existing grid group, goal line, area fills, lane lines stay here, unchanged */}
        </g>
```
i.e. open the `<g data-testid="chart-zoomable" …>` right after `</defs>` and close it `</g>` right before `</svg>`. Do not move the `<defs>` inside.

- [ ] **Step 5: Add the transition style.** In `CycleRaceScreen.scss`, add:
```scss
  &__zoomable { transition: transform 400ms ease-out; will-change: transform; }
```

- [ ] **Step 6: Run the chart + screen + full Fitness suites → PASS**
`./node_modules/.bin/vitest run --config vitest.config.mjs frontend/src/modules/Fitness/widgets/CycleGame/panels/DistanceChart.test.jsx frontend/src/modules/Fitness/widgets/CycleGame/CycleRaceScreen.test.jsx`

- [ ] **Step 7: Commit**
```bash
git add frontend/src/modules/Fitness/widgets/CycleGame/panels/DistanceChart.jsx frontend/src/modules/Fitness/widgets/CycleGame/CycleRaceScreen.scss frontend/src/modules/Fitness/widgets/CycleGame/panels/DistanceChart.test.jsx
git commit -m "feat(cycle-game): 400ms zoom-out animation on each chart level bump"
```

---

## Final verification

- [ ] **Run the full Fitness suite**
`./node_modules/.bin/vitest run --config vitest.config.mjs frontend/src/modules/Fitness/`
Expected: PASS.

- [ ] **Deploy + visual smoke (operator):** rebuild + `deploy-daylight`, then on a live race confirm: at the start the lines grow from the left into a fixed ~30s/250m frame (not pegged at the right); when the leader nears the top/right the view doubles with a visible ~400ms pull-back; gridlines coarsen as you zoom (never crowd); and when riders bunch near the finish the grid + lines morph to log together.

---

## Notes for the implementer

- **The two mechanisms are independent:** `nextZoomLevel` controls the *window* (how much is visible); `logRef` controls the Y *transform within* the window. Both feed `yFor`. Don't conflate them.
- **Monotonic:** `zoomRef`/`prevLevelRef` only ever increase during a race; a new race remounts `DistanceChart` (the screen is re-created), resetting them to 0.
- **1 Hz assumption:** X base is 30 (= 30s at the 1Hz engine tick); `stepS` derives real seconds-per-sample from `elapsedS`, so it stays correct if the tick rate ever changes.
- **Don't animate SVG geometry directly** (points/x1/y1 aren't CSS-transitionable) — the scale transition on the wrapping `<g transform>` is the animation.
