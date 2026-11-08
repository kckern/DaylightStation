import React, { useEffect, useId, useLayoutEffect, useMemo, useRef } from 'react';
import getLogger from '@/lib/logging/Logger.js';
import { createTickLerp } from '../../../../../../__capabilities/gaming/browser/platform/realtime/index.js';
import { hrTrendRange, monotonePath, trendReady, trendTransform, zoneBands } from './hrTrend.js';
import { buildPrefix, sampleTrend } from './hrTrendScale.js';

let _logger;
const logger = () => (_logger ||= getLogger().child({ component: 'fitness-sidebar-hr-trend' }));

// Frame writes are capped at ~30 fps: the line moves a fraction of a pixel per
// frame between 5s ticks, and the garage display renders several cards.
export const TREND_FRAME_MIN_MS = 33;

const isReading = (v) => Number.isFinite(v) && v > 0;
const lerp = (a, b, f) => a + (b - a) * f;
const nowMs = () => (typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now());
const prefersReducedMotion = () => {
  try {
    return Boolean(window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches);
  } catch {
    return false;
  }
};

// Geometry at fraction f of the way from the previous tick to this one. At
// f = 1 it is the tick's own state. Below 1, "now" sits between the last two
// slots: the history slides left on the log axis, and the tip at the right
// edge eases from the previous reading to the newest one.
function frameAt({ chart, prevRange }, f) {
  const { prefix, hr, range } = chart;
  const last = prefix.length - 1;
  if (f >= 1 || last < 1) {
    const points = sampleTrend(prefix, { head: last, lastIndex: last });
    return { d: monotonePath(points), transform: trendTransform(range) };
  }
  const points = sampleTrend(prefix, { head: last - 1 + f, lastIndex: last - 1 });
  const a = hr[last - 1];
  const b = hr[last];
  const tip = isReading(a) && isReading(b) ? lerp(a, b, f) : (isReading(b) ? b : null);
  points.push({ x: 100, hr: tip });
  const r = [lerp(prevRange[0], range[0], f), lerp(prevRange[1], range[1], f)];
  return { d: monotonePath(points), transform: trendTransform(r) };
}

/**
 * Whole-session HR sparkline for a tall rider card. Until the rider has
 * TREND_MIN_READINGS real readings it shows a collecting spinner in the same
 * box. Then: one monotone curve on a log time axis (hrTrendScale.js), drawn in
 * (x, bpm) user space and referenced once per zone band, each copy clipped to
 * its band and stroked in the band's colour — so the colour changes exactly
 * where the line crosses a threshold.
 *
 * Data recomputes only when the timeline ticks (every 5s): `tickCount` is the
 * memo key and the series is read uncloned. Between ticks a createTickLerp
 * clock glides the line; frames write `d` and the plot transform through refs,
 * so React never re-renders per frame (the DistanceChart pattern).
 */
