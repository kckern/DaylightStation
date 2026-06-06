# Canvas2D POV Race Grid Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the PovGrid DOM-transform road renderer with a single-surface Canvas2D wireframe grid + cinematic camera, keeping rich rider avatars as a DOM overlay positioned by the same camera.

**Architecture:** One `<canvas>` draws the whole wireframe road per frame; the *same* per-frame camera positions a thin DOM overlay of `CircularUserAvatar` riders so they sit on the road. Reuses the tuned 1/z projection (`povProjection`), leader-anchored zoom, and the 1 Hz→60fps interpolation; adds a dynamic camera (FOV pulse on sprints + lateral lead toward the leader). Single rasterization surface eliminates the 50-compositor-layer shimmer.

**Tech Stack:** React (hooks, rAF), Canvas 2D, Vitest + jsdom (jsdom returns `null` for `getContext('2d')` — components guard; pure draw code is tested against a mock ctx).

**Spec:** `docs/superpowers/specs/2026-06-06-pov-canvas-race-grid-design.md`

---

## Conventions (verified)

- Run one test file: `./node_modules/.bin/vitest run --config vitest.config.mjs <path>`
- `povProjection.js` exports: `POV_CAMERA {rightPct, farFrac:0.22, depthRatio:6, fogFrac}`, `screenY(t,cam)→0..1`, `depthScale(t,cam)→1 near…1/depthRatio far`, `bandOpacity(t,cam)`, `smoothstep`.
- `povFrame.js` `computePovFrame({riders, leaderPrev, leaderCur, k, frac, cam, count, minorM, majorM})` → `{ lineSlots:[{slot,m,major,t,y,scale,opacity}], markers:[{id,idx,laneX,t,y,scale}] }`. `y`=screenY(t,cam), `scale`=depthScale(t,cam).
- `povRails.js` `computeGridRails(cam, count)` → `[{i, nearX, farX, yNear, yFar}]` (nearX 0..100 even).
- `useLeaderAnchoredZoom(distances, {maxLines})` → `{ kFrac, leaderDist, ... }`.
- `CircularUserAvatar` props: `name, avatarSrc, heartRate, zoneId, zoneColor, size, showGauge, showIndicator`.
- `formatDistance(meters)→string`; `LINE_COLORS` is an exported array.
- Cyan neon token `#21e6ff` = rgb `33, 230, 255`.

## File structure

| File | Responsibility | Action |
|------|----------------|--------|
| `frontend/src/modules/Fitness/lib/cycleGame/povCamera.js` | Camera object + `projectX`/`projectY` (extends povProjection with `vanishX`) | Create |
| `frontend/src/modules/Fitness/lib/cycleGame/povCameraDynamics.js` | `stepCameraDynamics` (smoothed offsets) + `cameraFrom` | Create |
| `frontend/src/modules/Fitness/lib/cycleGame/povCanvasScene.js` | `drawScene(ctx, {...})` — strokes rails + trusses, fog + dual-pass glow | Create |
| `frontend/src/modules/Fitness/widgets/CycleGame/panels/PovGrid.jsx` | Canvas + avatar overlay + rAF loop | Rewrite |
| `frontend/src/modules/Fitness/widgets/CycleGame/panels/PovGrid.scss` | Canvas full-bleed + avatar overlay | Rewrite |
| `frontend/src/modules/Fitness/widgets/CycleGame/panels/PovGrid.test.jsx` | Canvas + avatar structure | Rewrite |
| `frontend/src/modules/Fitness/widgets/CycleGame/panels/PovGrid.README.md` | Canvas/camera/overlay model | Rewrite |

Reused: `povProjection`, `povRails`, `povFrame`, `leaderAnchoredZoom`/`useLeaderAnchoredZoom`, `tickFraction`, `lineColors`, `formatDistance`, `CircularUserAvatar`. Removed from `PovGrid.jsx`: the 50-`hline` pool, the SVG rail fan, `cqw/cqh` positioning, `povNoise` usage.

---

## Task 1: `povCamera.js` — projection with a shiftable vanishing point

**Files:**
- Create: `frontend/src/modules/Fitness/lib/cycleGame/povCamera.js`
- Test: `frontend/src/modules/Fitness/lib/cycleGame/povCamera.test.js`

- [ ] **Step 1: Write the failing test**

Create `frontend/src/modules/Fitness/lib/cycleGame/povCamera.test.js`:

