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
same camera that draws the canvas (so they sit exactly on the road), `z-index` by
depth so nearer riders paint on top.

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
  for each marker: write transform on its avatar DOM node (z-index by depth, nearer on top)
```

## The camera & framing

`povProjection` gives the fixed 1/z ground plane (`screenY`, `depthScale`);
`povCamera` adds a shiftable `vanishX`. `povCameraDynamics` eases two bounded
offsets toward race-driven targets: **lateral lead** (vanishX leans toward the
leader's lane) and **FOV pulse** (`depthRatio` boosts on acceleration). Both ease
exponentially (no overshoot) and apply to the whole scene coherently — the grid
never deforms independently. `farFrac` is fixed: the road does not breathe.

**Framing.** The leader rests at `farFrac` ≈ **30%** (top third), *not* at the
vanishing point — the road continues **ahead** of them (`povFrame`/`povGates` emit
major marks + upcoming lap/finish gates at depth `t>1`, bounded by `cam.aheadT`,
fading toward the true horizon), so you can read what's coming. Last place is
anchored **low** (≈ bottom 20%) via the PovGrid-only zoom anchors (`ZOOM_CFG`:
lower `homePct`/`minGapM`), so the field fills the frame instead of crowding the
top. Each **major gridline is labeled** with its metre value just off the road's
left edge (`drawScene`).

**Camera audit logging.** All camera motion is logged via the structured logger:
`cycle_game.pov.camera` (a manually-throttled ~1 Hz snapshot of the live camera —
zoom `k`/`fovMul`/`depthRatio`, pan `vanishX`, dolly `leaderDist`; skipped while
idle) and `cycle_game.pov.rezoom` (on a held-`k` change). Note: a periodic *state
snapshot* must not use `logger.sampled` — sampled burns its per-minute budget on
the neutral idle frames and never records the race.

## Tests

- **Math, unit-tested headlessly:** `povCamera.test.js` (projection, vanishX
  shift), `povCameraDynamics.test.js` (bounded, smooth, settling),
  `povCanvasScene.test.js` (mock ctx: stroke counts, fog falloff), plus the
  retained `povProjection`/`povFrame`/`leaderAnchoredZoom`/`povRails` tests.
- **`PovGrid.test.jsx`** asserts structure (a `<canvas>` + the avatar overlay +
  one avatar per moved rider). jsdom can't rasterize canvas, so **the motion +
  look are verified on the kiosk** (a Performance trace showing per-frame work and
  a steady 60fps).
