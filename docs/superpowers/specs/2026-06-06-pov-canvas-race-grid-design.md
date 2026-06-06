# Canvas2D POV Race Grid — Design

**Date:** 2026-06-06
**Status:** Approved (design); pending implementation plan
**Area:** Fitness / Cycle Game / `CycleGame/panels/PovGrid`

## Problem

The POV road panel (`PovGrid`) renders the wireframe race road by transforming
~50 `hline` `<div>`s plus an SVG rail fan, each its own compositor layer. With
~50 independently device-pixel-snapped layers, the grid shimmers/thrashes — a
large `farFrac` camera bob was masking it; removing the bob (to fix a separate
"jello" deformation) exposed it. The data feed is a clean 1 Hz and the
interpolation is position-continuous, so this is a **renderer** problem, not a
timing one: the multi-layer DOM-transform approach is the wrong foundation for a
dense pseudo-3D ("Mode-7 / Outrun") road.

## Goal

Rip and replace the POV renderer with a best-in-class **Canvas2D** scene: a
single-surface wireframe **grid plane**, a **dynamic/cinematic camera**, and
**DOM-overlay avatars** that sit exactly on the road — for the live race.

## Decisions (locked during brainstorming)

1. **Avatars: DOM overlay** (chosen over canvas-drawn after evaluating both).
   Reuse `CircularUserAvatar` (rich HR gauge), each positioned every frame from
   the canvas camera. Few nodes (≤6) → no shimmer; accurate xy mapping; smooth.
   **Why not canvas-drawn:** our avatars are telemetry cards (photo + live HR
   gauge + zone ring + name/distance text), not sprites. Drawing them on canvas
   means re-implementing the async-loaded circular photo, the gauge arc, and
   crisp text at varying depth scales (canvas text/gauges blur when scaled
   small), and forking `CircularUserAvatar` into a second renderer — for the sole
   benefit of grid-in-front-of-a-far-avatar occlusion, which is rarely visible.
   DOM overlay keeps the polished component, crisp text, and GPU-composited
   motion; avatar-vs-avatar occlusion is handled by depth-ordered `z-index`, and
   fog/scale come from the same projection. Canvas owns the dense wireframe (its
   strength); DOM owns the few rich avatars (its strength).
2. **Scope: replace the `PovGrid` panel only.** Other panels (oval, distance
   chart, speedos) and `CycleRaceScreen` wiring unchanged.
3. **Camera: dynamic / cinematic.** FOV/zoom pulse on sprints + lateral lead/bank
   toward the leader/overtakes, spring-smoothed, applied rigidly to the whole
   scene (no jello).
4. **Aesthetic: refined Tron/neon.** Cyan neon wireframe, smoother — depth fog,
   crisp convergence, subtle glow.
5. **Reuse the proven 1/z ground-plane projection** (`povProjection`); layer
   dynamic camera params on top. Not a full matrix camera (overkill for a
   straight bunching road).

## Architecture

One `<canvas>` draws the whole wireframe road per frame. The **same per-frame
camera** that draws the grid also positions the DOM avatar overlay, so riders sit
on the road and cinematic camera moves apply to grid + riders coherently (rigid).
This is a render-layer swap + camera upgrade — the upstream data flow, zoom, and
interpolation are unchanged.

### Components

| File | Responsibility | Action |
|------|----------------|--------|
| `CycleGame/panels/PovGrid.jsx` | Thin shell: `<canvas>` + avatar overlay layer; one rAF loop (camera → draw → position avatars). Keeps `data-testid="race-pov"` and props. | Rewrite in place |
| `lib/cycleGame/povCamera.js` | Camera value-object `{ farFrac, depthRatio, vanishX, zoom }` + `project(depthT, laneX, cam) → { x, y, scale, fog }`. Extends `povProjection`. SSOT for canvas + avatars. | Create |
| `lib/cycleGame/povCameraDynamics.js` | Pure: race-state → smoothed cinematic camera offsets (FOV/zoom pulse, lateral lead). Critically-damped easing. | Create |
| `lib/cycleGame/povCanvasScene.js` | Pure-ish draw fn `(ctx, camera, gridState, dpr)`: strokes rails + trusses with fog + dual-pass glow. | Create |
| `CycleGame/panels/PovGrid.scss` | Canvas full-bleed + avatar overlay layer. | Rewrite |
| `CycleGame/panels/PovGrid.README.md` | Update to the canvas/camera/overlay model. | Update |

