# Session Detail Redesign & FitnessSidebar Decommission

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Redesign FitnessSessionDetailWidget with a 3-row layout (header/chart/timeline), create a new FitnessTimeline component, and migrate all FitnessSidebar/ code into the FitnessModules/ framework so FitnessSidebar/ can be deleted.

**Architecture:** The session detail widget becomes a vertical flex container with 25%/40%/35% row splits. The chart row reuses FitnessChartApp as-is. The new FitnessTimeline shares the chart's X axis domain and margins for pixel-perfect alignment. The sidebar decommission is a pure file-move + import-path update with no behavior changes.

**Tech Stack:** React, SVG, Mantine, existing sessionDataAdapter + FitnessChart.helpers.js

---

## Task 1: Move FitnessChart.helpers.js into FitnessModules

**Files:**
- Move: `frontend/src/modules/Fitness/FitnessSidebar/FitnessChart.helpers.js` → `frontend/src/modules/Fitness/FitnessModules/lib/chartHelpers.js`
- Modify: `frontend/src/modules/Fitness/FitnessModules/modules/FitnessChartApp/FitnessChartApp.jsx:13`
- Modify: `frontend/src/modules/Fitness/FitnessSidebar/FitnessChart.jsx:5-13`

**Step 1: Copy the file to its new location**

```bash
cp frontend/src/modules/Fitness/FitnessSidebar/FitnessChart.helpers.js \
   frontend/src/modules/Fitness/FitnessModules/lib/chartHelpers.js
```

**Step 2: Update FitnessChartApp.jsx import**

In `FitnessChartApp.jsx` line 7-13, change:
```js
} from '../../../FitnessSidebar/FitnessChart.helpers.js';
```
to:
```js
} from '../../lib/chartHelpers.js';
```

**Step 3: Update FitnessChart.jsx re-exports (temporary — deleted in Task 6)**

In `FitnessSidebar/FitnessChart.jsx` lines 5-13, change the re-export source:
```js
} from './FitnessChart.helpers.js';
```
to:
```js
} from '../FitnessModules/lib/chartHelpers.js';
```

**Step 4: Delete the old file**

```bash
rm frontend/src/modules/Fitness/FitnessSidebar/FitnessChart.helpers.js
```

**Step 5: Verify build**

```bash
cd frontend && npx vite build --mode development 2>&1 | head -20
```
Expected: No import resolution errors.

**Step 6: Commit**

```bash
git add frontend/src/modules/Fitness/FitnessModules/lib/chartHelpers.js \
       frontend/src/modules/Fitness/FitnessModules/modules/FitnessChartApp/FitnessChartApp.jsx \
       frontend/src/modules/Fitness/FitnessSidebar/FitnessChart.jsx \
       frontend/src/modules/Fitness/FitnessSidebar/FitnessChart.helpers.js
git commit -m "refactor(fitness): move chart helpers to FitnessModules/lib/"
```

---

## Task 2: Extract shared chart constants

FitnessChartApp.jsx defines margins/dimensions that the new FitnessTimeline needs for X axis alignment. Extract them to a shared constants file.

**Files:**
- Create: `frontend/src/modules/Fitness/FitnessModules/lib/chartConstants.js`
- Modify: `frontend/src/modules/Fitness/FitnessModules/modules/FitnessChartApp/FitnessChartApp.jsx`

**Step 1: Create the shared constants file**

```js
// frontend/src/modules/Fitness/FitnessModules/lib/chartConstants.js

export const CHART_MARGIN = { top: 10, right: 90, bottom: 38, left: 4 };
export const MIN_VISIBLE_TICKS = 30;
```

**Step 2: Update FitnessChartApp.jsx to import from shared constants**

Replace the local `CHART_MARGIN` definition (line 21) and remove local `MIN_VISIBLE_TICKS` import:

In `FitnessChartApp.jsx`, change:
```js
import {
	MIN_VISIBLE_TICKS,
	ZONE_COLOR_MAP,
	buildBeatsSeries,
	buildSegments,
	createPaths
} from '../../lib/chartHelpers.js';
```
to:
```js
import {
	ZONE_COLOR_MAP,
	buildBeatsSeries,
	buildSegments,
	createPaths
} from '../../lib/chartHelpers.js';
import { CHART_MARGIN, MIN_VISIBLE_TICKS } from '../../lib/chartConstants.js';
```