```javascript
import { describe, it, expect } from 'vitest';
import { BASE_CAMERA, projectX, projectY } from './povCamera.js';
import { depthScale, screenY } from './povProjection.js';

describe('povCamera', () => {
  it('leaves the near edge unchanged (depthScale=1 at t=0)', () => {
    expect(projectX(0, 0, BASE_CAMERA)).toBeCloseTo(0);
    expect(projectX(0, 100, BASE_CAMERA)).toBeCloseTo(100);
    expect(projectX(0, 73, BASE_CAMERA)).toBeCloseTo(73);
  });

  it('converges lanes toward the vanishing point with depth', () => {
    const sFar = depthScale(1, BASE_CAMERA);
    expect(projectX(1, 0, BASE_CAMERA)).toBeCloseTo(50 + (0 - 50) * sFar);
    expect(projectX(1, 100, BASE_CAMERA)).toBeCloseTo(50 + (100 - 50) * sFar);
  });

  it('shifts the far convergence when vanishX moves, near edge fixed', () => {
    const cam = { ...BASE_CAMERA, vanishX: 60 };
    expect(projectX(0, 100, cam)).toBeCloseTo(100);                 // near edge unaffected
    const sFar = depthScale(1, cam);
    expect(projectX(1, 100, cam)).toBeCloseTo(60 + (100 - 60) * sFar); // far leans to vanishX 60
  });

  it('projectY runs bottom→horizon', () => {
    expect(projectY(0, BASE_CAMERA)).toBeCloseTo(screenY(0, BASE_CAMERA)); // 1 (bottom)
    expect(projectY(1, BASE_CAMERA)).toBeCloseTo(BASE_CAMERA.farFrac);     // horizon
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `./node_modules/.bin/vitest run --config vitest.config.mjs frontend/src/modules/Fitness/lib/cycleGame/povCamera.test.js`
Expected: FAIL — cannot resolve `./povCamera.js`.

- [ ] **Step 3: Write the implementation**

Create `frontend/src/modules/Fitness/lib/cycleGame/povCamera.js`:

```javascript
import { screenY, depthScale, POV_CAMERA } from './povProjection.js';

/**
 * The POV camera. Extends the fixed 1/z ground-plane projection (povProjection)
 * with a shiftable horizontal vanishing point (`vanishX`, default 50). The grid
 * canvas AND the DOM avatar overlay both project through this single object, so
 * they never detach and cinematic camera moves apply to everything coherently.
 */
export const BASE_CAMERA = { ...POV_CAMERA, vanishX: 50 };

// Project a ground point to a horizontal screen fraction (0..100 = % width).
// depth t in [0,1] (0 near/bottom, 1 far/horizon); worldX is the near-edge x (0..100).
export function projectX(t, worldX, cam = BASE_CAMERA) {
  const vanishX = Number.isFinite(cam.vanishX) ? cam.vanishX : 50;
  return vanishX + (worldX - vanishX) * depthScale(t, cam);
}