### Reused verbatim
`leaderAnchoredZoom` (k / leaderDist), `tickFraction` + `povFrame` (1 Hz→60fps
interpolation), `povRails` (rail lane geometry — now drawn, not SVG'd),
`lineColors`, `formatDistance`, `CircularUserAvatar`.

## Data flow

```
riders (1 Hz cumulativeDistanceM) + riderLive (HR/avatar/zone)
  → useLeaderAnchoredZoom → { k, leaderDist }
  → per-tick capture (roll cur→prev, tickAt)          [unchanged pattern]
  → rAF loop (mounts once):
       frac = tickFraction(now, tickAt, 1000)
       interpolate leader + riders (povFrame)
       camera = applyDynamics(baseCamera, cameraDynamics(raceState))
       povCanvasScene(ctx, camera, gridState, dpr)     // draw rails + trusses
       for each rider: project → write transform on its avatar DOM node
```

## The camera

### Projection (`povCamera.js`)
Keeps the 1/z ground-plane model: depth `t∈[0,1]` (0 near/bottom, 1 far/horizon),
`r = 1/z`, screen-Y and horizontal scale linear in `r`. Camera object adds:
- `vanishX` — horizontal vanishing-point x (default 50; shifted by lateral lead).
- `zoom` / `depthRatio` — perspective strength (modulated by FOV pulse).
- `farFrac` — horizon screen-Y (fixed; the grid does not breathe).

`project(t, laneX, cam) → { x: vanishX + (laneX - vanishX) * depthScale(t), y: screenY(t), scale, fog }`.
Both the canvas draw and the avatar positioning call this — identical camera, so
they never detach.

### Dynamics (`povCameraDynamics.js`)
Pure function of smoothed race signals → bounded camera offsets:
- **FOV/zoom pulse:** smoothed leader acceleration (Δ leaderDist over time) →
  bounded `depthRatio`/zoom modulation (a "speed" surge on sprints).
- **Lateral lead/bank:** target `vanishX` shifts toward the leader's lane / the
  site of an overtake; spring-smoothed so the road yaws gently.
- All offsets critically-damped (spring or exponential), bounded, and applied to
  the whole scene coherently — rigid, never deforming the grid independently
  (the "not jello" rule).

## Canvas rendering (`povCanvasScene.js`)
- Backing store sized to `devicePixelRatio × CSS` via `ResizeObserver`; context
  scaled by dpr; redraw on resize. Container resize re-rasterizes (never thrashes).
- **Rails:** the fixed lane lines (`povRails` geometry) projected through the
  camera, strokes converging to `vanishX` at the horizon.
- **Trusses:** the metre marks (10 m minor / 50 m major) bunching to the horizon;
  major = brighter/thicker.
- **Fog:** per-depth alpha via `bandOpacity` — faint at the horizon and the near
  edge, brightest mid-field.
- **Neon glow:** dual-pass stroke (wide faint + narrow bright) rather than
  `shadowBlur` (cheaper at 60fps on the Shield). Glow strength tunable.
- All positions float-computed, rasterized once per frame → the multi-layer
  snap-shimmer is gone by construction.

## Avatar overlay
- A DOM layer (`position: absolute; inset: 0`) holds one `CircularUserAvatar` per
  rider (and ghost). Each frame, `project()` the rider's interpolated distance →
  write `transform: translate3d(x, y, 0) translate(-50%,-50%) scale(...)` on its
  node; `z-index` by depth so nearer riders occlude farther ones.
- Name + distance label travel with the avatar (existing markup).
- Few nodes → smooth, no shimmer.

## Error handling / edge cases
- No riders moved (all 0 m): render the empty road, no avatars (current behavior).
- `riderLive` missing for a rider: fall back to colour ring only (as today).
- Canvas/2D context unavailable (jsdom/old engine): guard — skip drawing, still
  mount the element + overlay so structure tests pass.
- Resize to 0 / hidden panel: guard against 0-size backing store.

## Testing
- **Unit (vitest):**
  - `povCamera.project` — monotonic depth, lane convergence to `vanishX`, scale
    falloff, `vanishX` shift behaves.
  - `povCameraDynamics` — offsets bounded; a step input produces a smooth,
    settling (not oscillating/overshooting unboundedly) response.
  - `povCanvasScene` — against a mock 2D context: strokes the expected segment
    count, applies fog falloff (alpha decreases toward horizon), dual-pass glow.
  - Existing `povProjection` / `povFrame` / `leaderAnchoredZoom` / `povRails`
    tests stay green.
- **`PovGrid.test.jsx`** — rewritten: asserts a `<canvas>` is present and one
  avatar overlay node per moved rider; the perf-contract assertions (no inline
  `top`/`left`) no longer apply to a canvas and are dropped.
- **Visual** — verified on the kiosk (paint flashing / a Performance trace), as
  the README already documents for motion. jsdom can't rasterize canvas.

## Out of scope (v1)
- Curved/hilly roads or a full matrix camera (1/z straight road only).
- Canvas-drawn avatars (DOM overlay chosen).
- Reworking other race panels or `CycleRaceScreen` layout.
- Background sky/horizon art beyond fog + glow (refined-Tron, not full Outrun).

## File structure summary

Create: `povCamera.js`, `povCameraDynamics.js`, `povCanvasScene.js` (+ tests).
Rewrite: `PovGrid.jsx`, `PovGrid.scss`, `PovGrid.test.jsx`, `PovGrid.README.md`.
Reuse: `povProjection`, `povRails`, `povFrame`, `leaderAnchoredZoom`,
`tickFraction`, `lineColors`, `formatDistance`, `CircularUserAvatar`.
Removed from `PovGrid.jsx`: the 50-`hline` pool, the SVG rail fan, `cqw/cqh`
positioning.
