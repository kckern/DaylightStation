# Cycle Game — Experience Improvements Audit (6 items)

**Date:** 2026-06-06
**Scope:** Six tester-requested experience improvements to the Cycle **Game** (multi-rider
race HUD): ghost styling on the POV view, a leader medal on the speedometers, a ghost-picker
skip-step, POV avatar anti-aliasing, no-HR avatar treatment, and the distance-chart log scale.
*Not* the Cycle **Challenge** (governance).
**Method:** Four parallel code deep-dives across `widgets/CycleGame/**` and
`lib/cycleGame/**`, every load-bearing claim spot-verified against source. Cross-referenced
against the prior visualization audit `2026-06-04-cycle-game-race-visualization-audit.md`
(its F11/F13 directly overlap items 1 and 3). Today's race logs corroborate the no-HR /
cool-zone path (riders raced with `heartRate: 0` the whole time).
**Status:** Findings + recommended approach only. No code changed. Plans follow separately.

> **Architecture note (changed since 2026-06-04):** the spatial race view was rebuilt. The
> old `RacePistons` / `CameraZoom` / `Rankings` panels are gone; the **PovGrid** (a true-3D
> THREE.PerspectiveCamera "Tron road") is now the point-of-view renderer, alongside
> `OvalTrack`, `DistanceChart`, `SplitsChart`, and `SpeedoRow`. Several prior-audit file
> references no longer resolve; the locations below are against current `HEAD`.

---

## Summary

| # | Item | Verdict | Where it lives | Severity | Effort |
|---|------|---------|----------------|----------|--------|
| 1 | Ghost CSS missing on POV chart (sweep all avatar sites) | **Corroborated** | `PovGrid.jsx:414` / `PovGrid.scss:30` | High | S (POV) + S (sweep) |
| 2 | 🥇 medal on current leader's odometer | **Refined** — data already exists, just gated to finishers | `CycleGameContainer.jsx:1303/1347`, `CycleSpeedometer.jsx:162` | Med | S |
| 3 | Ghost picker: skip rider step when 1 rider; ghost styling | **Corroborated + refined** | `home/GhostPicker.jsx:52-63` | Med | S |
| 4 | POV avatars look blocky (anti-alias) | **Corroborated** — CSS upscaling a 44px raster | `PovGrid.jsx:320-322`, `:36` | Med | S–M |
| 5 | No-HR avatar: drop gauge, use rider color, no blue | **Corroborated + refined** | `CircularUserAvatar.jsx:123`, `CycleSpeedometer.jsx:133`, `CycleGameContainer.jsx:1343` | Med | M |
| 6 | Log scale not separating neck-and-neck; collision-prevention as crutch | **Corroborated — and the log math is backwards** | `DistanceChart.jsx:138-146`, `:210-247` | High | M |

> **Backbone:** items **1, 4, 5** all converge on `CircularUserAvatar` and its render sites,
> and item **3** shares the ghost-styling concern. Treat *"audit every avatar render site"*
> as one workstream (the sweep item 1 explicitly asked for) and hang 4/5 off it. Items **2**
> and **6** are localized and independent.

---

## The canonical ghost treatment (shared context for items 1 & 3)

There is exactly **one** ghost style, defined globally in `_cgTokens.scss:79-94`:

```scss
@mixin cg-ghost-img {
  filter: grayscale(1) sepia(0.6) hue-rotate(175deg) saturate(1.7) brightness(1.05) contrast(0.95);
}
.cg-ghost { … img { @include cg-ghost-img; } }   // tint when an <img> is INSIDE a .cg-ghost wrapper
img.cg-ghost { @include cg-ghost-img; }            // …or on a bare <img class="cg-ghost">
```

`CircularUserAvatar` has **no `isGhost` prop and no internal ghost branch** — ghost styling
is purely "did the caller put `cg-ghost` on (or around) the avatar `<img>`." That design is
fine, but it means every render site must opt in, and that's exactly where the inconsistency
lives. This is the same root cause the 2026-06-04 audit logged as **F11 (High)**; it is still
open and the rebuild moved (not fixed) it.

### Avatar render-site inventory (the "sweep")

