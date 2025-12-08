# Fitness Race Chart — Design & Implementation Plan

## Goal
Render a real-time race-style line chart showing cumulative heart activity per participant over the session timeline, with avatar markers at the latest point. Replace the existing `FitnessChart.jsx` content with this experience.

## Data sources (via `useFitnessSession`/`useFitnessContext`)
- `participantRoster`: provides `name`, `displayLabel`, `avatarUrl`, `zoneColor`, `profileId`, `hrDeviceId`.
- `getUserTimelineSeries(nameOrId, metric, opts)`: fetches aligned timeline arrays. Use `metric="heart_beats"` (preferred) or fall back to integrating `heart_rate` if beats unavailable.
- `timelineTimebase`: supplies `intervalMs`, `tickCount`, `startTime` for axis scaling.
- Optional: `treasureBox`/events unused for this view.

## Chart semantics
- Metric: cumulative heartbeats per user (`user:<slug>:heart_beats`). If missing, compute on-the-fly from `heart_rate` with `(hr/60) * (intervalMs/1000)` per tick.
- X-axis: time (ms from `timebase.startTime`). Y-axis: cumulative beats. Values must be monotonic; clamp negatives to 0.
- Sorting/“race” behavior: participants ordered by latest cumulative value descending; avatars pinned to line ends.
- Windowing: default to full session; allow optional prop to limit to last N ticks for performance if needed.
- Zone-aware coloring: use `user:<slug>:zone_id` (or mapped zone color) per tick to color line segments; segment strictly by zone changes (no slope-derived coloring).

## Visual treatment
- Lines: distinct, moderately thick strokes; color from `zoneColor` fallback palette; light glow/halo on hover or active leader.
- Avatars: circular image if `avatarUrl`, otherwise initials chip; positioned at latest point with subtle shadow.
- Grid: minimal horizontal gridlines; small timestamp labels at start/end.
- Empty states: “Timeline warming up…” when <1 participant or no samples.
- Zone segments: apply per-segment stroke color based on zone_id. Palette: cool/active/warm/hot/fire → blue/green/yellow/orange/red.

## Component plan (`FitnessChart.jsx` rework)
- Rename render intent to “RaceChart” but keep file/export for minimal surface change.
- Hooks:
	- Read `participantRoster`, `getUserTimelineSeries`, `timelineTimebase` from context.
	- Memoize per-user series fetch; derive beats series (use provided heart_beats; else integrate heart_rate).
	- Build dataset [{id, name, color, avatarUrl, beatsSeries, times}]. Filter participants lacking any numeric samples.
	- Also fetch `zone_id` series per user; precompute segment color arrays aligned to beats.
- Rendering:
	- Compute x coords from tick index * intervalMs; normalize to SVG width; y coords from beats scaled to max.
	- Draw segmented polylines per user: break on nulls or zone changes; stroke color per segment using zone palette. Place avatar at end (svg <image>/<foreignObject> fallback to circle + initials).
	- Legend/ordering: list by current value descending; optionally show numeric total (rounded beats).
- Updates: rerender on context version changes; no internal timer needed (context updates on ticks).

## Edge cases
- No beats data: skip participant; if all skipped, show empty state.
- NaN or null samples: treat as gaps; do not break polyline (segment breaks at null).
- Timebase missing: default intervalMs=5000, startTime=0 to avoid crash; warn in console in dev.
- Early-session sparsity: enforce a minimum visible tick span (e.g., `minVisibleTicks=30`). When `tickCount < minVisibleTicks`, map ticks to a partial width (left-aligned) leaving right-side whitespace for growth; avatars and lines animate/grow rightward as data arrives. Once `tickCount >= minVisibleTicks`, fill 100% width using the full domain or a sliding window while the time axis labels compress accordingly.
- Late joiners: if a participant’s first non-null sample occurs after the session start, begin their polyline at that tick (no leading line); optionally render a faint dashed stub from y=0 to the first point to indicate late entry.
- Depart/rejoin: when a user drops to entirely null samples, break the polyline; resume with a new segment (optionally faded “rejoin” marker) when data resumes. Keep cumulative beats monotonic by carrying the last total forward across gaps.
- Overlapping avatars: if two endpoints are within a collision threshold (e.g., <12px), stagger avatars vertically with a short connector line, or render a small stack indicator (+N). Prefer minimal jitter; use deterministic ordering (by participant id) to avoid flicker.

## Architecture & Componentization
- Composition: keep `FitnessChart.jsx` as a thin container that maps context data into a `RaceChart` render tree. Extract small subcomponents:
	- `RaceChartSvg`: renders axes, polylines, markers.
	- `RaceChartAvatar`: draws circle/image/initials at the line endpoint.
	- `RaceChartLegend` (optional): lists ordered participants with totals.
