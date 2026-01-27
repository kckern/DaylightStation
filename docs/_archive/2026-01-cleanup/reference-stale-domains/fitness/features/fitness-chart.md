# Fitness Chart

## Overview

The Fitness Chart displays real-time race-style progress visualization during fitness sessions. Each participant's accumulated coins are plotted as a line graph with zone-colored segments, avatars at line endpoints, and dropout badges for inactive participants.

**Related code:**
- `frontend/src/modules/Fitness/FitnessSidebar/FitnessChart.jsx` - Wrapper component
- `frontend/src/modules/Fitness/FitnessSidebar/FitnessChart.helpers.js` - Core data transformation
- `frontend/src/modules/Fitness/FitnessPlugins/plugins/FitnessChartApp/FitnessChartApp.jsx` - Main chart renderer
- `frontend/src/modules/Fitness/FitnessPlugins/plugins/FitnessChartApp/layout/LayoutManager.js` - Avatar/badge collision resolution

---

## Architecture

### Component Hierarchy

```
FitnessChart.jsx (Sidebar wrapper)
    └── FitnessChartApp.jsx (Full implementation)
            ├── useFitnessPlugin() - Access session data
            ├── useRaceChartWithHistory() - Build chart data
            │       ├── useRaceChartData() - Transform roster to entries
            │       └── buildBeatsSeries() - Extract timeline data
            ├── LayoutManager - Collision resolution
            └── RaceChartSvg - SVG rendering
```

### Data Flow

```
┌─────────────────────────────────────────────────────────────────────┐
│                      FitnessContext                                  │
├─────────────────────────────────────────────────────────────────────┤
│  participants: RosterEntry[]     (from ParticipantRoster)           │
│  getUserTimelineSeries: fn       (from Timeline)                     │
│  timebase: { intervalMs, ... }   (from Timeline)                     │
│  activityMonitor: ActivityMonitor (dropout/activity tracking)        │
│  zoneConfig: ZoneConfig[]        (from FitnessSession)              │
└─────────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────────┐
│                  useRaceChartWithHistory()                           │
├─────────────────────────────────────────────────────────────────────┤
│  For each participant:                                               │
│    1. buildBeatsSeries() → { beats[], zones[], active[] }           │
│    2. buildSegments() → ChartSegment[]                              │
│    3. Track dropout markers from activity gaps                       │
│                                                                      │
│  Output: { presentEntries, absentEntries, dropoutMarkers, ... }     │
└─────────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────────┐
│                      createPaths()                                   │
├─────────────────────────────────────────────────────────────────────┤
│  Transform segments → SVG path strings with scaling                  │
│  Apply logarithmic Y-scale for visual separation                     │
│  Handle gap (dropout) segments with dashed styling                   │
└─────────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────────┐
│                    LayoutManager.layout()                            │
├─────────────────────────────────────────────────────────────────────┤
│  Input: avatars[] + badges[]                                         │
│  Resolve collisions (avatars cluster at right edge)                  │
│  Generate connectors for displaced elements                          │
│  Output: { elements[], connectors[] }                                │
└─────────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────────┐
│                      RaceChartSvg                                    │
├─────────────────────────────────────────────────────────────────────┤
│  Render: grid lines, axes, paths, connectors, badges, avatars        │
│  Z-order: grid → axes → paths → connectors → badges → avatars        │
└─────────────────────────────────────────────────────────────────────┘
```

---

## Components

### FitnessChart.jsx

Simple wrapper that renders `FitnessChartApp` in sidebar mode. Re-exports helper functions for backward compatibility.

```jsx
// Usage
import FitnessChart from '../FitnessSidebar/FitnessChart';

<FitnessChart />
```

**Exports:**
- `default` - FitnessChart component
- `MIN_VISIBLE_TICKS` - Minimum X-axis tick count (30)
- `ZONE_COLOR_MAP` - Zone ID to color mapping
- `buildBeatsSeries` - Extract coin/zone/activity data
- `buildSegments` - Create chart segments
- `createPaths` - Generate SVG paths
- `getZoneCoinRate` - Get coin rate for a zone
- `buildLiveEdge` - Build live edge for real-time updates

