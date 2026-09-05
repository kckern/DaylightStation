import { useMemo } from 'react';
import { useApiResource } from '../../../lib/hooks/useApiResource.js';
import { createAppLogger } from '../../../lib/ui/createAppLogger.js';
import { buildWeightSeries, fmtLbs, fmtDelta, VIEW_W, VIEW_H } from './weightSeries.js';
import { ErrorState, StatCard, Skeleton } from '@/lib/ui';

const logger = createAppLogger('health').child('weight-chip');

const ARROWS = { up: '▲', down: '▼', flat: '■' };

/**
 * Weight + 7-day trend + a 30-day sparkline, as one compact row.
 *
 * The sparkline is two inline SVG polylines — the raw daily readings and the
 * adjusted average the budget is actually computed from — on ONE shared scale.
 * No chart library for two polylines, and nothing here animates `filter`
 * (a known paint-cost trap in this repo: low fps with zero long tasks).
 *
 * Direction is carried by an ARROW as well as by hue (accessibility A1: never
 * colour alone), and a history too short to have a 7-day delta says so instead
 * of printing a confident ±0.0.
 */
export function WeightChip() {
  const res = useApiResource('api/v1/health/weight', { label: 'weight-chip', logger, swr: true });
  const series = useMemo(() => buildWeightSeries(res.data), [res.data]);
  const { latestLbs, deltaLbs, direction, rawPoints, avgPoints, entries, latest, trendDays } = series;
  if (res.error) return <ErrorState error={res.error} onRetry={res.reload} label="Weight unavailable" />;

  const deltaText = fmtDelta(deltaLbs);
  const label = latestLbs == null
    ? 'Weight, no readings yet'
    : `Weight ${fmtLbs(latestLbs)} pounds${deltaText ? `, ${deltaText.replace('−', 'minus ').replace('+', 'plus ').replace('±', 'no change, ')} pounds over ${trendDays} days` : ', no 7-day trend yet'}`;

  return (
    <div className="health-weightchip" role="group" aria-label={label} aria-busy={res.loading}>
      <StatCard compact label="Weight" value={res.loading ? <Skeleton width={64} height={24} /> : fmtLbs(latestLbs)} unit="lb"
        trend={deltaText ? (
          <span className={`health-weightchip__delta health-weightchip__delta--${direction}`} data-testid="weight-delta">
            <span className="health-weightchip__arrow" aria-hidden="true">{ARROWS[direction]}</span>
            {deltaText}
            <span className="health-weightchip__window"> / {trendDays}d</span>
          </span>
        ) : (
          <span className="health-weightchip__delta health-weightchip__delta--none" data-testid="weight-delta-none">
            no 7-day trend yet
          </span>
        )}
      spark={rawPoints || avgPoints ? (
        <svg className="health-weightchip__spark" viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
          preserveAspectRatio="none" role="img"
          aria-label={`${entries.length} day weight sparkline ending ${latest?.date || ''}`}>
          {rawPoints ? (
            <polyline data-testid="spark-raw" className="health-weightchip__line health-weightchip__line--raw"
              points={rawPoints} fill="none" vectorEffect="non-scaling-stroke" />
          ) : null}
          {avgPoints ? (
            <polyline data-testid="spark-avg" className="health-weightchip__line health-weightchip__line--avg"
              points={avgPoints} fill="none" vectorEffect="non-scaling-stroke" />
          ) : null}
        </svg>
      ) : (
        // One reading is not a line. Drawing a flat segment across the box
        // would assert a month of stability nobody measured.
        <span className="health-weightchip__spark health-weightchip__spark--empty" data-testid="spark-empty" aria-hidden="true" />
      )} />
    </div>
  );
}
export default WeightChip;
