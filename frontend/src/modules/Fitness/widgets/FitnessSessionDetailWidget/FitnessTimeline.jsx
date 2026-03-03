import React, { useMemo, useRef, useState, useLayoutEffect } from 'react';
import { createChartDataSource } from '../FitnessChartApp/sessionDataAdapter.js';
import { CHART_MARGIN, MIN_VISIBLE_TICKS } from '@/modules/Fitness/lib/chartConstants.js';
import { ZONE_COLOR_MAP } from '@/modules/Fitness/lib/chartHelpers.js';
import './FitnessTimeline.scss';

/**
 * Map a tick index to an X pixel position, matching FitnessChartApp's X axis.
 */
function tickToX(index, effectiveTicks, plotWidth) {
  if (effectiveTicks <= 1) return CHART_MARGIN.left;
  return CHART_MARGIN.left + (index / (effectiveTicks - 1)) * plotWidth;
}

/**
 * Linearly interpolate across null/0 gaps in an HR series.
 * Returns a new array with gaps filled. Leading/trailing gaps are left as 0.
 */
function interpolateGaps(series) {
  const out = new Array(series.length);
  // Find first valid index
  let firstValid = -1, lastValid = -1;
  for (let i = 0; i < series.length; i++) {
    const v = series[i];
    if (Number.isFinite(v) && v > 0) {
      if (firstValid < 0) firstValid = i;
      lastValid = i;
      out[i] = v;
    } else {
      out[i] = 0;
    }
  }
  if (firstValid < 0) return out;

  // Interpolate interior gaps
  let prevIdx = firstValid;
  for (let i = firstValid + 1; i <= lastValid; i++) {
    if (out[i] > 0) {
      // Fill gap between prevIdx and i
      if (i - prevIdx > 1) {
        const startVal = out[prevIdx];
        const endVal = out[i];
        for (let j = prevIdx + 1; j < i; j++) {
          const t = (j - prevIdx) / (i - prevIdx);
          out[j] = startVal + t * (endVal - startVal);
        }
      }
      prevIdx = i;
    }
  }
  return out;
}

/**
 * Build an SVG area path for a single participant's HR series.
 * Returns { fills: Array<{ d: string, color: string }> }
 * where fills are zone-colored sub-areas.
 */
function buildHrAreaPath(hrSeries, zoneSeries, effectiveTicks, plotWidth, laneTop, laneHeight) {
  if (!hrSeries || hrSeries.length === 0) return { fills: [] };

  const interpolated = interpolateGaps(hrSeries);

  // Find the active range (first to last valid value)
  let firstValid = -1, lastValid = -1;
  for (let i = 0; i < interpolated.length; i++) {
    if (interpolated[i] > 0) {
      if (firstValid < 0) firstValid = i;
      lastValid = i;
    }
  }
  if (firstValid < 0) return { fills: [] };

  let hrMin = Infinity, hrMax = -Infinity;
  for (let i = firstValid; i <= lastValid; i++) {
    const v = interpolated[i];
    if (v > 0) {
      if (v < hrMin) hrMin = v;
      if (v > hrMax) hrMax = v;
    }
  }
  if (!Number.isFinite(hrMin) || hrMin === hrMax) {
    hrMin = hrMax - 10 || 50;
  }

  const range = hrMax - hrMin;
  const paddedMin = hrMin - range * 0.1;

  const hrToY = (hr) => {
    const ratio = (hr - paddedMin) / (hrMax - paddedMin);
    return laneTop + laneHeight - ratio * laneHeight;
  };

  const baseline = laneTop + laneHeight;

  // Fill-forward null zones to avoid false transitions
  const zones = new Array(interpolated.length);
  let lastZone = null;
  for (let i = 0; i < interpolated.length; i++) {
    const z = zoneSeries?.[i] ?? null;
    if (z != null) lastZone = z;
    zones[i] = lastZone;
  }

  const fills = [];
  let segStart = firstValid;
  for (let i = firstValid; i <= lastValid + 1; i++) {
    const currentZone = i <= lastValid ? zones[i] : null;
    const prevZone = i > firstValid ? zones[i - 1] : null;

    if (i === lastValid + 1 || (i > firstValid && currentZone !== prevZone)) {
      const zone = prevZone || 'rest';
      const color = ZONE_COLOR_MAP[zone] || ZONE_COLOR_MAP.default || '#888';

      // Extend one tick past segment end to overlap with next segment (eliminates gaps)
      const drawEnd = Math.min(i, lastValid);
      let d = '';
      for (let j = segStart; j <= drawEnd; j++) {
        const x = tickToX(j, effectiveTicks, plotWidth);
        const y = hrToY(interpolated[j]);
        d += j === segStart ? `M${x},${y}` : ` L${x},${y}`;
      }
      const xEnd = tickToX(drawEnd, effectiveTicks, plotWidth);
      const xStart = tickToX(segStart, effectiveTicks, plotWidth);
      d += ` L${xEnd},${baseline} L${xStart},${baseline} Z`;

      fills.push({ d, color });
      segStart = i;
    }
  }

  return { fills };
}

