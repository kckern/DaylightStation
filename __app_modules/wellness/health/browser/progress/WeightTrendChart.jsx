import { useMemo, useRef } from 'react';
import Highcharts from 'highcharts';
import HighchartsReact from 'highcharts-react-official';
import { useChartThemeTokens } from '@/lib/theme/useChartThemeTokens.js';
import { buildWeightChartOptions } from "./weightChart.js";

/**
 * The weight trend as a Highcharts area chart: the adjusted average (area),
 * the days actually weighed (dots), and the average less that day's water
 * weight (hairline) — the screen-framework widget's picture, themed. Loaded
 * lazily: Highcharts stays out of the Today bundle.
 */
export function WeightTrendChart({ entries, goalLbs = null, height = 150, compact = true }) {
  const ref = useRef(null);
  const tokens = useChartThemeTokens(ref);
  const options = useMemo(
    () => buildWeightChartOptions({ entries, tokens, goalLbs, height, compact }),
    [entries, tokens, goalLbs, height, compact],
  );
  return (
    <div ref={ref} className="health-weight-trend" data-testid="weight-trend-chart" style={{ minHeight: height }}>
      {options ? <HighchartsReact highcharts={Highcharts} options={options} /> : null}
    </div>
  );
}

export default WeightTrendChart;