// Vertical screen fraction (0=top, 1=bottom).
export function projectY(t, cam = BASE_CAMERA) {
  return screenY(t, cam);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `./node_modules/.bin/vitest run --config vitest.config.mjs frontend/src/modules/Fitness/lib/cycleGame/povCamera.test.js`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/modules/Fitness/lib/cycleGame/povCamera.js frontend/src/modules/Fitness/lib/cycleGame/povCamera.test.js
git commit -m "feat(cycle-game): povCamera — 1/z projection with shiftable vanishing point

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 2: `povCameraDynamics.js` — smoothed cinematic offsets

**Files:**
- Create: `frontend/src/modules/Fitness/lib/cycleGame/povCameraDynamics.js`
- Test: `frontend/src/modules/Fitness/lib/cycleGame/povCameraDynamics.test.js`

- [ ] **Step 1: Write the failing test**

Create `frontend/src/modules/Fitness/lib/cycleGame/povCameraDynamics.test.js`:

```javascript
import { describe, it, expect } from 'vitest';
import { stepCameraDynamics, cameraFrom, NEUTRAL_DYNAMICS } from './povCameraDynamics.js';
import { BASE_CAMERA } from './povCamera.js';

const settle = (signals, steps = 400, dt = 16) => {
  let s = NEUTRAL_DYNAMICS;
  for (let i = 0; i < steps; i++) s = stepCameraDynamics(s, signals, dt);
  return s;
};

describe('povCameraDynamics', () => {
  it('starts neutral (no lean, no zoom boost)', () => {
    expect(NEUTRAL_DYNAMICS.vanishX).toBe(50);
    expect(NEUTRAL_DYNAMICS.fovMul).toBe(1);
  });

  it('leans the vanishing point toward the leader lane, bounded', () => {
    const right = settle({ leaderLaneX: 100, accel: 0 });
    expect(right.vanishX).toBeGreaterThan(50);
    expect(right.vanishX).toBeLessThanOrEqual(50 + 12 + 1e-6); // LEAD_GAIN clamp
    const left = settle({ leaderLaneX: 0, accel: 0 });
    expect(left.vanishX).toBeLessThan(50);
  });

  it('pulses FOV up on acceleration, bounded, and never below 1', () => {
    const sprint = settle({ leaderLaneX: 50, accel: 100 });
    expect(sprint.fovMul).toBeGreaterThan(1);
    expect(sprint.fovMul).toBeLessThanOrEqual(1.5 + 1e-6); // FOV_MAX clamp
    const cruise = settle({ leaderLaneX: 50, accel: 0 });
    expect(cruise.fovMul).toBeCloseTo(1, 2);
  });

  it('eases smoothly — one step moves only partway toward target', () => {
    const next = stepCameraDynamics(NEUTRAL_DYNAMICS, { leaderLaneX: 100, accel: 0 }, 16);
    expect(next.vanishX).toBeGreaterThan(50);
    expect(next.vanishX).toBeLessThan(56); // far short of the ~62 target in one 16ms step
  });

  it('cameraFrom maps dynamics onto a camera (vanishX + depthRatio boost)', () => {
    const cam = cameraFrom({ vanishX: 57, fovMul: 1.2 });
    expect(cam.vanishX).toBe(57);
    expect(cam.depthRatio).toBeCloseTo(BASE_CAMERA.depthRatio * 1.2);
    expect(cam.farFrac).toBe(BASE_CAMERA.farFrac); // horizon fixed — grid doesn't breathe
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `./node_modules/.bin/vitest run --config vitest.config.mjs frontend/src/modules/Fitness/lib/cycleGame/povCameraDynamics.test.js`
Expected: FAIL — cannot resolve `./povCameraDynamics.js`.

- [ ] **Step 3: Write the implementation**

Create `frontend/src/modules/Fitness/lib/cycleGame/povCameraDynamics.js`:

```javascript
import { BASE_CAMERA } from './povCamera.js';

// Tunables (kiosk-calibrated; adjust by feel).
const VANISH_TAU_MS = 450;   // lateral-lead ease time constant
const FOV_TAU_MS = 350;      // fov-pulse ease time constant
const LEAD_GAIN = 12;        // max % the vanishing point leans toward the leader lane
const FOV_GAIN = 0.5;        // depthRatio multiplier added at full normalized accel
const FOV_MAX = 1.5;         // clamp on the depthRatio multiplier
const ACCEL_REF = 6;         // accel (m/tick²) that maps to full FOV pulse

export const NEUTRAL_DYNAMICS = { vanishX: 50, fovMul: 1 };

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const ease = (cur, target, dtMs, tau) => cur + (target - cur) * (1 - Math.exp(-dtMs / tau));

/**
 * Advance the cinematic camera state one frame toward its targets, derived from
 * smoothed race signals. Exponential ease (no overshoot) so the camera glides —
 * cinematic, never jittery. Offsets are bounded; the whole scene (grid + avatars)
 * uses them coherently, so the grid never deforms independently ("not jello").
 *
 * @param {{vanishX:number, fovMul:number}} state - previous dynamics
 * @param {{leaderLaneX:number, accel:number}} signals - leader lane (0..100), accel (m/tick²)
 * @param {number} dtMs - frame delta
 * @param {object} [cfg] - tunable overrides
 */
export function stepCameraDynamics(state, signals, dtMs, cfg = {}) {
  const s = state || NEUTRAL_DYNAMICS;
  const leaderLaneX = Number.isFinite(signals?.leaderLaneX) ? signals.leaderLaneX : 50;
  const accel = Number.isFinite(signals?.accel) ? signals.accel : 0;
  const leadGain = cfg.leadGain ?? LEAD_GAIN;
  const fovGain = cfg.fovGain ?? FOV_GAIN;
  const fovMax = cfg.fovMax ?? FOV_MAX;

  const targetVanish = 50 + clamp((leaderLaneX - 50) / 50, -1, 1) * leadGain;
  const targetFov = clamp(1 + clamp(accel / (cfg.accelRef ?? ACCEL_REF), 0, 1) * fovGain, 1, fovMax);

  return {
    vanishX: ease(s.vanishX, targetVanish, dtMs, cfg.vanishTau ?? VANISH_TAU_MS),
    fovMul: ease(s.fovMul, targetFov, dtMs, cfg.fovTau ?? FOV_TAU_MS)
  };
}

// Build a camera from the eased dynamics. farFrac stays fixed (the horizon does
// not breathe); only vanishX leans and depthRatio pulses.
export function cameraFrom(dyn) {
  const d = dyn || NEUTRAL_DYNAMICS;
  return { ...BASE_CAMERA, vanishX: d.vanishX, depthRatio: BASE_CAMERA.depthRatio * d.fovMul };
}

export default stepCameraDynamics;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `./node_modules/.bin/vitest run --config vitest.config.mjs frontend/src/modules/Fitness/lib/cycleGame/povCameraDynamics.test.js`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/modules/Fitness/lib/cycleGame/povCameraDynamics.js frontend/src/modules/Fitness/lib/cycleGame/povCameraDynamics.test.js
git commit -m "feat(cycle-game): povCameraDynamics — eased FOV pulse + lateral lead

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 3: `povCanvasScene.js` — draw rails + trusses (fog + dual-pass glow)

**Files:**
- Create: `frontend/src/modules/Fitness/lib/cycleGame/povCanvasScene.js`
- Test: `frontend/src/modules/Fitness/lib/cycleGame/povCanvasScene.test.js`

- [ ] **Step 1: Write the failing test**

Create `frontend/src/modules/Fitness/lib/cycleGame/povCanvasScene.test.js`:

```javascript
import { describe, it, expect } from 'vitest';
import { drawScene } from './povCanvasScene.js';
import { BASE_CAMERA } from './povCamera.js';

// Mock 2D context: records stroke calls with the strokeStyle active at stroke time.
function mockCtx() {
  const calls = { clearRect: 0, stroke: 0, strokeStyles: [], lineWidths: [] };
  return {
    calls,
    _style: '',
    _w: 0,
    set strokeStyle(v) { this._style = v; },
    get strokeStyle() { return this._style; },
    set lineWidth(v) { this._w = v; },
    get lineWidth() { return this._w; },
    set lineCap(_) {},
    clearRect() { calls.clearRect++; },
    beginPath() {},
    moveTo() {},
    lineTo() {},
    stroke() { calls.stroke++; calls.strokeStyles.push(this._style); calls.lineWidths.push(this._w); }
  };
}

const alphaOf = (rgba) => Number(rgba.match(/[\d.]+\)$/)[0].replace(')', ''));

describe('drawScene', () => {
  const railsX = [0, 25, 50, 75, 100];
  const lineSlots = [
    { slot: 0, m: 0, major: true, t: 0.1, y: 0.9, scale: 0.9, opacity: 0.8 }, // near, bright
    { slot: 5, m: 200, major: false, t: 0.9, y: 0.3, scale: 0.2, opacity: 0.1 }, // far, faint
    { slot: 9, m: 400, major: false, t: 1.0, y: 0.22, scale: 0.16, opacity: 0 }  // parked
  ];

  it('no-ops on a missing context or zero size', () => {
    expect(() => drawScene(null, { camera: BASE_CAMERA, lineSlots, railsX, dims: { w: 10, h: 10 } })).not.toThrow();
    const ctx = mockCtx();
    drawScene(ctx, { camera: BASE_CAMERA, lineSlots, railsX, dims: { w: 0, h: 0 } });
    expect(ctx.calls.clearRect).toBe(0);
  });

  it('clears, then dual-pass strokes every rail and every visible truss', () => {
    const ctx = mockCtx();
    drawScene(ctx, { camera: BASE_CAMERA, lineSlots, railsX, dims: { w: 200, h: 100 } });
    expect(ctx.calls.clearRect).toBe(1);
    // rails: 5 × 2 passes; trusses with opacity>0: 2 × 2 passes
    expect(ctx.calls.stroke).toBe((5 + 2) * 2);
  });

  it('fogs: the far/faint truss strokes are dimmer than the near/bright one', () => {
    const ctx = mockCtx();
    drawScene(ctx, { camera: BASE_CAMERA, lineSlots, railsX, dims: { w: 200, h: 100 } });
    const alphas = ctx.calls.strokeStyles.map(alphaOf);
    expect(Math.max(...alphas)).toBeGreaterThan(Math.min(...alphas));
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `./node_modules/.bin/vitest run --config vitest.config.mjs frontend/src/modules/Fitness/lib/cycleGame/povCanvasScene.test.js`
Expected: FAIL — cannot resolve `./povCanvasScene.js`.

- [ ] **Step 3: Write the implementation**

Create `frontend/src/modules/Fitness/lib/cycleGame/povCanvasScene.js`:

```javascript
import { projectX, projectY } from './povCamera.js';

const CYAN = '33, 230, 255'; // #21e6ff

// Dual-pass neon stroke: a wide faint halo + a narrow bright core. Cheaper than
// shadowBlur at 60fps on the Shield, and reads as glow.
function neonLine(ctx, x0, y0, x1, y1, alpha, width) {
  ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1);
  ctx.lineWidth = width * 3.5;
  ctx.strokeStyle = `rgba(${CYAN}, ${(alpha * 0.35).toFixed(3)})`;
  ctx.stroke();
  ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1);
  ctx.lineWidth = width;
  ctx.strokeStyle = `rgba(${CYAN}, ${alpha.toFixed(3)})`;
  ctx.stroke();
}

