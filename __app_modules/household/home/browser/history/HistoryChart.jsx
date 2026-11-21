import { useMemo, useRef } from 'react';
import Highcharts from 'highcharts';
import HighchartsReact from 'highcharts-react-official';
import { useChartThemeTokens } from '@/lib/theme/useChartThemeTokens.js';
import { buildHistoryChartOptions } from './historyChart.js';

/**
 * One entity's history: a reading as an area, on/off as a stepped band, rings
 * as marks. Loaded lazily, so Highcharts stays out of the home bundle until a
 * drawer opens.
 */
export function HistoryChart({ history, unit = null, height = 140 }) {
  const ref = useRef(null);
  const tokens = useChartThemeTokens(ref);
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
