# Bug 01: Chart Dropout Visualization Threshold

**Severity:** Low
**Area:** Visualization
**Status:** Open

## Summary

Grey dotted lines (dropouts) are appearing for insignificant gaps in the fitness chart. The visualization should enforce a 2-minute minimum threshold before rendering the grey dotted line style.

## Current Behavior

- Any gap in heart rate data triggers the grey dotted line rendering
- Short gaps (< 2 minutes) display the same as long gaps
- Creates visual noise for brief sensor disconnects

## Expected Behavior

- **Gap < 2 minutes:** Fill with the color of the dropout point (maintain visual continuity)
- **Gap >= 2 minutes:** Use grey dotted line (indicate significant dropout)

## Relevant Code

### Gap Detection Logic
**File:** `frontend/src/modules/Fitness/FitnessSidebar/FitnessChart.helpers.js`

| Function | Lines | Purpose |
|----------|-------|---------|
| `buildSegments()` | 317-459 | Detects dropouts and creates gap segments |
| `isDropout(tickStatus)` | 374-383 | Checks if a tick represents dropout |
| `createPaths()` | 574-663 | Converts segments to SVG paths with styling |

**Key logic (lines 386-408):** Creates horizontal gap segments at dropout points with `isGap: true`

### Gap Rendering
**File:** `frontend/src/modules/Fitness/FitnessPlugins/plugins/FitnessChartApp/FitnessChartApp.jsx`

| Function | Lines | Purpose |
|----------|-------|---------|
| `RaceChartSvg()` | 481-630 | Renders SVG paths for chart |

**Current styling (lines 510-523):**
```jsx
<path
  stroke={path.isGap ? ZONE_COLOR_MAP.default : path.color}  // Grey for ALL gaps
  strokeDasharray={path.isGap ? '4 4' : undefined}           // Dotted for ALL gaps
/>
```

### Alternative Builder
**File:** `frontend/src/modules/Fitness/domain/ChartDataBuilder.js`

- Gap segment creation at lines 489-504
- Same issue: all gaps treated uniformly regardless of duration

## Root Cause

The gap styling logic (`isGap` flag) is binary - it doesn't consider the **duration** of the gap. The segment creation marks any dropout as a gap without capturing the gap length for downstream styling decisions.

## Fix Direction

1. **Capture gap duration** in `buildSegments()`:
   - When creating a gap segment, calculate `gapDurationMs` or `gapDurationTicks`
   - Store on the segment: `{ isGap: true, gapDurationMs: ... }`

2. **Threshold constant**:
   - Add `MIN_GAP_DURATION_FOR_DASHED_MS = 2 * 60 * 1000` (2 minutes)

3. **Conditional styling** in `createPaths()` and `RaceChartSvg()`:
   - If `isGap && gapDurationMs >= MIN_GAP_DURATION_FOR_DASHED_MS`: grey dotted
   - If `isGap && gapDurationMs < MIN_GAP_DURATION_FOR_DASHED_MS`: use segment color, solid

## Testing Approach

Runtime tests should:
1. Create session data with various gap durations (30s, 1min, 2min, 5min)
2. Verify short gaps render with segment color (solid)
3. Verify long gaps render grey dotted
4. Edge case: exactly 2-minute gap should use dotted style