/**
 * Draw the POV road wireframe onto a 2D context for one frame.
 *  - rails: the fixed longitudinal gridlines (near-edge x in `railsX`), each
 *    projected near(t=0,bottom) → far(t=1,horizon) through the live camera.
 *  - trusses: the metre marks (`lineSlots` from computePovFrame), each a
 *    horizontal line across the road width at its depth, fogged by its opacity.
 * Positions are CSS px; the caller scales the context by devicePixelRatio.
 *
 * @param {CanvasRenderingContext2D|null} ctx
 * @param {{camera:object, lineSlots:Array, railsX:number[], dims:{w:number,h:number}}} args
 */
export function drawScene(ctx, { camera, lineSlots = [], railsX = [], dims }) {
  const w = dims?.w || 0;
  const h = dims?.h || 0;
  if (!ctx || !(w > 0) || !(h > 0)) return;

  ctx.clearRect(0, 0, w, h);
  ctx.lineCap = 'round';
  const X = (frac) => (frac / 100) * w;  // x fraction (0..100) → px
  const Y = (frac) => frac * h;          // y fraction (0..1)   → px

  // Rails — longitudinal, faint, uniform (the road's lane grid).
  const railY0 = Y(projectY(0, camera));
  const railY1 = Y(projectY(1, camera));
  for (const nx of railsX) {
    neonLine(ctx, X(projectX(0, nx, camera)), railY0, X(projectX(1, nx, camera)), railY1, 0.30, 1);
  }

  // Trusses — lateral metre marks bunching to the horizon, fogged by depth.
  const vanishX = Number.isFinite(camera?.vanishX) ? camera.vanishX : 50;
  for (const s of lineSlots) {
    if (!(s.opacity > 0)) continue;
    const y = Y(s.y);
    const xl = X(vanishX + (0 - vanishX) * s.scale);
    const xr = X(vanishX + (100 - vanishX) * s.scale);
    const alpha = s.opacity * (s.major ? 0.95 : 0.45);
    neonLine(ctx, xl, y, xr, y, alpha, s.major ? 1.6 : 1);
  }
}

export default drawScene;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `./node_modules/.bin/vitest run --config vitest.config.mjs frontend/src/modules/Fitness/lib/cycleGame/povCanvasScene.test.js`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/modules/Fitness/lib/cycleGame/povCanvasScene.js frontend/src/modules/Fitness/lib/cycleGame/povCanvasScene.test.js
git commit -m "feat(cycle-game): povCanvasScene — wireframe rails+trusses, fog + dual-pass glow

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 4: Rewrite `PovGrid.jsx` (canvas + avatar overlay) + SCSS + test

