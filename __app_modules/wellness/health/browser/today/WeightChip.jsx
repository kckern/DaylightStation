import { lazy, Suspense, useMemo } from 'react';
import { useApiResource } from "../../../../../frontend/src/lib/hooks/useApiResource.js";
import { unavailableError } from "../healthResources.js";
import { createAppLogger } from "../../../../../frontend/src/lib/ui/createAppLogger.js";
import { buildWeightSeries, fmtLbs, fmtDelta, TREND_ARROWS } from "./weightSeries.js";
import { WINDOW_DAYS } from '../progress/weightChart.js';
import { ErrorState, LoadingState, StatCard, Skeleton, useRetryRegion } from '@/lib/ui';

const logger = createAppLogger('health').child('weight-chip');
// Highcharts is lazy: it stays out of the Today bundle (the intake/burn chart does the same).
const WeightTrendChart = lazy(() => import("../progress/WeightTrendChart.jsx").then(m => ({ default: m.WeightTrendChart })));
const CHART_HEIGHT = 150;

/**
 * Weight + 7-day trend, and the twelve-week trend chart: the same picture as the
 * screen-framework weight widget (__app_modules/Health/Weight.jsx) and the Progress
 * tab — adjusted-average area, a dot for each day actually weighed (never the
 * forward-filled `lbs`), and the average less water weight as a hairline.
 *
 * Direction is carried by an ARROW as well as by hue (accessibility A1: never
 * colour alone), and a history too short to have a 7-day delta says so instead
 * of printing a confident ±0.0.
 */
export function WeightChip({ asOf }) {
  const res = useApiResource('api/v1/health/weight', { label: 'weight-chip', logger, swr: true });
  const busy = res.loading || res.revalidating;
  const hasResult = Boolean(res.hasResult);
  const { regionProps, retry } = useRetryRegion(res.reload, busy);
  const series = useMemo(() => buildWeightSeries(res.data, { asOf, days: WINDOW_DAYS }), [res.data, asOf]);
  const { latestLbs, deltaLbs, direction, entries, latest, trendDays } = series;
  const hasReadings = entries.length > 0;
  // The same 12-week series decides whether the chart is useful and feeds it.
  const chartEntries = entries;
  // A settled empty history is valid, but it is not useful stale content: if
  // its refresh fails, offer Retry instead of presenting that empty snapshot
  // as current. Populated history remains readable if a refresh fails.
  const readError = busy
    ? null
    : unavailableError(res) ?? (!hasReadings ? res.error ?? null : null);
  const showContent = hasResult && !readError && (!busy || hasReadings);

  const deltaText = fmtDelta(deltaLbs);
  const label = showContent && latestLbs == null
    ? 'Weight, no readings yet'
    : showContent
      ? `Weight ${fmtLbs(latestLbs)} pounds${deltaText ? `, ${deltaText.replace('−', 'minus ').replace('+', 'plus ').replace('±', 'no change, ')} pounds over ${trendDays} days` : ', no 7-day trend yet'}`
      : 'Weight history';

  return (
    <div className="health-weightchip" role="group" aria-label={label} {...regionProps}>
      {busy && !hasReadings ? <LoadingState label="weight history" rows={1} data-testid="weight-chip-loading" /> : null}
      {readError ? <ErrorState error={readError} onRetry={retry} label="Weight unavailable" /> : null}
      {showContent ? <>
        <StatCard
          compact
          label={`Weight${latest?.date ? ` · as of ${latest.date}` : ''}`}
          value={fmtLbs(latestLbs)}
          unit="lb"
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
      </> : null}
    </div>
  );
}
export default WeightChip;
