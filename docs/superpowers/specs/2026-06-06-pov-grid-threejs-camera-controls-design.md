# POV Grid — three.js + camera-controls rewrite (design spec)

**Date:** 2026-06-06
**Status:** Approved (design)
**Supersedes:** the Canvas2D `PovGrid` renderer (`povProjection`/`povFrame`/`povGates`/`povCamera`/`povCameraDynamics`/`povRails`/`povCanvasScene`/`leaderAnchoredZoom`).

## Why

The Canvas2D POV road hand-rolls its own pseudo-3D projection **and** its own
camera (leader-anchored zoom, hysteresis rezoom, FOV/vanishX dynamics). The
camera is where every recent bug lives: whiplash zoom/pan, riders appearing
pinned while the grid morphs, tick-line crowding at the vanishing point,
"rug-pull" rezooms every 1–2 s. These are all symptoms of re-implementing a
*smooth follow camera* by hand.

A smooth, damped, auto-framing camera is a solved, packaged problem. We adopt:

- **[three.js](https://threejs.org)** — a real `PerspectiveCamera` + grid in true
  3D. Perspective + fog give depth bunching and far-line fade for free (no 1/z
  math, no vanishing-point crowding heuristics).
- **[camera-controls](https://github.com/yomotsu/camera-controls)** (yomotsu) — a
  damped camera with `fitToBox`/`fitToSphere` (smoothly frame a bounding volume),
  `smoothTime` (damping → no whiplash), and `minDistance`/`maxDistance` (the
  max-zoom cap). Our entire camera behaviour becomes "fit the field's box each
  frame, eased, clamped."

The road renderer itself stays bespoke (no library ships a racing road — every
reference implementation is hand-rolled), but the *camera* — the hard part — is
now battle-tested library code.

## Scope

Rewrite **only** the `povGrid` panel. Out of scope: `DistanceChart`, `OvalTrack`,
the container/data pipeline, governance, audio. Contract preserved:

- Component: `panels/PovGrid.jsx`, default export `PovGrid`.
- Props (unchanged): `riderIds: string[]`, `riders: { [id]: { cumulativeDistanceM, displayName, isGhost } }`,
  `riderLive: { [id]: { avatarSrc, heartRate, zoneId, zoneColor, dnf } }`,
  `lapLengthM: number`, `finishM: number|null`.
- Mounted by `CycleRaceScreen` as the `povGrid` slot — call site unchanged.
- `data-testid="race-pov"` on the root; `data-testid="pov-marker"` on each avatar card.
- 1 Hz data tick (`RACE_TICK_MS`) interpolated to 60 fps (reuse `tickFraction.js`).

## Architecture

```
PovGrid.jsx  (React shell)
  ├─ dynamic import('three') + import('camera-controls')   ← ~165 KB loaded only when POV mounts
  ├─ on mount: build scene once
  │     WebGLRenderer (DPR-aware, THREE.Fog)        → the road canvas
  │     PerspectiveCamera ── CameraControls          → all camera motion
  │     CSS2DRenderer (overlay)                       → DOM avatar cards
  │     road group  (rails + metre trusses, neon)
  │     gate group  (lap/finish arches + labels)
  │     per rider:  Object3D anchor + CSS2DObject(card)
  ├─ rAF loop (mounted once):
  │     frac = tickFraction(now, tickAt, RACE_TICK_MS)
  │     world = povWorld(...)            ← pure: distance→Z, lane→X, DNF excluded
  │     for each rider: anchor.position = interpolated (x, z); update gate/mark opacity by fog
  │     box  = povFollowCam(...)         ← pure: field bounds + ahead headroom + min-span cap
  │     cameraControls.fitToBox(box, true)   ← eased framing
  │     cameraControls.update(dt)            ← advance damping
  │     webglRenderer.render(scene, camera); css2dRenderer.render(scene, camera)
  │     ~1 Hz: log cycle_game.pov.camera snapshot
  └─ React render: <div race-pov> { webgl canvas mount, css2d mount, avatar cards as CSS2DObject sources }
```

### Pure, unit-tested modules (no three.js — just numbers)

**`lib/cycleGame/povWorld.js`** — maps race data → world coordinates.

```
povWorld({ riders, riderLive, leaderPrev, leaderCur, frac, laneCount,
           lapLengthM, finishM, aheadM, gridMinorM, gridMajorM, fogFarM })
  → {
      riders: [{ id, idx, x, z, distM, dnf:false }],   // DNF excluded entirely
      leaderZ, lastZ,
      marks:  [{ z, m, major:boolean, label:string|null }],  // metre trusses in view, majors labeled
      gates:  [{ z, lap:number|null, isFinish:boolean, label }],
    }
```

- **Coordinate convention:** world is metres. Rider at distance `d` sits at
  `z = -d` (road recedes into −Z; camera looks down −Z). `x` is the lane offset
  across the road, spread like the current `laneX`: single rider centred,
  otherwise evenly across the road half-width.
- **Lane spread:** `laneX(idx, n)` — n≤1 → centre (x=0); else evenly spaced across
  `[-ROAD_HALF, +ROAD_HALF]`.
- **DNF exclusion:** riders with `riderLive[id].dnf` truthy are omitted from
  `riders` (and therefore from the avatar overlay and the camera bounds).
- **Moved filter:** a rider with `cumulativeDistanceM <= 0` is omitted (matches
  current `movedIds`).
- **Marks:** metre marks from `0` up to `leader + aheadM` (or `fogFarM` behind),
  at `gridMinorM` spacing; `major = (m % gridMajorM === 0)`; majors get
  `label = "${m}m"`, minors `label = null`. Marks beyond `fogFarM` from the
  leader are omitted (fog would hide them).
- **Gates:** every `lapLengthM` multiple within the visible window (behind +
  ahead to `leader + aheadM`), never past `finishM`; plus a finish gate at
  `finishM` when set. `label = isFinish ? "FINISH" : "LAP ${lap}"`.
- **Interpolation:** `leader = lerp(leaderPrev, leaderCur, frac)`; per-rider
  `z = -lerp(prev, cur, frac)` (caller supplies prev/cur or povWorld lerps from a
  passed snapshot — keep the lerp here so it is unit-tested).

**`lib/cycleGame/povFollowCam.js`** — the box to frame.

```
povFollowCam({ riders, leaderZ, lastZ, aheadM, minSpanM, roadHalfW })
  → { min: {x,y,z}, max: {x,y,z} }   // an AABB for cameraControls.fitToBox
```

- The box spans `z ∈ [leaderZ - aheadM, lastZ]` (leader side gets `aheadM` of
  road ahead so the leader frames in the top third, not at the edge).
- **Min-span cap:** if `(lastZ - (leaderZ - aheadM)) < minSpanM`, expand
  symmetrically to `minSpanM` so a bunched pack does not zoom in past the cap
  (close riders cluster; proximity is highlighted, not stretched). This is the
  fit-box equivalent of the old `minGapM`; the hard pixel cap is also enforced by
  `cameraControls.minDistance`.
- `x ∈ [-roadHalfW, +roadHalfW]`, `y` a small fixed band (riders sit ~on the
  ground plane). Pure; returns plain numbers (caller wraps in `THREE.Box3`).

### Camera (camera-controls) configuration

- `smoothTime` ≈ 0.45 s (damping; tune on kiosk) — the single knob that kills
  whiplash. `draggingSmoothTime` irrelevant (no user drag).
- `minDistance` = the max-zoom cap (closest the camera may dolly — clusters near
  riders). `maxDistance` = farthest (whole field spread).
- `minPolarAngle`/`maxPolarAngle` fixed to a low, near-ground racing tilt so the
  camera always looks down the road (no orbit).
- `mouseButtons`/`touches` all set to `NONE` (kiosk; no user camera input).
- Per frame: `fitToBox(box, true)` then `update(dt)`. Re-targeting every frame +
  eased `update` = continuous smooth follow.

### Road, gates, avatars (three.js scene)

- **Rails:** `LineSegments` along Z at the fixed lane-edge X positions (6–10
  lines). Neon cyan, emissive, additive blend + a faint wider pass for glow.
- **Metre trusses:** `LineSegments` across X at each `marks[].z`; major lines
  brighter/thicker than minor. Off-road CSS2D `Nm` label per major (reuse the
  CSS2D layer). Fog fades far lines (no vanishing-point crowding).
- **Gates:** an arch (half-torus or arc curve) across the road at each `gates[].z`;
  magenta for laps, gold for finish; CSS2D `LAP n` / `FINISH` label.
- **Avatars:** unchanged `CircularUserAvatar` card (name, avatarSrc, heartRate,
  zoneId, zoneColor, `size=44`, `showGauge=false`, `showIndicator=false`) + a
  distance `<span>` + ghost class + `--cg-pov-color` var, wrapped in a
  `data-testid="pov-marker"` div, attached to the rider's anchor via `CSS2DObject`.
  CSS2D handles depth ordering and screen projection.

### Fog / depth

`THREE.Fog(bg, nearM, farM)` with `farM ≈ fogFarM`. Far rails, trusses, gates,
and avatars fade out — the depth cue and the density limiter in one.

## Error handling / fallback

- **No WebGL:** if `WebGLRenderer` construction throws or `getContext('webgl2')`
  is null (jsdom, headless, a broken GPU), skip the WebGL scene, render the avatar
  overlay only (CSS2D still works as plain DOM, or fall back to absolutely-
  positioned cards), and `logger.warn('cycle_game.pov.webgl_unavailable', …)`.
  The panel must never throw.
- **Empty field:** no moved riders → render the empty road (or nothing) without
  errors; camera holds a neutral framing.
- **Dynamic-import failure:** if `import('three')` rejects, log `error` and render
  the avatar-only fallback.

## Logging (per CLAUDE.md — ship with the feature)

- `info  cycle_game.pov.mount`   `{ riderCount, webgl: boolean }`
- `info  cycle_game.pov.unmount` `{}`
- `warn  cycle_game.pov.webgl_unavailable` `{ reason }`
- `debug cycle_game.pov.camera`  ~1 Hz manual throttle (NOT `logger.sampled` —
  sampled burns its budget on idle frames): `{ camX, camY, camZ, tgtX, tgtY, tgtZ,
  distance, fov, boxSpanZ, leaderDistM, riderCount }`.
- Component child logger via `useMemo`/ref: `getLogger().child({ component: 'pov-grid' })`.

## Bundle

`three` (~150 KB gz) + `camera-controls` (~15 KB gz) are **dynamic-imported**
inside `PovGrid` (a `useEffect` that `await import(...)`s before building the
scene). They are absent from the fitness main chunk until the race POV mounts.

## Testing

- **`povWorld.test.js`** (vitest, pure): distance→Z monotonic & negative; lane
  spread (1 rider centred, N evenly spread, symmetric); DNF excluded; non-moved
  excluded; marks span 0..leader+ahead at minor spacing with correct major flags
  & labels; far marks (> fogFarM) culled; gates at lap multiples behind+ahead,
  none past finish, finish gate present when set; interpolation by `frac`.
- **`povFollowCam.test.js`** (vitest, pure): box spans lastZ..leaderZ−aheadM;
  ahead headroom present; min-span cap expands a bunched field symmetrically;
  x bounds = ±roadHalfW; degenerate (1 rider) still yields a valid box.
- **`PovGrid.test.jsx`** (vitest + jsdom): mock `three`, `camera-controls`, and
  the CSS2D bits (jsdom has no WebGL). Assert the React shell renders
  `data-testid="race-pov"`, one `data-testid="pov-marker"` per **moved, non-DNF**
  rider, the ghost class on ghost riders, a distance label per card, and that a
  DNF / non-moved rider yields no card. Mock `@/lib/logging/Logger.js`.
- **Kiosk verification:** WebGL motion + look (smooth follow, cap, fog, gates,
  neon) verified on the garage Firefox via the `cycle_game.pov.camera` audit log
  and visual inspection — jsdom cannot rasterize WebGL.

## Files

| Action | Path |
|---|---|
| Rewrite | `frontend/src/modules/Fitness/widgets/CycleGame/panels/PovGrid.jsx` |
| Rewrite | `frontend/src/modules/Fitness/widgets/CycleGame/panels/PovGrid.scss` |
| Rewrite | `frontend/src/modules/Fitness/widgets/CycleGame/panels/PovGrid.README.md` |
| Rewrite | `frontend/src/modules/Fitness/widgets/CycleGame/panels/PovGrid.test.jsx` |
| Create | `frontend/src/modules/Fitness/lib/cycleGame/povWorld.js` (+ `.test.js`) |
| Create | `frontend/src/modules/Fitness/lib/cycleGame/povFollowCam.js` (+ `.test.js`) |
| Delete | `lib/cycleGame/povProjection.js`, `povFrame.js`, `povGates.js`, `povCamera.js`, `povCameraDynamics.js`, `povRails.js`, `povCanvasScene.js`, `leaderAnchoredZoom.js`, `useLeaderAnchoredZoom.js` + each `.test.js` |
| Keep | `lib/cycleGame/tickFraction.js`, `lineColors.js`, `formatDistance.js` |
| Modify | `frontend/package.json` (+ `three`, `+ camera-controls`); regenerate lockfile |

## Open tuning knobs (kiosk, post-build)

`smoothTime`, `minDistance`/`maxDistance`, `aheadM`, `minSpanM`, `fogFarM`, road
half-width, neon intensity, polar tilt. All centralized as named constants at the
top of `PovGrid.jsx` / the pure modules so they tune without restructuring.