And remove the local `CHART_MARGIN` const declaration (line 21):
```js
// DELETE this line:
const CHART_MARGIN = { top: 10, right: 90, bottom: 38, left: 4 };
```

**Step 3: Verify build**

```bash
cd frontend && npx vite build --mode development 2>&1 | head -20
```

**Step 4: Commit**

```bash
git add frontend/src/modules/Fitness/FitnessModules/lib/chartConstants.js \
       frontend/src/modules/Fitness/FitnessModules/modules/FitnessChartApp/FitnessChartApp.jsx
git commit -m "refactor(fitness): extract shared chart constants for timeline alignment"
```

---

## Task 3: Create FitnessTimeline component

New SVG component that renders non-cumulative HR area charts per participant, sharing the chart's X axis.

**Files:**
- Create: `frontend/src/modules/Fitness/FitnessModules/modules/HomeApp/widgets/FitnessTimeline.jsx`
- Create: `frontend/src/modules/Fitness/FitnessModules/modules/HomeApp/widgets/FitnessTimeline.scss`

**Step 1: Create FitnessTimeline.jsx**

```jsx
// frontend/src/modules/Fitness/FitnessModules/modules/HomeApp/widgets/FitnessTimeline.jsx

import React, { useMemo, useRef, useState, useLayoutEffect } from 'react';
import { createChartDataSource } from '../../FitnessChartApp/sessionDataAdapter.js';
import { CHART_MARGIN, MIN_VISIBLE_TICKS } from '../../../lib/chartConstants.js';
import { ZONE_COLOR_MAP } from '../../../lib/chartHelpers.js';
import './FitnessTimeline.scss';

/**
 * Map a tick index to an X pixel position, matching FitnessChartApp's X axis.
 */
function tickToX(index, effectiveTicks, plotWidth) {
  if (effectiveTicks <= 1) return CHART_MARGIN.left;
  return CHART_MARGIN.left + (index / (effectiveTicks - 1)) * plotWidth;
}

/**
 * Build an SVG area path for a single participant's HR series.
 * Returns { path: string, fills: Array<{ d: string, color: string }> }
 * where fills are zone-colored sub-areas.
 */
function buildHrAreaPath(hrSeries, zoneSeries, effectiveTicks, plotWidth, laneTop, laneHeight) {
  if (!hrSeries || hrSeries.length === 0) return { fills: [] };

  // Find HR range for this participant
  let hrMin = Infinity, hrMax = -Infinity;
  for (let i = 0; i < hrSeries.length; i++) {
    const v = hrSeries[i];
    if (Number.isFinite(v) && v > 0) {
      if (v < hrMin) hrMin = v;
      if (v > hrMax) hrMax = v;
    }
  }
  if (!Number.isFinite(hrMin) || hrMin === hrMax) {
    hrMin = hrMax - 10 || 50;
  }

  // Add 10% padding below minimum so the area doesn't touch the floor
  const range = hrMax - hrMin;
  const paddedMin = hrMin - range * 0.1;

  // Scale HR value to Y pixel within the lane (inverted: top = max)
  const hrToY = (hr) => {
    if (!Number.isFinite(hr) || hr <= 0) return laneTop + laneHeight;
    const ratio = (hr - paddedMin) / (hrMax - paddedMin);
    return laneTop + laneHeight - ratio * laneHeight;
  };

  const baseline = laneTop + laneHeight;

  // Build zone-colored area fills
  const fills = [];
  let segStart = 0;
  for (let i = 0; i <= hrSeries.length; i++) {
    const currentZone = zoneSeries?.[i] || null;
    const prevZone = i > 0 ? (zoneSeries?.[i - 1] || null) : null;

    // When zone changes or we reach the end, close the current segment
    if (i === hrSeries.length || (i > 0 && currentZone !== prevZone)) {
      const segEnd = i;
      const zone = prevZone || 'rest';
      const color = ZONE_COLOR_MAP[zone] || ZONE_COLOR_MAP.default || '#888';

      // Build area path for this segment
      let d = '';
      // Top line (HR values)
      for (let j = segStart; j < segEnd; j++) {
        const x = tickToX(j, effectiveTicks, plotWidth);
        const y = hrToY(hrSeries[j]);
        d += j === segStart ? `M${x},${y}` : ` L${x},${y}`;
      }
      // Bottom line (baseline, right to left)
      const xEnd = tickToX(segEnd - 1, effectiveTicks, plotWidth);
      const xStart = tickToX(segStart, effectiveTicks, plotWidth);
      d += ` L${xEnd},${baseline} L${xStart},${baseline} Z`;

      fills.push({ d, color });
      segStart = i;
    }
  }

  return { fills };
}

/**
 * Format milliseconds as m:ss duration label.
 */
function formatDuration(ms) {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, '0')}`;
}