**Files:**
- Rewrite: `frontend/src/modules/Fitness/widgets/CycleGame/panels/PovGrid.jsx`
- Rewrite: `frontend/src/modules/Fitness/widgets/CycleGame/panels/PovGrid.scss`
- Rewrite: `frontend/src/modules/Fitness/widgets/CycleGame/panels/PovGrid.test.jsx`

Context: keeps the same props (`riderIds, riders, riderLive`) and `data-testid="race-pov"`, so `CycleRaceScreen` wiring is unchanged. The capture-tick + interpolation machinery and the avatar markers are kept; the grid `<div>` pool + SVG fan are replaced by a `<canvas>` drawn via `drawScene`, and avatars are positioned by the dynamic camera.

- [ ] **Step 1: Write the failing test**

Replace the entire contents of `frontend/src/modules/Fitness/widgets/CycleGame/panels/PovGrid.test.jsx` with:

```javascript
import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import PovGrid from './PovGrid.jsx';

const riders = {
  a: { displayName: 'A', cumulativeDistanceM: 500 },
  b: { displayName: 'B', cumulativeDistanceM: 400 }
};

describe('PovGrid', () => {
  it('renders the canvas road and one avatar per moved rider', () => {
    const { getByTestId, getAllByTestId, container } = render(
      <PovGrid riderIds={['a', 'b']} riders={riders} riderLive={{}} />
    );
    expect(getByTestId('race-pov')).toBeInTheDocument();
    expect(container.querySelector('canvas.cg-pov__canvas')).toBeTruthy();
    expect(getAllByTestId('pov-marker')).toHaveLength(2);
  });

  it('never renders a rider still at 0 m (they would anchor the zoom scale)', () => {
    const field = {
      a: { displayName: 'A', cumulativeDistanceM: 500 },
      b: { displayName: 'B', cumulativeDistanceM: 0 },   // never moved
      c: { displayName: 'C', cumulativeDistanceM: 120 }
    };
    const { getAllByTestId } = render(<PovGrid riderIds={['a', 'b', 'c']} riders={field} riderLive={{}} />);
    expect(getAllByTestId('pov-marker')).toHaveLength(2); // a + c, not b
  });

  it('renders no avatars at the start when no one has moved', () => {
    const field = { a: { displayName: 'A', cumulativeDistanceM: 0 }, b: { displayName: 'B', cumulativeDistanceM: 0 } };
    const { queryAllByTestId } = render(<PovGrid riderIds={['a', 'b']} riders={field} riderLive={{}} />);
    expect(queryAllByTestId('pov-marker')).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `./node_modules/.bin/vitest run --config vitest.config.mjs frontend/src/modules/Fitness/widgets/CycleGame/panels/PovGrid.test.jsx`
Expected: FAIL — `canvas.cg-pov__canvas` not found (current component renders the DOM grid).

- [ ] **Step 3: Rewrite the component**

Replace the entire contents of `frontend/src/modules/Fitness/widgets/CycleGame/panels/PovGrid.jsx` with:

```javascript
import React, { useEffect, useRef } from 'react';
import PropTypes from 'prop-types';
import CircularUserAvatar from '@/modules/Fitness/components/CircularUserAvatar.jsx';
import { LINE_COLORS } from '@/modules/Fitness/lib/cycleGame/lineColors.js';
import { formatDistance } from '@/modules/Fitness/lib/cycleGame/formatDistance.js';
import { useLeaderAnchoredZoom } from '@/modules/Fitness/lib/cycleGame/useLeaderAnchoredZoom.js';
import { computePovFrame } from '@/modules/Fitness/lib/cycleGame/povFrame.js';
import { tickFraction } from '@/modules/Fitness/lib/cycleGame/tickFraction.js';
import { computeGridRails } from '@/modules/Fitness/lib/cycleGame/povRails.js';
import { BASE_CAMERA } from '@/modules/Fitness/lib/cycleGame/povCamera.js';
import { stepCameraDynamics, cameraFrom, NEUTRAL_DYNAMICS } from '@/modules/Fitness/lib/cycleGame/povCameraDynamics.js';
import { drawScene } from '@/modules/Fitness/lib/cycleGame/povCanvasScene.js';
import './PovGrid.scss';

const MINOR_M = 10;        // minor metre mark every 10 m
const MAJOR_M = 50;        // major every 50 m
const GRID_SLOTS = 50;     // recycled metre-mark pool (covers 500 m)
const TICK_MS = 1000;      // matches RACE_TICK_MS — the 1 Hz data cadence
const K_TAU_MS = 320;      // zoom-ease time constant
const VLINES = 9;          // fixed vertical gridlines (road edges + interior)

// Static near-edge x positions for the longitudinal rails (camera reprojects per frame).
const RAILS_X = computeGridRails(BASE_CAMERA, VLINES).map((r) => r.nearX);

/**
 * Canvas2D POV road. A single <canvas> draws the wireframe grid (rails + metre
 * trusses) each frame through a dynamic camera; the SAME camera positions a DOM
 * overlay of rider avatars, so they sit on the road. One rAF loop owns both. The
 * camera leans toward the leader and pulses FOV on sprints — but rigidly (the
 * grid never deforms; "not jello"). See README.
 */
