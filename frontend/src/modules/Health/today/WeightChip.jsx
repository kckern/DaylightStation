import { lazy, Suspense, useMemo } from 'react';
import { useApiResource } from '../../../lib/hooks/useApiResource.js';
import { unavailableError } from '../healthResources.js';
import { createAppLogger } from '../../../lib/ui/createAppLogger.js';
import { buildWeightSeries, normalizeWeightEntries, fmtLbs, fmtDelta, TREND_ARROWS } from './weightSeries.js';
import { ErrorState, StatCard, Skeleton } from '@/lib/ui';

const logger = createAppLogger('health').child('weight-chip');
// Highcharts is lazy: it stays out of the Today bundle (the intake/burn chart does the same).
const WeightTrendChart = lazy(() => import('../progress/WeightTrendChart.jsx').then(m => ({ default: m.WeightTrendChart })));
const CHART_HEIGHT = 150;

/**
 * Weight + 7-day trend, and the twelve-week trend chart: the same picture as the
 * screen-framework weight widget (modules/Health/Weight.jsx) and the Progress
 * tab — adjusted-average area, a dot for each day actually weighed (never the
 * forward-filled `lbs`), and the average less water weight as a hairline.
 *
 * Direction is carried by an ARROW as well as by hue (accessibility A1: never
 * colour alone), and a history too short to have a 7-day delta says so instead
 * of printing a confident ±0.0.
 */
export function WeightChip({ asOf }) {
  const res = useApiResource('api/v1/health/weight', { label: 'weight-chip', logger, swr: true });
  const series = useMemo(() => buildWeightSeries(res.data, { asOf }), [res.data, asOf]);
  const { latestLbs, deltaLbs, direction, entries, latest, trendDays } = series;
  // The chart plots the full normalized history (it windows itself to 12 weeks, up to asOf).
  const chartEntries = useMemo(() => normalizeWeightEntries(res.data).filter(e => !asOf || e.date <= asOf), [res.data, asOf]);
  if (unavailableError(res)) return <ErrorState error={res.error} onRetry={res.reload} label="Weight unavailable" />;

  const deltaText = fmtDelta(deltaLbs);
  const label = latestLbs == null
    ? 'Weight, no readings yet'
    : `Weight ${fmtLbs(latestLbs)} pounds${deltaText ? `, ${deltaText.replace('−', 'minus ').replace('+', 'plus ').replace('±', 'no change, ')} pounds over ${trendDays} days` : ', no 7-day trend yet'}`;

  return (
    <div className="health-weightchip" role="group" aria-label={label} aria-busy={res.loading}>
      <StatCard compact label={`Weight${latest?.date ? ` · as of ${latest.date}` : ''}`} value={res.loading ? <Skeleton width={64} height={24} /> : fmtLbs(latestLbs)} unit="lb"
        trend={deltaText ? (
          <span className={`health-weightchip__delta health-weightchip__delta--${direction}`} data-testid="weight-delta">
            <span className="health-weightchip__arrow" aria-hidden="true">{TREND_ARROWS[direction]}</span>
            {deltaText}
            <span className="health-weightchip__window"> / {trendDays}d</span>
          </span>
        ) : (
          <span className="health-weightchip__delta health-weightchip__delta--none" data-testid="weight-delta-none">
            no 7-day trend yet
          </span>
        )}
      />
      {entries.length > 1 ? (
        <Suspense fallback={<Skeleton height={CHART_HEIGHT} />}>
          <WeightTrendChart entries={chartEntries} height={CHART_HEIGHT} />
        </Suspense>
      ) : (
        // One reading is not a line: say so rather than draw a flat month.
        <span className="health-weightchip__empty" data-testid="spark-empty">Not enough weigh-ins for a trend yet</span>
      )}
    </div>
  );
}
export default WeightChip;