### FitnessChartApp.jsx

Full chart implementation supporting multiple display modes.

```jsx
// Usage
<FitnessChartApp
  mode="sidebar"     // "sidebar" | "standalone" | "overlay" | "mini"
  onClose={() => {}}
  config={...}
  onMount={() => {}}
/>
```

**Props:**
| Prop | Type | Description |
|------|------|-------------|
| `mode` | string | Display mode affecting layout CSS class |
| `onClose` | function | Callback when chart is closed |
| `config` | object | Plugin configuration |
| `onMount` | function | Callback when component mounts |

---

## Helper Functions

### buildBeatsSeries(rosterEntry, getSeries, timebase, options)

Extracts coin accumulation and zone data for a participant.

**Parameters:**
- `rosterEntry` - Participant roster entry with `profileId`/`id`
- `getSeries` - Timeline series getter function
- `timebase` - Timeline timebase config (`{ intervalMs }`)
- `options.activityMonitor` - Optional ActivityMonitor for centralized tracking
- `options.getEntitySeries` - Optional entity-based series getter (Phase 5)

**Returns:**
```typescript
{
  beats: number[];   // Cumulative coin values per tick
  zones: string[];   // Zone IDs per tick ('active', 'warm', 'hot', 'fire')
  active: boolean[]; // Whether HR data was present at each tick
}
```

**Data Sources (priority order):**
1. `coins_total` from TreasureBox (preferred)
2. `heart_beats` pre-computed series
3. Computed from `heart_rate` (deprecated fallback)

### buildSegments(beats, zones, active, options)

Creates chart segments from series data. Each segment represents a continuous colored portion of the line.

**Parameters:**
- `beats` - Array of cumulative coin values
- `zones` - Array of zone IDs
- `active` - Array of activity booleans
- `options.isCurrentlyActive` - Whether user is currently active (from roster)
- `options.currentTick` - Current tick index
- `options.zoneConfig` - Zone configuration for coin rate lookup

**Returns:**
```typescript
ChartSegment[] = {
  zone: string | null;         // Zone ID or null for gaps
  color: string;               // Hex color
  status: ParticipantStatus;   // ACTIVE | IDLE | REMOVED
  isGap: boolean;              // True for dropout periods
  points: { i: number, v: number }[];  // Tick index and value
}[]
```

**Segment Types:**
1. **Active segments** - Colored by zone, solid line
2. **Gap segments** - Grey, dashed, horizontal line during dropout

### createPaths(segments, options)

Converts segments to SVG path strings with coordinate scaling.

**Parameters:**
- `segments` - ChartSegment array from buildSegments
- `options.width` - Chart width in pixels
- `options.height` - Chart height in pixels
- `options.margin` - `{ top, right, bottom, left }`
- `options.minVisibleTicks` - Minimum X-axis range
- `options.maxValue` - Y-axis maximum
- `options.yScaleBase` - Logarithmic scale base (default: 20)
- `options.scaleY` - Custom Y-scale function

**Returns:**
```typescript
{
  zone: string | null;
  color: string;
  status: ParticipantStatus;
  opacity: number;     // 0.5 for gaps, 1.0 for active
  isGap: boolean;
  d: string;           // SVG path d attribute
}[]
```

### getZoneCoinRate(zoneId, zoneConfig)

Returns the coin rate for a zone ID.

**Parameters:**
- `zoneId` - Zone ID string ('active', 'warm', 'hot', 'fire')
- `zoneConfig` - Zone configuration array with `coins` property

**Returns:** Number - coins per interval (0 for blue/unknown)

**Default rates:**
- `active` (blue): 0 coins
- `warm` (yellow): 1 coin
- `hot` (orange): 3 coins
- `fire` (red): 5 coins

### buildLiveEdge({ lastTick, lastValue, liveProgress, currentTick })

Builds live edge data for smooth real-time updates between recorded ticks.