export default function FitnessTimeline({ sessionData }) {
  const containerRef = useRef(null);
  const [dimensions, setDimensions] = useState({ width: 0, height: 0 });

  // Observe container size
  useLayoutEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect;
      setDimensions({ width: Math.round(width), height: Math.round(height) });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const { getSeries, roster, timebase } = useMemo(
    () => createChartDataSource(sessionData),
    [sessionData]
  );

  const { width, height } = dimensions;
  const plotWidth = width - CHART_MARGIN.left - CHART_MARGIN.right;
  const plotHeight = height - CHART_MARGIN.bottom; // no top margin for timeline

  // Build per-participant lane data
  const lanes = useMemo(() => {
    if (!roster || roster.length === 0 || plotWidth <= 0 || plotHeight <= 0) return [];

    const participantCount = roster.length;
    const laneGap = 2;
    const laneHeight = Math.max(10, (plotHeight - (participantCount - 1) * laneGap) / participantCount);

    return roster.map((entry, idx) => {
      const userId = entry.id || entry.profileId;
      const hrSeries = getSeries(userId, 'heart_rate', { clone: false });
      const zoneSeries = getSeries(userId, 'zone_id', { clone: false }) || getSeries(userId, 'zone', { clone: false });

      const maxIndex = hrSeries.reduce((max, v, i) => (Number.isFinite(v) && v > 0 ? i : max), 0);
      const effectiveTicks = Math.max(MIN_VISIBLE_TICKS, (timebase.tickCount || maxIndex + 1));

      const laneTop = idx * (laneHeight + laneGap);
      const { fills } = buildHrAreaPath(hrSeries, zoneSeries, effectiveTicks, plotWidth, laneTop, laneHeight);

      return {
        userId,
        name: entry.displayLabel || entry.name || userId,
        avatarUrl: entry.avatarUrl,
        laneTop,
        laneHeight,
        fills,
        effectiveTicks,
      };
    });
  }, [roster, getSeries, timebase, plotWidth, plotHeight]);

  // X axis tick labels (match chart: 0%, 25%, 50%, 75%, 100%)
  const xTicks = useMemo(() => {
    if (lanes.length === 0 || plotWidth <= 0) return [];
    const effectiveTicks = lanes[0]?.effectiveTicks || MIN_VISIBLE_TICKS;
    const totalMs = effectiveTicks * (timebase.intervalMs || 5000);
    return [0, 0.25, 0.5, 0.75, 1].map((pct) => ({
      x: CHART_MARGIN.left + pct * plotWidth,
      label: formatDuration(pct * totalMs),
    }));
  }, [lanes, plotWidth, timebase]);

  if (!sessionData || width === 0) {
    return <div ref={containerRef} className="fitness-timeline" />;
  }

  return (
    <div ref={containerRef} className="fitness-timeline">
      <svg width={width} height={height} className="fitness-timeline__svg">
        {/* Participant lanes */}
        {lanes.map((lane) => (
          <g key={lane.userId}>
            {/* Zone-colored area fills */}
            {lane.fills.map((fill, i) => (
              <path
                key={i}
                d={fill.d}
                fill={fill.color}
                opacity={0.6}
                stroke="none"
              />
            ))}
            {/* Participant label */}
            <text
              x={CHART_MARGIN.left + 4}
              y={lane.laneTop + 12}
              className="fitness-timeline__label"
            >
              {lane.name}
            </text>
          </g>
        ))}
        {/* X axis labels */}
        <g className="fitness-timeline__x-axis">
          {xTicks.map((tick, i) => (
            <text
              key={i}
              x={tick.x}
              y={height - 6}
              textAnchor="middle"
              className="fitness-timeline__tick"
            >
              {tick.label}
            </text>
          ))}
        </g>
      </svg>
    </div>
  );
}
```

**Step 2: Create FitnessTimeline.scss**

```scss
// frontend/src/modules/Fitness/FitnessModules/modules/HomeApp/widgets/FitnessTimeline.scss

