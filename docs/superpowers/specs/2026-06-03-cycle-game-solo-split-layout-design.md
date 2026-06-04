# CycleGame Solo Split Layout (Design)

**Date:** 2026-06-03
**Component:** `frontend/src/modules/Fitness/widgets/CycleGame/RaceLayoutManager.jsx` (+ `CycleRaceScreen.jsx`, `panels/SpeedoRow.jsx`)
**Status:** Approved design, ready for implementation plan.

## Problem

A solo race (one participant, no opponents) renders through the multi-rider
velodrome grid: a full-width top region tuned for up to three panels over a 48%
speedo band. With a single rider that yields one thin top panel and one centered
gauge marooned in a large void — and, before today's `zoneBox` propagation fix,
the gauge was pinned to its 96px floor. The screen reads as broken, especially at
race start (t=0) when no line/lap data exists yet.

## Design

When the field is exactly one participant, the race screen becomes **two balanced
50% / 50% columns** below the clock chrome:

- **Left half — the gauge.** The `CycleSpeedometer` (RPM / HR / zone + odometer),
  the hero effort readout since there is no one to race. Sized larger than in the
  multi-gauge band (see "Gauge cap" below).
- **Right half — adaptive.** The **lap table** when laps are enabled, otherwise the
  **progress chart** (climbing distance line; goal line for distance races, pace
  only for time races).

A ghost or a second rider makes `fieldSize ≥ 2` and reverts to the existing
velodrome grid. No separate bottom speedo band exists in solo mode — the gauge IS
the left column.

**Start state (t=0):** the left gauge fills its column immediately; the chart's
framed gridlines (level-0 30s × 250m window) render even with no data, so the
right half reads as a "ready" framed grid rather than an empty bar.

## Architecture (Approach C — re-arrange in the layout manager)

The race director and panel registry are **unchanged**. The director's existing
`candidacy` already does the solo work:

- `speedoRow` (`candidacy: () => true`) → assigned to `bottom`.
- For one rider, `distanceChart` (`fieldSize ≥ 2 || !lapsEnabled`) or `lapTable`
  (`lapsEnabled`) qualifies and lands in `topLeft`; `rankings` / `ovalTrack`
  (both `fieldSize ≥ 2`) do not.

So a solo decision already carries exactly the two panels we want: one in
`bottom`, one in the first top zone. The only change is **how they are rendered**.

- **`CycleRaceScreen.jsx`** computes `solo = riderIds.length === 1` and passes it
  to `RaceLayoutManager` as a `solo` prop. (One entry === no ghost, since a ghost
  would be a second rider entry.)
- **`RaceLayoutManager.jsx`** keeps all hooks (telemetry, thrash detector) running
  unconditionally, then branches the returned JSX: when `solo`, render a 2-column
  grid (`1fr 1fr`) with the `bottom` panel on the left and the single filled top
  panel on the right. Each half is still wrapped in `PanelSlot`, so the measured
  `zoneBox` flows to the panels (the gauge sizes via `gaugeRowSize`, the chart's
  fit-guard works). Non-solo renders the existing top-row-over-band layout.
- **Gauge cap:** `SpeedoRow` gains an optional `maxGauge` prop (default `280`,
  threaded into `gaugeRowSize`'s `max`). `CycleRaceScreen` passes a larger cap
  (`420`) in solo mode so the lone hero gauge fills its half instead of sitting at
  the 280 multi-gauge cap.

### Units / files touched

| File | Change |
|------|--------|
| `RaceLayoutManager.jsx` | `solo` prop + solo render branch (2-col grid) |
| `RaceLayoutManager.scss` | `.race-layout--solo` grid template + half-column styles |
| `CycleRaceScreen.jsx` | compute `solo`, pass to manager, pass `maxGauge` to the speedo factory |
| `panels/SpeedoRow.jsx` | optional `maxGauge` prop → `gaugeRowSize({ max })` |

## Testing

- **`RaceLayoutManager.test.jsx`:** with `solo` and a decision of
  `{ bottom: 'speedoRow', topLeft: 'distanceChart' }`, renders two solo zones
  (`zone-solo-left` = speedo, `zone-solo-right` = chart) and no top-row/band; with
  `solo=false` the existing grid is unchanged.
- **`CycleRaceScreen.test.jsx`:** one rider → `race-layout-solo` present; two riders
  → absent (velodrome grid). Existing solo gauge-count / chart-line tests stay green.
- **`SpeedoRow.test.jsx`:** a larger `maxGauge` raises the clamp (e.g. `420` in a tall
  solo column yields a gauge > 280); default stays `280`.

## Out of scope

- A dedicated "start pedaling" cue (separate start-state affordance, not chosen).
- Any change to the director, panel registry candidacy, or multi-rider layout.
- Re-tuning the oval track or chart zoom.