**Parameters:**
- `lastTick` - Last recorded tick index
- `lastValue` - Last recorded coin value
- `liveProgress` - From `TreasureBox.getIntervalProgress()`
- `currentTick` - Current tick (may be fractional)

**Returns:**
```typescript
{
  startTick: number;
  startValue: number;
  endTick: number;
  endValue: number;    // Projected total
  zone: string;
  color: string;
  isLive: true;
} | null
```

---

## Zone Colors

Defined in `frontend/src/modules/Fitness/domain/types.js`:

| Zone ID | Color | Meaning |
|---------|-------|---------|
| `active` | `#3b82f6` (blue) | Below target HR - no coins |
| `warm` | `#eab308` (yellow) | In lower zone - slow coins |
| `hot` | `#f97316` (orange) | In target zone - good coins |
| `fire` | `#ef4444` (red) | High intensity - max coins |
| `default` | `#9ca3af` (grey) | No zone data / gap |

---

## Participant States

From `ParticipantStatus` enum:

| Status | Meaning | Visual |
|--------|---------|--------|
| `ACTIVE` | Currently broadcasting HR | Avatar at line tip |
| `IDLE` | Stopped broadcasting, still in session | Gap segment (dashed grey) |
| `REMOVED` | Left session entirely | Badge at dropout point |

---

## Dropout Detection

Dropout is detected from the `active` array in `buildBeatsSeries`:

1. **ActivityMonitor** (preferred) - Centralized activity tracking
2. **heart_rate nulls** (fallback) - `active[i] = hr != null && hr > 0`

When a participant drops out:
1. Current segment ends
2. Horizontal gap segment created (dashed grey)
3. Dropout badge may appear at dropout tick

When participant rejoins:
1. Gap segment extends to rejoin tick
2. New colored segment starts
3. Vertical jump shows coins earned after rejoin

---

## Y-Scale Behavior

The chart uses different Y-scale strategies based on **historic participant count** (not current snapshot):

| Historic User Count | Scale Type | Behavior |
|---------------------|------------|----------|
| 1 user | **Linear** | Direct mapping, evenly distributed gridlines |
| 2 users | **Logarithmic** | Standard log scale (base 20) for visual separation |
| 3+ users | **Power curve** | Clamps lowest user to 25% chart height |

**Key behaviors:**

- **Scale persistence**: Once a session has multiple participants, the scale stays non-linear even if users drop out. This is determined by `allEntries.length` (historic) not `presentEntries.length` (current).
- **Linear gridlines**: When single-user linear scale is active, horizontal gridlines are evenly distributed across the Y-axis.
- **Power curve formula**: For 3+ users, calculates `k = log(0.25) / log(normLow)` then applies `mapped = norm^k` to ensure the lowest participant stays visible at 25% height.

**Gridline distribution:**

| Mode | Gridline Range | User Position |
|------|----------------|---------------|
| Single user | 0 to maxValue (full chart) | Near top (absolute progress) |
| Multi-user | lowestAvatar to maxValue | Distributed by relative rank |

In single-user mode, gridlines span the full chart height from 0 (X-axis) to the maximum value, with equal spacing between all gridlines including the gap to the X-axis. The user's line appears near the top of the chart, showing their absolute coin progress.

```javascript
if (userCount === 1) {
  mapped = norm;  // Linear
} else if (userCount === 2) {
  mapped = 1 - Math.log(1 + (1 - norm) * (logBase - 1)) / Math.log(logBase);
} else {
  const k = Math.log(0.25) / Math.log(normLow);
  mapped = Math.pow(norm, k);  // Power curve
}
```

This prevents leading participants from squashing others to the bottom of the chart while keeping single-user sessions simple and readable.

---

## Layout Manager Integration

The chart uses `LayoutManager` for collision resolution:

```javascript
const layoutManager = new LayoutManager({
  bounds: { width, height, margin },
  avatarRadius: 30,
  badgeRadius: 10,
  options: {
    enableConnectors: true,
    minSpacing: 4,
    maxDisplacement: 100,
    maxBadgesPerUser: 3
  }
});

const { elements, connectors } = layoutManager.layout([...avatars, ...badges]);
```

