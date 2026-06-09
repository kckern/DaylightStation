import { useMemo, useRef, useState, useLayoutEffect } from 'react';
import { createChartDataSource } from '../FitnessChart/sessionDataAdapter.js';
import { CHART_MARGIN, MIN_VISIBLE_TICKS } from '@/modules/Fitness/lib/chartConstants.js';
import { computeChallengeMarkers, computeVideoMarkers } from './timelineOverlay.js';
import { resolveSessionStartMs } from './sessionDetailUtils.js';

/**
 * Shared tick-axis scale for the session-detail overlay. Mirrors FitnessTimeline's
 * effectiveTicks derivation so the center gutter's chips land on the SAME x as the
 * vertical indicators drawn by the line chart (top) and HR-area lanes (bottom).
 */
export function computeEffectiveTicks(sessionData, getSeries, roster) {
  if (!roster || roster.length === 0) return MIN_VISIBLE_TICKS;
  let globalMaxIndex = 0;
  for (const entry of roster) {
    const userId = entry.id || entry.profileId;
    const hrSeries = getSeries(userId, 'heart_rate', { clone: false });
    const maxIdx = hrSeries.reduce((max, v, i) => (Number.isFinite(v) && v > 0 ? i : max), 0);
    if (maxIdx > globalMaxIndex) globalMaxIndex = maxIdx;
  }
  return Math.max(
    MIN_VISIBLE_TICKS,
    globalMaxIndex + 1,
    sessionData?.isGroup ? (Number(sessionData?.timeline?.tick_count) || 0) : 0
  );
}

/**
 * Measures the host element width and computes the challenge/video markers on the
 * shared tick axis. Returns a ref to attach to the full-width host plus the marker
 * arrays. The left inset (avatar column) is applied by the caller via opts.marginLeft.
 */
export function useTimelineMarkers(sessionData) {
  const ref = useRef(null);
  const [dims, setDims] = useState({ width: 0, height: 0 });
  const { width, height } = dims;

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => setDims({
      width: Math.round(entry.contentRect.width),
      height: Math.round(entry.contentRect.height)
    }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const { getSeries, roster, timebase } = useMemo(
    () => createChartDataSource(sessionData),
    [sessionData]
  );

  return useMemo(() => {
    const plotWidth = width - CHART_MARGIN.left - CHART_MARGIN.right;
    if (!sessionData || plotWidth <= 0) {
      return { ref, width, height, challengeMarkers: [], videoMarkers: [] };
    }
    const effectiveTicks = computeEffectiveTicks(sessionData, getSeries, roster);
    const intervalMs = Number(timebase?.intervalMs) > 0 ? Number(timebase.intervalMs) : 5000;
    const opts = {
      intervalMs,
      effectiveTicks,
      plotWidth,
      marginLeft: CHART_MARGIN.left,
      sessionStartMs: resolveSessionStartMs(sessionData)
    };
    const events = sessionData?.timeline?.events;
    return {
      ref,
      width,
      height,
      challengeMarkers: computeChallengeMarkers(events, opts),
      videoMarkers: computeVideoMarkers(events, opts)
    };
  }, [sessionData, width, height, getSeries, roster, timebase]);
}