export default function PovGrid({ riderIds, riders, riderLive = {} }) {
  const distOf = (id) => Math.max(0, riders[id]?.cumulativeDistanceM || 0);
  const movedIds = riderIds.filter((id) => distOf(id) > 0);
  const colorOf = (id) => LINE_COLORS[riderIds.indexOf(id) % LINE_COLORS.length];
  const zoom = useLeaderAnchoredZoom(movedIds.map(distOf), { maxLines: GRID_SLOTS });
  const laneX = (idx) => (movedIds.length <= 1 ? 50 : 12 + idx * (76 / (movedIds.length - 1)));

  const canvasRef = useRef(null);
  const ctxRef = useRef(null);
  const dimsRef = useRef({ w: 0, h: 0, dpr: 1 });
  const tickRef = useRef({ leaderPrev: 0, leaderCur: 0, kTarget: 0, riders: [], tickAt: 0, leaderVel: 0, accel: 0, leaderLaneX: 50 });
  const kRef = useRef(null);
  const camDynRef = useRef(NEUTRAL_DYNAMICS);
  const markerEls = useRef({});
  const prevDistRef = useRef({});

  // Capture each new tick's targets (only on real data change), and derive the
  // camera signals (leader lane + acceleration) for the dynamics.
  useEffect(() => {
    const t = tickRef.current;
    if (zoom.leaderDist === t.leaderCur && Object.keys(prevDistRef.current).length === movedIds.length) return;
    const now = performance.now();
    const prev = prevDistRef.current;
    const ridersFrame = movedIds.map((id, idx) => ({
      id, idx, laneX: laneX(idx),
      prev: Number.isFinite(prev[id]) ? prev[id] : distOf(id),
      cur: distOf(id)
    }));
    const leaderCur = zoom.leaderDist;
    const leaderPrev = Number.isFinite(t.leaderCur) && t.leaderCur > 0 ? t.leaderCur : leaderCur;
    const leaderVel = Math.max(0, leaderCur - leaderPrev);           // m per 1 Hz tick
    const accel = leaderVel - (t.leaderVel || 0);                    // m per tick²
    const leaderId = movedIds.reduce((best, id) => (best && distOf(best) >= distOf(id) ? best : id), null);
    const leaderLaneX = leaderId ? laneX(movedIds.indexOf(leaderId)) : 50;
    tickRef.current = {
      leaderPrev, leaderCur, kTarget: zoom.kFrac, riders: ridersFrame, tickAt: now,
      leaderVel, accel, leaderLaneX
    };
    const next = {}; movedIds.forEach((id) => { next[id] = distOf(id); });
    prevDistRef.current = next;
  });

  // Size the canvas backing store to devicePixelRatio for crisp lines; re-measure
  // on resize. jsdom returns null for getContext('2d') and 0-size rects — guarded.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return undefined;
    ctxRef.current = (canvas.getContext && canvas.getContext('2d')) || null;
    const measure = () => {
      const rect = canvas.getBoundingClientRect();
      const dpr = (typeof window !== 'undefined' && window.devicePixelRatio) || 1;
      const w = Math.max(0, Math.round(rect.width));
      const h = Math.max(0, Math.round(rect.height));
      dimsRef.current = { w, h, dpr };
      if (w > 0 && h > 0) {
        canvas.width = Math.round(w * dpr);
        canvas.height = Math.round(h * dpr);
        if (ctxRef.current) ctxRef.current.setTransform(dpr, 0, 0, dpr, 0, 0);
      }
    };
    measure();
    let ro;
    if (typeof ResizeObserver !== 'undefined') {
      ro = new ResizeObserver(measure);
      ro.observe(canvas);
    }
    return () => { if (ro) ro.disconnect(); };
  }, []);

  // The 60fps loop — mounts once, draws the grid to canvas, positions avatars.
  useEffect(() => {
    let raf;
    let lastT = performance.now();
    const draw = () => {
      const nowT = performance.now();
      const dt = Math.min(64, nowT - lastT); lastT = nowT;
      const t = tickRef.current;

      const target = t.kTarget;
      if (!(kRef.current > 0)) kRef.current = target;
      else if (target > 0) kRef.current += (target - kRef.current) * (1 - Math.exp(-dt / K_TAU_MS));
      const kFrame = kRef.current;

      camDynRef.current = stepCameraDynamics(camDynRef.current, { leaderLaneX: t.leaderLaneX, accel: t.accel }, dt);
      const camera = cameraFrom(camDynRef.current);

      const frac = tickFraction(nowT, t.tickAt, TICK_MS);
      const { lineSlots, markers } = computePovFrame({
        riders: t.riders, leaderPrev: t.leaderPrev, leaderCur: t.leaderCur,
        k: kFrame, frac, cam: camera, count: GRID_SLOTS, minorM: MINOR_M, majorM: MAJOR_M
      });

      drawScene(ctxRef.current, { camera, lineSlots, railsX: RAILS_X, dims: dimsRef.current });

      markers.forEach((m) => {
        const el = markerEls.current[m.id];
        if (!el) return;
        const x = camera.vanishX + (m.laneX - camera.vanishX) * m.scale;
        el.style.transform =
          `translate3d(${x.toFixed(2)}cqw, ${(m.y * 100).toFixed(3)}cqh, 0) translate(-50%, -50%) scale(${(0.55 + 0.45 * m.scale).toFixed(3)})`;
        el.style.zIndex = String(100 + Math.round(m.t * 100)); // nearer riders occlude farther
      });
      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, []);

  return (
    <div className="cg-pov" data-testid="race-pov">
      <canvas className="cg-pov__canvas" ref={canvasRef} aria-hidden="true" />
      <div className="cg-pov__avatars" aria-hidden="true">
        {movedIds.map((id) => {
          const color = colorOf(id);
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
    </div>
  );
}

PovGrid.propTypes = {
  riderIds: PropTypes.array.isRequired,
  riders: PropTypes.object.isRequired,
  riderLive: PropTypes.object
};
```

- [ ] **Step 4: Rewrite the SCSS**

Replace the entire contents of `frontend/src/modules/Fitness/widgets/CycleGame/panels/PovGrid.scss` with:

```scss
@use '../cgTokens' as cg;

.cg-pov {
  position: relative; width: 100%; height: 100%; min-height: 0; overflow: hidden;
  container-type: size;              // enables cqw/cqh positioning of the avatar overlay
  contain: layout paint;             // isolate from the rest of the screen
  background: radial-gradient(130% 80% at 50% 6%, #2a0a3a 0%, #0a0118 70%);

  // The road grid is a single canvas surface — no per-element compositor layers,
  // so no sub-pixel shimmer. Stretches to the panel; the JS sizes the backing store.
  &__canvas { position: absolute; inset: 0; width: 100%; height: 100%; display: block; }

  // DOM avatar overlay — the few rich CircularUserAvatar cards, positioned each
  // frame by the same camera that draws the canvas.
  &__avatars { position: absolute; inset: 0; pointer-events: none; }

  &__marker {
    position: absolute; top: 0; left: 0;
    display: flex; flex-direction: column; align-items: center; gap: 2px;
    transform-origin: 50% 50%;
    will-change: transform;
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

- [ ] **Step 5: Run the structure test**

Run: `./node_modules/.bin/vitest run --config vitest.config.mjs frontend/src/modules/Fitness/widgets/CycleGame/panels/PovGrid.test.jsx`
Expected: PASS (3 tests). (jsdom can't rasterize the canvas; the structure — canvas + one avatar per moved rider — is what's asserted. Motion is verified on the kiosk.)

- [ ] **Step 6: Commit**

```bash
git add frontend/src/modules/Fitness/widgets/CycleGame/panels/PovGrid.jsx frontend/src/modules/Fitness/widgets/CycleGame/panels/PovGrid.scss frontend/src/modules/Fitness/widgets/CycleGame/panels/PovGrid.test.jsx
git commit -m "feat(cycle-game): PovGrid — Canvas2D wireframe road + DOM avatar overlay + dynamic camera

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 5: Rewrite `PovGrid.README.md`

**Files:**
- Rewrite: `frontend/src/modules/Fitness/widgets/CycleGame/panels/PovGrid.README.md`

- [ ] **Step 1: Replace the README**

Replace the entire contents of `frontend/src/modules/Fitness/widgets/CycleGame/panels/PovGrid.README.md` with:

```markdown
# PovGrid — the Canvas2D POV race road (reviewer notes)

**Component:** `PovGrid.jsx` (`data-testid="race-pov"`) — the first-person
"Cruis'n-USA" standings road in the cycle race screen (right sidebar in ≤3-rider
mode, third top column in ≥4-rider mode).

This panel is a **single-surface Canvas2D wireframe road with a DOM avatar
overlay**. All the math lives in pure, unit-tested modules; the component is a
thin shell that draws the grid to one `<canvas>` and positions a few rich avatar
cards over it — both driven by the same per-frame camera.

## Why canvas (the perf contract)

> The road grid is **one canvas surface**, rasterized once per frame. The previous
> implementation transformed ~50 `<div>` gridlines + an SVG fan — ~50 independent
> compositor layers, each device-pixel-snapped separately, which shimmered. A
> single canvas has no per-layer snapping, so the grid is rock-steady.

The **avatars stay DOM** (`CircularUserAvatar`): they're telemetry cards (photo +
HR gauge + zone ring + labels), not sprites — DOM keeps text crisp and reuses the
polished component. Only ≤6 nodes, so no shimmer; positioned each frame from the
same camera that draws the canvas (so they sit exactly on the road).

## Files

| File | Role |
|---|---|
| `PovGrid.jsx` | Thin shell: a `<canvas>` + the avatar overlay; one rAF loop (camera → draw → position avatars). |
| `PovGrid.scss` | Canvas full-bleed; `container-type: size` for the avatar `cqw/cqh` overlay. |
| `lib/cycleGame/povCamera.js` | **The camera.** 1/z projection with a shiftable `vanishX`; `projectX`/`projectY`. |
| `lib/cycleGame/povCameraDynamics.js` | **Cinematic motion.** Eased FOV pulse on sprints + lateral lead toward the leader. Bounded, rigid (no jello). |
| `lib/cycleGame/povCanvasScene.js` | **The draw.** Strokes rails + trusses with depth fog + a dual-pass neon glow. |
| `lib/cycleGame/povProjection.js` | The underlying 1/z ground-plane math (`screenY`, `depthScale`). |
| `lib/cycleGame/povFrame.js` | Per-frame interpolation + metre-mark projection (`computePovFrame`). |
| `lib/cycleGame/povRails.js` | Fixed vertical-gridline lane positions. |
| `lib/cycleGame/tickFraction.js` | 1 Hz→60fps interpolation clock. |
| `lib/cycleGame/leaderAnchoredZoom.js` | Held-`k` hysteresis rezoom. |

## How it runs

```
per 1 Hz tick (React render):
  useLeaderAnchoredZoom → { k, leaderDist }
  capture { leaderPrev/Cur, kTarget, riders[{prev,cur,laneX}], tickAt,
            leaderVel, accel, leaderLaneX } into a ref   // accel/lane drive the camera

per animation frame (rAF, mounted once):
  ease k; dt
  dynamics = stepCameraDynamics(prev, { leaderLaneX, accel }, dt)   // eased, bounded
  camera   = cameraFrom(dynamics)                                   // vanishX lean + depthRatio pulse
  { lineSlots, markers } = computePovFrame({ ...tickRef, k, frac, cam: camera })
  drawScene(ctx, { camera, lineSlots, railsX, dims })               // one canvas pass
  for each marker: write transform on its avatar DOM node (z-index by depth)
```

## The camera

`povProjection` gives the fixed 1/z ground plane (`screenY`, `depthScale`);
`povCamera` adds a shiftable `vanishX`. `povCameraDynamics` eases two bounded
offsets toward race-driven targets: **lateral lead** (vanishX leans toward the
leader's lane) and **FOV pulse** (`depthRatio` boosts on acceleration). Both ease
exponentially (no overshoot) and apply to the whole scene coherently — the grid
never deforms independently. `farFrac` (the horizon row) is fixed: the road does
not breathe.

## Tests

- **Math, unit-tested headlessly:** `povCamera.test.js` (projection, vanishX
  shift), `povCameraDynamics.test.js` (bounded, smooth, settling),
  `povCanvasScene.test.js` (mock ctx: stroke counts, fog falloff), plus the
  retained `povProjection`/`povFrame`/`leaderAnchoredZoom`/`povRails` tests.
- **`PovGrid.test.jsx`** asserts structure (a `<canvas>` + one avatar per moved
  rider). jsdom can't rasterize canvas, so **the motion + look are verified on the
  kiosk** (a Performance trace showing per-frame work and a steady 60fps).
```

- [ ] **Step 2: Commit**

```bash
git add frontend/src/modules/Fitness/widgets/CycleGame/panels/PovGrid.README.md
git commit -m "docs(cycle-game): rewrite PovGrid README for the Canvas2D renderer

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 6: Full verification

**Files:** none (verification only)

- [ ] **Step 1: Run the new modules + the broader cycle-game suite**

Run: `./node_modules/.bin/vitest run --config vitest.config.mjs frontend/src/modules/Fitness/lib/cycleGame frontend/src/modules/Fitness/widgets/CycleGame`
Expected: PASS — the new `povCamera`/`povCameraDynamics`/`povCanvasScene` tests, the rewritten `PovGrid.test.jsx`, and all pre-existing cycle-game tests (no regressions). Note any pre-existing failures unrelated to this change but do not fix them here.

- [ ] **Step 2: Confirm no dangling references to the removed renderer**

Run: `grep -rnE 'cg-pov__hline|cg-pov__fan|cg-pov__grid|cg-pov__rail|makeSmoothNoise|povNoise' frontend/src/modules/Fitness/widgets/CycleGame/panels/PovGrid.jsx frontend/src/modules/Fitness/widgets/CycleGame/panels/PovGrid.scss`
Expected: no output (the DOM grid, SVG fan, and noise are fully gone from PovGrid). `povNoise.js` itself stays in the repo (other consumers / tests) — just unused by PovGrid.

- [ ] **Step 3: Commit any (there should be none)**

If Steps 1–2 surfaced a fix, commit it with a clear message. Otherwise nothing to commit.

---

## Self-Review notes

- **Spec coverage:** canvas grid (Task 3 + 4), shiftable-vanishing-point camera (Task 1), cinematic dynamics — FOV pulse + lateral lead (Task 2), DOM-overlay avatars driven by the camera (Task 4), dpr-aware backing store + resize (Task 4), fog + dual-pass glow (Task 3), tests at each layer, README (Task 5). Reuse of `povProjection`/`povFrame`/`povRails`/`leaderAnchoredZoom`/`tickFraction` preserved.
- **Type consistency:** the camera object `{ ...BASE_CAMERA, vanishX, depthRatio }` is produced by `cameraFrom` (Task 2) and consumed identically by `projectX`/`projectY` (Task 1), `computePovFrame` (`cam`), and `drawScene` (Task 3). Dynamics shape `{ vanishX, fovMul }` is consistent between `stepCameraDynamics`, `NEUTRAL_DYNAMICS`, and `cameraFrom`. `lineSlots`/`markers` shapes match `computePovFrame`'s documented output.
- **Known limitation (v1):** avatars render over the canvas (z-index by depth handles avatar-vs-avatar occlusion); a gridline never occludes a far avatar — accepted per spec.
- **Visual verification is out-of-band:** jsdom can't rasterize canvas; the look/motion is confirmed on the kiosk by the human, not in CI.
```
