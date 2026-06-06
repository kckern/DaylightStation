# POV Grid — three.js + camera-controls Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the hand-rolled Canvas2D POV race road with a three.js scene driven by the `camera-controls` library, so smooth follow / auto-framing / zoom-cap come from battle-tested code instead of bespoke math.

**Architecture:** `PovGrid.jsx` becomes a React shell that dynamic-imports `three` + `camera-controls`, builds a WebGL road scene once, overlays DOM avatar cards via `CSS2DRenderer`, and runs one rAF loop that interpolates rider positions, frames the field with `cameraControls.fitToBox(box, true)` (eased), and renders. All race-data→world math lives in two pure, unit-tested modules (`povWorld`, `povFollowCam`).

**Tech Stack:** React, three.js (`WebGLRenderer`, `PerspectiveCamera`, `CSS2DRenderer`, `Fog`, `LineSegments`), camera-controls, vitest + jsdom, the project structured logger.

**Spec:** `docs/superpowers/specs/2026-06-06-pov-grid-threejs-camera-controls-design.md`

**Constants (shared, defined where noted):**
- `RACE_TICK_MS = 1000` (data cadence; reuse `tickFraction.js`)
- `ROAD_HALF_W = 4` (world units; road spans x ∈ [−4, +4])
- `LANE_INSET = 0.85` (riders spread across ±ROAD_HALF_W·LANE_INSET)
- `GRID_MINOR_M = 1`, `GRID_MAJOR_M = 10`
- `AHEAD_M = 25` (road drawn ahead of the leader → leader frames in top third)
- `MIN_SPAN_M = 20` (min field span to frame → max-zoom cap)
- `FOG_FAR_M = 220` (marks/fog cutoff behind the leader)

---

### Task 1: Add three.js + camera-controls dependencies

**Files:**
- Modify: `frontend/package.json`
- Modify: `frontend/package-lock.json` (regenerated)

- [ ] **Step 1: Add the deps**

In `frontend/package.json` `dependencies`, add (alphabetical):
```json
"camera-controls": "^2.10.1",
"three": "^0.169.0"
```

- [ ] **Step 2: Install + regenerate lockfile**

Run: `cd frontend && npm install three@^0.169.0 camera-controls@^2.10.1`
Expected: `package-lock.json` updated, no peer-dep errors. (camera-controls peers on `three` — satisfied.)

- [ ] **Step 3: Verify import resolves**

Run: `cd frontend && node -e "import('three').then(m=>console.log('three', typeof m.WebGLRenderer)).then(()=>import('camera-controls')).then(m=>console.log('cc', typeof m.default))"`
Expected: `three function` then `cc function`.

- [ ] **Step 4: Commit**

```bash
git add frontend/package.json frontend/package-lock.json
git commit -m "build(cycle-game): add three.js + camera-controls for POV renderer"
```

---

### Task 2: `povWorld` — race data → world coordinates (pure)

**Files:**
- Create: `frontend/src/modules/Fitness/lib/cycleGame/povWorld.js`
- Test: `frontend/src/modules/Fitness/lib/cycleGame/povWorld.test.js`

**Interface:**
```
povWorld({
  riders,        // [{ id, idx, prev, cur, isGhost }]  prev/cur = distance metres at prev/current tick
  frac,          // 0..1 interpolation within the tick
  laneCount,     // number of riders to spread across the road (= riders.length)
  lapLengthM, finishM,
  aheadM = AHEAD_M, gridMinorM = GRID_MINOR_M, gridMajorM = GRID_MAJOR_M, fogFarM = FOG_FAR_M,
  roadHalfW = ROAD_HALF_W, laneInset = LANE_INSET,
}) → {
  riders: [{ id, idx, isGhost, x, z, distM }],   // z = -distM ; x = lane offset
  leaderZ, lastZ,
  marks:  [{ z, m, major, label }],              // label = `${m}m` for majors else null
  gates:  [{ z, lap, isFinish, label }],
}
```
Rider input is already DNF/non-moved filtered by the caller — but `povWorld` must
still tolerate an empty `riders` array (return empty riders/marks/gates, `leaderZ=lastZ=0`).

- [ ] **Step 1: Write the failing tests**

