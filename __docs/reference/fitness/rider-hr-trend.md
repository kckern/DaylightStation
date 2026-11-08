# Rider card HR trend

The whole-session heart-rate line inside each tall rider card in the fitness
sidebar (`FitnessUsers` → `RiderHrTrend`).

| File | Role |
|---|---|
| `__app_modules/wellness/fitness/browser/player/panels/RiderHrTrend.jsx` | Component: collecting state, SVG, motion clock |
| `.../player/panels/hrTrendScale.js` | Log time axis, prefix sums, slot sampling |
| `.../player/panels/hrTrend.js` | Curve path, zone bands, y-range, visibility hysteresis |
| `.../player/panels/FitnessUsers.jsx` | Decides availability; passes series, zones, tick length |
| `.../player/FitnessSidebar.scss` | `.has-trend` card grid, line, guide and spinner styles |
| `tests/_infrastructure/harnesses/fitness-sidebar-layout.mjs --only=trend` | Real-browser layout + render check |

## Data

The chart reads the session timeline: `heart_rate` for the participant, one slot
per 5 s tick, `null` while the strap is silent (a strap that sends packets
without a real reading for `hrStaleMs` also reads null). The participant id
follows the race chart's order: the entity's stint series first, then the
timeline user. "Now" is the series' own last slot, so a rider who joined late
still ends at the right edge.

The timeline's `zone_id` series is **not** read. Colour comes from height against
the rider's own `zoneSequence` (`progressInfo` or the user's vitals).

## States

- **No timeline** (`timelineTimebase` absent, or no series selector): no chart;
  single-rider cards keep the 132 px cap.
- **Collecting**: from session start the card takes its trend height (single
  rider: up to `TREND_SINGLE_CAP_PX = 560`) and shows a quiet spinner
  (`role="status"`) until the rider has `TREND_MIN_READINGS = 5` real readings.
  Readings, not ticks: a dropout neither counts nor resets.
- **Drawn**: the line, logged once per mount as `fitness.sidebar.hr_trend.ready`.

A card shows the trend box at ≥ `TREND_ON_PX = 116` px and hides it below
`TREND_OFF_PX = 108` px (hysteresis, so a resize wobble can't flicker it).

## Time axis

`x = 1 − ln(1 + age/k) / ln(1 + span/k)` with ages in ticks and
`k = TREND_RECENT_TICKS = 12` (1 minute). On a 30-minute ride the last minute
takes about 20 % of the width and the last five about 52 %; a short session is
near-linear, so the early line still fills the card.

Sampling is O(slots) per frame: prefix sums over the series are built once per
tick, and the width is cut into `TREND_SLOTS = 120` screen slots whose edges map
back to index ranges. Each tick lands in exactly one slot, so recent ticks stay
individual points and old ones are averaged. A slot whose ticks hold no reading
is a gap.

## Drawing

One monotone cubic path (Fritsch–Carlson: smooth, never overshoots a reading) in
`(x 0..100, bpm)` user space, inside a group whose `matrix` transform maps bpm
onto the 0..100 viewBox height. The path lives in `<defs>` and is drawn by one
`<use>` per zone band, each clipped (`clipPathUnits="userSpaceOnUse"`) to its
band's bpm range and stroked in its colour (`ZONE_COLORS[id]`, else the zone's
own colour, else 60 % white). The colour therefore changes exactly where the line
crosses a threshold, including mid-segment. Outer bands run to 0 and 400 bpm. A
rider without zones gets one neutral band. Faint guides sit at the inner
thresholds that fall inside the y-range.

The y-range is bounded by the rider's thresholds ±10 bpm and widens only when
the data leaves them, so the line doesn't rescale every tick.

## Motion

A `createTickLerp` clock per card (realtime kit) runs across each tick interval.
At fraction f, "now" sits at `lastIndex − 1 + f`: the history slides left on the
log axis, the tip at the right edge eases from the previous reading to the
newest, and the y-range eases from the previous tick's range. Frames write the
path `d` and the group transform through refs (never React props), capped at
`TREND_FRAME_MIN_MS = 33`. A layout effect places the f = 0 frame before paint on
each tick. A jump of more than one tick, the first draw, and
`prefers-reduced-motion` all land directly on the final state.

The tip trails the live BPM by one tick; the number on the card stays live.

## Logging

`component: fitness-sidebar-hr-trend`

| Event | Level | Data |
|---|---|---|
| `fitness.sidebar.hr_trend.mount` / `.unmount` | debug | `profileId`, `cardHeight`, `readings` |
| `fitness.sidebar.hr_trend.ready` | info | `profileId`, `readings`, `ticks` |
| `fitness.sidebar.hr_trend.visibility` | sampled | `shown`, `cardHeight` |
