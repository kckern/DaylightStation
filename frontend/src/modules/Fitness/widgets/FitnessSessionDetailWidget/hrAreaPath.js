// hrAreaPath.js — HR-lane SVG area-path geometry for FitnessTimeline.jsx,
// split out so Fast Refresh can hot-reload the timeline component on its own.
import { CHART_MARGIN, MIN_GAP_DURATION_FOR_DASHED_MS } from '@/modules/Fitness/lib/chartConstants.js';
import { ZONE_COLOR_MAP, buildActivityMaskFromHeartRate } from '@/modules/Fitness/lib/chartHelpers.js';

/**
 * Map a tick index to an X pixel position, matching FitnessChart's X axis.
 */
export function tickToX(index, effectiveTicks, plotWidth) {
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
export function buildHrAreaPath(hrSeries, zoneSeries, effectiveTicks, plotWidth, laneTop, laneHeight, intervalMs) {
  if (!hrSeries || hrSeries.length === 0) return { fills: [], hrMin: null, hrMax: null, lastActiveTick: -1 };

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
  if (firstValid < 0) return { fills: [], hrMin: null, hrMax: null, lastActiveTick: -1 };

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

  return { fills, hrMin, hrMax, lastActiveTick: lastValid };
}
