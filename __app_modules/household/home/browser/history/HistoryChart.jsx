import { useEffect, useMemo, useRef, useState } from 'react';
import Highcharts from 'highcharts';
import HighchartsReact from 'highcharts-react-official';
import { buildHistoryChartOptions } from './historyChart.js';

/**
 * The live --ds-* token values off a mounted, DS-themed element (the pattern
 * WeightTrendChart uses: getComputedStyle rather than Highcharts' styled mode).
 */
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
    warning: get('--ds-warning'),
    info: get('--ds-info'),
  };
}

/**
 * One entity's history: a reading as an area, on/off as a stepped band, rings
 * as marks. Loaded lazily, so Highcharts stays out of the home bundle until a
 * drawer opens.
 */
export function HistoryChart({ history, unit = null, height = 140 }) {
  const ref = useRef(null);
  const [tokens, setTokens] = useState(null);
  useEffect(() => { if (ref.current) setTokens(readTokens(ref.current)); }, []);
  const options = useMemo(
    () => buildHistoryChartOptions({ history, tokens, height, unit }),
    [history, tokens, height, unit],
  );
  return (
    <div ref={ref} className="home-history__chart" data-kind={history?.kind} style={{ minHeight: height }}>
      {options ? <HighchartsReact highcharts={Highcharts} options={options} /> : null}
    </div>
  );
}

export default HistoryChart;
