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
never pinned in place. Each major (10 m) gridline is labelled off the road's left
edge; lap/finish gates are arches the avatars pass through.

## Never loses anyone (audit C5)

Four cooperating mechanisms guarantee the person you're chasing never leaves the
screen and always has a labelled road:

- **Gap compression** (`povWorld.displayGap` / `displayDist`) — a rider more than
  ~100 m ahead of the camera anchor (the trailing framed rider) is displayed at a
  logarithmically compressed distance, so a far leader renders on-screen as a
  readable card instead of fogging out at the `MAX_DIST` dolly cap. Identity inside
  the 100 m window, so ordinary close racing is untouched; **true metres are
  preserved** in `distM` / `leaderM` (only the *displayed* z compresses). The card
  scale floor is raised to `0.45` so a compressed leader stays a card, not a dot.
- **Rider-anchored road** — metre marks + lap/finish gates generate across
  `[lastPlaceM − BEHIND_M, leaderM + AHEAD_M]` (not leader-anchored), so the
  trailing rider — whom the camera follows — always rides a labelled road with lap
  arches. Gate z is compressed identically, so a gate stays under the rider crossing
  it.
- **Fog scales with the window** — `scene.fog.far` and the grid shader's `uFogFar`
  are raised each frame to always cover the compressed leader, so it's a visible
  card, never a fog silhouette.
- **Horizon leader chip** (`povFollowCam.horizonChipState`) — when the *true* gap
  outruns the near window, a fixed-size, plate-styled `LEADER +N m` chip is pinned
  high-centre (hysteresis: show > 120 m, hide < 108 m — no boundary flicker).

## Start-line lineup

ALL non-DNF riders (incl. ghosts and not-yet-moved riders parked at `z = 0`) render
from mount, so the road is never empty at GO. The `distM > 0` exclusion now applies
**only to camera framing** and **only after a 5 s start grace** — before that the
whole start line is framed. An initial `setLookAt` fires on mount so the first
rendered frame is already framed (no unframed pop-in). A DNF rider is off the course
entirely.

## Rank + gap badges

Each card carries a **fixed-screen-size** badge (`povWorld.povBadges`) — rank
ordinal + gap-to-next-above ("2nd · −12 m"), lane-colour plate — pinned just below
the avatar by the rAF loop and **not** depth-scaled, so the "who am I chasing"
readout is legible even for a tiny, far leader. Rank/gap mirror the StandingsTower
(T8) off the same container-forwarded live `standings()` placement. The old
depth-scaled absolute-distance label under the avatar is removed (superseded).

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

- **Pure math, headless:** `povWorld.test.js` (x/z mapping, lane spread, gap
  compression identity+monotonicity, rider-anchored mark/gate span, start-line
  parking, `povBadges` rank/gap text) and `povFollowCam.test.js` (ahead headroom,
  min-span cap, single-rider, `horizonChipState` hysteresis).
- **`PovGrid.test.jsx`** renders with three + camera-controls mocked (jsdom has no
  WebGL) and asserts the React-owned overlay: a card per non-DNF rider (incl.
  parked start-line riders), ghost class, DNF hidden, rank/gap badge text, horizon
  chip element.
- **WebGL motion + look** (smooth follow, zoom cap, fog, neon, gates) are verified on
  the **garage Firefox kiosk** via the `cycle_game.pov.camera` audit log + visual
  inspection — jsdom cannot rasterize WebGL.