export default function FitnessTimeline({ sessionData, maxAvatarSize }) {
  const containerRef = useRef(null);
  const [dimensions, setDimensions] = useState({ width: 0, height: 0 });

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
  const plotHeight = height; // No bottom margin — chart above provides x-axis labels

  // Global effectiveTicks — matches FitnessChartApp's calculation (max across all participants)
  const effectiveTicks = useMemo(() => {
    if (!roster || roster.length === 0) return MIN_VISIBLE_TICKS;
    let globalMaxIndex = 0;
    for (const entry of roster) {
      const userId = entry.id || entry.profileId;
      const hrSeries = getSeries(userId, 'heart_rate', { clone: false });
      const maxIdx = hrSeries.reduce((max, v, i) => (Number.isFinite(v) && v > 0 ? i : max), 0);
      if (maxIdx > globalMaxIndex) globalMaxIndex = maxIdx;
    }
    return Math.max(MIN_VISIBLE_TICKS, globalMaxIndex + 1);
  }, [roster, getSeries]);

  const lanes = useMemo(() => {
    if (!roster || roster.length === 0 || plotWidth <= 0 || plotHeight <= 0) return [];

    const participantCount = roster.length;
    const laneGap = 2;
    const laneHeight = Math.max(10, (plotHeight - (participantCount - 1) * laneGap) / participantCount);

    return roster.map((entry, idx) => {
      const userId = entry.id || entry.profileId;
      const hrSeries = getSeries(userId, 'heart_rate', { clone: false });
      const zoneSeries = getSeries(userId, 'zone_id', { clone: false }) || getSeries(userId, 'zone', { clone: false });

      const laneTop = idx * (laneHeight + laneGap);
      const { fills } = buildHrAreaPath(hrSeries, zoneSeries, effectiveTicks, plotWidth, laneTop, laneHeight);

      return {
        userId,
        name: entry.displayLabel || entry.name || userId,
        avatarUrl: entry.avatarUrl,
        laneTop,
        laneHeight,
        fills,
      };
    });
  }, [roster, getSeries, effectiveTicks, plotWidth, plotHeight]);

  // X-axis labels removed — the chart row above provides them

  if (!sessionData || width === 0) {
    return <div ref={containerRef} className="fitness-timeline" />;
  }

  return (
    <div ref={containerRef} className="fitness-timeline">
      <svg width={width} height={height} className="fitness-timeline__svg">
        <defs>
          {lanes.map((lane) => {
            const avatarSize = maxAvatarSize > 0 ? Math.min(lane.laneHeight, maxAvatarSize) : lane.laneHeight;
            const r = avatarSize / 2;
            const cx = r;
            const cy = lane.laneTop + lane.laneHeight / 2;
            return (
              <clipPath key={`clip-${lane.userId}`} id={`avatar-clip-${lane.userId}`}>
                <circle cx={cx} cy={cy} r={r} />
              </clipPath>
            );
          })}
        </defs>
        {lanes.map((lane) => {
          const size = maxAvatarSize > 0 ? Math.min(lane.laneHeight, maxAvatarSize) : lane.laneHeight;
          const r = size / 2;
          const cx = r;
          const cy = lane.laneTop + lane.laneHeight / 2;
          const borderWidth = 3;
          return (
            <g key={lane.userId}>
              {lane.fills.map((fill, i) => (
                <path
                  key={i}
                  d={fill.d}
                  fill={fill.color}
                  opacity={0.6}
                  stroke="none"
                />
              ))}
              {lane.avatarUrl && (
                <>
                  <image
                    href={lane.avatarUrl}
                    x={0}
                    y={lane.laneTop + (lane.laneHeight - size) / 2}
                    width={size}
                    height={size}
                    clipPath={`url(#avatar-clip-${lane.userId})`}
                    preserveAspectRatio="xMidYMid slice"
                  />
                  <circle
                    cx={cx}
                    cy={cy}
                    r={r - borderWidth / 2}
                    fill="none"
                    stroke="rgba(0, 0, 0, 0.7)"
                    strokeWidth={borderWidth}
                  />
                </>
              )}
            </g>
          );
        })}
      </svg>
    </div>
  );
}
