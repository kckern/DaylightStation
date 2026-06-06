# PovGrid — the three.js POV race road (reviewer notes)

**Component:** `PovGrid.jsx` (`data-testid="race-pov"`) — the first-person
"Cruis'n-USA" standings road in the cycle race screen (the `povGrid` panel slot in
`CycleRaceScreen`).

This panel is a **three.js WebGL road with a projected DOM overlay**. The neon grid
(rails + metre trusses) and the lap/finish arches are drawn in true 3D by a
`WebGLRenderer`; a [`camera-controls`](https://github.com/yomotsu/camera-controls)
follow-cam frames the field each frame; the rider avatar cards and the metre / gate
labels are positioned by projecting their 3D world points to screen, so they ride
the road with crisp text and stay React-owned.

## Why three.js + camera-controls

> The previous renderer hand-rolled **both** a pseudo-3D projection **and** a smooth
> follow camera (leader-anchored zoom, hysteresis rezoom, FOV/vanishX dynamics). The
> camera was where every bug lived: whiplash zoom/pan, riders pinned while the grid
> morphed, tick crowding at the vanishing point, rezoom "rug pulls". A smooth, damped,
> auto-framing camera is a solved, packaged problem.

- **three.js** gives a real `PerspectiveCamera` + grid: perspective + `THREE.Fog`
  produce depth bunching and far-line fade for free — no 1/z math, no
  vanishing-point crowding heuristics.
- **camera-controls** gives the damped follow-cam: `smoothTime` (damping → no
  whiplash) and `minDistance`/`maxDistance` (the max-zoom cap). The camera is driven
  by `controls.setLookAt(...)` each frame toward a position derived from the field's
  framing box, eased by `smoothTime`.

The road renderer stays bespoke (no library ships a racing road), but the *camera* —
the hard part — is now battle-tested library code.

## Files

| File | Role |
|---|---|
| `PovGrid.jsx` | Shell: dynamic-imports three + camera-controls, builds the scene once, runs one rAF loop (interpolate → frame → render → project overlay). |
| `PovGrid.scss` | WebGL canvas + label/card overlay layers, full-bleed. |
| `lib/cycleGame/povWorld.js` | **Pure.** Race data → world coords: rider x/z, metre marks (1 m / 10 m, majors labelled), lap/finish gates. Unit-tested. |
| `lib/cycleGame/povFollowCam.js` | **Pure.** The framing box: last-place → leader + `AHEAD_M` of road ahead, with a `MIN_SPAN_M` cap. Unit-tested. |
| `lib/cycleGame/tickFraction.js` | 1 Hz → 60 fps interpolation clock (shared). |
| `lib/cycleGame/lineColors.js`, `formatDistance.js` | Per-rider colour + distance formatting (shared). |

## How it runs

```
per 1 Hz tick (React render):
  capture { riders:[{id,idx,prev,cur,isGhost}], tickAt } into a ref (only on change)

per animation frame (rAF, mounted once):
  frac  = tickFraction(now, tickAt, RACE_TICK_MS)
  world = povWorld({ riders, frac, lapLengthM, finishM, ... })   // pure: x/z, marks, gates
  writeTrusses(world.marks); updateGates(world.gates)            // rewrite GL buffers
  box   = povFollowCam({ leaderZ, lastZ, AHEAD_M, MIN_SPAN_M })  // pure framing box
  controls.setLookAt(camFrom(box), lookAt(box), true)           // eased follow (smoothTime)
  controls.update(dt); renderer.render(scene, camera)
  updateMajorLabels(world.marks); positionCards(world.riders)    // project 3D → screen px
```

## Framing

The framing box spans last-place → `leader − AHEAD_M` (road drawn ahead of the
leader, so the leader sits in the **top third**, not at the screen edge). A bunched
pack is expanded to `MIN_SPAN_M` (and clamped by `controls.minDistance`) so close /
overtaking riders **cluster** — proximity is highlighted, not stretched across the
screen. `smoothTime` eases every re-frame, so there is no whiplash and riders are
never pinned in place. DNF / not-yet-moved riders are excluded entirely (a stalled
rider can't crush the scale). Each major (10 m) gridline is labelled off the road's
left edge; lap/finish gates are arches the avatars pass through.

## Camera audit logging

All camera motion is logged via the structured logger: `cycle_game.pov.camera` (a
manually-throttled ~1 Hz snapshot — camera position, target, distance, fov, leader
distance, rider count; skipped while idle), plus `cycle_game.pov.mount` /
`unmount` and a `cycle_game.pov.webgl_unavailable` warning if the GL context can't be
created. Note: a periodic *state snapshot* must not use `logger.sampled` — sampled
burns its per-minute budget on the neutral idle frames and never records the race.

## Bundle

`three` (~176 KB gz) and `camera-controls` (~10 KB gz) are **dynamic-imported** inside
the mount effect, so they land in their own chunks and load only when the race POV
mounts — they are absent from the fitness main entry chunk.

## Tests

- **Pure math, headless:** `povWorld.test.js` (x/z mapping, lane spread, DNF/non-moved
  exclusion, 1 m/10 m marks + labels + fog cull, lap/finish gates) and
  `povFollowCam.test.js` (ahead headroom, min-span cap, single-rider).
- **`PovGrid.test.jsx`** renders with three + camera-controls mocked (jsdom has no
  WebGL) and asserts the avatar overlay: one card per moved non-DNF rider, ghost
  class, DNF hidden, distance label.
- **WebGL motion + look** (smooth follow, zoom cap, fog, neon, gates) are verified on
  the **garage Firefox kiosk** via the `cycle_game.pov.camera` audit log + visual
  inspection — jsdom cannot rasterize WebGL.
