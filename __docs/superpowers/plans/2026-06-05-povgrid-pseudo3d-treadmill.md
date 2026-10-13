# PovGrid Pseudo-3D Treadmill — Best-Practice Rewrite Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild the cycle-game POV road grid as a 60fps, compositor-only pseudo-3D treadmill: real `1/z` ground-plane projection (scaling + lane convergence), engine-time rAF interpolation (continuous scroll from a 1 Hz data source), and `transform`/`opacity`-only animation — eliminating the `top`-animated, `preserve-3d`-repaint anti-pattern the review flagged.

**Architecture:** Three pure, unit-tested modules carry all the math — `tickFraction` (timing), `povProjection` (the `1/z` camera), `povFrame` (per-frame layout) — and the `gridLines` cap is made non-truncating. `PovGrid.jsx` becomes a thin shell: React renders a **fixed recycled pool** of grid-line nodes + one marker per rider + a static SVG lane fan **once per tick**; a single `requestAnimationFrame` loop reads the latest tick data from refs, interpolates, and writes `style.transform`/`opacity` **imperatively** (no React state per frame). No CSS `perspective`/`rotateX` survives — depth is `translate3d` + `scaleX`/`scale` + opacity fog, so nothing repaints through a 3D matrix.

**Tech Stack:** React (.jsx), SCSS (CSS container-query units `cqw`/`cqh`, `will-change`, `contain`), Vitest. Run a vitest file from repo root `/opt/Code/DaylightStation`: `npx vitest run --config vitest.config.mjs <path>`. Build: `cd frontend && npm run build`.

---

## Background: why this shape

