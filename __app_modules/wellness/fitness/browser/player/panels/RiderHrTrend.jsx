import React, { useEffect, useMemo, useRef } from 'react';
import getLogger from '@/lib/logging/Logger.js';
import { ZONE_COLORS } from '../../shared/constants/fitness.js';
import { bucketHrSeries, hrTrendRange, hrTrendRuns, thresholdLines } from './hrTrend.js';

let _logger;
const logger = () => (_logger ||= getLogger().child({ component: 'fitness-sidebar-hr-trend' }));

/**
 * Whole-session HR sparkline for a tall rider card: one polyline per zone run,
 * zone-coloured, broken on dropouts, with faint guides at the rider's zone
 * thresholds. Static SVG — no animation; the new point simply appears.
 *
 * Recomputes only when the timeline ticks (every 5s): `tickCount` is the memo
 * key and the series is read uncloned. FitnessUsers re-renders on every HR
 * publish, so this boundary is what keeps the cost at one SVG diff per tick.
 */
const RiderHrTrend = ({ participantId, getSeries, tickCount, thresholds, profileId, cardHeight }) => {
  const getSeriesRef = useRef(getSeries);
  getSeriesRef.current = getSeries;
  const thresholdsKey = (thresholds || []).join(',');

  const chart = useMemo(() => {
    const read = getSeriesRef.current;
    if (!participantId || typeof read !== 'function') return null;
    const hr = read(participantId, 'heart_rate', { clone: false }) || [];
    const zones = read(participantId, 'zone_id', { clone: false }) || [];
    const buckets = bucketHrSeries(hr, zones);
    const marks = thresholdsKey ? thresholdsKey.split(',').map(Number) : [];
    const range = hrTrendRange(buckets, marks);
    return { width: Math.max(1, buckets.length), runs: hrTrendRuns(buckets, range), guides: thresholdLines(range, marks) };
    // tickCount is the recompute clock; the series arrays are mutated in place.
  }, [participantId, tickCount, thresholdsKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const buckets = chart?.width || 0;
  useEffect(() => {
    logger().debug('fitness.sidebar.hr_trend.mount', { profileId, cardHeight, buckets });
    return () => logger().debug('fitness.sidebar.hr_trend.unmount', { profileId });
    // Lifecycle only: height and bucket count at mount are the useful context.
  }, [profileId]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!chart || !chart.runs.length) return <div className="rider-hr-trend rider-hr-trend--empty" aria-hidden="true" />;
  return (
    <svg className="rider-hr-trend" viewBox={`0 0 ${chart.width} 100`} preserveAspectRatio="none" aria-hidden="true" focusable="false">
      {chart.guides.map((y) => (
        <line key={`g${y}`} className="rider-hr-trend__guide" x1="0" x2={chart.width} y1={y} y2={y} />
      ))}
      {chart.runs.map((run, i) => (
        <polyline key={i} className="rider-hr-trend__line" points={run.points}
          stroke={ZONE_COLORS[run.zone] || 'rgba(255,255,255,0.6)'} />
      ))}
    </svg>
  );
};

export default React.memo(RiderHrTrend);