- Data shaping layer: a pure helper to normalize participant inputs into `{id, name, color, avatarUrl, series: beats[], times[]}`; unit-testable without React.
- Zone segmentation helper: produce segments [{points, color}] using zone_id series only.
- Rendering isolation: SVG-only, no external charting lib. Keep visuals self-contained; rely on existing SCSS for layout/spacing.
- Performance: memoize shaped data; avoid redoing path math unless `timelineTimebase`, `roster`, or `getUserTimelineSeries` output changes. If paths get large (5k ticks), consider downsampling/resampling in the helper.
- Error handling: guard against missing `timebase`; fallback to default interval; log a console.warn in dev only.
- Accessibility: mark SVG as presentational, provide `aria-label` summarizing leaders; avatars use `aria-hidden` when decorative.
- Theming: colors come from participant `zoneColor`; define fallback palette inside the component to avoid cross-file dependencies.

## Separation of concerns (presentation only)
- Source of truth: keep metrics/timeline data in `FitnessSession` and `FitnessContext` (model/controller). The chart consumes read-only getters (`participantRoster`, `getUserTimelineSeries`, `timelineTimebase`) and does not mutate session state.
- Data shaping: perform all derivations (beats integration, zone segmentation) in a pure helper invoked by the chart; no side effects or writes back to context.
- Props interface: the chart accepts data already prepared by context; avoid passing setters or mutators. Provide only display-safe values (numbers, strings, URLs) to the SVG layer.
- State management: internal component state limited to presentation (hover/active ids), not domain data. Memoize computed paths/segments to avoid re-computation and keep controller logic untouched.
- Testing: unit-test helpers independently of React and context to ensure presentation stays decoupled from the model.

## Integration plan — FitnessCam & Sidebar
- Toggle UX: add a sidebar control to enable “Race Chart” view. When toggled on, the main webcam stage in `FitnessCam.jsx` is replaced by the chart; the webcam feed is demoted to the sidebar panel instead of the chart.
- Layout changes in `FitnessCam.jsx`:
	- Maintain a view mode state (`viewMode: 'cam' | 'chart'`).
	- If `viewMode === 'chart'`, render the RaceChart in the main area; render a compact webcam preview component inside the sidebar (reuse existing camera component if available, scaled down).
	- Preserve fullscreen toggle behavior; in chart mode, fullscreen should show the chart, with the webcam preview remaining in sidebar/overlay.
- Sidebar wiring (`FitnessSidebar`):
	- Expose a callback/prop to flip `viewMode` (e.g., `onToggleChart`).
	- Add a menu item or switch labeled “Race Chart” to toggle chart mode; reflect active state.
	- Ensure governance/music controls remain accessible regardless of mode.
- Data flow: the chart pulls data from `useFitnessContext` as usual; no changes to context shape. The webcam preview continues using existing video context.
- Responsiveness: when chart mode is active on smaller screens, ensure sidebar width accommodates the webcam preview; fall back to hiding preview if space constrained.
- Exit paths: toggling back to “Camera” restores original layout; persist last choice per session (optional) via local state, not global context.

## Avatar component migration
**Goal:** Replace raw SVG circle/avatar rendering with the shared `CircularUserAvatar` component for consistent visuals (gauge ring, border, image fallback) and avoid duplicated styling.

### Current state
- `FitnessSidebar/FitnessChart.jsx` draws avatars with SVG `<circle>` + `<image>` clipPath, custom stroke color, overlap handling, and transform positioning.
- Avatar stacking/downward offset already works; borders take participant color; clipping is circular.

### Plan
1) **Data shape:** For each avatar endpoint we already have `{name, avatarUrl, color, value, x, y, offsetY}`. We will map these into `CircularUserAvatar` props:
	- `name` → `name`
	- `avatarUrl` → `avatarSrc`
	- `color` → `zoneColor` (also set CSS variable for ring color)
	- `size` → use avatar diameter (2 * AVATAR_RADIUS) in px
	- `ringWidth` → small (e.g., 4px) to mimic current stroke
	- `showGauge` → false (unless we want ring progress); rely on border color
	- `showIndicator` → false
	- `className` → chart-specific class for positioning
2) **Rendering host:** Keep positioning inside the SVG overlay layer by using `<foreignObject>` wrapping `CircularUserAvatar`, since that component outputs HTML/CSS. Position using existing transform/translate values; ensure `overflow: visible` remains.
3) **Overlap logic:** Reuse current offset computation; apply translate to the `<foreignObject>` container; size matches avatar size.
4) **Styling:** Add a light drop shadow around the avatar host to match prior halo; ensure border color comes from `zoneColor` via CSS variable or inline style. If `CircularUserAvatar` defaults conflict, override via CSS (race-chart scope) to remove gauges and set ring thickness.
5) **Accessibility:** Preserve aria-hidden behavior for decorative avatars; `CircularUserAvatar` allows `ariaLabel` if needed.