| # | Site | File:line | Ghost cue today | Correct? |
|---|------|-----------|-----------------|----------|
| 1 | **POV chart** | `PovGrid.jsx:414-418` | `is-ghost` → **opacity 0.6 only** | ❌ no tint |
| 2 | Speedometer | `CycleSpeedometer.jsx:133` | wrapper `cg-ghost` | ✅ |
| 3 | Race results | `RaceResults.jsx:68` | wrapper `cg-ghost` | ✅ |
| 4 | Ready strip | `RiderReadyStrip.jsx:30-39` | n/a (pre-race, no ghosts) | n/a |
| 5 | History table | `home/HistoryTable.jsx:40,44` | bare `img.cg-ghost` | ✅ |
| 6 | Ghost picker (card + roster) | `home/GhostPicker.jsx:125,210` | wrapper `cg-ghost` | ✅ |

`DistanceChart` end-of-line tags are letter nodes, not avatars (`DistanceChart.jsx:408-413`),
with their own `is-ghost` (opacity/dash) — out of scope for the avatar sweep but worth noting
the chart ghost cue is also "opacity only," matching the POV gap.

**Net:** the *only* avatar site missing the real ghost tint is the **POV chart** (item 1).
The sweep the tester asked for confirms the others are already correct — so item 1 is a
one-site fix plus a guard test to keep all sites consistent.

---

## Item 1 — Ghost styling on the POV chart

**Finding (corroborated).** `PovGrid.jsx:414` tags the marker wrapper with `is-ghost`, and
`PovGrid.scss:30` defines `&.is-ghost { opacity: 0.6; }` — that's the entire POV ghost
treatment. The avatar `<img>` (inside `CircularUserAvatar` → `.avatar-core`) never receives
the `cg-ghost` filter, so POV ghosts are merely faded, never icy/grayscale like everywhere
else. Exactly the reported "ghost CSS not applied on the POV chart."

**Do ghosts render in the POV at all?** Verified end-to-end: ghost riders are in
`engineState.riders` (`isGhost` set from `ghostSeries`, `CycleRaceEngine.js:24`), their
`cumulativeDistanceM` is computed every tick (`_ghostDistanceAt`, `:56-64`, with a safe
`ghostIntervalS` fallback at `:48-50`), and PovGrid's `movedIds` gate (`distOf(id) > 0`,
`PovGrid.jsx:107`) therefore admits them once moving. So **the render path exists** — ghosts
*are* drawn as markers, just opacity-dimmed and untinted. **Tester decision:** use the
existing `.cg-ghost` standard, do not reinvent.

> ⚠️ **If ghosts appear to be literally absent from the POV** (not just unstyled), that is a
> separate visual bug the code review cannot see — most likely a 404 on the source avatar
> (`avatarSrc = /api/v1/static/img/users/${sourceId}`, `sourceId = id.split(':')[2]`), which
> breaks for a ghost-of-a-ghost (prior audit **F14**: `split(':')[2] === 'ghost'`). **Verify
> on a live race with a ghost before/while implementing**; if absent, add the F14 deref (use
> last `:`-segment) as part of this item.

**Approach.** Add the canonical class to the POV marker so the global rule applies:
`className={`cg-pov__marker${isGhost ? ' is-ghost cg-ghost' : ''}`}` (`PovGrid.jsx:414`).
Drop or keep `opacity: 0.6` (`PovGrid.scss:30`) per taste — the tint is the required cue.
Because `_cgTokens.scss` already styles `.cg-ghost img`, no new CSS is needed.

**Make it stick (the sweep).** Add a small test/lint that asserts every avatar render site
emits `cg-ghost` for ghost riders, so a future panel can't silently regress (this is the
durable answer to "make sure each one has the right wiring").

---

## Item 2 — 🥇 medal on the current leader's odometer

**Finding (refined).** The live leader is **already computed** — the engine's `standings()`
(`CycleRaceEngine.js:135-147`) ranks un-finished riders by `cumulativeDistanceM` desc every
tick and is exposed via `getState().standings` (`:172`). The container even builds
`placementByUser` from it (`CycleGameContainer.jsx:1303-1304`) — but then **throws it away
for non-finishers** (`:1347` `placement: isFinished ? … : null`). So "who is first right now"
needs no new derivation; it's one unused value.

The odometer is the bottom pill `CycleSpeedometer.jsx:162-164` (`.cycle-speedometer__odometer`),
a `static`-positioned `<div>` outside the gauge.

**Approach.**
1. Container: add `isLeader: placementByUser[userId] === 1` to the `riderLive` object
   (`CycleGameContainer.jsx` ~1347), **guarded on `engineState.elapsedS > 0`** — pre-start all
   distances are 0 and `standings()` falls back to id order, which would park a medal on an
   arbitrary rider before anyone pedals.
