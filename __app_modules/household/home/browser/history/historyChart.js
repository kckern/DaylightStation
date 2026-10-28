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

import { formatWatts } from '../entities/formatEntityState.js';

const parseMs = (iso) => {
  const ms = iso ? Date.parse(iso) : NaN;
  return Number.isFinite(ms) ? ms : null;
};

const zoneFormats = new Map();
function partsIn(ms, timeZone) {
  const key = timeZone || '';
  let fmt = zoneFormats.get(key);
  if (!fmt) {
    fmt = new Intl.DateTimeFormat('en-US', {
      timeZone: timeZone || undefined, weekday: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', hourCycle: 'h23',
    });
    zoneFormats.set(key, fmt);
  }
  const o = {};
  for (const p of fmt.formatToParts(new Date(ms))) if (p.type !== 'literal') o[p.type] = p.value;
  return { weekday: o.weekday, day: Number(o.day), hour: Number(o.hour) % 24, minute: Number(o.minute) };
}

/** "6 pm" / "6:30 pm" — the page's clock, lowercase, in the household zone. */
export function formatClock(ms, timeZone) {
  const { hour, minute } = partsIn(ms, timeZone);
  const h = hour % 12 || 12;
  const m = minute ? `:${String(minute).padStart(2, '0')}` : '';
  return `${h}${m} ${hour < 12 ? 'am' : 'pm'}`;
}

/**
 * An x-axis label in the same dialect as the Today scale: "6 pm" for a time,
 * "Wed 28" for a day — and a local midnight on an hourly axis is its day.
 */
export function formatAxisTime(ms, unitName, timeZone) {
  const p = partsIn(ms, timeZone);
  const dayTick = unitName === 'day' || unitName === 'week' || unitName === 'month'
    || (p.hour === 0 && p.minute === 0);
  return dayTick ? `${p.weekday} ${p.day}` : formatClock(ms, timeZone);
}

/** "Wed 28, 6:30 pm" — a tooltip's moment. */
function formatMoment(ms, timeZone) {
  const p = partsIn(ms, timeZone);
  return `${p.weekday} ${p.day}, ${formatClock(ms, timeZone)}`;
}

const isWatts = (unit) => unit === 'W';

/** A reading's value with its unit: watts as W / kW, anything else as given. */
function formatValue(value, unit, digits = 0) {
  if (!Number.isFinite(value)) return '';
  if (isWatts(unit)) return formatWatts(value);
  const n = value.toLocaleString(undefined, { maximumFractionDigits: digits });
  return unit ? `${n} ${unit}` : n;
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
  const timeZone = history.timeZone || null;
  return {
    chart: {
      backgroundColor: 'transparent', height, spacing: [8, 4, 4, 4],
      style: { fontFamily: 'inherit' }, animation: false,
    },
    // The household's zone when the server names it (the Today lanes use the
    // same), else the browser's own.
    time: timeZone ? { timezone: timeZone } : { useUTC: false },
    title: { text: null },
    legend: { enabled: false },
    credits: { enabled: false },
    accessibility: { enabled: false },
    tooltip: {
      enabled: kind !== 'state',
      backgroundColor: tokens.surface, borderColor: tokens.border,
      style: { color: tokens.textHigh || tokens.textMid, fontSize: '0.75rem' },
      formatter() {
        const what = isLine ? `<b>${formatValue(this.y, unit, 1)}</b>` : 'Rang';
        return `${formatMoment(this.x, timeZone)}<br/>${what}`;
      },
    },
    xAxis: {
      type: 'datetime',
      min: startMs ?? undefined, max: endMs ?? undefined,
      // Highcharts floors the tick interval at the closest gap between points:
      // a lamp on all day is two points 24 h apart, which left one label.
      minTickInterval: 5 * 60e3,
      lineColor: tokens.border, tickColor: tokens.border,
      labels: {
        style: axisLabel,
        formatter() { return formatAxisTime(this.value, this.tickPositionInfo?.unitName, timeZone); },
      },
    },
    yAxis: isLine
      ? {
        title: { text: null },
        gridLineColor: tokens.border,
        labels: { style: axisLabel, formatter() { return formatValue(this.value, unit); } },
      }
      : { visible: false, min: kind === 'state' ? 0 : -1, max: 1, title: { text: null } },
    plotOptions: { series: { animation: false, states: { inactive: { enabled: false } } } },
    series: seriesFor(history, tokens, unit),
  };
}