### Implementation steps
- Import `CircularUserAvatar` in `FitnessChart.jsx`.
- Replace SVG circle/image block with a `<foreignObject>` containing `CircularUserAvatar` sized to the avatar diameter.
- Add scoped CSS for `.race-chart__avatar-fo` to ensure proper sizing and pointer-events as needed; disable gauge/indicator via props.
- Verify stacking still works and borders retain participant color.
- Test in sim to confirm no reintroduced gaps or misalignments.

## Avatar endpoint labels — coin totals
- **Goal:** Show each participant’s current `coins_total` immediately to the left of their avatar marker, outside the avatar chrome.
- **Data:** Reuse the already forward/backfilled `coins_total` series; take the last numeric sample for each participant (fallback to `heart_beats` only if coins unavailable).
- **Positioning:** Render a small label group anchored to the same `x,y+offset` as the avatar; place the text with `text-anchor="end"` and a fixed left padding (e.g., 10–12px gap) so the label sits left-aligned to the avatar edge. Keep vertical center aligned to the avatar.
- **Rendering host:** Use an SVG `<text>` (simpler) or a lightweight `<foreignObject>` with a `<span>` if you need font control; keep `pointer-events: none` so labels don’t block hover.
- **Styling:** Semi-bold, compact number (`font-size: 11–12px`, `font-weight: 600`, neutral/light color with slight shadow for contrast). Optionally prepend a small coin glyph; avoid colored backgrounds to reduce overlap noise.
- **Overlap behavior:** Inherit the existing avatar stack offset so labels travel with avatars. If multiple avatars share the same `x`, allow slight vertical jitter (same as avatar offset) and do not try to horizontally separate labels (we already separate by offset).
- **Abbreviation:** Format numbers with `toLocaleString` and short suffixes (`1.2k`, `950`, `12.4k`) to keep the label under ~4–6 chars.
## Detailed design — files and responsibilities
- `frontend/src/modules/Fitness/FitnessSidebar/FitnessChart.jsx`
	- Replace current heart-rate sparkline with new RaceChart implementation (SVG-based).
	- Export default component (name can stay `FitnessChart`); internal render uses helpers below.
	- Add helpers: `buildBeatsSeries(rosterEntry, getSeries, timebase)`, `buildSegments(beats, zones, timebase)`, `createPaths(segments, width, height)`.
	- Subcomponents: `RaceChartSvg`, `RaceChartAvatar`, optional `RaceChartLegend`.
- `frontend/src/modules/Fitness/FitnessSidebar/FitnessChart.scss`
	- Update styles for race chart: line strokes, segment colors, avatar chips (stack/offset), empty state, header.
- `frontend/src/context/FitnessContext.jsx`
	- Ensure `getUserTimelineSeries` supports `heart_beats` and `zone_id` retrieval (already present); no API change expected.
- `frontend/src/hooks/fitness/FitnessSession.js`
	- No new changes expected; chart is read-only consumer (ensure `heart_beats`/`zone_id` series are present as implemented earlier).
- `frontend/src/modules/Fitness/FitnessSidebar/index` (if any barrel) or `FitnessSidebar.jsx`
	- Export/use the updated chart component.
- `frontend/src/modules/Fitness/FitnessCam.jsx`
	- Add `viewMode` state (`cam` | `chart`).
	- Conditionally render RaceChart in main area when `viewMode === 'chart'`.
	- Move webcam preview into sidebar when chart mode is active (reuse existing stage component scaled down or a new `MiniCam` wrapper).
	- Pass toggle handler to `FitnessSidebar` (`onToggleChart` prop).
- `frontend/src/modules/Fitness/FitnessSidebar/FitnessSidebar.jsx`
	- Add UI control (toggle/button) to switch view mode; call `onToggleChart` prop.
	- Optionally show mini-cam slot when chart mode is active.
- Optional: `frontend/src/modules/Fitness/FitnessSidebar/FitnessChart.test.jsx` (new)
	- Unit test data shaping (beats integration, segment building) and rendering of empty/leader states.
	- Storybook/story (if used) to visualize overlap handling and early-session padding.

## Phased implementation plan
- Phase 1: Data shaping + helpers
	- Implement `buildBeatsSeries`, `buildSegments`, and `createPaths` in `FitnessChart.jsx` (or colocated helper file), with unit tests for beats integration, zone segmentation, and path generation.
- Phase 2: SVG rendering
	- Replace `FitnessChart.jsx` UI with `RaceChartSvg`, `RaceChartAvatar`, segmented polylines, empty/leader states, and overlap handling; update `FitnessChart.scss` styling.
- Phase 3: Integration with context
	- Wire the chart to `useFitnessContext` data (`participantRoster`, `getUserTimelineSeries`, `timelineTimebase`); ensure zone series pulled and mapped. Validate early-session padding behavior.
- Phase 4: FitnessCam/Sidebar toggle
	- Add `viewMode` state to `FitnessCam.jsx`, sidebar toggle UI in `FitnessSidebar.jsx`, and mini-cam placement when chart mode is active.