```js
import { describe, it, expect } from 'vitest';
import { povWorld, laneX } from './povWorld.js';

const mk = (id, idx, prev, cur, isGhost = false) => ({ id, idx, prev, cur, isGhost });

describe('laneX', () => {
  it('centres a single rider', () => {
    expect(laneX(0, 1, 4, 0.85)).toBe(0);
  });
  it('spreads N riders symmetrically across ±halfW*inset', () => {
    const n = 3, hw = 4, inset = 0.85;
    const xs = [0, 1, 2].map((i) => laneX(i, n, hw, inset));
    expect(xs[0]).toBeCloseTo(-hw * inset);
    expect(xs[2]).toBeCloseTo(hw * inset);
    expect(xs[1]).toBeCloseTo(0);
    expect(xs[0] + xs[2]).toBeCloseTo(0); // symmetric
  });
});

describe('povWorld', () => {
  const base = { lapLengthM: 100, finishM: null, aheadM: 25, gridMinorM: 1, gridMajorM: 10, fogFarM: 220, roadHalfW: 4, laneInset: 0.85 };

  it('places riders at z = -interpolated distance', () => {
    const riders = [mk('a', 0, 40, 50), mk('b', 1, 10, 20)];
    const w = povWorld({ ...base, riders, frac: 0.5, laneCount: 2 });
    expect(w.riders.find((r) => r.id === 'a').z).toBeCloseTo(-45);
    expect(w.riders.find((r) => r.id === 'b').z).toBeCloseTo(-15);
    expect(w.riders.find((r) => r.id === 'a').distM).toBeCloseTo(45);
  });

  it('reports leaderZ (furthest = most negative) and lastZ', () => {
    const riders = [mk('a', 0, 50, 50), mk('b', 1, 20, 20)];
    const w = povWorld({ ...base, riders, frac: 1, laneCount: 2 });
    expect(w.leaderZ).toBeCloseTo(-50);
    expect(w.lastZ).toBeCloseTo(-20);
  });

  it('returns an empty world for no riders', () => {
    const w = povWorld({ ...base, riders: [], frac: 0, laneCount: 0 });
    expect(w.riders).toEqual([]);
    expect(w.marks).toEqual([]);
    expect(w.gates).toEqual([]);
    expect(w.leaderZ).toBe(0);
    expect(w.lastZ).toBe(0);
  });

  it('emits minor marks at 1m and flags/labels 10m majors', () => {
    const riders = [mk('a', 0, 25, 25)];
    const w = povWorld({ ...base, riders, frac: 1, laneCount: 1 });
    const m20 = w.marks.find((x) => x.m === 20);
    const m21 = w.marks.find((x) => x.m === 21);
    expect(m20.major).toBe(true);
    expect(m20.label).toBe('20m');
    expect(m21.major).toBe(false);
    expect(m21.label).toBe(null);
    expect(m20.z).toBeCloseTo(-20);
  });

  it('culls marks farther than fogFarM behind the leader', () => {
    const riders = [mk('a', 0, 300, 300)];
    const w = povWorld({ ...base, riders, frac: 1, laneCount: 1, fogFarM: 220 });
    expect(w.marks.every((x) => x.m >= 300 - 220 - 1e-6)).toBe(true);
    expect(w.marks.some((x) => x.m < 80)).toBe(false);
  });

  it('emits marks ahead of the leader up to aheadM', () => {
    const riders = [mk('a', 0, 50, 50)];
    const w = povWorld({ ...base, riders, frac: 1, laneCount: 1, aheadM: 25 });
    expect(w.marks.some((x) => x.m > 50 && x.m <= 75 + 1e-6)).toBe(true);
    expect(w.marks.some((x) => x.m > 75 + 1e-6)).toBe(false);
  });

  it('emits lap gates at lap multiples behind and ahead, none past finish', () => {
    const riders = [mk('a', 0, 250, 250)];
    const w = povWorld({ ...base, riders, frac: 1, laneCount: 1, lapLengthM: 100, finishM: 400 });
    const laps = w.gates.filter((g) => !g.isFinish).map((g) => g.lap).sort((p, q) => p - q);
    expect(laps).toContain(2);
    expect(laps).toContain(3);
    expect(w.gates.every((g) => g.isFinish || g.lap * 100 <= 400 + 1e-6)).toBe(true);
    const finish = w.gates.find((g) => g.isFinish);
    expect(finish.label).toBe('FINISH');
    expect(finish.z).toBeCloseTo(-400);
  });

  it('omits gates when no lap length', () => {
    const riders = [mk('a', 0, 50, 50)];
    const w = povWorld({ ...base, riders, frac: 1, laneCount: 1, lapLengthM: 0 });
    expect(w.gates).toEqual([]);
  });
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `cd /opt/Code/DaylightStation && ./node_modules/.bin/vitest run --config vitest.config.mjs frontend/src/modules/Fitness/lib/cycleGame/povWorld.test.js`
Expected: FAIL — `povWorld is not a function` / cannot find module.

- [ ] **Step 3: Implement `povWorld.js`**

```js
const lerp = (a, b, f) => a + (b - a) * (f || 0);

/** Lane offset across the road: single rider centred; N spread evenly over ±halfW*inset. */
export function laneX(idx, n, halfW, inset) {
  if (n <= 1) return 0;
  const span = halfW * inset;
  return -span + (idx * (2 * span)) / (n - 1);
}

/**
 * Pure race-data → world mapping for the POV road. World is metres; the road
 * recedes into −Z (camera looks down −Z). See the design spec.
 */
