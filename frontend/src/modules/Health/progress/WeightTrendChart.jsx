import { useEffect, useMemo, useRef, useState } from 'react';
import Highcharts from 'highcharts';
import HighchartsReact from 'highcharts-react-official';
import { buildWeightChartOptions } from './weightChart.js';

// Reads the --ds-* custom properties off a mounted DS-themed element. The
// chart is ported from the screen-framework weight widget (Weight.jsx), with
// its hardcoded hex swapped for the live token values (getComputedStyle, not
// Highcharts' styled mode, which needs a stylesheet keyed to Highcharts' own
// class names).
export function readTokens(el) {
  const cs = getComputedStyle(el);
  const get = (name) => cs.getPropertyValue(name).trim();
  return {
    textHigh: get('--ds-text-high'),
    textMid: get('--ds-text-mid'),
    textLow: get('--ds-text-low'),
    border: get('--ds-border'),
    surface: get('--ds-surface'),
    accent: get('--ds-accent') || get('--ds-info'),
  };
}

/**
 * The weight trend as a Highcharts area chart: the adjusted average (area),
 * the days actually weighed (dots), and the average less that day's water
 * weight (hairline) — the screen-framework widget's picture, themed. Loaded
 * lazily: Highcharts stays out of the Today bundle.
 */
export function WeightTrendChart({ entries, goalLbs = null, height = 150, compact = true }) {
  const ref = useRef(null);
  const [tokens, setTokens] = useState(null);
  useEffect(() => { if (ref.current) setTokens(readTokens(ref.current)); }, []);
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
