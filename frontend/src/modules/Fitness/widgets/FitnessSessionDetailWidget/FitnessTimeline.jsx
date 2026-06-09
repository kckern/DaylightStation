import React, { useMemo, useRef, useState, useLayoutEffect } from 'react';
import { createChartDataSource } from '../FitnessChart/sessionDataAdapter.js';
import { CHART_MARGIN, MIN_GAP_DURATION_FOR_DASHED_MS } from '@/modules/Fitness/lib/chartConstants.js';
import { ZONE_COLOR_MAP, buildActivityMaskFromHeartRate } from '@/modules/Fitness/lib/chartHelpers.js';
import { computeRaceBands, computeSeamLines, computeVideoMarkers, computeChallengeMarkers } from './timelineOverlay.js';
import { resolveSessionStartMs } from './sessionDetailUtils.js';
import { computeEffectiveTicks } from './useTimelineMarkers.js';
import { getChallengeMarkerColor } from '@/modules/Fitness/lib/activities/challengeTypeRegistry.js';
import { getActivityDisplay, primaryActivity } from '@/modules/Fitness/lib/activities/fitnessActivityRegistry.jsx';
import './FitnessTimeline.scss';

/**
 * Map a tick index to an X pixel position, matching FitnessChart's X axis.
 */
function tickToX(index, effectiveTicks, plotWidth) {
  if (effectiveTicks <= 1) return CHART_MARGIN.left;
  return CHART_MARGIN.left + (index / (effectiveTicks - 1)) * plotWidth;
}

/**
 * Interpolate across short gaps but zero out long gaps.
 * Short gaps (< 2 min) are linearly interpolated for visual continuity
 * (matching the race chart which shows these as colored solid lines).
 * Long gaps (>= 2 min) are set to 0, matching the grey dotted line.
 */
function interpolateShortGaps(series, longGapMask) {
  const out = new Array(series.length);
  for (let i = 0; i < series.length; i++) {
    const v = series[i];
    if (longGapMask[i]) {
      out[i] = 0; // Long gap — zero
    } else if (Number.isFinite(v) && v > 0) {
      out[i] = v;
    } else {
      out[i] = 0; // Will be interpolated below for short gaps
    }
  }

  // Find first and last valid indices (excluding long-gap regions)
  let firstValid = -1, lastValid = -1;
  for (let i = 0; i < out.length; i++) {
    if (out[i] > 0) {
      if (firstValid < 0) firstValid = i;
      lastValid = i;
    }
  }
  if (firstValid < 0) return out;

  // Interpolate short interior gaps (where longGapMask is false and value is 0)
  let prevIdx = firstValid;
  for (let i = firstValid + 1; i <= lastValid; i++) {
    if (out[i] > 0) {
      if (i - prevIdx > 1) {
        // Only interpolate if ALL ticks in the gap are NOT long-gap
        const allShort = (() => {
          for (let j = prevIdx + 1; j < i; j++) {
            if (longGapMask[j]) return false;
          }
          return true;
        })();
        if (allShort) {
          const startVal = out[prevIdx];
          const endVal = out[i];
          for (let j = prevIdx + 1; j < i; j++) {
            const t = (j - prevIdx) / (i - prevIdx);
            out[j] = startVal + t * (endVal - startVal);
          }
        }
      }
      prevIdx = i;
    }
  }
  return out;
}

/**
 * Compute a "long gap" mask matching the grey dotted line logic in the race chart.
 * Uses buildActivityMaskFromHeartRate (same active[] as buildBeatsSeries fallback)
 * and the same MIN_GAP_DURATION_FOR_DASHED_MS threshold from buildSegments rendering.
 *
 * @returns {boolean[]} true at ticks that fall inside a long gap (>= 2 min)
 */
function buildLongGapMask(hrSeries, intervalMs) {
  const active = buildActivityMaskFromHeartRate(hrSeries);
  const mask = new Array(active.length).fill(false);

  // Find contiguous runs of inactive ticks and mark those >= threshold
  let runStart = -1;
  for (let i = 0; i <= active.length; i++) {
    if (i < active.length && !active[i]) {
      if (runStart < 0) runStart = i;
    } else {
      if (runStart >= 0) {
        const runTicks = i - runStart;
        const runDurationMs = runTicks * intervalMs;
        if (runDurationMs >= MIN_GAP_DURATION_FOR_DASHED_MS) {
          for (let j = runStart; j < i; j++) mask[j] = true;
        }
        runStart = -1;
      }
    }
  }
  return mask;
}

/**
 * Build an SVG area path for a single participant's HR series.
 * Returns { fills: Array<{ d: string, color: string }> }
 * where fills are zone-colored sub-areas.
 *
 * Long gaps (>= 2 min of no HR data) are zeroed to match the grey dotted line
 * in the race chart. Short gaps are linearly interpolated for visual continuity.
 */
