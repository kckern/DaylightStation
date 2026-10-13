# Weight chart — user stories

**Date:** 2026-09-06
**Status:** Built — Health app, Progress tab (`/health/progress`), 2026-09-06

All eight stories ship in the Progress tab's Weight card. The chart is built by
`frontend/src/modules/Health/progress/weightChart.js` (pure) and rendered by
`ProgressView.jsx`; the Today tab keeps the compact chip, whose sparkline is
fixed by the same normalization change (story 2).

The screen-framework weight widget renders a chart the compact health chip does
not. These stories name each capability the widget has that is worth keeping,
so the behaviour survives whatever renderer it ends up on rather than living
only as a Highcharts options object.

**Data contract.** One row per calendar day, keyed by ISO date. Every row
carries `lbs` (forward-filled from the last weigh-in) and `lbs_adjusted_average`.
Only a day actually weighed carries `measurement`. Also present per day:
`fat_percent_adjusted_average`, `lbs_adjusted_average_7day_trend`,
`calorie_balance`, `water_weight`.

**Forward-fill is the trap that shapes several of these stories.** In a recent
snapshot 249 of 249 rows had `lbs` and 127 had `measurement`. Anything that
treats `lbs` as a reading invents roughly half its data points.

---

## 1. Rolling-average trend line

**As** someone tracking weight day to day
**I want** the smoothed rolling average drawn as a continuous line across the
whole window
**So that** I read the direction of my weight instead of yesterday's water,
salt, and time of day.

Acceptance criteria:
- Plots `lbs_adjusted_average`, one point per day, as a smooth continuous line.
- Window is the last 12 weeks (84 days), not 30 — a weight trend is only legible
  over a season.
- The line is the visual primary: heaviest stroke, highest contrast, drawn above
  the water-weight line and below the measurement dots.
- If the most recent row predates today, the series extends to today at the last
  known average, so the line always reaches the right edge of the chart.
- No gaps: the average is defined every day even when nobody weighed in.

---

## 2. Actual measurement points

**As** someone who does not weigh in every day
**I want** a discrete dot on exactly the days I stepped on the scale
**So that** I can see how noisy my real readings are and which days the average
is actually anchored to.

Acceptance criteria:
- One dot per day where `measurement` is present. **Days with only a
  forward-filled `lbs` draw no dot** — a repeated value is not a second
  measurement.
- Dots are drawn from `measurement`, never from `lbs`.
- Dots share the trend line's vertical scale, so a dot above the line means that
  reading was above the average.
- Dots are small and lower-contrast than the trend line: they are the evidence,
  not the story.
- A window with no weigh-ins renders the trend line alone, with no dots and no
  placeholder.

---

## 3. Filled area under the trend

**As** someone glancing at the chart from across the room
**I want** the region under the trend line shaded
**So that** the line reads as a solid mass at a distance and I can tell up from
down without finding the axis.

Acceptance criteria:
- The fill is bounded by the trend line and the bottom of the plot area.
- Low opacity (~0.2) so gridlines, month lines, and dots remain visible through
  it.
- The fill is tied to the average series only; the water-weight line and the
  dots are never filled.
- The fill's base is the bottom of the plot, which is a clipped axis
  (see story 4) — so the fill is a legibility aid, never a bar to compare
  magnitudes by.

---

## 4. Weight-scale labels on the vertical axis

**As** someone reading the chart
**I want** labelled pound values and gridlines at every pound
**So that** I know whether a swing is one pound or five.

Acceptance criteria:
- Axis is clipped to the data: floor(min) − 1 to ceil(max) + 1 across both the
  average and the measurements. A zero-based axis would flatten every real
  change into nothing.
- Major tick and gridline every 1 lb; a lighter minor tick between.
- Labels formatted with the unit attached (`172 lbs`), not a bare number.
- Axis is drawn on the right-hand side, where the most recent values are, so the
  eye lands on the label nearest today.
- Gridlines are visible through the area fill.

---

## 5. Weekly breakdown on the time axis

**As** someone reviewing a 12-week window
**I want** a dated label every seven days
**So that** I can place a bump in time without counting pixels.

Acceptance criteria:
- A labelled tick every 7 days across the window, formatted `MMM D`.
- Labels are rotated (~-35°) and never overlap or stagger onto a second row.
- The leftmost label is suppressed where it would collide with the chart edge.
- One x position per day, evenly spaced — the chart is a calendar strip, not a
  time-proportional scatter.
- Gridlines at the weekly ticks are subtle enough to sit behind the data.

---

## 6. Month boundary lines

**As** someone thinking in calendar months
**I want** a distinct vertical line wherever a new month begins
**So that** I can say "I lost two pounds in August" without arithmetic.

Acceptance criteria:
- A vertical rule at every day-of-month = 1 inside the window.
- Visually distinct from the weekly gridlines: brighter and roughly twice the
  width.
- Drawn beneath the data series, never over the dots or the trend line.
- A window containing no month boundary simply draws none.

---

## 7. Water-weight differential line

**As** someone whose scale reads several pounds of water
**I want** a thin secondary line showing the average with water weight removed
**So that** I can see the band my "true" weight sits in rather than one number
that includes hydration noise.

Acceptance criteria:
- A thin, low-contrast, unfilled line tracking below the trend line.
- **Uses each day's own `water_weight`**, not today's value applied backwards.
  The current widget subtracts the latest `water_weight` from every historical
  point, which draws a parallel shadow rather than a real series — fix this when
  the story is built.
- Never carries dots or markers: it is a derived band edge, not a measurement.
- Days with no `water_weight` break the line rather than falling back to zero,
  which would drop it by ~4 lbs and read as sudden loss.
- Shares the trend line's vertical scale.

---

## 8. Statistics table above the chart

**As** someone checking in each morning
**I want** the day's key numbers stated as text above the chart
**So that** I get the exact figures without reading them off a line.

Acceptance criteria — five cells, from the most recent row:
| Cell | Source | Presentation |
|---|---|---|
| Weight | `lbs_adjusted_average` | one decimal, `lbs` |
| Composition | `fat_percent_adjusted_average` | whole percent |
| 7-day trend | `lbs_adjusted_average_7day_trend` | signed value plus an up/down arrow — direction is never carried by colour alone |
| Daily calories | `calorie_balance` | absolute value plus a `+`/`−` glyph; exactly zero reads `Balanced` |
| Days to goal | derived | day count plus the projected calendar date beneath it |

- Goal projection: lean mass = `lbs_adjusted_average × (1 − fat% / 100)`; goal
  weight = lean mass ÷ (1 − goalBF / 100); days = (current − goal) ÷ (weekly
  trend ÷ 7).
- The goal body-fat percentage is configuration, not a literal in the component.
- When the trend is flat or moving away from the goal, the cell shows a warning
  glyph rather than a negative or infinite day count.
- While data is loading, the table holds its five-column shape with skeletons —
  it must not collapse and reflow the chart below it.

---

## Not carried over

- **Per-point tooltips.** They exist in the widget and are worth keeping on a
  pointer surface, but they are unreachable on the ambient screens this widget
  runs on, so no story claims them as a requirement.
- **The chip's "no 7-day trend yet" guard.** The widget trusts the stored
  `..._7day_trend` field; the chip derives its own. Whichever survives, the two
  surfaces must not print different numbers for the same day.
