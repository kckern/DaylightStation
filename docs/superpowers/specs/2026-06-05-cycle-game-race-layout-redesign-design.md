# Cycle-Game Race Layout Redesign — Design

**Date:** 2026-06-05
**Status:** Approved (brainstorm) — pending spec review

## Goal

Replace the cycle-game race screen's dynamic, director-driven panel layout with **two fixed layouts chosen by field size**, introduce a **vertical Tron/Cruising-USA "POV grid"** (the piston chart rotated into a perspective road), fold the **race timer into the chart panel**, replace the rankings panel with a **compact splits chart**, and **re-couple the oval to laps**.

## Background / current state

- `RaceLayoutManager.jsx` renders a dynamic grid: three top zones (`topLeft/topCenter/topRight`) + a bottom speedo band, with a solo (1-rider) special branch.
- `lib/cycleGame/raceDirector.js` + `lib/cycleGame/racePanels.js` score each panel's *candidacy*/*priority* per tick and assign panels to zones. Panels: `speedoRow`, `distanceChart`, `rankings`, `lapPanel`, `racePistons`, `camera (CameraZoom)`, `ovalTrack`.
- The piston chart (`panels/RacePistons.jsx`) is a horizontal leader-anchored spatial view using `lib/cycleGame/leaderAnchoredZoom.js` + `useLeaderAnchoredZoom.js` (leader pinned right, hysteresis rezoom, fixed-metre grid).
- The race header/timer (count-down for time races, count-up for distance) renders in `CycleRaceScreen.jsx` above the layout.
- The oval (`panels/OvalTrack.jsx` + `ovalTrackModel.js`) currently models the **whole race as one loop**, decoupled from laps.
- Lap data already exists: the engine state exposes per-rider `lapSplits` (`CycleRaceEngine.getState()`), and `lap_length_m` is config (set to 100 m).

## The two layouts

Selected by **field size = total riders shown, including ghosts** (the same count the director used).

### Sidebar mode — `fieldSize ≤ 3`
```
┌───────────────────────────────┬───────────────┐
│ Distance Chart  │ Splits chart │   POV grid    │  ← sidebar top ~70%
│ (timer = top    │  (top-right) │  (vertical,   │
│  30% of panel)  │              │   skewed)     │
├─────────────────┴─────────────┤               │
│       Speedometers (band)     ├───────────────┤
│                               │  Oval / laps  │  ← sidebar bottom ~30%
└───────────────────────────────┴───────────────┘
   main panel ~68%                  sidebar ~32%
```
- **Main (~68% left):** top row = Distance Chart (left) + Splits chart (right); Speedometers as the bottom band (existing `minmax` band sizing).
- **Sidebar (~32% right):** POV grid (top ~70%) + Oval/laps (bottom ~30%).

### Wide mode — `fieldSize ≥ 4`
```
┌──────────────┬──────────────┬──────────────┐
│ Distance     │ Splits chart │   POV grid   │  ← three EQUAL columns
│ Chart+timer  │              │  (no oval)   │
├──────────────┴──────────────┴──────────────┤
│        Speedometers — full width            │  ← band ~42%
└─────────────────────────────────────────────┘
```
- Top row = three **equal-third** columns: Distance Chart+timer | Splits chart | POV grid.
- Speedometers full-width along the bottom (~42% height). **No oval.**

`fieldSize === 1` (solo, incl. 1 live + 0 ghosts) uses **sidebar mode** with single-rider fallbacks (see Components).

## Components

### Distance Chart (`panels/DistanceChart.jsx`) — modified
Existing line chart, unchanged in plotting. **The race header folds into its top 30%:** a header strip renders the timer (count-down "TIME LEFT m:ss" for time races, count-up for distance races) and the win-condition label; the chart occupies the lower ~70%. The standalone header in `CycleRaceScreen.jsx` is removed.

### POV grid (`panels/PovGrid.jsx`) — new, replaces `RacePistons`
The piston chart rotated 90° into a vertical perspective road:
- **Long axis = vertical (Y).** Reuses the leader-anchored zoom math (`leaderAnchoredZoom.js` / `useLeaderAnchoredZoom.js`) applied to Y instead of X: **leader pinned near the top** (far / vanishing point), a rider `g` metres back sits below it, `k` held between rezooms, hysteresis rezoom (last place home ≈ same band), fixed-metre grid. All zoom/pan/rezoom rules are **identical** to today — only the axis changes.
- **Cross axis = lanes (X):** one column per rider across the road width; each rider's marker (tip avatar) rides at its Y = spatial standing, X = its lane.
- **2-D grid:** the existing metre gridlines become **horizontal lines** (receding up the road, spaced by the zoom — density still reads the zoom level), plus **lane/vertical lines** converging toward the vanishing point.
- **Perspective + animation:** a CSS perspective skew (trapezoidal, vanishing point at top) gives the 3-D road; the grid animates **rushing toward the camera** as the leader advances (driven by the pan, eased over the tick — reusing the 0.9 s transition discipline). Skew/animation are **visual dressing layered on the existing spatial math** — positions are computed exactly as today, then the whole plane is transformed.
- **Solo fallback:** with one rider the zoom has no gap; use the existing single-rider fixed traveling scale (grid pans with distance, rider centered).
- Rankings are **not** shown anywhere — order is read directly from the POV grid.