export function povWorld({
  riders = [], frac = 0, laneCount = 0,
  lapLengthM = 0, finishM = null,
  aheadM = 25, gridMinorM = 1, gridMajorM = 10, fogFarM = 220,
  roadHalfW = 4, laneInset = 0.85,
}) {
  const n = laneCount || riders.length;
  const worldRiders = riders.map((r) => {
    const distM = Math.max(0, lerp(r.prev, r.cur, frac));
    return { id: r.id, idx: r.idx, isGhost: !!r.isGhost, x: laneX(r.idx, n, roadHalfW, laneInset), z: -distM, distM };
  });

  if (!worldRiders.length) {
    return { riders: [], leaderZ: 0, lastZ: 0, marks: [], gates: [] };
  }

  const dists = worldRiders.map((r) => r.distM);
  const leaderM = Math.max(...dists);
  const lastM = Math.min(...dists);
  const leaderZ = -leaderM;
  const lastZ = -lastM;

  // Metre marks: from (leader - fogFarM, clamped ≥0) to (leader + aheadM), at minor spacing.
  const marks = [];
  const startM = Math.max(0, Math.ceil((leaderM - fogFarM) / gridMinorM) * gridMinorM);
  const endM = leaderM + aheadM;
  const majorEvery = Math.max(1, Math.round(gridMajorM / gridMinorM));
  for (let m = startM; m <= endM + 1e-6; m += gridMinorM) {
    const mr = Math.round(m / gridMinorM) * gridMinorM;
    const major = (mr / gridMinorM) % majorEvery === 0;
    marks.push({ z: -mr, m: mr, major, label: major ? `${mr}m` : null });
  }

  // Gates: lap multiples across the visible window (behind + ahead), never past finish; + finish.
  const gates = [];
  const lap = Number.isFinite(lapLengthM) && lapLengthM > 0 ? lapLengthM : 0;
  if (lap > 0) {
    const finishCap = Number.isFinite(finishM) && finishM > 0 ? finishM : Infinity;
    const nearM = Math.max(0, leaderM - fogFarM);
    const farM = Math.min(leaderM + aheadM, finishCap);
    const firstN = Math.max(1, Math.ceil(nearM / lap));
    for (let k = firstN; k * lap <= farM + 1e-6; k++) {
      const d = k * lap;
      if (Math.abs(d - finishCap) < 1e-6) continue; // finish drawn as its own gate
      gates.push({ z: -d, lap: k, isFinish: false, label: `LAP ${k}` });
    }
  }
  if (Number.isFinite(finishM) && finishM > 0) {
    gates.push({ z: -finishM, lap: null, isFinish: true, label: 'FINISH' });
  }

  return { riders: worldRiders, leaderZ, lastZ, marks, gates };
}

export default povWorld;
```

- [ ] **Step 4: Run to verify pass**

Run: `cd /opt/Code/DaylightStation && ./node_modules/.bin/vitest run --config vitest.config.mjs frontend/src/modules/Fitness/lib/cycleGame/povWorld.test.js`
Expected: PASS (all cases).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/modules/Fitness/lib/cycleGame/povWorld.js frontend/src/modules/Fitness/lib/cycleGame/povWorld.test.js
git commit -m "feat(cycle-game): povWorld — pure race-data → 3D world mapping (riders, marks, gates)"
```

---

### Task 3: `povFollowCam` — the bounding box to frame (pure)

**Files:**
- Create: `frontend/src/modules/Fitness/lib/cycleGame/povFollowCam.js`
- Test: `frontend/src/modules/Fitness/lib/cycleGame/povFollowCam.test.js`

**Interface:**
```
povFollowCam({ leaderZ, lastZ, aheadM = AHEAD_M, minSpanM = MIN_SPAN_M, roadHalfW = ROAD_HALF_W, groundBand = 1.5 })
  → { min: { x, y, z }, max: { x, y, z } }
```
`leaderZ`/`lastZ` are negative (further = more negative). The frame must include
`aheadM` of road ahead of the leader (more negative than leaderZ) and the min-span
cap keeps a bunched field from over-zooming.

- [ ] **Step 1: Write the failing tests**