.fitness-timeline {
  width: 100%;
  height: 100%;
  position: relative;
  overflow: hidden;

  &__svg {
    display: block;
    width: 100%;
    height: 100%;
  }

  &__label {
    font-size: 11px;
    fill: rgba(255, 255, 255, 0.7);
    font-weight: 600;
    pointer-events: none;
    text-shadow: 0 1px 2px rgba(0, 0, 0, 0.5);
  }

  &__tick {
    font-size: 11px;
    fill: rgba(255, 255, 255, 0.4);
    font-weight: 400;
  }
}
```

**Step 3: Verify build**

```bash
cd frontend && npx vite build --mode development 2>&1 | head -20
```

**Step 4: Commit**

```bash
git add frontend/src/modules/Fitness/FitnessModules/modules/HomeApp/widgets/FitnessTimeline.jsx \
       frontend/src/modules/Fitness/FitnessModules/modules/HomeApp/widgets/FitnessTimeline.scss
git commit -m "feat(fitness): add FitnessTimeline component with per-participant HR area chart"
```

---

## Task 4: Redesign FitnessSessionDetailWidget

Replace the current single-chart layout with the 3-row design.

**Files:**
- Modify: `frontend/src/modules/Fitness/FitnessModules/modules/HomeApp/widgets/FitnessSessionDetailWidget.jsx`
- Create: `frontend/src/modules/Fitness/FitnessModules/modules/HomeApp/widgets/FitnessSessionDetailWidget.scss`

**Step 1: Create the SCSS file**

```scss
// frontend/src/modules/Fitness/FitnessModules/modules/HomeApp/widgets/FitnessSessionDetailWidget.scss

