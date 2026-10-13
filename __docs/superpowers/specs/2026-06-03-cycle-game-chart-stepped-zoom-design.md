# CycleGame DistanceChart — Stepped Zoom-Out Camera + Lin/Log Grid (Design)

**Date:** 2026-06-03
**Component:** `frontend/src/modules/Fitness/widgets/CycleGame/panels/DistanceChart.jsx`
**Status:** Approved design, ready for implementation plan.

## Problem

The chart auto-fits **X** to the number of ticks (so the newest point is always slammed to the right edge) and **Y** continuously to the goal/leader distance. The result: lines look *pegged at the edges* and barely seem to move — you can't perceive growth/pace. We want a **stepped, doubling "zoom-out camera"**: a fixed starting window that the lines grow into, doubling out in clear 2× steps (with gridlines + a short animation) so motion is always visible. The existing **linear→log crowding transform** (which spreads competitors bunched near the finish) is *kept* and made more legible by having the gridlines morph with it.

## Design

Two **independent** mechanisms that compose:

### 1. Stepped window (the "camera")

A single shared integer **zoom level `L`** controls both axes (chosen design "B": both axes double together):

- X (time) window `T = X_BASE_S × 2ᴸ`, default `X_BASE_S = 30s`.
- Y (distance) window `D = Y_BASE_M × 2ᴸ`, default `Y_BASE_M = 250m`.
- **Trigger:** when the leader's distance ≥ `THRESHOLD × D` **or** elapsed ≥ `THRESHOLD × T` (whichever crosses first), `L` increments so both windows double. `THRESHOLD` default `0.9`. A single tick may jump more than one level if the data leaps; the level is computed, not stepped-by-one-blindly.
- **Monotonic:** `L` only ever increases during a race; it resets to 0 when a new race starts (component remounts / fresh `riders`).
- **Animation:** the SVG content transitions to the new scale over `ZOOM_ANIM_MS` (default `400ms`, ease-out), so the pull-back reads as one camera move. (CSS transition on the scaled group / the mapped coordinates.)

`xFor(i)` maps elapsed time (tick index × interval) into `[0, W]` over `[0, T]`; a point past `T` clamps to the right edge (only briefly, until the level doubles). `yFor(d)` maps distance into `[0, H]` over `[0, D]` using the active Y transform (below).

### 2. Y transform: linear ↔ log (kept)

Unchanged in spirit from today's `logRef`: linear by default, **sticky switch to log** when riders crowd near the top of the Y window (gap between adjacent leaders < a small fraction of `D`), with hysteresis so it doesn't flap. `yFor` applies the active transform over `[0, D]`. This is orthogonal to `L` (crowding ≠ approaching the top).

### 3. Gridlines (densifying, fixed-unit, bottom-capped, transform-aware)

- Drawn at multiples of `baseUnit × 2ᵏ`, where `k` is the smallest integer keeping on-screen spacing ≥ `GRID_MIN_PX` (default `32px`). So as `L` grows, the gridline unit **coarsens** (collapses the densest level) and lines never crowd below the pixel floor — a *bottom cap*, not a top cap.
- **Positioned through the active Y transform:** linear mode → evenly-spaced Y lines; log mode → lines compress toward the top, morphing (animated) on the lin↔log flip — so the grid itself signals the scale change alongside the line shapes.
- X gridlines are always linear (time doesn't crowd).
- **No axis labels** (gridlines convey scope visually).

### Unchanged

De-overlap terminus tags, officiating-event markers, lane colors, the `useFitGuard` overflow guard, log-crowding hysteresis logic.

## Architecture / units

- **New pure module `lib/cycleGame/chartZoom.js`** (unit-tested, no DOM):
  - `nextZoomLevel(prevLevel, { leaderDistanceM, elapsedS, xBaseS, yBaseM, threshold })` → the new monotonic level (≥ prevLevel): the smallest `L ≥ prevLevel` such that `leaderDistanceM < threshold × yBaseM × 2ᴸ` **and** `elapsedS < threshold × xBaseS × 2ᴸ` (i.e. grow `L` until both data points sit under the threshold of their windows).
  - `gridUnit(windowSpan, pxSpan, baseUnit, minPx)` → `baseUnit × 2ᵏ`, smallest `k` with `(baseUnit×2ᵏ / windowSpan) × pxSpan ≥ minPx`.
  - `gridValues(windowSpan, baseUnit, pxSpan, minPx)` → ascending array of data values `[0, unit, 2·unit, … ≤ windowSpan]` at the chosen unit.
- **`DistanceChart.jsx`** consumes the module: holds `L` in a sticky ref (monotonic, like `logRef`), computes `T`/`D`, redefines `xFor`/`yFor` over the windows, renders gridlines via `gridValues` mapped through `xFor`/`yFor`, and applies the transition. Tunables are module constants (override-ready for config later).

## Testing

- **`chartZoom.test.js` (vitest, pure):** `nextZoomLevel` is monotonic, doubles when data hits 90%, multi-steps on a leap, never decreases; `gridUnit` coarsens to respect `minPx`; `gridValues` returns the right values at a unit and never crowds below `minPx`.
- **`DistanceChart.test.jsx` (component):** at level 0 a small race renders gridlines and the line within the 30s/250m window (newest point not pegged at the right when under window); when distance exceeds 90% of `D`, the rendered Y scale reflects the doubled window (e.g. a known data point lands at the expected fraction); gridlines render (`data-testid` on grid group). Existing chart tests (race-line trim, event markers) stay green.

## Config / tunables (module constants, defaults)

`X_BASE_S = 30`, `Y_BASE_M = 250`, `THRESHOLD = 0.9`, `GRID_MIN_PX = 32`, `ZOOM_ANIM_MS = 400`.

## Out of scope

The OvalTrack "whole-race track" redesign (separately parked). No change to the engine, director, or other panels.