```js
import { describe, it, expect } from 'vitest';
import { povFollowCam } from './povFollowCam.js';

describe('povFollowCam', () => {
  it('spans from ahead-of-leader to last place', () => {
    const box = povFollowCam({ leaderZ: -100, lastZ: -40, aheadM: 25, minSpanM: 20, roadHalfW: 4 });
    expect(box.min.z).toBeCloseTo(-125); // leaderZ - aheadM (most negative)
    expect(box.max.z).toBeCloseTo(-40);  // lastZ (least negative)
  });

  it('uses ±roadHalfW for x', () => {
    const box = povFollowCam({ leaderZ: -50, lastZ: -50, roadHalfW: 4 });
    expect(box.min.x).toBeCloseTo(-4);
    expect(box.max.x).toBeCloseTo(4);
  });

  it('expands a bunched field to minSpanM (max-zoom cap)', () => {
    // ahead-to-last span = (100-? ) here leader=last → raw span = aheadM = 25 ≥ 20, so no expand.
    const tight = povFollowCam({ leaderZ: -50, lastZ: -48, aheadM: 5, minSpanM: 20, roadHalfW: 4 });
    const span = tight.max.z - tight.min.z;
    expect(span).toBeCloseTo(20);
    // expansion is symmetric about the raw midpoint
    const rawMid = ((-50 - 5) + -48) / 2;
    expect((tight.min.z + tight.max.z) / 2).toBeCloseTo(rawMid);
  });

  it('does not shrink a spread field below its natural span', () => {
    const box = povFollowCam({ leaderZ: -200, lastZ: -40, aheadM: 25, minSpanM: 20, roadHalfW: 4 });
    expect(box.max.z - box.min.z).toBeCloseTo(185);
  });

  it('handles a single rider (leaderZ === lastZ)', () => {
    const box = povFollowCam({ leaderZ: -60, lastZ: -60, aheadM: 25, minSpanM: 20, roadHalfW: 4 });
    expect(box.min.z).toBeLessThan(box.max.z);
    expect(box.max.z - box.min.z).toBeCloseTo(25); // aheadM ≥ minSpanM
  });
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `cd /opt/Code/DaylightStation && ./node_modules/.bin/vitest run --config vitest.config.mjs frontend/src/modules/Fitness/lib/cycleGame/povFollowCam.test.js`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `povFollowCam.js`**

```js
/**
 * Axis-aligned bounding box for cameraControls.fitToBox to frame the field.
 * zFar = leaderZ - aheadM (road ahead of the leader → leader frames high).
 * zNear = lastZ. If the span is below minSpanM, expand symmetrically about its
 * midpoint so a bunched pack doesn't zoom past the cap. See the design spec.
 */
export function povFollowCam({ leaderZ, lastZ, aheadM = 25, minSpanM = 20, roadHalfW = 4, groundBand = 1.5 }) {
  let zFar = leaderZ - aheadM; // most negative
  let zNear = lastZ;           // least negative
  const span = zNear - zFar;
  if (span < minSpanM) {
    const mid = (zNear + zFar) / 2;
    zFar = mid - minSpanM / 2;
    zNear = mid + minSpanM / 2;
  }
  return {
    min: { x: -roadHalfW, y: -groundBand, z: zFar },
    max: { x: roadHalfW, y: groundBand, z: zNear },
  };
}