.session-detail {
  display: flex;
  flex-direction: column;
  height: 100%;
  width: 100%;
  overflow: hidden;
  background: transparent;

  // ── Header row (25%) ──
  &__header {
    flex: 0 0 25%;
    display: flex;
    flex-direction: row;
    align-items: stretch;
    gap: 0;
    overflow: hidden;
    padding: 8px 12px;
  }

  &__poster,
  &__thumb {
    flex: 0 0 auto;
    height: 100%;
    aspect-ratio: 2/3;
    border-radius: 6px;
    overflow: hidden;

    img {
      width: 100%;
      height: 100%;
      object-fit: cover;
      display: block;
    }

    &--placeholder {
      background: rgba(255, 255, 255, 0.05);
    }
  }

  &__thumb {
    aspect-ratio: 16/9;
  }

  &__meta {
    flex: 1 1 0;
    display: flex;
    flex-direction: column;
    justify-content: center;
    padding: 0 16px;
    min-width: 0;
    gap: 4px;
  }

  &__meta-top {
    display: flex;
    flex-direction: column;
    gap: 2px;
  }

  &__title {
    font-size: 1.1rem;
    font-weight: 700;
    color: #fff;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  &__show {
    font-size: 0.85rem;
    color: rgba(255, 255, 255, 0.5);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  &__meta-bottom {
    display: flex;
    flex-direction: row;
    align-items: center;
    gap: 10px;
    margin-top: 4px;
    flex-wrap: wrap;
  }

  &__meta-item {
    font-size: 0.8rem;
    color: rgba(255, 255, 255, 0.45);
    font-weight: 500;
    white-space: nowrap;
  }

  &__coins {
    color: #f5c542;
    font-weight: 600;
  }

  // ── Chart row (40%) ──
  &__chart {
    flex: 0 0 40%;
    overflow: hidden;
    position: relative;
  }

  // ── Timeline row (35%) ──
  &__timeline {
    flex: 0 0 35%;
    overflow: hidden;
    position: relative;
  }
}
```

**Step 2: Rewrite FitnessSessionDetailWidget.jsx**

```jsx
// frontend/src/modules/Fitness/FitnessModules/modules/HomeApp/widgets/FitnessSessionDetailWidget.jsx

import React, { useState, useEffect, useMemo } from 'react';
import { Text, Skeleton } from '@mantine/core';
import { getWidgetRegistry } from '../../../../../../screen-framework/widgets/registry.js';
import { useScreen } from '../../../../../../screen-framework/providers/ScreenProvider.jsx';
import FitnessTimeline from './FitnessTimeline.jsx';
import './FitnessSessionDetailWidget.scss';

/**
 * Build display URL from a media ID (e.g. "plex:649319" → "/api/v1/display/plex/649319").
 */
function mediaDisplayUrl(contentId) {
  if (!contentId) return null;
  const str = String(contentId);
  if (str.includes(':')) {
    const [source, id] = str.split(':', 2);
    return `/api/v1/display/${source}/${id}`;
  }
  return `/api/v1/display/plex/${str}`;
}

/**
 * Format session start time.
 */
function formatTime(startTime, timezone) {
  if (!startTime) return '--';
  const opts = { hour: 'numeric', minute: '2-digit' };
  if (timezone) opts.timeZone = timezone;
  return new Date(startTime).toLocaleTimeString([], opts).toLowerCase().replace(' ', '');
}

/**
 * Format session date.
 */
function formatDate(dateStr) {
  if (!dateStr) return '';
  const d = new Date(dateStr + 'T12:00:00');
  return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
}

export default function FitnessSessionDetailWidget({ sessionId }) {
  const [sessionData, setSessionData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const { restore } = useScreen();

  useEffect(() => {
    if (!sessionId) return;
    setLoading(true);
    setError(null);

    fetch(`/api/v1/fitness/sessions/${sessionId}`)
      .then((res) => {
        if (!res.ok) throw new Error(`${res.status}`);
        return res.json();
      })
      .then((data) => {
        setSessionData(data.session || data);
        setLoading(false);
      })
      .catch((err) => {
        setError(err.message);
        setLoading(false);
      });
  }, [sessionId]);

  // Extract header metadata from session
  const header = useMemo(() => {
    if (!sessionData) return null;
    const summary = sessionData.summary || {};
    const pm = Array.isArray(summary.media) ? summary.media.find(m => m.primary) || summary.media[0] : null;
    const session = sessionData.session || {};

    // Derive date from sessionId (YYYYMMDD...) or session.start
    const dateStr = sessionData.sessionId
      ? `${sessionData.sessionId.slice(0, 4)}-${sessionData.sessionId.slice(4, 6)}-${sessionData.sessionId.slice(6, 8)}`
      : null;

    const durationMs = (session.duration_seconds || 0) * 1000;

    return {
      title: pm?.title || 'Workout',
      showTitle: pm?.showTitle || pm?.grandparentTitle || null,
      posterUrl: pm?.grandparentId ? mediaDisplayUrl(pm.grandparentId) : null,
      thumbUrl: pm?.contentId ? mediaDisplayUrl(pm.contentId) : null,
      date: dateStr ? formatDate(dateStr) : '',
      time: session.start ? formatTime(new Date(session.start).getTime(), sessionData.timezone) : '--',
      durationMin: durationMs > 0 ? Math.round(durationMs / 60000) : null,
      totalCoins: sessionData.treasureBox?.totalCoins || summary.coins?.total || 0,
    };
  }, [sessionData]);

  if (loading) {
    return (
      <div className="session-detail" style={{ padding: '2rem', gap: '1rem' }}>
        <Skeleton height={20} width="40%" />
        <Skeleton height="100%" style={{ flex: 1 }} />
      </div>
    );
  }

  if (error) {
    return (
      <div style={{ padding: '2rem', textAlign: 'center' }}>
        <Text c="red" size="sm">Failed to load session: {error}</Text>
        <Text
          size="sm"
          c="dimmed"
          mt="md"
          style={{ cursor: 'pointer', textDecoration: 'underline' }}
          onClick={() => restore('right-area')}
        >
          Back to dashboard
        </Text>
      </div>
    );
  }

  const registry = getWidgetRegistry();
  const ChartComponent = registry.get('fitness:chart');

  return (
    <div className="session-detail">
      {/* ── Header (25%) ── */}
      <div className="session-detail__header">
        {/* Show poster (left) */}
        {header?.posterUrl ? (
          <div className="session-detail__poster">
            <img
              src={header.posterUrl}
              alt=""
              onError={(e) => { e.target.style.display = 'none'; }}
            />
          </div>
        ) : (
          <div className="session-detail__poster session-detail__poster--placeholder" />
        )}

        {/* Center metadata */}
        <div className="session-detail__meta">
          <div className="session-detail__meta-top">
            <div className="session-detail__title" title={header?.title}>
              {header?.title}
            </div>
            {header?.showTitle && (
              <div className="session-detail__show" title={header.showTitle}>
                {header.showTitle}
              </div>
            )}
          </div>
          <div className="session-detail__meta-bottom">
            {header?.date && <span className="session-detail__meta-item">{header.date}</span>}
            {header?.time && <span className="session-detail__meta-item">{header.time}</span>}
            {header?.durationMin && <span className="session-detail__meta-item">{header.durationMin}m</span>}
            {header?.totalCoins > 0 && (
              <span className="session-detail__meta-item session-detail__coins">+{header.totalCoins}</span>
            )}
          </div>
        </div>

        {/* Episode thumbnail (right) */}
        {header?.thumbUrl ? (
          <div className="session-detail__thumb">
            <img
              src={header.thumbUrl}
              alt=""
              onError={(e) => { e.target.style.display = 'none'; }}
            />
          </div>
        ) : (
          <div className="session-detail__thumb session-detail__thumb--placeholder" />
        )}
      </div>

      {/* ── Chart (40%) ── */}
      <div className="session-detail__chart">
        {ChartComponent ? (
          <ChartComponent sessionData={sessionData} mode="standalone" />
        ) : (
          <Text c="dimmed" ta="center" py="xl">Chart not available</Text>
        )}
      </div>

      {/* ── Timeline (35%) ── */}
      <div className="session-detail__timeline">
        <FitnessTimeline sessionData={sessionData} />
      </div>
    </div>
  );
}
```

**Step 3: Verify build**

```bash
cd frontend && npx vite build --mode development 2>&1 | head -20
```

**Step 4: Visual test**

Start dev server and navigate to fitness home screen. Click a session. Verify:
- Header shows poster left, metadata center, episode thumb right
- Chart renders in middle row
- Timeline renders in bottom row with area charts per participant
- X axis labels align between chart and timeline

**Step 5: Commit**

```bash
git add frontend/src/modules/Fitness/FitnessModules/modules/HomeApp/widgets/FitnessSessionDetailWidget.jsx \
       frontend/src/modules/Fitness/FitnessModules/modules/HomeApp/widgets/FitnessSessionDetailWidget.scss
git commit -m "feat(fitness): redesign session detail with header/chart/timeline layout"
```

---

## Task 5: Move sidebar components into FitnessModules

Move all remaining FitnessSidebar/ files into FitnessModules/ and update import paths.

**Files to move:**

| From (FitnessSidebar/) | To (FitnessModules/) |
|---|---|
| `RealtimeCards/*` (entire dir) | `shared/RealtimeCards/` |
| `TouchVolumeButtons.jsx` | `shared/TouchVolumeButtons.jsx` |
| `useVoiceMemoRecorder.js` | `shared/hooks/useVoiceMemoRecorder.js` |
| `FitnessGovernance.jsx` | `shared/FitnessGovernance.jsx` |
| `FitnessGovernance.scss` | `shared/FitnessGovernance.scss` |
| `FitnessTreasureBox.jsx` | `shared/FitnessTreasureBox.jsx` |
| `FitnessUsers.jsx` | `shared/FitnessUsers.jsx` |
| `FitnessVideo.jsx` | `shared/FitnessVideo.jsx` |
| `FitnessVoiceMemo.jsx` | `shared/FitnessVoiceMemo.jsx` |
| `FitnessMusicPlayer.jsx` | `shared/FitnessMusicPlayer.jsx` |
| `FitnessPlaylistSelector.jsx` | `shared/FitnessPlaylistSelector.jsx` |
| `FitnessSidebarMenu.jsx` | `shared/FitnessSidebarMenu.jsx` |
| `FitnessChart.scss` | `shared/FitnessChart.scss` |

**Step 1: Create destination directories**

```bash
mkdir -p frontend/src/modules/Fitness/FitnessModules/shared/RealtimeCards
mkdir -p frontend/src/modules/Fitness/FitnessModules/shared/hooks
```

**Step 2: Move files**

```bash
# RealtimeCards (entire directory)
cp -r frontend/src/modules/Fitness/FitnessSidebar/RealtimeCards/* \
      frontend/src/modules/Fitness/FitnessModules/shared/RealtimeCards/

# Individual components
for f in TouchVolumeButtons.jsx FitnessGovernance.jsx FitnessGovernance.scss \
         FitnessTreasureBox.jsx FitnessUsers.jsx FitnessVideo.jsx \
         FitnessVoiceMemo.jsx FitnessMusicPlayer.jsx FitnessPlaylistSelector.jsx \
         FitnessSidebarMenu.jsx FitnessChart.scss; do
  cp "frontend/src/modules/Fitness/FitnessSidebar/$f" \
     "frontend/src/modules/Fitness/FitnessModules/shared/$f"
done

# Hook
cp frontend/src/modules/Fitness/FitnessSidebar/useVoiceMemoRecorder.js \
   frontend/src/modules/Fitness/FitnessModules/shared/hooks/useVoiceMemoRecorder.js
```

**Step 3: Fix internal import paths in moved files**

Each moved file has imports relative to FitnessSidebar/. These need updating to reflect the new location under FitnessModules/shared/. The key adjustments:

- `../domain` → `../../domain` (one level deeper)
- `../../context/FitnessContext.jsx` → `../../../context/FitnessContext.jsx`
- `../../lib/logging/Logger.js` → `../../../lib/logging/Logger.js`
- `../../hooks/...` → `../../../hooks/...`
- `../shared/...` → `../../shared/...` (Fitness/shared, not FitnessModules/shared)
- `./RealtimeCards/...` → `../RealtimeCards/...` (within FitnessModules/shared/)
- `./TouchVolumeButtons` → `../TouchVolumeButtons` (within FitnessModules/shared/)
- `./FitnessPlaylistSelector` → `../FitnessPlaylistSelector` (within FitnessModules/shared/)

For `useVoiceMemoRecorder.js` (now in `shared/hooks/`):
- `../../lib/api.mjs` → `../../../../lib/api.mjs`
- `../../lib/logging/Logger.js` → `../../../../lib/logging/Logger.js`

For `RealtimeCards/*.jsx`:
- `../domain` → `../../../domain`
- Imports of sibling RealtimeCards files stay the same (same directory)

**Step 4: Update all external consumers**

These files import from FitnessSidebar/ and need path updates:

**`FitnessSidebar.jsx`** (the shell — `frontend/src/modules/Fitness/FitnessSidebar.jsx`):
```
./FitnessSidebar/FitnessTreasureBox.jsx  → ./FitnessModules/shared/FitnessTreasureBox.jsx
./FitnessSidebar/FitnessUsers.jsx        → ./FitnessModules/shared/FitnessUsers.jsx
./FitnessSidebar/FitnessSidebarMenu.jsx  → ./FitnessModules/shared/FitnessSidebarMenu.jsx
./FitnessSidebar/FitnessVideo.jsx        → ./FitnessModules/shared/FitnessVideo.jsx
./FitnessSidebar/FitnessVoiceMemo.jsx    → ./FitnessModules/shared/FitnessVoiceMemo.jsx
./FitnessSidebar/FitnessMusicPlayer.jsx  → ./FitnessModules/shared/FitnessMusicPlayer.jsx
./FitnessSidebar/FitnessGovernance.jsx   → ./FitnessModules/shared/FitnessGovernance.jsx
./FitnessSidebar/FitnessGovernance.scss  → ./FitnessModules/shared/FitnessGovernance.scss
```

**`FitnessPlayer.jsx`** (line 15):
```
./FitnessSidebar/FitnessChart.jsx → (delete this import — FitnessChart.jsx is being deleted)
```
If `FitnessChart` is used in FitnessPlayer.jsx, replace with direct import of `FitnessChartApp`:
```js
import FitnessChart from './FitnessModules/modules/FitnessChartApp/index.jsx';
```

**`FitnessPlayerOverlay/VoiceMemoOverlay.jsx`** (line 4):
```
../FitnessSidebar/useVoiceMemoRecorder.js → ../FitnessModules/shared/hooks/useVoiceMemoRecorder.js
```

**`shared/containers/FullScreenContainer/FullScreenContainer.jsx`** (line 3):
```
../../../FitnessSidebar/RealtimeCards/RpmDeviceAvatar.jsx → ../../../FitnessModules/shared/RealtimeCards/RpmDeviceAvatar.jsx
```

**`modules/sidebar/index.js`** (lines 28-33):
```
../../FitnessSidebar/FitnessTreasureBox.jsx  → ../../FitnessModules/shared/FitnessTreasureBox.jsx
../../FitnessSidebar/FitnessGovernance.jsx   → ../../FitnessModules/shared/FitnessGovernance.jsx
../../FitnessSidebar/FitnessUsers.jsx        → ../../FitnessModules/shared/FitnessUsers.jsx
../../FitnessSidebar/FitnessMusicPlayer.jsx  → ../../FitnessModules/shared/FitnessMusicPlayer.jsx
../../FitnessSidebar/FitnessVoiceMemo.jsx    → ../../FitnessModules/shared/FitnessVoiceMemo.jsx
../../FitnessSidebar/FitnessSidebarMenu.jsx  → ../../FitnessModules/shared/FitnessSidebarMenu.jsx
```

**`modules/sidebar/MusicPanel.jsx`** (line 3):
```
../../FitnessSidebar/FitnessMusicPlayer.jsx → ../../FitnessModules/shared/FitnessMusicPlayer.jsx
```

**`modules/sidebar/UsersPanel.jsx`** (line 3):
```
../../FitnessSidebar/FitnessUsers.jsx → ../../FitnessModules/shared/FitnessUsers.jsx
```

**`modules/sidebar/VoiceMemoPanel.jsx`** (line 3):
```
../../FitnessSidebar/FitnessVoiceMemo.jsx → ../../FitnessModules/shared/FitnessVoiceMemo.jsx
```

**`modules/sidebar/TreasureBoxPanel.jsx`** (line 3):
```
../../FitnessSidebar/FitnessTreasureBox.jsx → ../../FitnessModules/shared/FitnessTreasureBox.jsx
```

**`modules/sidebar/GovernancePanel.jsx`** (line 3):
```
../../FitnessSidebar/FitnessGovernance.jsx → ../../FitnessModules/shared/FitnessGovernance.jsx
```

**Step 5: Verify build**

```bash
cd frontend && npx vite build --mode development 2>&1 | head -20
```
Expected: Clean build with no import resolution errors.

**Step 6: Commit**

```bash
git add frontend/src/modules/Fitness/FitnessModules/shared/ \
       frontend/src/modules/Fitness/FitnessSidebar.jsx \
       frontend/src/modules/Fitness/FitnessPlayer.jsx \
       frontend/src/modules/Fitness/FitnessPlayerOverlay/VoiceMemoOverlay.jsx \
       frontend/src/modules/Fitness/shared/containers/FullScreenContainer/FullScreenContainer.jsx \
       frontend/src/modules/Fitness/modules/sidebar/
git commit -m "refactor(fitness): move sidebar components into FitnessModules/shared/"
```

---

## Task 6: Delete FitnessSidebar/ directory

**Files:**
- Delete: `frontend/src/modules/Fitness/FitnessSidebar/` (entire directory)
- Delete: `frontend/src/modules/Fitness/FitnessSidebar.scss` (if it exists and is only used by the sidebar shell)

**Step 1: Verify no remaining imports reference the old path**

```bash
cd frontend && grep -r "FitnessSidebar/" src/ --include="*.jsx" --include="*.js" --include="*.scss" | grep -v node_modules
```
Expected: No results (all imports updated in Task 5).

**Step 2: Delete the directory**

```bash
rm -rf frontend/src/modules/Fitness/FitnessSidebar/
```

**Step 3: Verify build**

```bash
cd frontend && npx vite build --mode development 2>&1 | head -20
```
Expected: Clean build.

**Step 4: Commit**

```bash
git add -A frontend/src/modules/Fitness/FitnessSidebar/
git commit -m "refactor(fitness): delete FitnessSidebar/ directory — fully migrated to FitnessModules"
```

---

## Task 7: Final verification

**Step 1: Full build check**

```bash
cd frontend && npx vite build --mode development 2>&1 | tail -5
```

**Step 2: Visual smoke test**

Start dev server and verify:
1. Fitness home screen loads (sessions list, weight, nutrition cards)
2. Click a session → session detail shows header/chart/timeline layout
3. Chart renders correctly with coin lines
4. Timeline shows HR area charts per participant, zone-colored
5. X axis labels align between chart and timeline
6. Navigate to live fitness player → sidebar components still work (treasure box, users, music, webcam, governance)
7. Navigate back to home → session list loads

**Step 3: Commit any fixes found during smoke test**