2. Thread `isLeader` through `SpeedoRow.jsx:30-55` → `CycleSpeedometer`.
3. Render `{isLeader && <span className="cycle-speedometer__leader-medal">🥇</span>}` at the
   top of the odometer; SCSS: `position: relative` on `&__odometer`, absolute medal at
   `top:-0.6em; left:-0.4em`. Reuse the existing gold glow already on `&__finished-place`
   (`CycleSpeedometer.scss:109`).

**Live updates are free** — `riderLive` is rebuilt from the per-tick snapshot, so the medal
hops on each lead change. **Ties:** `standings()` assigns a strict `placement` after a stable
sort, so exactly one rider is rank-1 (deterministic, no co-leader handling needed). Add a
`SpeedoRow` test asserting the medal renders only for the leader.

---

## Item 3 — Ghost picker: skip the rider step for single-rider races

**Finding (corroborated + refined).** The two-step flow is local to `GhostPicker.jsx`
(`rosterFor` state = step driver: `null` = pick-race, candidate = pick-riders;
`GhostPicker.jsx:33-35,166`). On the second tap of a race, `handleTap` (`:52-63`) seeds the
roster with all **live** (non-ghost) riders and opens step 2. The meaningful count for step 2
is **live riders only** (`participants.filter(p => !p.isGhost).length`) — ghosts in the
roster are display-only/locked, so a race with one human + N ghosts is effectively single-rider.

Ghost styling **in the picker is already correct** (`GhostPicker.jsx:125,210` use `cg-ghost`);
nothing to fix there. (The broader ghost inconsistency the tester referenced is item 1, on the
POV — not the picker.)

**Approach.** In `handleTap`'s commit branch (`GhostPicker.jsx:60-63`), short-circuit when
exactly one live rider:

```js
const live = (c.participants || []).filter((p) => !p.isGhost);
if (live.length === 1) { onSelect?.({ ...c, participants: live }); return; }  // skip step 2
setSelected(new Set(live.map((p) => p.id)));
setRosterFor(c);
```

The `onSelect` payload shape is identical to the step-2 CTA (`{ ...candidate, participants }`,
`:225`), so `onSelectGhost` (`CycleGameContainer.jsx:1089`) needs no change. Guard only `=== 1`;
leave `0` (all-ghost race) to fall through to the existing disabled "No live riders" state
(`:73,223`) rather than silently no-op.

> Related but distinct: 2026-06-04 **F13** wanted a subset picker for multi-rider ghost races
> (≥2). That now exists (step 2 is the subset picker). This item is the inverse — collapse it
> away when there's nothing to pick.

---

## Item 4 — POV avatars look blocky (anti-aliasing)

**Finding (corroborated).** PovGrid is a **hybrid renderer**: the neon grid is WebGL
(three.js `antialias:true`, `PovGrid.jsx:171`, plus the `fwidth` analytic-line shader
`GRID_FRAG` `:65-90`) — that's why the grid is crisp. The avatars are **DOM**
`CircularUserAvatar` cards (`:408-423`) positioned over the canvas and **CSS-scaled up**:

```js
// PovGrid.jsx:320-322
const scale = clamp(CARD_MIN_SCALE, CARD_MAX_SCALE, CARD_FOCAL / Math.max(1, p.dist));
el.style.transform = `… scale(${scale.toFixed(3)})`;   // CARD_MAX_SCALE = 1.5  (:36)
```

The avatar photo is a **44px raster `<img>`** scaled up to 1.5× for near riders. CSS
`transform: scale()` resamples the already-rasterized bitmap, so close riders get upscaled and
jagged while the vector grid stays smooth. The WebGL `antialias` flag does nothing for the DOM
avatars.

**Approach (options, cheapest first).**
- Render the avatar at a **larger intrinsic `size`** (e.g. `size=88`) and invert the scale math
  so it's only ever *downscaled* (browsers downsample cleanly): `CARD_MAX_SCALE ≤ 1.0`, base
  size doubled. Lowest risk, biggest win.
- Request a higher-resolution avatar source for the POV (`live.avatarSrc` at a 2× variant).
- Add `image-rendering`/`will-change: transform` hints (minor) and ensure `transform`
  composites on its own layer.
- Heaviest: move the avatar ring to SVG. Not needed if the size-up approach lands.

---

## Item 5 — No-HR avatar: hide the gauge, use the rider's own color

**Finding (corroborated + refined).** Two separate causes produce the "blue + always-on HR
gauge" the tester sees, and they are **site-specific**:

1. **Always-on ring.** `CircularUserAvatar.jsx:123` draws the zone gauge whenever
   `showGauge` is true (default `true`, `:37`) — **independent of HR**. The HR *digit* already
   hides at `heartRate <= 0` (`:166`), but the ring does not. The **speedometer**
   (`CycleSpeedometer.jsx:133`) passes no `showGauge`, so its ring is always on. (POV already
   passes `showGauge={false}`, `PovGrid.jsx:418`; ready strip already gates on
   `showGauge={heartRate>0}`, `RiderReadyStrip.jsx:37` — that's the pattern to copy.)
2. **The blue.** A live no-HR rider can still carry a default/idle `vitals.zoneColor` (the
   blue) from `getUserVitals`, threaded straight through at `CycleGameContainer.jsx:1343`,
   overriding the per-rider identity color. The rider's own color (`LINE_COLORS[idx]`,
   `lineColors.js`) is already in hand at every site (`SpeedoRow.jsx:43`, `--cg-pov-color`).

**Approach.**
- Define an explicit `hasActiveHr = Number.isFinite(heartRate) && heartRate > 0` signal and
  pass `showGauge={hasActiveHr}` at the speedometer (and anywhere else defaulting to true).
- When `!hasActiveHr`, the ring/border should use the **rider color**, not the zone blue:
  in the container's `riderLive` build (`:1343`), fall back to the rider color when there's no
  active HR (don't let idle `vitals.zoneColor` win). The avatar already maps `zoneColor` →
  `--vital-ring-color` (`:61`), so feeding it the rider color is enough.
- The avatar needs a **plain-border state** when the gauge is suppressed: today the only
  always-present border is the white hairline `::after` (`CircularUserAvatar.scss:44`). Give the
  no-HR state a border colored by `zoneColor` (= rider color) so the avatar reads as "that
  rider, no live HR" rather than blue-with-empty-gauge.

> This is a real `CircularUserAvatar` API change (a no-HR visual state), so it's the larger of
> the avatar-cluster fixes and should land with tests for both the active-HR and no-HR renders.

---

## Item 6 — The logarithmic scale isn't doing its job

> **Scope clarification needed.** The tester calls this the "point of view chart," but the
> only logarithmic scale + collision-prevention pair in the codebase is in **`DistanceChart`**,
> not the POV grid. PovGrid is true-3D perspective (`1/z`) with **no log step**; it clusters a
> tight pack on purpose via a `MIN_SPAN_M = 20` camera cap (`povFollowCam.js:14-22`) and spreads
> riders by fixed lanes (`povWorld.js:4-8`), not by a collision pass. The symptom described —
> "goes logarithmic, then collision-prevention spreads the dots" — matches `DistanceChart`
> exactly. **The analysis below is for `DistanceChart`; confirm that's the intended target**
> (or, if the POV grid is meant, the same "expand the front cluster" principle translates to
> relaxing/replacing the `MIN_SPAN_M` floor so a neck-and-neck pack still gets depth separation).

**Finding (corroborated — and the math is backwards).** `DistanceChart.jsx:138-146`:

```js
const yFor = (d) => {
  const lin = Math.min(1, (d || 0) / D);                       // D = visible window (≤ goalM)
  let frac = lin;
  if (useLog) {
    const logF = 1 - (Math.log1p(Math.max(0, D - (d || 0))) / Math.log1p(Math.max(1, D)));
    frac = lin + (logF - lin) * LOG_BLEND;                     // LOG_BLEND = 0.35
  }
  return (H - PAD_B) - clamp(frac) * PLOT_H;
};
```

`useLog` flips on when leaders bunch (`minGap < D*0.05`, hysteresis `:121-132`). Three
compounding flaws keep it from separating the front cluster:

1. **The steep region is in the wrong place.** The log domain is `D − d` (distance below the
   *window top* `D`). Its slope `1/((D−d+1)·log1p(D))` blows up only as `d → D` — i.e. at the
   far, usually-empty top of the window — while the actual leaders sit at `d ≈ leader ≪ D`,
   where the curve is nearly flat. So the magnification is spent on empty space above the pack.
   *Example:* two leaders 3 m apart at `d≈1500` in a `goalM=5000` window separate by
   `≈3/((5000−1500)·log1p(5000)) ≈ 0.0001` of the plot — visually zero.
2. **The 35% blend halves what little remains** (`LOG_BLEND=0.35`, keeps 65% linear).
3. **Reference length is the whole window**, so a few-metre gap is measured against thousands
   of metres — the classic "log of absolute distance dwarfs the small gap."

Because `yFor` barely moves the cluster, the **tag de-overlap pass** (`DistanceChart.jsx:210-247`,
`minSepPct` push + connector at `:391`) becomes the de-facto separator — the "lazy collision
detection" the tester called out. Collision-prevention firing here is the *symptom*, not the fix.

**Approach (correct formulation — math, not implementation).**
1. **Anchor the domain at the leader.** Use the gap behind the leader `g_i = leaderM − d_i ≥ 0`
   (leader `g=0`), not absolute `d` or `D−d`. (`deriveRaceSnapshot.js:55-64` already computes
   `leaderGapM`/`tightestPairGapM` — the signals exist.)
2. **Log the gap with a small metre-scale knob `k`:**
   `depth(g) = log1p(g/k) / log1p(G/k)`, then `y = topY + depth(g)·plotHeight` (leader pinned
   at top). `k ≈ 3–5 m` puts the most pixels in the first few metres; `G` = the visible gap span
   (clamped to a sane `MAX_GAP_M`, with a floor so a tiny pack doesn't over-zoom). Slope
   `1/((g+k)·log1p(G/k))` is **largest at `g=0`** — exactly "expand the front, compress the
   back," and independent of how far the race has run.
3. **Retire the blend.** With the leader as a fixed top reference there's no hockey-stick, so
   `LOG_BLEND` can go to ~1.0 (or be replaced by the `k` softness knob).
4. **Collision-prevention becomes a true last resort.** After the gap-log scale, riders
   separate on their own above the front resolution (`≈ plotHeight/(k·log1p(G/k))` m/px). Gate
   the de-overlap pass to fire **only** on the subset still within an avatar-radius after the
   new scale (genuine sub-~1 m dead heats), leaving everyone else at their true `yFor`.

---

## Resolved decisions (tester, 2026-06-06)

1. **Item 6 target → `DistanceChart.jsx`.** Confirmed: the POV chart (`PovGrid.jsx`) has no
   log scale; `DistanceChart` is the only one with the log + collision-prevention pair.
2. **Item 1 / POV ghost → use the existing `.cg-ghost` standard**, do not reinvent. Ghosts
   must show *as ghosts* on the POV (currently opacity-only). Verify live whether they're
   merely untinted vs. literally absent (404 avatar / F14).
3. **Item 5 → every avatar site** gets the no-HR state (drop gauge, plain border in the
   rider's own color).
4. **Item 2 → live rank-1 throughout** (the medal naturally lands on the winner at the end).

---

## Touch-point file map (for the follow-up plan)

| Item | Primary files |
|------|---------------|
| 1 | `panels/PovGrid.jsx` (:414), `panels/PovGrid.scss` (:30), `_cgTokens.scss`; + sweep guard test |
| 2 | `CycleGameContainer.jsx` (:1303,1347), `panels/SpeedoRow.jsx` (:30-55), `CycleSpeedometer.jsx` (:162), `CycleSpeedometer.scss` (:89), `panels/SpeedoRow.test.jsx` |
| 3 | `home/GhostPicker.jsx` (:52-63) |
| 4 | `panels/PovGrid.jsx` (:36,320-322,408-423) |
| 5 | `components/CircularUserAvatar.jsx` (:37,123,166), `.scss` (:44), `CycleSpeedometer.jsx` (:133), `panels/SpeedoRow.jsx` (:43), `CycleGameContainer.jsx` (:1335-1356), `lib/cycleGame/lineColors.js`, avatar tests |
| 6 | `panels/DistanceChart.jsx` (:121-146,210-247,391), `lib/cycleGame/deriveRaceSnapshot.js` (:55-64), `DistanceChart.test.jsx` |

---

## Suggested sequencing (quick wins → deeper)

1. **Item 3** (single-rider skip) — one branch, isolated. *S*
2. **Item 1** (POV ghost class) + the avatar-site sweep guard. *S*
3. **Item 2** (leader medal) — data already present. *S*
4. **Item 4** (avatar AA via size-up) — localized to PovGrid. *S–M*
5. **Item 5** (no-HR avatar state) — real component API change, needs tests. *M*
6. **Item 6** (gap-anchored log scale) — most math, most visual-tuning; do last and verify on
   a live neck-and-neck race. *M*

*Next: turn these into a sequenced implementation plan, one item at a time.*