### Splits chart (`panels/SplitsChart.jsx`) — new, replaces `Rankings` + `LapPanel`/`LapTable`
Compact table, **laps down the rows (newest at the bottom), one column per rider**:
- Completed laps show the **lap split time**.
- The **current (in-progress) lap is a live count-up** per rider (ticks every render).
- Each rider's **best lap** is highlighted.
- Designed to **hold many laps** — compact rows; shows the most-recent laps (scroll/clamp to the panel height, newest visible).
- Data source: per-rider `lapSplits` from the engine state + the current elapsed-on-lap (`distance mod lap_length` → time since the last split). No rankings/medal content.

### Oval / laps (`panels/OvalTrack.jsx` + `ovalTrackModel.js`) — modified
**Re-coupled to laps:** one loop = **the current lap**. Each rider is a dot positioned by progress around the current lap (`(distance mod lap_length) / lap_length`), with a **lap counter** ("Lap N") in the center. Rendered **sidebar-bottom, sidebar mode only** (absent in wide mode).

### Speedometers (`panels/SpeedoRow.jsx`) — unchanged
Bottom band in sidebar mode; full-width in wide mode. Existing component; layout supplies the zone box.

### Removed
- **Rankings** (`panels/Rankings.jsx`) — order is implied by the POV grid.
- **CameraZoom** (`panels/CameraZoom.jsx`) — a director-promoted transient panel; the POV grid subsumes its role. (Keep the file out of the new layout; deletion optional in the plan.)
- **Dynamic director** — `raceDirector.js` candidacy/priority/zone assignment and `racePanels.js` registry are no longer consulted for layout; `RaceLayoutManager` selects a fixed template.

## Architecture

`RaceLayoutManager.jsx` becomes a **template selector**: given `fieldSize` and the panel render-factories, it renders one of two static CSS-grid templates (sidebar vs wide). No per-tick zone scoring, no candidacy, no `decision` object. `CycleRaceScreen.jsx` stops building the director `decision`, passes `fieldSize` + the panel factories, and no longer renders a standalone header (it moves into Distance Chart).

Each panel stays a focused presentational component fed by the existing race snapshot (`riders`, `riderLive`, `lapSplits`, `lap_length_m`, win condition, elapsed). The `PanelSlot` zone-box measurement pattern (stable factory via `render` prop — the remount fix) is retained for every slot.

## Data flow

`CycleGameContainer` → race snapshot (per-rider distance/rpm/lapSplits/finish, leader gap, elapsed, win condition, lap length) → `CycleRaceScreen` → `RaceLayoutManager(fieldSize, panels)` → fixed template → `PanelSlot`s inject `zoneBox` into each panel. Panels read only the snapshot fields they need. The POV grid + oval need `lap_length_m`; the splits chart needs `lapSplits` + lap length.

## Edge cases

- **Solo (fieldSize 1):** sidebar mode; POV grid single-rider fallback; oval shows the one rider's laps; splits chart one column.
- **Threshold:** `≤3` → sidebar, `≥4` → wide. Ghosts count toward `fieldSize`.
- **Laps disabled / `lap_length_m` unset:** laps are always enabled in practice (`lap_length_m` defaults to 100 m). If a race is configured without a lap length, the Oval renders a single loop with no lap counter and the Splits chart shows a "no splits yet" empty state — neither errors.
- **Rezoom on the vertical axis** must not fight the perspective transform — the transform wraps the positioned plane; rezoom changes positions inside it, the transform is constant.

## Testing

- **Unit:** template selection (`fieldSize` → mode + correct panels present/absent); POV grid vertical mapping (leader at top, trailer below, reuses zoom math — extend `leaderAnchoredZoom` tests for axis-agnostic use or wrap); splits chart (`lapSplits` → rows, current lap count-up, best-lap highlight); oval lap re-coupling (`distance mod lap_length` → dot angle, lap counter).
- **Runtime (Playwright):** both modes render with the right panels (2-rider → sidebar w/ oval; 4-rider → wide, no oval, full-width speedos); screenshots for visual review of the POV skew; avatars 1:1; no clipping.

## Files affected (for the plan)

- **New:** `panels/PovGrid.jsx` (+scss), `panels/SplitsChart.jsx` (+scss).
- **Modified:** `RaceLayoutManager.jsx` (+scss) — two fixed templates; `CycleRaceScreen.jsx` — pass `fieldSize`, drop `decision`/header; `panels/DistanceChart.jsx` (+scss) — header/timer strip; `panels/OvalTrack.jsx` + `lib/cycleGame/ovalTrackModel.js` — lap re-coupling; `lib/cycleGame/useLeaderAnchoredZoom.js`/`leaderAnchoredZoom.js` — axis-agnostic helper if needed.
- **Removed from layout (delete optional):** `panels/Rankings.jsx`, `panels/CameraZoom.jsx`, `panels/RacePistons.jsx` (superseded by PovGrid), `panels/LapPanel.jsx`/`panels/LapTable.jsx` (superseded by SplitsChart), `lib/cycleGame/raceDirector.js` + `racePanels.js` (director retired).
- **Tests:** update/replace `RacePistons.test.jsx`, `CameraZoom.test.jsx`, `raceDirector.test.js`, `racePanels.test.js`, `layoutSizing*`/`layoutMonitor*` as the director retires; add `PovGrid`/`SplitsChart`/template-selection tests; update runtime cycle-game tests.