export default povFollowCam;
```

- [ ] **Step 4: Run to verify pass**

Run: `cd /opt/Code/DaylightStation && ./node_modules/.bin/vitest run --config vitest.config.mjs frontend/src/modules/Fitness/lib/cycleGame/povFollowCam.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/modules/Fitness/lib/cycleGame/povFollowCam.js frontend/src/modules/Fitness/lib/cycleGame/povFollowCam.test.js
git commit -m "feat(cycle-game): povFollowCam — fit-box framing with ahead headroom + min-span zoom cap"
```

---

### Task 4: Rewrite `PovGrid.jsx` — three.js scene + camera-controls + CSS2D avatars

**Files:**
- Rewrite: `frontend/src/modules/Fitness/widgets/CycleGame/panels/PovGrid.jsx`
- Rewrite: `frontend/src/modules/Fitness/widgets/CycleGame/panels/PovGrid.scss`

**Context for the implementer:** jsdom cannot run WebGL, so this file is NOT
unit-tested directly (the shell is tested in Task 5 with three mocked; the visuals
are kiosk-verified). Build defensively: every WebGL call guarded so a missing
context degrades to the avatar-only overlay, never throws. Follow the existing
component's structure (refs + one rAF loop; component child logger). Reuse
`tickFraction.js`, `lineColors.js`, `formatDistance.js`, `CircularUserAvatar`.

- [ ] **Step 1: Implement the shell + dynamic import + scene + rAF**

Key requirements (write complete, working code):

1. **Props & derived data** (unchanged contract):
   - `distOf(id) = max(0, riders[id]?.cumulativeDistanceM || 0)`
   - `movedIds = riderIds.filter((id) => distOf(id) > 0 && !riderLive[id]?.dnf)`
   - `colorOf(id) = LINE_COLORS[riderIds.indexOf(id) % LINE_COLORS.length]`
2. **Refs:** `rootRef` (the `race-pov` div), `glMountRef` (WebGL canvas host),
   `css2dMountRef` (CSS2D host), `markerEls` (`{id: HTMLElement}` for each card),
   `sceneRef` holding `{ THREE, renderer, css2dRenderer, scene, camera, controls,
   roadGroup, gateGroup, riderAnchors:{id:Object3D}, labelObjs, webgl:boolean }`,
   `tickRef` (`{ riders:[{id,idx,prev,cur,isGhost}], leaderPrev, leaderCur, tickAt }`),
   `prevDistRef`, `gateCfgRef = { lapLengthM, finishM }`, `logRef` (child logger).
3. **Constants** at top: `RACE_TICK_MS=1000`, `ROAD_HALF_W=4`, `LANE_INSET=0.85`,
   `GRID_MINOR_M=1`, `GRID_MAJOR_M=10`, `AHEAD_M=25`, `MIN_SPAN_M=20`,
   `FOG_FAR_M=220`, `SMOOTH_TIME=0.45`, `MIN_DIST=8`, `MAX_DIST=140`,
   neon colors `CYAN=0x21e6ff`, `MAGENTA=0xff40a0`, `GOLD=0xffc846`, `BG=0x05070d`.
4. **Tick capture effect** (runs each render, only on real change — mirror the old
   guard): build `tickRef.current.riders = movedIds.map((id, idx) => ({ id, idx,
   prev: finite(prevDist[id]) ? prevDist[id] : distOf(id), cur: distOf(id),
   isGhost: !!riders[id]?.isGhost }))`, set `leaderPrev/leaderCur` from the max cur
   (and previous leaderCur), `tickAt = performance.now()`; update `prevDistRef`.
5. **Scene-build effect** (mount once): `let alive = true; (async () => { try {
   const THREE = await import('three'); const { CSS2DRenderer, CSS2DObject } =
   await import('three/examples/jsm/renderers/CSS2DRenderer.js'); const CameraControls
   = (await import('camera-controls')).default; CameraControls.install({ THREE }); …
   build renderer/scene/camera/controls/road/gates… sceneRef.current = {…webgl:true};
   } catch (e) { logRef.current.warn('cycle_game.pov.webgl_unavailable', { reason:
   String(e?.message || e) }); sceneRef.current = { webgl:false }; } })();` Guard
   `if (!alive) dispose`. On cleanup: `alive=false`, dispose renderer/controls/scene,
   `logRef.current.info('cycle_game.pov.unmount', {})`.
   - Renderer: `new THREE.WebGLRenderer({ antialias:true, alpha:false })`,
     `setPixelRatio(devicePixelRatio)`, sized to the mount rect; `scene.background =
     new THREE.Color(BG)`; `scene.fog = new THREE.Fog(BG, MIN_DIST, FOG_FAR_M)`.
   - Camera: `new THREE.PerspectiveCamera(55, aspect, 0.1, 2000)`.
   - Controls: `new CameraControls(camera, renderer.domElement)`;
     `controls.smoothTime = SMOOTH_TIME`; `controls.minDistance = MIN_DIST`;
     `controls.maxDistance = MAX_DIST`; disable all user input
     (`controls.mouseButtons.left/right/wheel/middle = CameraControls.ACTION.NONE`,
     same for `touches`); lock polar to a low racing tilt
     (`controls.minPolarAngle = controls.maxPolarAngle = 1.15` rad ≈ 66°).
   - CSS2DRenderer sized to the mount, `domElement.style.position='absolute'`,
     `pointerEvents='none'`, appended to `css2dMountRef`.
   - `roadGroup`: rails as `LineSegments` (cyan, `LineBasicMaterial` + a faint
     additive second pass for glow); trusses + gates rebuilt each frame from
     `povWorld` output OR built once over a fixed Z range and repositioned — choose
     rebuild-each-frame of a small pooled set (≤ FOG_FAR_M/GRID_MINOR_M lines) for
     simplicity; majors brighter. Off-road major labels via `CSS2DObject` (a small
     `<div>` `Nm`) — pool + reposition.
   - `gateGroup`: arches (a `TorusGeometry` half or an arc via `EllipseCurve`)
     spanning the road; magenta laps / gold finish; `CSS2DObject` label.
   - Per moved rider: a `THREE.Object3D` anchor added to scene; attach a
     `CSS2DObject` wrapping the card DOM node (see Step 2 JSX) so it tracks the
     anchor. Store anchors in `riderAnchors`.
6. **ResizeObserver** on the root → resize renderer + css2dRenderer + camera aspect.
7. **rAF loop** (start after scene built; guard `webgl`):
   - `const now = performance.now(); const dt = min(0.064,(now-last)/1000); last=now;`
   - `frac = tickFraction(now, tickRef.tickAt, RACE_TICK_MS)`
   - `const world = povWorld({ riders: tickRef.riders, frac, laneCount:
     tickRef.riders.length, lapLengthM: gateCfg.lapLengthM, finishM:
     gateCfg.finishM, aheadM:AHEAD_M, gridMinorM:GRID_MINOR_M, gridMajorM:
     GRID_MAJOR_M, fogFarM:FOG_FAR_M, roadHalfW:ROAD_HALF_W, laneInset:LANE_INSET })`
   - position rider anchors from `world.riders` (`anchor.position.set(x, 0, z)`);
     hide anchors whose id is no longer present.
   - update trusses/labels/gates from `world.marks`/`world.gates` (reposition pooled
     line/label objects; set opacity/visible by whether in range).
   - `const b = povFollowCam({ leaderZ: world.leaderZ, lastZ: world.lastZ, aheadM:
     AHEAD_M, minSpanM: MIN_SPAN_M, roadHalfW: ROAD_HALF_W })`
   - `controls.fitToBox(new THREE.Box3(new THREE.Vector3(b.min.x,b.min.y,b.min.z),
     new THREE.Vector3(b.max.x,b.max.y,b.max.z)), true, { paddingTop:0.05,
     paddingBottom:0.05, paddingLeft:0.05, paddingRight:0.05 })`
   - `controls.update(dt)`
   - `renderer.render(scene, camera); css2dRenderer.render(scene, camera)`
   - **camera audit log** ~1 Hz (manual throttle, NOT `logger.sampled`): when
     `world.riders.length && now-lastCamLog>=1000` → `logRef.current.debug(
     'cycle_game.pov.camera', { camX,camY,camZ (camera.position rounded 1dp),
     tgtX,tgtY,tgtZ (controls.getTarget() rounded), distance: round(controls.distance,1),
     fov: camera.fov, boxSpanZ: round(b.max.z-b.min.z,1), leaderDistM:
     round(-world.leaderZ), riderCount: world.riders.length })`.
8. **Mount log:** after scene built, `logRef.current.info('cycle_game.pov.mount',
   { riderCount: movedIds.length, webgl: sceneRef.current.webgl })`.

- [ ] **Step 2: React render output (the DOM the CSS2D cards wrap)**

Render the same avatar cards as before, into a hidden host that the scene-build
effect adopts into `CSS2DObject`s (read each card node from `markerEls`):

```jsx
return (
  <div className="cg-pov" data-testid="race-pov" ref={rootRef}>
    <div className="cg-pov__gl" ref={glMountRef} aria-hidden="true" />
    <div className="cg-pov__css2d" ref={css2dMountRef} aria-hidden="true" />
    <div className="cg-pov__cards" aria-hidden="true">
      {movedIds.map((id) => {
        const color = colorOf(id);
        const isGhost = !!riders[id]?.isGhost;
        const live = riderLive[id] || {};
        return (
          <div key={id} className={`cg-pov__marker${isGhost ? ' is-ghost' : ''}`}
            data-testid="pov-marker" ref={(el) => { markerEls.current[id] = el; }}
            style={{ '--cg-pov-color': color }}>
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
```
The scene effect moves each `markerEls.current[id]` node into a `CSS2DObject`
attached to that rider's anchor (so three positions it). If `webgl` is false, leave
the cards in `.cg-pov__cards` (CSS centers them) as the degraded fallback.

- [ ] **Step 3: Rewrite `PovGrid.scss`**

- `.cg-pov` — `position:relative; width:100%; height:100%; overflow:hidden;`
- `.cg-pov__gl`, `.cg-pov__css2d` — `position:absolute; inset:0;`
- `.cg-pov__css2d` — `pointer-events:none;`
- `.cg-pov__marker` — the card layout (avatar + distance), `--cg-pov-color` accent;
  carry over the ghost styling and `.cg-pov__dist` from the old SCSS.
- `.cg-pov__cards` — when WebGL active these nodes are reparented by three, so this
  container only matters for the fallback: `position:absolute; inset:0; display:flex;
  align-items:center; justify-content:center; gap:…` (degraded centered row).

- [ ] **Step 4: Manual smoke (build only — no WebGL in node)**

Run: `cd frontend && npx vite build 2>&1 | tail -5`
Expected: build succeeds (three + camera-controls bundle into a dynamic chunk). If
it fails on `three/examples/jsm/...`, switch the CSS2DRenderer import to the
package path that resolves under the installed three version and note it.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/modules/Fitness/widgets/CycleGame/panels/PovGrid.jsx frontend/src/modules/Fitness/widgets/CycleGame/panels/PovGrid.scss
git commit -m "feat(cycle-game): PovGrid — three.js road + camera-controls follow-cam + CSS2D avatars"
```

---

### Task 5: Rewrite `PovGrid.test.jsx` — shell test with three mocked

**Files:**
- Rewrite: `frontend/src/modules/Fitness/widgets/CycleGame/panels/PovGrid.test.jsx`

**Context:** jsdom has no WebGL. Mock `three`, `three/examples/jsm/renderers/CSS2DRenderer.js`,
`camera-controls`, and `@/lib/logging/Logger.js` so the component mounts and we can
assert the DOM avatar overlay (the contract that matters for tests).

- [ ] **Step 1: Write the test**

```jsx
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';

// --- mocks: WebGL stack is inert under jsdom ---
vi.mock('@/lib/logging/Logger.js', () => ({
  default: () => ({ child: () => ({ debug() {}, info() {}, warn() {}, error() {} }) }),
}));
vi.mock('camera-controls', () => {
  class CC { constructor() { this.mouseButtons = {}; this.touches = {}; }
    static install() {} static ACTION = { NONE: 0 };
    fitToBox() {} update() {} getTarget() { return { x: 0, y: 0, z: 0 }; }
    dispose() {} }
  return { default: CC };
});
vi.mock('three/examples/jsm/renderers/CSS2DRenderer.js', () => ({
  CSS2DRenderer: class { constructor() { this.domElement = document.createElement('div'); } setSize() {} render() {} },
  CSS2DObject: class { constructor(el) { this.element = el; this.position = { set() {} }; } },
}));
vi.mock('three', () => {
  const V3 = class { constructor(x, y, z) { this.x = x; this.y = y; this.z = z; } set() { return this; } };
  return {
    WebGLRenderer: class { constructor() { this.domElement = document.createElement('canvas'); } setSize() {} setPixelRatio() {} render() {} dispose() {} },
    PerspectiveCamera: class { constructor() { this.position = new V3(0,0,0); this.fov = 55; } updateProjectionMatrix() {} },
    Scene: class { add() {} remove() {} }, Group: class { add() {} },
    Color: class {}, Fog: class {},
    Object3D: class { constructor() { this.position = new V3(0,0,0); } add() {} },
    Vector3: V3, Box3: class { constructor(a, b) { this.min = a; this.max = b; } },
    LineSegments: class { constructor() { this.position = new V3(0,0,0); } },
    BufferGeometry: class { setFromPoints() { return this; } setAttribute() {} dispose() {} },
    LineBasicMaterial: class {}, TorusGeometry: class {}, Mesh: class { constructor() { this.position = new V3(0,0,0); } },
    Float32BufferAttribute: class {}, EllipseCurve: class { getPOINTS() { return []; } getPoints() { return []; } },
  };
});

import PovGrid from './PovGrid.jsx';

const riders = {
  a: { displayName: 'Ada', cumulativeDistanceM: 120 },
  b: { displayName: 'Ben', cumulativeDistanceM: 80 },
  c: { displayName: 'Cy', cumulativeDistanceM: 0 }, // not moved
};

describe('PovGrid (three.js shell)', () => {
  beforeEach(() => cleanup());

  it('renders the race-pov root', () => {
    const { getByTestId } = render(<PovGrid riderIds={['a', 'b']} riders={riders} riderLive={{}} />);
    expect(getByTestId('race-pov')).toBeTruthy();
  });

  it('renders one card per moved, non-DNF rider', () => {
    const { getAllByTestId } = render(<PovGrid riderIds={['a', 'b', 'c']} riders={riders} riderLive={{}} />);
    expect(getAllByTestId('pov-marker')).toHaveLength(2); // c has 0 distance
  });

  it('excludes DNF riders', () => {
    const { getAllByTestId } = render(
      <PovGrid riderIds={['a', 'b']} riders={riders} riderLive={{ b: { dnf: true } }} />);
    expect(getAllByTestId('pov-marker')).toHaveLength(1);
  });

  it('marks ghost riders', () => {
    const field = { a: { displayName: 'Ada', cumulativeDistanceM: 50, isGhost: true } };
    const { getByTestId } = render(<PovGrid riderIds={['a']} riders={field} riderLive={{}} />);
    expect(getByTestId('pov-marker').className).toContain('is-ghost');
  });

  it('shows a distance label per card', () => {
    const { getByText } = render(<PovGrid riderIds={['a']} riders={{ a: { displayName: 'Ada', cumulativeDistanceM: 120 } }} riderLive={{}} />);
    expect(getByText(/120/)).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run**

Run: `cd /opt/Code/DaylightStation && ./node_modules/.bin/vitest run --config vitest.config.mjs frontend/src/modules/Fitness/widgets/CycleGame/panels/PovGrid.test.jsx`
Expected: PASS (5 cases). If the component's effects reference a three API not in
the mock, extend the mock minimally (do not change the component to satisfy the test).

- [ ] **Step 3: Commit**

```bash
git add frontend/src/modules/Fitness/widgets/CycleGame/panels/PovGrid.test.jsx
git commit -m "test(cycle-game): PovGrid shell test with three/camera-controls mocked"
```

---

### Task 6: Delete the dead Canvas2D POV modules + rewrite the README

**Files:**
- Delete: `lib/cycleGame/{povProjection,povFrame,povGates,povCamera,povCameraDynamics,povRails,povCanvasScene,leaderAnchoredZoom,useLeaderAnchoredZoom}.js` + each `.test.js`
- Rewrite: `widgets/CycleGame/panels/PovGrid.README.md`

- [ ] **Step 1: Confirm nothing else imports them**

Run:
```bash
cd /opt/Code/DaylightStation/frontend/src/modules/Fitness
grep -rIl -E "povProjection|povFrame|povGates|povCamera|povCameraDynamics|povRails|povCanvasScene|leaderAnchoredZoom|useLeaderAnchoredZoom" . | grep -vE "lib/cycleGame/(povProjection|povFrame|povGates|povCamera|povCameraDynamics|povRails|povCanvasScene|leaderAnchoredZoom|useLeaderAnchoredZoom)\.(js|test\.js)$"
```
Expected: no output (only the files being deleted reference each other). If
anything else shows up, stop and report.

- [ ] **Step 2: Delete the files**

```bash
cd /opt/Code/DaylightStation/frontend/src/modules/Fitness/lib/cycleGame
git rm povProjection.js povProjection.test.js povFrame.js povFrame.test.js \
  povGates.js povGates.test.js povCamera.js povCamera.test.js \
  povCameraDynamics.js povCameraDynamics.test.js povRails.js povRails.test.js \
  povCanvasScene.js povCanvasScene.test.js leaderAnchoredZoom.js leaderAnchoredZoom.test.js \
  useLeaderAnchoredZoom.js
# (useLeaderAnchoredZoom has no test file; remove only what exists — adjust if git rm errors)
```

- [ ] **Step 3: Rewrite the README**

Replace `PovGrid.README.md` with a three.js-oriented reviewer note: the renderer is
a three.js `WebGLRenderer` road + `camera-controls` follow-cam + `CSS2DRenderer`
avatar cards; all race→world math is in `povWorld.js`/`povFollowCam.js` (unit-tested);
the camera frames the field via `fitToBox(box, true)` each frame (smooth + capped by
`smoothTime`/`min,maxDistance`); WebGL motion is kiosk-verified via the
`cycle_game.pov.camera` audit log; three+camera-controls are dynamic-imported.

- [ ] **Step 4: Run the full cycle-game suite**

Run: `cd /opt/Code/DaylightStation && ./node_modules/.bin/vitest run --config vitest.config.mjs frontend/src/modules/Fitness/lib/cycleGame frontend/src/modules/Fitness/widgets/CycleGame`
Expected: PASS, with the deleted modules' tests gone and `povWorld`/`povFollowCam`/`PovGrid` green.

- [ ] **Step 5: Commit**

```bash
git add -A frontend/src/modules/Fitness/lib/cycleGame frontend/src/modules/Fitness/widgets/CycleGame/panels/PovGrid.README.md
git commit -m "refactor(cycle-game): remove Canvas2D POV modules superseded by three.js renderer"
```

---

### Task 7: Full build + lint gate

**Files:** none (verification)

- [ ] **Step 1: Vite production build**

Run: `cd frontend && npx vite build 2>&1 | tail -15`
Expected: success; a separate chunk contains three.js (confirm it is NOT in the main
fitness entry chunk — dynamic import worked).

- [ ] **Step 2: Lint the changed files**

Run: `cd frontend && npx eslint src/modules/Fitness/widgets/CycleGame/panels/PovGrid.jsx src/modules/Fitness/lib/cycleGame/povWorld.js src/modules/Fitness/lib/cycleGame/povFollowCam.js`
Expected: clean (fix any issues, re-run).

- [ ] **Step 3: Commit (only if lint auto-fixes changed files)**

```bash
git add -A && git commit -m "chore(cycle-game): lint fixes for three.js POV" || echo "nothing to commit"
```

---

## Self-review (against spec)

- ✅ Smooth follow / cap / no-whiplash → `fitToBox(box, true)` + `smoothTime` + `min/maxDistance` (Task 4).
- ✅ Leader top-third + road ahead → `AHEAD_M` headroom in `povFollowCam` (Task 3).
- ✅ DNF excluded → caller `movedIds` filter + `povWorld` tolerant (Tasks 2, 4).
- ✅ 1 m/10 m marks + major labels → `povWorld.marks` (Task 2), CSS2D labels (Task 4).
- ✅ Lap/finish gates → `povWorld.gates` (Task 2), arches (Task 4).
- ✅ DOM telemetry cards → CSS2DObject wrapping `CircularUserAvatar` (Task 4, 5).
- ✅ Vanishing-point crowding → real perspective + `THREE.Fog` (Task 4); no heuristic.
- ✅ Camera audit logging → `cycle_game.pov.camera` ~1 Hz manual throttle (Task 4); mount/unmount/webgl_unavailable.
- ✅ Dynamic import / bundle → `await import('three'|'camera-controls')` (Task 4); chunk check (Task 7).
- ✅ Delete dead modules → Task 6.
- ✅ Tests → `povWorld`/`povFollowCam` unit (Tasks 2,3); `PovGrid` shell mocked (Task 5).
- ✅ Fallback → webgl=false avatar-only + warn (Task 4).