See [chart-layout.md](chart-layout.md) for detailed layout documentation.

---

## Zone Slope Enforcement

To fix the "sawtooth" pattern in chart rendering, `enforceZoneSlopes()` interpolates segment values based on zone coin rates:

- **Blue zones (coinRate=0)**: Enforced flat - all points use start value
- **Non-blue zones**: If flat when shouldn't be, interpolates expected slope
- **Gap segments**: Unchanged (already flat)

This ensures visual consistency between rendered slope and expected coin accumulation.

---

## Performance Considerations

1. **Memoization** - `useRaceChartData` and paths are memoized on roster/timebase changes
2. **Persisted state** - Last valid render persisted to prevent flicker during data updates
3. **ResizeObserver** - Chart dimensions update on container resize
4. **Diagnostic logging** - Warmup and mismatch warnings logged to console for debugging

---

## Constants

```javascript
const DEFAULT_CHART_WIDTH = 420;
const DEFAULT_CHART_HEIGHT = 390;
const CHART_MARGIN = { top: 10, right: 90, bottom: 38, left: 4 };
const AVATAR_RADIUS = 30;
const ABSENT_BADGE_RADIUS = 10;
const COIN_LABEL_GAP = 8;
const Y_SCALE_BASE = 20;
const MIN_GRID_LINES = 4;
const PATH_STROKE_WIDTH = 5;
const MIN_VISIBLE_TICKS = 30;
```

---

## Usage Examples

### Basic Sidebar Usage

```jsx
import FitnessChart from '../FitnessSidebar/FitnessChart';

function FitnessSidebar() {
  return (
    <div className="fitness-sidebar">
      <FitnessChart />
    </div>
  );
}
```

### Direct FitnessChartApp Usage

```jsx
import FitnessChartApp from '../FitnessPlugins/plugins/FitnessChartApp';

function CustomChartView() {
  return (
    <FitnessChartApp
      mode="standalone"
      onClose={() => navigate('/fitness')}
      onMount={() => console.log('Chart ready')}
    />
  );
}
```

### Using Helper Functions

```jsx
import { buildBeatsSeries, buildSegments, createPaths } from '../FitnessSidebar/FitnessChart';

function CustomRenderer({ participant, getSeries, timebase }) {
  const { beats, zones, active } = buildBeatsSeries(participant, getSeries, timebase);
  const segments = buildSegments(beats, zones, active);
  const paths = createPaths(segments, { width: 400, height: 300 });

  return (
    <svg>
      {paths.map((path, i) => (
        <path key={i} d={path.d} stroke={path.color} />
      ))}
    </svg>
  );
}
```

---

## Debugging

### Console Warnings

| Warning | Meaning | Action |
|---------|---------|--------|
| `[FitnessChart][warmup]` | No series data while roster has participants | Wait for timeline to populate |
| `[FitnessChart] Avatar mismatch` | Roster count differs from chart count | Check ID normalization |
| `fitness_chart.id_fallback` | Using non-canonical ID (name/hrDeviceId) | Ensure profileId is set |
| `fitness_chart.no_series_data` | No coins/beats/HR data for participant | Check timeline recording |
| `fitness_chart.hr_calc_fallback` | Computing beats from HR (deprecated) | Ensure coins_total is recorded |

### Data Flow Verification

1. Check `participants` in FitnessContext - should have roster entries
2. Check `getUserTimelineSeries(userId, 'coins_total')` - should return array
3. Check `buildBeatsSeries` return - should have non-empty `beats` array
4. Check `buildSegments` return - should have segment objects with points

---

## Related Documentation

- [chart-layout.md](chart-layout.md) - LayoutManager collision resolution
- [sessions.md](sessions.md) - Session lifecycle and entity tracking
- [../../ai-context/fitness.md](../../ai-context/fitness.md) - Fitness domain overview