function buildHrAreaPath(hrSeries, zoneSeries, effectiveTicks, plotWidth, laneTop, laneHeight, intervalMs) {
  if (!hrSeries || hrSeries.length === 0) return { fills: [] };

  const longGap = buildLongGapMask(hrSeries, intervalMs);

  // Interpolate short gaps only; zero out long gaps
  const interpolated = interpolateShortGaps(hrSeries, longGap);

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

  // Build fills, breaking at zone changes AND long-gap boundaries (HR zeroed out).
  // Long gaps (>= 2 min) drop to baseline, matching the grey dotted line in the race chart.
  const fills = [];
  let segStart = -1;

  const flushSegment = (endIdx) => {
    if (segStart < 0 || endIdx < segStart) return;
    const zone = zones[segStart] || 'rest';
    const color = ZONE_COLOR_MAP[zone] || ZONE_COLOR_MAP.default || '#888';
    let d = '';
    for (let j = segStart; j <= endIdx; j++) {
      const x = tickToX(j, effectiveTicks, plotWidth);
      const y = hrToY(interpolated[j]);
      d += j === segStart ? `M${x},${y}` : ` L${x},${y}`;
    }
    const xEnd = tickToX(endIdx, effectiveTicks, plotWidth);
    const xStart = tickToX(segStart, effectiveTicks, plotWidth);
    d += ` L${xEnd},${baseline} L${xStart},${baseline} Z`;
    fills.push({ d, color });
    segStart = -1;
  };

  for (let i = firstValid; i <= lastValid; i++) {
    const isActive = interpolated[i] > 0;
    if (!isActive) {
      // Gap tick — flush any open segment
      if (segStart >= 0) flushSegment(i - 1);
      continue;
    }
    // Active tick — check if zone changed
    if (segStart >= 0 && zones[i] !== zones[segStart]) {
      // Extend one tick into new segment for overlap, then start fresh
      flushSegment(i);
      segStart = i;
    } else if (segStart < 0) {
      segStart = i;
    }
  }
  // Flush final segment
  if (segStart >= 0) flushSegment(lastValid);

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

  // Global effectiveTicks — shared with the gutter (useTimelineMarkers) so chips align.
  const effectiveTicks = useMemo(
    () => computeEffectiveTicks(sessionData, getSeries, roster),
    [roster, getSeries, sessionData]
  );

  const intervalMs = Number(timebase?.intervalMs) > 0 ? Number(timebase.intervalMs) : 5000;

  const overlay = useMemo(() => {
    const sessionStartMs = resolveSessionStartMs(sessionData);
    const opts = { intervalMs, effectiveTicks, plotWidth, marginLeft: CHART_MARGIN.left, sessionStartMs };
    const events = sessionData?.timeline?.events;
    return {
      bands: computeRaceBands(sessionData?.activities, opts),
      seams: computeSeamLines(sessionData?.seams, opts),
      videoMarkers: computeVideoMarkers(events, opts),
      challengeMarkers: computeChallengeMarkers(events, opts),
      accent: getActivityDisplay(primaryActivity(sessionData?.activities)?.type)?.accent || '#3ba776',
    };
  }, [sessionData, intervalMs, effectiveTicks, plotWidth]);

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
      const { fills } = buildHrAreaPath(hrSeries, zoneSeries, effectiveTicks, plotWidth, laneTop, laneHeight, intervalMs);

      return {
        userId,
        name: entry.displayLabel || entry.name || userId,
        avatarUrl: entry.avatarUrl,
        laneTop,
        laneHeight,
        fills,
      };
    });
  }, [roster, getSeries, effectiveTicks, plotWidth, plotHeight, intervalMs]);

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
        {/* race bands (under lanes) */}
        {overlay.bands.map((b, i) => (
          <g key={`band-${b.raceId || i}`} className="timeline-band">
            <rect x={b.x} y={0} width={b.width} height={plotHeight} fill={overlay.accent} opacity={0.1} />
            <rect x={b.x} y={0} width={b.width} height={2} fill={overlay.accent} opacity={0.6} />
          </g>
        ))}
        {/* HR-area fills (under the indicator overlays) */}
        {lanes.map((lane) => (
          <g key={`fills-${lane.userId}`}>
            {lane.fills.map((fill, i) => (
              <path key={i} d={fill.d} fill={fill.color} opacity={0.6} stroke="none" />
            ))}
          </g>
        ))}
        {/* challenge duration rectangles — solid edge on the RIGHT (challenge end) */}
        {overlay.challengeMarkers.map((m, i) => {
          const color = getChallengeMarkerColor(m);
          const w = Math.max(m.width, 2);
          return (
            <g key={`chal-${i}`} className="timeline-challenge-marker">
              <rect x={m.x} y={0} width={w} height={plotHeight} fill={color} opacity={0.06} />
              <line x1={m.xEnd} y1={0} x2={m.xEnd} y2={plotHeight} stroke={color} strokeWidth={1.5} opacity={0.9} />
            </g>
          );
        })}
        {/* seams + video-change markers (dashed) */}
        {overlay.seams.map((s, i) => (
          <g key={`seam-${i}`} className="timeline-seam">
            <line x1={s.x} y1={0} x2={s.x} y2={plotHeight} stroke="rgba(255,255,255,0.55)" strokeWidth={1.5} strokeDasharray="3 3" />
          </g>
        ))}
        {overlay.videoMarkers.map((m, i) => (
          <g key={`vid-${i}`} className="timeline-video-marker">
            <line x1={m.x} y1={0} x2={m.x} y2={plotHeight} stroke="rgba(255,255,255,0.8)" strokeWidth={1.5} strokeDasharray="6 4" />
          </g>
        ))}
        {/* avatars — drawn LAST so they sit above every indicator line/rect */}
        {lanes.map((lane) => {
          if (!lane.avatarUrl) return null;
          const size = maxAvatarSize > 0 ? Math.min(lane.laneHeight, maxAvatarSize) : lane.laneHeight;
          const r = size / 2;
          const borderWidth = 3;
          return (
            <g key={`avatar-${lane.userId}`}>
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
                cx={r}
                cy={lane.laneTop + lane.laneHeight / 2}
                r={r - borderWidth / 2}
                fill="none"
                stroke="rgba(0, 0, 0, 0.7)"
                strokeWidth={borderWidth}
              />
            </g>
          );
        })}
      </svg>
    </div>
  );
}
