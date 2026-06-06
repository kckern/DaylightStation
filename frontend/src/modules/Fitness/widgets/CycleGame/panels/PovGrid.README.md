# PovGrid — the POV road treadmill (reviewer notes)

**Component:** `PovGrid.jsx` (`data-testid="race-pov"`) — the vertical first-person
"Cruising-USA" standings road in the cycle race screen (right sidebar in ≤3-rider
mode, third top column in ≥4-rider mode).

This panel is a **60fps, compositor-only pseudo-3D treadmill**. The design splits cleanly:
**all the math lives in pure, unit-tested modules**, and the component is a thin shell that
renders a stable DOM once per tick and then drives motion **imperatively** with `transform`
and `opacity` only. If you're reviewing it, read this first, then the modules.

## The one rule (perf contract)

> **We animate `transform` and `opacity` only — never `top`/`left`/`width`/`height`.**
> The grid must **composite**, not repaint. There is **no CSS `perspective`/`rotateX`**: the
> depth is a `1/z` projection computed in JS and applied as `translate3d` + `scaleX`/`scale`,
> so nothing repaints through a 3D matrix. Verify with DevTools → Rendering → **Paint flashing**:
> during a race you should see only the line/marker layers compose, **no full-panel green repaint**.

(This replaces the previous implementation, which animated `top` with a `0.9s` CSS transition on
up to 80 nodes inside a `rotateX(38deg) preserve-3d` plane — layout + repaint-through-perspective
every frame. That was the cardinal perf defect; it is gone.)

## Files

| File | Role |
|---|---|
| `PovGrid.jsx` | Thin shell: renders the structure once/tick, runs one rAF loop that writes transforms. |
| `PovGrid.scss` | `container-type: size` (enables `cqw`/`cqh`), `contain: layout paint`, `will-change: transform`. No 3D, no transitions. |
| `../../../lib/cycleGame/povProjection.js` | **The camera.** `1/z` ground-plane projection: `screenY`, `depthScale`, `POV_CAMERA`. |
| `../../../lib/cycleGame/povFrame.js` | **Per-frame layout.** `computePovFrame(...)` interpolates + projects → screen positions. |
| `../../../lib/cycleGame/tickFraction.js` | **Timing.** `tickFraction(now, tickAt, tickMs)` — engine-time interpolation, self-correcting. |
| `../../../lib/cycleGame/leaderAnchoredZoom.js` | **Scaling/zoom.** Held-`k` hysteresis rezoom, `gridLines` (coarsens, never truncates). |

## Architecture (how it actually runs)

```
per 1 Hz tick (React render):
  useLeaderAnchoredZoom(distances) → { k, lines (world-metre marks), leaderDist }
  → capture { leaderPrev, leaderCur, k, lines, riders[{prev,cur,laneX}], tickAt } into a ref
  React renders: a FIXED pool of 24 hline <div>s (keyed by slot) + 1 marker/rider + a static SVG lane fan

per animation frame (rAF loop, mounted once):
  frac = tickFraction(now, tickAt, 1000)                  // 0→1 across the tick, saturates if overdue
  { lineSlots, markers } = computePovFrame({ ...tickRef, frac })
  for each hline slot:  el.style.transform = translate3d(0, y cqh, 0) scaleX(depthScale)
                        el.style.opacity   = fog(depth)
  for each marker:      el.style.transform = translate3d(x cqw, y cqh, 0) translate(-50%,-50%) scale(...)
```

**React owns structure; the rAF loop owns motion.** No `setState` per frame, so React never
re-reconciles during animation — the loop just mutates `style.transform` on refs.

### The camera (`povProjection.js`)

`leaderAnchoredZoom` already maps *metres-behind-leader* → a **linear** depth coord
`u ∈ [0, rightPct]` (leader near `rightPct`, near-camera near 0). The camera adds **only the
perspective**: normalize `t = u/rightPct` (0 near, 1 far/leader), let `z = 1 + (depthRatio−1)·t`,
and use `r = 1/z`. For a ground plane, **screen-Y and horizontal scale are both linear in `r = 1/z`**
(the standard projective result) — so far marks bunch toward the horizon and lanes converge,
from one ratio. Two meaningful constants, derived once for the 1280×720 kiosk:

- `farFrac` — where the leader/far-plane sits on screen (`0.10`, near the top).
- `depthRatio` — `zFar/zNear`; perspective strength (`6`). `1` would be flat (no 3D).

`screenY(0)=1` (near→bottom), `screenY(1)=farFrac` (leader→top); `depthScale(0)=1` (near, big),
`depthScale(1)=1/depthRatio` (far, small). The lane fan and per-marker `x` use `depthScale` to
converge lanes toward the vanishing point.

### Timing (`tickFraction.js`)

The engine ticks at **1 Hz**; motion is continuous via per-frame interpolation of `leaderDist`
(and each rider) between the previous and current tick. `tickFraction` reads `performance.now()`
against the tick timestamp and **saturates at 1 when a tick is overdue** — so a stalled tick parks
the road at the latest data instead of freezing mid-glide. (This is the same idea as
`DistanceChart`'s rAF clock; here it's a shared primitive.)

### Scaling / grid (`leaderAnchoredZoom.js`)

`k` (width-fraction per metre) is held in a ref and only recomputed on a **rezoom** — when the
last-place rider drifts out of the `[0.15, 0.33]` hysteresis band, `k` is recomputed to put it back
at `homePct 0.25`. `pickGridMeters` steps the metre interval to a nice 1/2/5×10ⁿ so density encodes
the zoom level. `gridLines` **coarsens** (doubles the interval) to keep the whole visible span within
`maxLines` (24) — it never truncates a road edge.

## What's deliberately NOT here (YAGNI)

- **No `<canvas>`.** At ≤24 lines + ≤6 markers, transformed `<div>`s composite fine and keep the
  real DOM avatars (`CircularUserAvatar`). Canvas would be a bigger rewrite for no win.
- **No general camera rig.** One fixed camera; `farFrac`/`depthRatio` are constants, not props.
- **No `prefers-reduced-motion` branch** (the kiosk doesn't set it). If ever needed, freeze `frac` at 1.
- **`DistanceChart` was not refactored** to share the clock — `tickFraction` is a new shared primitive
  PovGrid uses; the chart keeps its own working `tickFrac`.

## What to scrutinize (review checklist)

1. **Layer count / overdraw.** 24 hlines + N markers each get a compositor layer (`will-change`).
   On the Shield, confirm the layer count is sane (DevTools → Layers) and the marker `box-shadow`
   glow rasterizes **once** per marker (it only transforms after that, never repaints). If layer
   memory is a concern, drop `MAX_LINES` or gate `will-change`.
2. **`cqw`/`cqh` support.** Positioning uses container-query length units against
   `container-type: size` on `.cg-pov`. Requires Chromium ≥ 105 (the kiosk is well past this). The
   `povFrame` output is unit-agnostic fractions, so a `ResizeObserver`→px fallback is trivial if a
   target ever lacks it.
3. **Tick-boundary capture.** The capture `useEffect` runs every render but early-returns unless
   `leaderDist` changed — verify a stray parent re-render doesn't reset `tickAt` (it shouldn't).
4. **Projection constants.** `depthRatio: 6` / `farFrac: 0.10` are tuned, not derived from a real
   focal length. Fine for one fixed camera; if the look needs adjusting, those are the two knobs.
5. **Negative / past-leader grid marks.** `gridLines` can emit marks slightly before the start or
   just past the leader when very zoomed out — intentional (a continuous road), and they project to
   the near/far edges. Confirm that reads as "road," not artifact.
6. **Lane fan vs. converging markers.** Lanes are a static SVG fan (drawn once, no per-frame cost);
   marker `x` converges via `depthScale`. Confirm a marker tracks its fan line at all depths.

## Tests

- **Math is unit-tested headlessly:** `tickFraction.test.js`, `povProjection.test.js`
  (monotonic, far-bunching, lane scale), `povFrame.test.js` (interpolation + projection),
  `leaderAnchoredZoom.test.js` (coarsening, no truncation).
- **`PovGrid.test.jsx`** asserts *structure* (24-slot pool, lane fan, one marker/rider) and guards the
  perf contract (no inline `top`/`left`). jsdom can't run transforms or rAF timing, so **the motion
  itself is verified on the kiosk** (paint flashing + a Performance trace showing per-frame work in
  *Composite Layers*, holding 60fps).