The current panel animates `top`/`left` with a `0.9s` CSS transition on up to 80 grid nodes living inside a `rotateX(38deg) preserve-3d` plane → layout + repaint-through-perspective every frame, won't hold 60fps on the Shield. The depth is a leaned plane, not a `1/z` camera (no true vanishing point, wrong bunching, no lane convergence). The smoothing is hand-coupled to the tick (a stalled tick freezes mid-glide). This rewrite fixes all three: **transform-only transport**, **engine-time interpolation**, **correct projection** — with the math in pure modules so it's testable headlessly (jsdom can't run transforms).

**Camera model (one fixed camera, two meaningful constants).** `leaderAnchoredZoom` already maps metres-behind-leader → a linear depth coordinate `u ∈ [0, rightPct]` (leader near `rightPct`, near-camera near 0). We keep that (scaling/zoom unchanged) and add only the perspective: normalize `t = u/rightPct ∈ [0,1]` (0 near, 1 far/leader), define forward distance `z = 1 + (depthRatio−1)·t`, and use `r = 1/z`. For a ground plane, screen-Y and horizontal scale are both **linear in `r = 1/z`** (the standard result) — so far marks bunch toward the horizon and lanes converge, correctly, from one ratio. `depthRatio` (zFar/zNear) sets how hard it bunches; `farFrac` is where the leader/far-plane sits on screen.

---

## File structure

- **Create** `frontend/src/modules/Fitness/lib/cycleGame/tickFraction.js` — pure `tickFraction(now, tickAt, tickMs) → [0,1]`.
- **Create** `frontend/src/modules/Fitness/lib/cycleGame/povProjection.js` — pure camera: `POV_CAMERA`, `depthT`, `perspRatio`, `screenY`, `depthScale`.
- **Create** `frontend/src/modules/Fitness/lib/cycleGame/povFrame.js` — pure `computePovFrame(...)` → `{ lineSlots, markers }`.
- **Modify** `frontend/src/modules/Fitness/lib/cycleGame/leaderAnchoredZoom.js` — make `gridLines` coarsen instead of truncate.
- **Rewrite** `frontend/src/modules/Fitness/widgets/CycleGame/panels/PovGrid.jsx` + `PovGrid.scss` — thin shell + imperative rAF; no CSS 3D.
- **Rewrite** `frontend/src/modules/Fitness/widgets/CycleGame/panels/PovGrid.README.md` — lead with approach + perf.
- **Tests:** one `*.test.js` beside each pure module; `PovGrid.test.jsx` updated for the new structure.

---

## Task 1: `tickFraction` — engine-time timing primitive

A pure clamp used by the rAF loop to interpolate across the 1 Hz tick (so a stalled tick saturates at 1 and self-corrects, instead of freezing mid-glide).

**Files:**
- Create: `frontend/src/modules/Fitness/lib/cycleGame/tickFraction.js`
- Test: `frontend/src/modules/Fitness/lib/cycleGame/tickFraction.test.js`

- [ ] **Step 1 — failing test:**
```js
import { describe, it, expect } from 'vitest';
import { tickFraction } from './tickFraction.js';

describe('tickFraction', () => {
  it('is 0 at the tick instant and 1 a full tick later', () => {
    expect(tickFraction(1000, 1000, 1000)).toBe(0);
    expect(tickFraction(2000, 1000, 1000)).toBe(1);
    expect(tickFraction(1500, 1000, 1000)).toBeCloseTo(0.5, 5);
  });
  it('clamps below 0 and above 1 (a stalled/overdue tick saturates)', () => {
    expect(tickFraction(900, 1000, 1000)).toBe(0);
    expect(tickFraction(5000, 1000, 1000)).toBe(1);
  });
  it('returns 1 for a non-positive interval', () => {
    expect(tickFraction(1234, 1000, 0)).toBe(1);
  });
});
```

- [ ] **Step 2 — run, expect FAIL:** `npx vitest run --config vitest.config.mjs frontend/src/modules/Fitness/lib/cycleGame/tickFraction.test.js`

- [ ] **Step 3 — implement:**
```js
/**
 * Fraction [0,1] elapsed from a tick timestamp toward the next tick. Saturates at 1
 * when a tick is overdue, so an interpolated value freezes at the latest data
 * instead of mid-glide. Pure — feed performance.now() from the caller.
 */
export function tickFraction(nowMs, tickAtMs, tickMs) {
  if (!(tickMs > 0)) return 1;
  const f = (nowMs - tickAtMs) / tickMs;
  return f < 0 ? 0 : f > 1 ? 1 : f;
}

export default tickFraction;
```

- [ ] **Step 4 — run, expect PASS.**

- [ ] **Step 5 — commit:**
```bash
git add frontend/src/modules/Fitness/lib/cycleGame/tickFraction.js frontend/src/modules/Fitness/lib/cycleGame/tickFraction.test.js
git commit -m "feat(cycle-game): tickFraction — engine-time interpolation primitive"
```

---

## Task 2: `povProjection` — the `1/z` ground-plane camera

**Files:**
- Create: `frontend/src/modules/Fitness/lib/cycleGame/povProjection.js`
- Test: `frontend/src/modules/Fitness/lib/cycleGame/povProjection.test.js`

- [ ] **Step 1 — failing test:**
```js
import { describe, it, expect } from 'vitest';
import { POV_CAMERA, depthT, perspRatio, screenY, depthScale } from './povProjection.js';

describe('povProjection (1/z ground-plane camera)', () => {
  it('depthT normalizes u∈[0,rightPct] to t∈[0,1] and clamps', () => {
    expect(depthT(0)).toBeCloseTo(0, 5);
    expect(depthT(POV_CAMERA.rightPct)).toBeCloseTo(1, 5);
    expect(depthT(2 * POV_CAMERA.rightPct)).toBe(1);
    expect(depthT(-1)).toBe(0);
  });
  it('screenY puts the near edge at the bottom and the far plane near the top', () => {
    expect(screenY(0)).toBeCloseTo(1, 5);                 // near camera → bottom
    expect(screenY(1)).toBeCloseTo(POV_CAMERA.farFrac, 5); // leader/far → top
  });
  it('screenY is monotonic and bunches toward the far plane', () => {
    expect(screenY(0.4)).toBeGreaterThan(screenY(0.6));   // nearer = lower on screen
    const nearStep = screenY(0) - screenY(0.1);           // equal world step near camera
    const farStep = screenY(0.9) - screenY(1);            // equal world step at the horizon
    expect(nearStep).toBeGreaterThan(farStep);            // far marks compress
  });
  it('depthScale shrinks lanes/markers with depth (1 near, 1/depthRatio far)', () => {
    expect(depthScale(0)).toBeCloseTo(1, 5);
    expect(depthScale(1)).toBeCloseTo(1 / POV_CAMERA.depthRatio, 5);
    expect(depthScale(0.3)).toBeGreaterThan(depthScale(0.7));
  });
  it('perspRatio is 1/z with z = 1 + (depthRatio-1)*t', () => {
    expect(perspRatio(0)).toBeCloseTo(1, 5);
    expect(perspRatio(1)).toBeCloseTo(1 / POV_CAMERA.depthRatio, 5);
  });
});
```

- [ ] **Step 2 — run, expect FAIL.**

- [ ] **Step 3 — implement:**
```js
/**
 * Fixed-camera ground-plane perspective for the POV road. The scaling/zoom is NOT
 * re-derived here — leaderAnchoredZoom maps metres-behind-leader → a linear depth
 * coord u∈[0,rightPct] (leader near rightPct, near-camera near 0). This module adds
 * only the perspective: a 1/z remap so depth bunches toward the horizon and lanes
 * converge — a real camera, not a leaned CSS plane.
 *
 * Two meaningful constants:
 *   farFrac    — screen-Y (0=top,1=bottom) the leader/far-plane sits at.
 *   depthRatio — zFar/zNear; how hard the perspective bunches (1 = flat, no 3D).
 */
export const POV_CAMERA = {
  rightPct: 0.88,  // leader's linear-depth coord (matches ZOOM_DEFAULTS.rightPct)
  farFrac: 0.10,   // leader/far-plane screen-Y (near the top)
  depthRatio: 6,   // zFar/zNear — perspective strength
  fogFrac: 0.18    // depth t below which far lines fade out (atmosphere)
};

// u∈[0,rightPct] → t∈[0,1] (0 near camera, 1 far/leader), clamped.
export function depthT(u, cam = POV_CAMERA) {
  const r = cam.rightPct > 0 ? u / cam.rightPct : 0;
  return r < 0 ? 0 : r > 1 ? 1 : r;
}

// 1/z for depth t, with z = 1 + (depthRatio-1)*t. r=1 at near, 1/depthRatio at far.
export function perspRatio(t, cam = POV_CAMERA) {
  return 1 / (1 + (cam.depthRatio - 1) * t);
}

// Screen-Y fraction (0=top,1=bottom). Linear in r=1/z (correct for a ground plane):
// near (t=0,r=1) → 1.0; far (t=1,r=1/depthRatio) → farFrac.
export function screenY(t, cam = POV_CAMERA) {
  const rNear = 1;
  const rFar = perspRatio(1, cam);
  const r = perspRatio(t, cam);
  const f = (r - rFar) / (rNear - rFar);       // 0 at far, 1 at near
  return cam.farFrac + (1 - cam.farFrac) * f;
}

// Horizontal scale at depth t — 1/z normalized to 1 at the near edge. Lanes/markers
// shrink with depth; far plane = 1/depthRatio.
export function depthScale(t, cam = POV_CAMERA) {
  return perspRatio(t, cam) / perspRatio(0, cam);
}
```

- [ ] **Step 4 — run, expect PASS.**

- [ ] **Step 5 — commit:**
```bash
git add frontend/src/modules/Fitness/lib/cycleGame/povProjection.js frontend/src/modules/Fitness/lib/cycleGame/povProjection.test.js
git commit -m "feat(cycle-game): povProjection — 1/z ground-plane camera (bunching + lane convergence)"
```

---

## Task 3: `gridLines` coarsens instead of truncating

The 80-line `break` silently drops lines at one edge. Replace with interval-doubling so the **whole visible span is always covered** by ≤ `maxLines`.

**Files:**
- Modify: `frontend/src/modules/Fitness/lib/cycleGame/leaderAnchoredZoom.js`
- Test: `frontend/src/modules/Fitness/lib/cycleGame/leaderAnchoredZoom.test.js` (append)

Current (`leaderAnchoredZoom.js:55-67`):
```js
export function gridLines(leaderDistM, kFrac, gridM, cfg = {}) {
  const { rightPct } = { ...ZOOM_DEFAULTS, ...cfg };
  if (!(kFrac > 0) || !(gridM > 0) || !isFinite(kFrac)) return [];
  const leftMeters = rightPct / kFrac;
  const startM = Math.max(0, Math.ceil(((leaderDistM || 0) - leftMeters) / gridM) * gridM);
  const lines = [];
  for (let m = startM; m <= (leaderDistM || 0) + 1e-6; m += gridM) {
    const x = rightPct - ((leaderDistM || 0) - m) * kFrac;
    if (x >= -0.02 && x <= rightPct + 0.02) lines.push({ m: Math.round(m), x });
    if (lines.length > 80) break; // safety against pathological intervals
  }
  return lines;
}
```

- [ ] **Step 1 — failing test (append to the existing describe in `leaderAnchoredZoom.test.js`):**
```js
import { gridLines } from './leaderAnchoredZoom.js';

describe('gridLines coarsening', () => {
  it('never exceeds maxLines and covers the whole visible span (no truncation)', () => {
    // tiny k + tiny gridM ⇒ thousands of naive lines; must coarsen, not drop.
    const lines = gridLines(10000, 0.00002, 1, { maxLines: 24 });
    expect(lines.length).toBeLessThanOrEqual(24);
    expect(lines.length).toBeGreaterThan(2);
    // near-camera edge (smallest m) AND far edge (nearest the leader) both present
    const ms = lines.map((l) => l.m);
    const span = 0.88 / 0.00002;                  // rightPct / k metres
    expect(Math.min(...ms)).toBeLessThan(10000 - span * 0.5); // a genuinely-near line survives
    expect(Math.max(...ms)).toBeGreaterThan(10000 - 200);     // a near-leader line survives
  });
  it('keeps the requested interval when it already fits', () => {
    const lines = gridLines(500, 0.0017, 50, { maxLines: 24 });
    const ms = lines.map((l) => l.m).sort((a, b) => a - b);
    if (ms.length >= 2) expect(ms[1] - ms[0]).toBe(50);
  });
});
```

- [ ] **Step 2 — run, expect FAIL** (no `maxLines` support; old path truncates): `npx vitest run --config vitest.config.mjs frontend/src/modules/Fitness/lib/cycleGame/leaderAnchoredZoom.test.js`

- [ ] **Step 3 — implement** (replace the function body):
```js
export function gridLines(leaderDistM, kFrac, gridM, cfg = {}) {
  const { rightPct, maxLines = 80 } = { ...ZOOM_DEFAULTS, ...cfg };
  if (!(kFrac > 0) || !(gridM > 0) || !isFinite(kFrac)) return [];
  const leftMeters = rightPct / kFrac;            // metres from the leader-pin to x=0
  // Coarsen the interval (×2 multiples of gridM) until the whole span fits in maxLines —
  // covers the full road instead of truncating one edge.
  let step = gridM;
  while (leftMeters / step > maxLines) step *= 2;
  const startM = Math.max(0, Math.ceil(((leaderDistM || 0) - leftMeters) / step) * step);
  const lines = [];
  for (let m = startM; m <= (leaderDistM || 0) + 1e-6; m += step) {
    const x = rightPct - ((leaderDistM || 0) - m) * kFrac;
    if (x >= -0.02 && x <= rightPct + 0.02) lines.push({ m: Math.round(m), x });
  }
  return lines;
}
```
Add `maxLines: 80` to `ZOOM_DEFAULTS` (so callers can override; default unchanged):
```js
export const ZOOM_DEFAULTS = {
  rightPct: 0.88,
  homePct: 0.25,
  lowPct: 0.15,
  highPct: 0.33,
  minGapM: 8,
  maxLines: 80
};
```

- [ ] **Step 4 — run, expect PASS** (plus the existing leaderAnchoredZoom tests).

- [ ] **Step 5 — commit:**
```bash
git add frontend/src/modules/Fitness/lib/cycleGame/leaderAnchoredZoom.js frontend/src/modules/Fitness/lib/cycleGame/leaderAnchoredZoom.test.js
git commit -m "fix(cycle-game): gridLines coarsens to fit maxLines instead of truncating a road edge"
```

---

## Task 4: `povFrame` — pure per-frame layout (the test seam)

All per-frame math in one pure function, so the component is a dumb writer of `style.transform`. Interpolates the leader **and** each rider between ticks, projects through `povProjection`.

**Files:**
- Create: `frontend/src/modules/Fitness/lib/cycleGame/povFrame.js`
- Test: `frontend/src/modules/Fitness/lib/cycleGame/povFrame.test.js`

- [ ] **Step 1 — failing test:**
```js
import { describe, it, expect } from 'vitest';
import { computePovFrame } from './povFrame.js';
import { POV_CAMERA } from './povProjection.js';

const k = 0.0017; // ~ rightPct/520m visible
const base = {
  lines: [{ m: 400, x: 0 }, { m: 500, x: 0 }],            // x is ignored; frame recomputes from leader
  riders: [
    { id: 'a', idx: 0, laneX: 12, prev: 480, cur: 500 },  // leader
    { id: 'b', idx: 1, laneX: 88, prev: 380, cur: 400 }   // trailer
  ],
  leaderPrev: 480, leaderCur: 500, k
};

describe('computePovFrame', () => {
  it('places the leader near the far plane (top) and the trailer lower', () => {
    const f = computePovFrame({ ...base, frac: 1 });
    const a = f.markers.find((m) => m.id === 'a');
    const b = f.markers.find((m) => m.id === 'b');
    expect(a.y).toBeLessThan(b.y);                         // leader higher (smaller y)
    expect(a.y).toBeCloseTo(POV_CAMERA.farFrac, 2);        // leader at the far plane
    expect(b.scale).toBeGreaterThan(a.scale);              // trailer is nearer the camera → bigger
  });
  it('interpolates the leader between ticks (frac scrolls the road)', () => {
    const at0 = computePovFrame({ ...base, frac: 0 });
    const at1 = computePovFrame({ ...base, frac: 1 });
    const line400at0 = at0.lineSlots.find((s) => s.m === 400);
    const line400at1 = at1.lineSlots.find((s) => s.m === 400);
    // leader advances 480→500, so the fixed 400m line moves toward the camera (y grows)
    expect(line400at1.y).toBeGreaterThan(line400at0.y);
  });
  it('returns a slot per input line and a marker per rider', () => {
    const f = computePovFrame({ ...base, frac: 0.5 });
    expect(f.lineSlots).toHaveLength(2);
    expect(f.markers).toHaveLength(2);
  });
});
```
> Sign convention: depth `t` is 1 at the leader (far plane) and ~0 at the near camera. `depthScale` is largest near the camera (1) and smallest at the far plane (`1/depthRatio`), so the **trailer** (nearer the camera) renders **bigger** than the leader — correct for a road receding away from you.

- [ ] **Step 2 — run, expect FAIL.**

- [ ] **Step 3 — implement:**
```js
import { depthT, screenY, depthScale, POV_CAMERA } from './povProjection.js';

/**
 * Pure per-frame layout for the POV road. Interpolates the leader and each rider
 * between the previous and current tick by `frac`, maps each to a linear depth coord
 * (leader-anchored), then projects to screen via povProjection. The component writes
 * the result straight to style.transform — no React state per frame.
 *
 * Returns:
 *   lineSlots: [{ m, y, scale, t }]   y/scale are 0..1 fractions of the panel
 *   markers:   [{ id, idx, laneX, y, scale, t }]
 */
export function computePovFrame({ lines, riders, leaderPrev, leaderCur, k, frac, cam = POV_CAMERA }) {
  const leader = leaderPrev + (leaderCur - leaderPrev) * (frac || 0);
  const project = (distM, minU) => {
    const u = Math.max(minU, Math.min(cam.rightPct, cam.rightPct - (leader - distM) * k));
    const t = depthT(u, cam);
    return { t, y: screenY(t, cam), scale: depthScale(t, cam) };
  };
  const lineSlots = (lines || []).map((ln) => ({ m: ln.m, ...project(ln.m, 0) }));
  const markers = (riders || []).map((r) => {
    const dist = r.prev + (r.cur - r.prev) * (frac || 0);
    return { id: r.id, idx: r.idx, laneX: r.laneX, ...project(dist, 0.02) };
  });
  return { lineSlots, markers };
}

export default computePovFrame;
```

- [ ] **Step 4 — run, expect PASS.**

- [ ] **Step 5 — commit:**
```bash
git add frontend/src/modules/Fitness/lib/cycleGame/povFrame.js frontend/src/modules/Fitness/lib/cycleGame/povFrame.test.js
git commit -m "feat(cycle-game): povFrame — pure per-frame POV layout (interpolation + projection)"
```

---

## Task 5: Rewrite `PovGrid.jsx` + `.scss` — thin shell, imperative rAF, no CSS 3D

React renders the structure **once per tick**; a single rAF loop interpolates and writes `transform`/`opacity` **imperatively** to refs. Depth is `translate3d` + `scaleX`/`scale` + opacity — no `perspective`/`rotateX`, so nothing repaints through a 3D matrix. Lane lines are a **fixed recycled pool** (keyed by slot); the converging lane fan is a **static SVG** drawn once.

**Files:**
- Rewrite: `frontend/src/modules/Fitness/widgets/CycleGame/panels/PovGrid.jsx`
- Rewrite: `frontend/src/modules/Fitness/widgets/CycleGame/panels/PovGrid.scss`
- Update: `frontend/src/modules/Fitness/widgets/CycleGame/panels/PovGrid.test.jsx`

- [ ] **Step 1 — update the structural test** (`PovGrid.test.jsx`) to the new contract. Replace assertions that targeted `top`-positioned `cg-pov__hline`/`cg-pov__vline` with the recycled pool + fan + markers:
```jsx
import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import PovGrid from './PovGrid.jsx';

const riders = {
  a: { displayName: 'A', cumulativeDistanceM: 500 },
  b: { displayName: 'B', cumulativeDistanceM: 400 }
};

describe('PovGrid', () => {
  it('renders the road container, a recycled hline pool, the lane fan, and one marker per rider', () => {
    const { getByTestId, getAllByTestId, container } = render(
      <PovGrid riderIds={['a', 'b']} riders={riders} riderLive={{}} />
    );
    expect(getByTestId('race-pov')).toBeInTheDocument();
    expect(getByTestId('pov-grid')).toBeInTheDocument();
    expect(container.querySelectorAll('.cg-pov__hline').length).toBe(24); // fixed pool, keyed by slot
    expect(container.querySelector('.cg-pov__fan')).toBeTruthy();
    expect(getAllByTestId('pov-marker')).toHaveLength(2);
  });
  it('does not animate layout-triggering properties (no top/left transitions)', () => {
    // guard against regressing to the old anti-pattern: the hline style must not set top/left
    const { container } = render(<PovGrid riderIds={['a']} riders={{ a: riders.a }} riderLive={{}} />);
    const hline = container.querySelector('.cg-pov__hline');
    expect(hline.style.top).toBe('');
    expect(hline.style.left).toBe('');
  });
});
```
> jsdom has no `requestAnimationFrame` timing or layout, so the test asserts **structure**, not motion (motion is covered by `povFrame`/`povProjection` tests + kiosk verification).

- [ ] **Step 2 — run, expect FAIL** (old component renders the metre-mapped grid, not a 24-slot pool): `npx vitest run --config vitest.config.mjs frontend/src/modules/Fitness/widgets/CycleGame/panels/PovGrid.test.jsx`

- [ ] **Step 3 — rewrite `PovGrid.jsx`** in full:
```jsx
import React, { useEffect, useRef } from 'react';
import PropTypes from 'prop-types';
import CircularUserAvatar from '@/modules/Fitness/components/CircularUserAvatar.jsx';
import { LINE_COLORS } from '@/modules/Fitness/lib/cycleGame/lineColors.js';
import { formatDistance } from '@/modules/Fitness/lib/cycleGame/formatDistance.js';
import { useLeaderAnchoredZoom } from '@/modules/Fitness/lib/cycleGame/useLeaderAnchoredZoom.js';
import { computePovFrame } from '@/modules/Fitness/lib/cycleGame/povFrame.js';
import { POV_CAMERA } from '@/modules/Fitness/lib/cycleGame/povProjection.js';
import { tickFraction } from '@/modules/Fitness/lib/cycleGame/tickFraction.js';
import './PovGrid.scss';

const MAX_LINES = 24;   // recycled hline slot pool (keyed by slot, never remounts)
const TICK_MS = 1000;   // matches RACE_TICK_MS — the data cadence we interpolate across

/**
 * POV road grid — a 60fps compositor-only pseudo-3D treadmill. React renders the
 * structure once per tick; a single rAF loop interpolates the leader/riders between
 * ticks (engine-time, self-correcting) and writes translate3d/scaleX/opacity straight
 * to refs. Depth is a 1/z projection (povProjection), NOT a CSS perspective — nothing
 * repaints through a 3D matrix. See PovGrid.README.md.
 */
export default function PovGrid({ riderIds, riders, riderLive = {} }) {
  const distOf = (id) => Math.max(0, riders[id]?.cumulativeDistanceM || 0);
  const zoom = useLeaderAnchoredZoom(riderIds.map(distOf), { maxLines: MAX_LINES });
  const laneX = (idx) => (riderIds.length <= 1 ? 50 : 12 + idx * (76 / (riderIds.length - 1)));

  const tickRef = useRef({ leaderPrev: 0, leaderCur: 0, k: 0, lines: [], riders: [], tickAt: 0 });
  const lineEls = useRef([]);     // MAX_LINES hline refs
  const markerEls = useRef({});   // id -> marker ref
  const prevDistRef = useRef({});

  // Capture each new tick's targets (roll cur→prev). Runs after every render, but only
  // advances when the data actually changed (a 1 Hz data tick), so a stray re-render
  // doesn't reset the interpolation clock.
  useEffect(() => {
    const t = tickRef.current;
    if (zoom.leaderDist === t.leaderCur && Object.keys(prevDistRef.current).length === riderIds.length) return;
    const now = performance.now();
    const prev = prevDistRef.current;
    const ridersFrame = riderIds.map((id, idx) => ({
      id, idx, laneX: laneX(idx),
      prev: Number.isFinite(prev[id]) ? prev[id] : distOf(id),
      cur: distOf(id)
    }));
    tickRef.current = {
      leaderPrev: Number.isFinite(t.leaderCur) && t.leaderCur > 0 ? t.leaderCur : zoom.leaderDist,
      leaderCur: zoom.leaderDist,
      k: zoom.kFrac,
      lines: zoom.lines.slice(0, MAX_LINES),
      riders: ridersFrame,
      tickAt: now
    };
    const next = {}; riderIds.forEach((id) => { next[id] = distOf(id); });
    prevDistRef.current = next;
  });

  // The 60fps loop — mounts once, reads refs, writes transforms. No React state per frame.
  useEffect(() => {
    let raf;
    const draw = () => {
      const t = tickRef.current;
      const frac = tickFraction(performance.now(), t.tickAt, TICK_MS);
      const { lineSlots, markers } = computePovFrame({
        lines: t.lines, riders: t.riders,
        leaderPrev: t.leaderPrev, leaderCur: t.leaderCur, k: t.k, frac
      });
      for (let i = 0; i < MAX_LINES; i++) {
        const el = lineEls.current[i];
        if (!el) continue;
        const s = lineSlots[i];
        if (!s) { el.style.opacity = '0'; continue; }
        el.style.transform = `translate3d(0, ${(s.y * 100).toFixed(3)}cqh, 0) scaleX(${s.scale.toFixed(4)})`;
        // atmosphere: fade lines as they approach the far plane (small t)
        el.style.opacity = (Math.max(0, Math.min(1, (s.t - POV_CAMERA.fogFrac) / (1 - POV_CAMERA.fogFrac))) * 0.5 + 0.15).toFixed(3);
      }
      markers.forEach((m) => {
        const el = markerEls.current[m.id];
        if (!el) return;
        const x = 50 + (m.laneX - 50) * m.scale;   // lanes converge toward centre with depth
        el.style.transform =
          `translate3d(${x.toFixed(2)}cqw, ${(m.y * 100).toFixed(3)}cqh, 0) translate(-50%, -50%) scale(${(0.55 + 0.45 * m.scale).toFixed(3)})`;
      });
      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, []);

  return (
    <div className="cg-pov" data-testid="race-pov">
      <svg className="cg-pov__fan" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
        {riderIds.map((id, idx) => {
          const nearX = laneX(idx);
          const farX = 50 + (nearX - 50) * (1 / POV_CAMERA.depthRatio);
          return (
            <line key={id} x1={nearX} y1={100} x2={farX} y2={POV_CAMERA.farFrac * 100}
              stroke="rgba(255,45,149,0.28)" strokeWidth="1" vectorEffect="non-scaling-stroke" />
          );
        })}
      </svg>

      <div className="cg-pov__grid" data-testid="pov-grid" aria-hidden="true">
        {Array.from({ length: MAX_LINES }, (_, i) => (
          <div key={i} className="cg-pov__hline" style={{ opacity: 0 }}
            ref={(el) => { lineEls.current[i] = el; }} />
        ))}
      </div>

      {riderIds.map((id, idx) => {
        const color = LINE_COLORS[idx % LINE_COLORS.length];
        const isGhost = !!riders[id]?.isGhost;
        const live = riderLive[id] || {};
        return (
          <div key={id} className={`cg-pov__marker${isGhost ? ' is-ghost' : ''}`} data-testid="pov-marker"
            ref={(el) => { markerEls.current[id] = el; }} style={{ '--cg-pov-color': color }}>
            <CircularUserAvatar name={riders[id]?.displayName} avatarSrc={live.avatarSrc}
              heartRate={live.heartRate} zoneId={live.zoneId} zoneColor={live.zoneColor || color}
              size={44} showGauge={false} showIndicator={false} />
            <span className="cg-pov__dist">{formatDistance(distOf(id))}</span>
          </div>
        );
      })}
    </div>
  );
}

PovGrid.propTypes = {
  riderIds: PropTypes.array.isRequired,
  riders: PropTypes.object.isRequired,
  riderLive: PropTypes.object
};
```

- [ ] **Step 4 — rewrite `PovGrid.scss`** in full (no `perspective`/`rotateX`/transition; container-query units; `will-change`/`contain`):
```scss
@use '../cgTokens' as cg;

.cg-pov {
  position: relative; width: 100%; height: 100%; min-height: 0; overflow: hidden;
  container-type: size;              // enables cqw/cqh positioning of children
  contain: layout paint;             // isolate from the rest of the screen
  background: radial-gradient(130% 80% at 50% 6%, #2a0a3a 0%, #0a0118 70%);

  &__fan  { position: absolute; inset: 0; width: 100%; height: 100%; pointer-events: none; }
  &__grid { position: absolute; inset: 0; pointer-events: none; }

  &__hline {
    position: absolute; left: 0; right: 0; top: 0; height: 2px;
    transform-origin: 50% 50%;
    background: rgba(cg.$cg-cyan, 0.40);
    will-change: transform, opacity;  // promote once; the rAF loop only moves/fades it
  }

  &__marker {
    position: absolute; top: 0; left: 0;
    display: flex; flex-direction: column; align-items: center; gap: 2px;
    transform-origin: 50% 50%;
    will-change: transform;
    z-index: 2;
    .circular-user-avatar {
      width: 44px !important; height: 44px !important; --vital-avatar-size: 44px;
      box-shadow: 0 0 0 2px var(--cg-pov-color, #{cg.$cg-cyan}), 0 0 12px -2px var(--cg-pov-color, #{cg.$cg-cyan});
      border-radius: 50%;
    }
    &.is-ghost { opacity: 0.6; }
  }
  &__dist {
    font-family: cg.$cg-mono; font-weight: 800; font-size: 0.62rem; color: cg.$cg-cyan;
    text-shadow: 0 1px 3px rgba(0, 0, 0, 0.85); white-space: nowrap;
  }
}
```

- [ ] **Step 5 — run the structural test, expect PASS** + the lib suite (no regressions):
`npx vitest run --config vitest.config.mjs frontend/src/modules/Fitness/widgets/CycleGame/panels/PovGrid.test.jsx frontend/src/modules/Fitness/lib/cycleGame`

- [ ] **Step 6 — build:** `cd frontend && npm run build` → `✓ built`.

- [ ] **Step 7 — commit:**
```bash
git add frontend/src/modules/Fitness/widgets/CycleGame/panels/PovGrid.jsx \
        frontend/src/modules/Fitness/widgets/CycleGame/panels/PovGrid.scss \
        frontend/src/modules/Fitness/widgets/CycleGame/panels/PovGrid.test.jsx
git commit -m "perf(cycle-game): PovGrid — compositor-only 1/z treadmill (translate3d + rAF, no CSS 3D)"
```

---

## Task 6: README rewrite + kiosk verification + deploy

- [ ] **Step 1 — rewrite `PovGrid.README.md`** to lead with the architecture and the perf contract the review demanded. It must, in order: (1) state the design — pure projection modules + imperative rAF + compositor-only transforms; (2) the camera model (`1/z`, `depthRatio`, `farFrac`); (3) the timing model (`tickFraction` interpolation, self-correcting); (4) a **"Perf contract"** section stating explicitly *"we animate `transform`/`opacity` only — never `top`/`left`/`width`; the grid must composite, not repaint; verify with DevTools paint-flashing"*; (5) the test seam (math is unit-tested in `povProjection`/`povFrame`/`gridLines`; the component is a dumb transform-writer); (6) a short "what to scrutinize" that now leads with layer count / overdraw, not the (now-fixed) `top` issue. Delete the stale `rotateX`/`0.9s transition`/`top`-mapping prose. Reference `file:line` for each module.

- [ ] **Step 2 — kiosk verification (Phase 0 measurement, post-rewrite):** load a race on the kiosk Chromium (or local Chromium at 1280×720). In DevTools Rendering, enable **Paint flashing** and **Layer borders**, run a multi-rider race, and confirm: (a) the road **scrolls smoothly** (no per-second stepping), (b) paint flashing shows **only marker/line layers compositing**, not a full-panel green repaint, (c) a Performance trace shows per-frame work in **Composite Layers**, not Layout/Paint, holding ~60fps. Record the result. If a full-panel repaint persists, check that no element still sets `top`/`left`/`width` and that `contain: layout paint` is on `.cg-pov`.

- [ ] **Step 3 — commit the README:**
```bash
git add frontend/src/modules/Fitness/widgets/CycleGame/panels/PovGrid.README.md
git commit -m "docs(cycle-game): rewrite PovGrid README — projection model + perf contract + test seam"
```

- [ ] **Step 4 — deploy** (this host): `cd /opt/Code/DaylightStation && sudo docker build -f docker/Dockerfile -t kckern/daylight-station:latest --build-arg BUILD_TIME="$(date -u +%Y-%m-%dT%H:%M:%SZ)" --build-arg COMMIT_HASH="$(git rev-parse --short HEAD)" .` then `sudo docker stop daylight-station && sudo docker rm daylight-station && sudo deploy-daylight`. Reload the kiosk and watch a 4-rider race POV.

---

## YAGNI guardrails (from the review — do NOT do these)

- **No `<canvas>` renderer.** Divs + `transform` are sufficient at ≤24 lines + ≤6 markers after `1/z` bunching. Canvas is a bigger rewrite that loses the DOM avatars. Don't pre-build it.
- **No general camera rig.** One fixed camera; `depthRatio`/`farFrac` are hardcoded constants with comments, not props. No FOV/roll/dolly parameters nobody will move.
- **Don't refactor `DistanceChart`.** It already has its own `tickFrac` clock; sharing is nice-to-have, not in scope. `tickFraction` is a new shared primitive PovGrid uses; leave the chart alone.
- **No `prefers-reduced-motion` branch** unless this panel ships somewhere that sets it (the kiosk doesn't). If added later, it would freeze `frac` at 1.

## Self-review notes

- **Spec coverage:** transport→`translate3d` (T5), engine-time timing (T1+T5), real `1/z` projection w/ convergence (T2,T4,T5), zoom/scale unchanged + cap fix (T3), test seam (T1–T4 pure tests), README honesty (T6). All review items covered.
- **Type consistency:** `POV_CAMERA` fields (`rightPct`, `farFrac`, `depthRatio`, `fogFrac`), `depthT/perspRatio/screenY/depthScale`, `computePovFrame({lines,riders,leaderPrev,leaderCur,k,frac})` returning `{lineSlots:[{m,y,scale,t}], markers:[{id,idx,laneX,y,scale,t}]}`, `tickFraction(now,tickAt,tickMs)`, `gridLines(...,{maxLines})` — names used identically across tasks.
- **Note for implementer:** confirm the kiosk Chromium build supports CSS container-query units (`cqh`/`cqw`) and `container-type: size` (Chromium ≥ 105 — the Shield/Linux-PC builds are well past this). If a target somehow lacks it, fall back to a `ResizeObserver` measuring the panel and emit `translate3d` in px (the `povFrame` output is already unit-agnostic fractions).