const RiderHrTrend = ({ participantId, getSeries, tickCount, tickMs, zones, profileId, cardHeight }) => {
  const getSeriesRef = useRef(getSeries);
  getSeriesRef.current = getSeries;
  const uid = `hrt${useId().replace(/[^a-zA-Z0-9_-]/g, '')}`;
  const zonesKey = (zones || []).map((z) => `${z?.id}:${z?.threshold}`).join(',');

  const bands = useMemo(() => zoneBands(zones), [zonesKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const chart = useMemo(() => {
    const read = getSeriesRef.current;
    if (!participantId || typeof read !== 'function') return null;
    const hr = read(participantId, 'heart_rate', { clone: false }) || [];
    const prefix = buildPrefix(hr);
    const readings = prefix.count[prefix.length];
    if (!trendReady(prefix)) return { ready: false, readings };
    // "Now" is the series' own last slot, not tickCount: a late joiner's
    // series is shorter, and its line must still end at the right edge.
    const lastIndex = prefix.length - 1;
    const points = sampleTrend(prefix, { head: lastIndex, lastIndex });
    const range = hrTrendRange(points, bands.slice(1).map((b) => b.lo));
    return range ? { ready: true, readings, prefix, hr, range } : { ready: false, readings };
    // tickCount is the recompute clock; the series arrays are mutated in place.
  }, [participantId, tickCount, bands]); // eslint-disable-line react-hooks/exhaustive-deps

  // Motion: one clock per card. Its interval is fixed at mount (the timeline's
  // tick length does not change within a session).
  const clockRef = useRef(null);
  if (!clockRef.current) clockRef.current = createTickLerp({ intervalMs: tickMs || 5000 });
  const pathRef = useRef(null);
  const plotRef = useRef(null);
  const frameRef = useRef(null);
  const lastTickRef = useRef({ tickCount: null, range: null, participantId: null, length: 0 });
  const lastWriteRef = useRef(-Infinity);

  const writeFrame = (f, force = false) => {
    const state = frameRef.current;
    if (!state || !pathRef.current || !plotRef.current) return;
    const t = nowMs();
    if (!force && f < 1 && t - lastWriteRef.current < TREND_FRAME_MIN_MS) return;
    lastWriteRef.current = t;
    const { d, transform } = frameAt(state, state.animate ? f : 1);
    pathRef.current.setAttribute('d', d);
    plotRef.current.setAttribute('transform', transform);
  };
  const writeFrameRef = useRef(writeFrame);
  writeFrameRef.current = writeFrame;

  useEffect(() => {
    const clock = clockRef.current;
    const unsubscribe = clock.subscribe((f) => writeFrameRef.current(f));
    return () => { unsubscribe(); clock.stop(); };
  }, []);

  // Before paint on each tick: place the line at f = 0 (or straight at the
  // final state when there is nothing to glide from), then start the clock.
  useLayoutEffect(() => {
    if (!chart?.ready) return;
    const last = lastTickRef.current;
    // Only a single-tick step of the same rider's series, grown by exactly one
    // slot, glides. A jump (hidden tab, first draw, late ready), a rider switch
    // or a series that didn't grow lands on the newest state instead.
    const length = chart.prefix.length;
    const animate = last.tickCount != null && tickCount - last.tickCount === 1
      && last.participantId === participantId && length === last.length + 1
      && Boolean(last.range) && !prefersReducedMotion();
    frameRef.current = { chart, prevRange: last.range || chart.range, animate };
    lastTickRef.current = { tickCount, range: chart.range, participantId, length };
    writeFrame(animate ? 0 : 1, true);
    if (animate) clockRef.current.onTick();
  }, [chart]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    logger().debug('fitness.sidebar.hr_trend.mount', { profileId, cardHeight, readings: chart?.readings ?? 0 });
    return () => logger().debug('fitness.sidebar.hr_trend.unmount', { profileId });
    // Lifecycle only: height and readings at mount are the useful context.
  }, [profileId]); // eslint-disable-line react-hooks/exhaustive-deps

  const ready = Boolean(chart?.ready);
  const loggedReadyRef = useRef(false);
  useEffect(() => {
    if (!ready || loggedReadyRef.current) return;
    loggedReadyRef.current = true;
    logger().info('fitness.sidebar.hr_trend.ready', { profileId, readings: chart.readings, ticks: tickCount });
  }, [ready]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!ready) {
    return (
      <div className="rider-hr-trend rider-hr-trend--loading" role="status" aria-label="Collecting heart rate">
        <span className="rider-hr-trend__spinner" />
      </div>
    );
  }

  const [lo, hi] = chart.range;
  const lineId = `${uid}-line`;
  // `d` and the plot transform are written by writeFrame, never by React, so
  // a parent re-render mid-glide cannot snap the line back to the tick state.
  return (
    <svg className="rider-hr-trend" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true" focusable="false">
      <defs>
        <path ref={pathRef} id={lineId} className="rider-hr-trend__line" />
        {bands.map((band) => (
          <clipPath key={band.key} id={`${uid}-band-${band.key}`} clipPathUnits="userSpaceOnUse">
            <rect x="-1" width="102" y={band.lo} height={band.hi - band.lo} />
          </clipPath>
        ))}
      </defs>
      <g ref={plotRef} className="rider-hr-trend__plot">
        {bands.slice(1).filter((b) => b.lo > lo && b.lo < hi).map((b) => (
          <line key={`g${b.key}`} className="rider-hr-trend__guide" x1="0" x2="100" y1={b.lo} y2={b.lo} />
        ))}
        {bands.map((band) => (
          <use key={band.key} href={`#${lineId}`} clipPath={`url(#${uid}-band-${band.key})`} stroke={band.color} />
        ))}
      </g>
    </svg>
  );
};

export default React.memo(RiderHrTrend);
