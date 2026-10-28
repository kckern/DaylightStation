//
// Everything the entity history chart decides, as pure functions. Highcharts
// renders into a real layout engine and jsdom has none, so the arithmetic lives
// here and HistoryChart.jsx only hands the result to <HighchartsReact> (the
// same split weightChart.js uses).
//
// Three shapes come back from GET /home-dashboard/entities/:id/history:
//   line   — bucketed readings `points: [{t, v, max}]`, `v: null` is a gap
//   state  — on-intervals `intervals: [{from, to}]` inside [sinceIso, endIso]
//   events — ring marks `marks: [ms]`
//

const parseMs = (iso) => {
  const ms = iso ? Date.parse(iso) : NaN;
  return Number.isFinite(ms) ? ms : null;
};

/** Only the points with a reading: a series of gaps has nothing to draw. */
export function hasReadings(history) {
  if (!history) return false;
  if (history.kind === 'line') return (history.points || []).some((p) => p.v !== null && p.v !== undefined);
  if (history.kind === 'state') return (history.intervals || []).length > 0;
  if (history.kind === 'events') return (history.marks || []).length > 0;
  return false;
}

/**
 * On-intervals as a 0/1 step series that covers the whole window: off from the
 * start until the first interval, 1 across each interval, and an interval still
 * open at the end of the window stays on to the end (not a fall to 0).
 */
export function stateSteps(intervals, startMs, endMs) {
  const data = [];
  const list = [...(intervals || [])].sort((a, b) => a.from - b.from);
  const start = startMs ?? list[0]?.from ?? null;
  const end = endMs ?? list[list.length - 1]?.to ?? null;
  if (start !== null && !(list[0] && list[0].from <= start)) data.push([start, 0]);
  for (const { from, to } of list) {
    data.push([Math.max(from, start ?? from), 1]);
    if (end === null || to < end) data.push([to, 0]);
  }
  const last = data[data.length - 1];
  if (end !== null && last && last[0] < end) data.push([end, last[1]]);
  return data;
}

function seriesFor(history, tokens, unit) {
  const startMs = parseMs(history.sinceIso);
  const endMs = parseMs(history.endIso);
  if (history.kind === 'state') {
    // Solid amber (the Mosaic's "on"): a translucent amber over the dark panel
    // reads olive, not on.
    return [{
      type: 'area', name: 'On', step: 'left', color: tokens.warning, fillColor: tokens.warning, fillOpacity: 1, lineWidth: 0,
      data: stateSteps(history.intervals, startMs, endMs), marker: { enabled: false },
      enableMouseTracking: false,
    }];
  }
  if (history.kind === 'events') {
    return [{
      type: 'scatter', name: 'Ring', color: tokens.info,
      data: (history.marks || []).map((t) => [t, 0]),
      marker: { symbol: 'circle', radius: 5, lineWidth: 0 },
    }];
  }
  return [{
    type: 'area', name: unit || 'Reading', color: tokens.accent, fillOpacity: 0.18, lineWidth: 1.5,
    data: (history.points || []).map((p) => [p.t, p.v ?? null]),
    connectNulls: false, marker: { enabled: false },
  }];
}

/**
 * Highcharts options for one entity's history, themed from the live --ds-*
 * token values. Null until the tokens are read (the first render).
 */
export function buildHistoryChartOptions({ history, tokens, height = 140, unit = null }) {
  if (!tokens || !history) return null;
  const kind = history.kind;
  const startMs = parseMs(history.sinceIso);
  const endMs = parseMs(history.endIso);
  const axisLabel = { color: tokens.textMid, fontSize: '0.68rem' };
  const isLine = kind !== 'state' && kind !== 'events';
  const suffix = unit ? ` ${unit}` : '';
  return {
    chart: {
      backgroundColor: 'transparent', height, spacing: [8, 4, 4, 4],
      style: { fontFamily: 'inherit' }, animation: false,
    },
    time: { useUTC: false },
    title: { text: null },
    legend: { enabled: false },
    credits: { enabled: false },
    accessibility: { enabled: false },
    tooltip: {
      enabled: kind !== 'state',
      backgroundColor: tokens.surface, borderColor: tokens.border,
      style: { color: tokens.textHigh || tokens.textMid, fontSize: '0.75rem' },
      xDateFormat: '%a %b %e, %l:%M %p',
      pointFormat: isLine ? `<b>{point.y:.1f}${suffix}</b>` : 'Rang',
    },
    xAxis: {
      type: 'datetime',
      min: startMs ?? undefined, max: endMs ?? undefined,
      // Highcharts floors the tick interval at the closest gap between points:
      // a lamp on all day is two points 24 h apart, which left one label.
      minTickInterval: 5 * 60e3,
      lineColor: tokens.border, tickColor: tokens.border,
      labels: { style: axisLabel },
      dateTimeLabelFormats: { minute: '%l:%M %p', hour: '%l %p', day: '%a %e', week: '%a %e' },
    },
    yAxis: isLine
      ? {
        title: { text: null },
        gridLineColor: tokens.border,
        labels: { style: axisLabel, format: `{value}${suffix}` },
      }
      : { visible: false, min: kind === 'state' ? 0 : -1, max: 1, title: { text: null } },
    plotOptions: { series: { animation: false, states: { inactive: { enabled: false } } } },
    series: seriesFor(history, tokens, unit),
  };
}
