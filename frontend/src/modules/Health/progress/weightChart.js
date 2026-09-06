//
// Everything the weight chart decides, as pure functions.
//
// Highcharts renders into a real layout engine, and jsdom has none — a test can
// mount the chart and still learn nothing about where a month line landed or
// which points became dots. So the arithmetic lives here and the component does
// nothing but hand the result to <HighchartsReact>, the same split dayBars.js
// and intakeBurn.js already use.
//
import { addDays } from '../today/WeekStrip.jsx';

/** The window the chart covers. Twelve weeks: a weight trend is a season, not a month. */
export const WINDOW_DAYS = 84;

/** Fallback body-fat target when goals carry none. */
export const DEFAULT_TARGET_BODY_FAT_PCT = 18;

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** Midday UTC for an ISO date — the same anchor weightSeries.js uses, so x
 *  positions from the two modules line up exactly. */
export const at = (date) => Date.parse(`${date}T12:00:00Z`);

/** The last WINDOW_DAYS of history, relative to the newest entry (not to today:
 *  a stale file should still draw its own last twelve weeks, not an empty box). */
export function windowEntries(entries, days = WINDOW_DAYS) {
  if (!entries?.length) return [];
  const from = addDays(entries[entries.length - 1].date, -(days - 1));
  return entries.filter((entry) => entry.date >= from);
}

/**
 * Gridline spacing in pounds. One line per pound is the point of the axis — it
 * is how a 1 lb move stays visible — but across a 40 lb range it becomes 40
 * lines of noise, so a wide window steps back to 5.
 */
export function tickIntervalFor(spanLbs) {
  return spanLbs <= 12 ? 1 : 5;
}

/** Vertical extent across every plotted series, clipped to the data (a
 *  zero-based axis would flatten a real 3 lb move into nothing). */
export function axisRange(entries, extra = []) {
  const values = entries
    .flatMap((entry) => [entry.avg, entry.measurement, waterValue(entry)])
    .concat(extra)
    .filter((v) => v != null && Number.isFinite(v));
  if (!values.length) return null;
  const min = Math.floor(Math.min(...values)) - 1;
  const max = Math.ceil(Math.max(...values)) + 1;
  return { min, max, tickInterval: tickIntervalFor(max - min) };
}

/** The average with that day's OWN water weight removed. Null — a gap in the
 *  line — when the day has no water figure; a zero fallback would drop the line
 *  several pounds and read as sudden loss. */
export function waterValue(entry) {
  return entry.avg != null && entry.waterWeight != null ? entry.avg - entry.waterWeight : null;
}

/** One vertical rule per calendar month start inside the window, labelled.
 *  Distinct from the weekly gridlines in width and colour, or it says nothing. */
export function monthBoundaries(entries, color) {
  return entries
    .filter((entry) => entry.date.slice(-2) === '01')
    .map((entry) => ({
      value: at(entry.date),
      color,
      width: 2,
      zIndex: 1, // above the grid, below the series
      // Horizontal, and inset from the rule. A plot line's label defaults to
      // rotation 90, which stands the month on its end against the top
      // gridline — legible only if you tilt your head.
      label: {
        text: MONTHS[Number(entry.date.slice(5, 7)) - 1],
        rotation: 0,
        align: 'left',
        verticalAlign: 'top',
        style: { color, fontSize: '0.65rem' },
        x: 4,
        y: 12,
      },
    }));
}

/**
 * How long until the goal body-fat percentage, at the current rate.
 *
 * Lean mass is the part that does not change: hold it constant, and the weight
 * at the target percentage follows. The rate is the DERIVED adjusted-average
 * delta (the same number the trend cell shows) rather than the stored
 * `..._7day_trend` field, so the two cannot print different futures.
 *
 * Returns `{ days: null, reason }` rather than a number whenever the arithmetic
 * would be a lie: no trend, a trend moving away from the goal, or already there.
 */
export function daysToGoal({ lbs, fatPct, targetPct, deltaLbs, trendDays }) {
  if (lbs == null || fatPct == null || targetPct == null) return { days: null, reason: 'no-data' };
  const leanMass = lbs * (1 - fatPct / 100);
  const goalWeight = leanMass / (1 - targetPct / 100);
  const toLose = lbs - goalWeight;
  if (toLose <= 0) return { days: 0, reason: 'at-goal', goalWeight };
  if (deltaLbs == null || !trendDays) return { days: null, reason: 'no-trend', goalWeight };
  const perDay = deltaLbs / trendDays;
  // Losing means the adjusted average is going DOWN; flat or rising never
  // arrives, and Infinity is not a date.
  if (perDay >= 0) return { days: null, reason: 'diverging', goalWeight };
  return { days: Math.ceil(toLose / -perDay), reason: 'ok', goalWeight };
}

/** The projected calendar date, or null when there is no honest day count. */
export function goalDate(fromDate, days) {
  return fromDate && days != null && days > 0 ? addDays(fromDate, days) : null;
}

/**
 * The Highcharts options.
 *
 * ONE hue carries "weight" and the other marks are neutral ink separated by
 * geometry. That is not a shortcut around the palette validator — it is what
 * the validator says: run as a categorical palette these colours fail the
 * chroma floor and the normal-vision separation floor, because they are not
 * four identities. They are one measure (pounds) shown four ways, so mark shape
 * carries the difference and the legend names it.
 */
export function buildWeightChartOptions({ entries, tokens, goalLbs = null, height = 260 }) {
  if (!tokens || !entries?.length) return null;
  const windowed = windowEntries(entries);
  const range = axisRange(windowed, goalLbs != null ? [goalLbs] : []);
  if (!range) return null;

  const point = (value, index) => [at(windowed[index].date), value];
  const avgData = windowed.map((entry, i) => point(entry.avg, i));
  const waterData = windowed.map((entry, i) => point(waterValue(entry), i));
  const measurementData = windowed
    .map((entry, i) => (entry.measurement == null ? null : point(entry.measurement, i)))
    .filter(Boolean);

  const lbsTip = function pointFormatter() {
    return `<b>${formatTickDate(this.x)}</b>: ${this.y.toFixed(1)} lbs`;
  };

  return {
    chart: { backgroundColor: 'transparent', height, spacingBottom: 8 },
    title: { text: null },
    credits: { enabled: false },
    // Four marks means identity cannot ride on shape alone any more than on
    // colour alone — the legend names each one.
    legend: {
      enabled: true,
      itemStyle: { color: tokens.textMid, fontSize: '0.7rem', fontWeight: '400' },
      itemHoverStyle: { color: tokens.textHigh },
      symbolHeight: 8,
      margin: 4,
    },
    tooltip: { shared: true, backgroundColor: tokens.surface, borderColor: tokens.border,
      style: { color: tokens.textHigh, fontSize: '0.75rem' } },
    yAxis: {
      min: range.min,
      max: range.max,
      tickInterval: range.tickInterval,
      gridLineColor: tokens.border,
      gridLineWidth: 1,
      opposite: true,
      offset: -8,
      title: { enabled: false },
      labels: { style: { color: tokens.textMid, fontSize: '0.8rem' }, format: '{value} lbs' },
    },
    xAxis: {
      type: 'datetime',
      tickInterval: 7 * 86400000,
      gridLineColor: tokens.border,
      gridLineWidth: 1,
      lineColor: tokens.border,
      crosshair: { color: tokens.border, width: 1 },
      // The first tick sits on the plot's left edge, where a -35° label runs
      // off the canvas and renders as a clipped fragment (", 15"). Dropping it
      // costs one date; keeping it prints garbage.
      labels: {
        rotation: -35,
        style: { color: tokens.textMid, fontSize: '0.7rem' },
        formatter() { return this.isFirst ? null : formatTickDate(this.value); },
      },
      plotLines: monthBoundaries(windowed, tokens.textLow),
    },
    plotOptions: {
      areaspline: { marker: { enabled: false }, lineWidth: 2, fillOpacity: 0.15,
        tooltip: { pointFormatter: lbsTip } },
      line: { marker: { enabled: false }, tooltip: { pointFormatter: lbsTip } },
      scatter: { tooltip: { pointFormatter: lbsTip } },
    },
    series: [
      { type: 'areaspline', name: 'Adjusted average', color: tokens.accent, data: avgData, zIndex: 3 },
      // The evidence: only days actually weighed. Recessive ink, and a hit
      // target wider than the dot so it is still hoverable at r 2.5.
      { type: 'scatter', name: 'Measured', color: tokens.textMid, data: measurementData, zIndex: 4,
        marker: { radius: 2.5, symbol: 'circle' }, stickyTracking: false,
        states: { hover: { halo: { size: 8 } } } },
      { type: 'line', name: 'Less water weight', color: tokens.textLow, data: waterData,
        lineWidth: 0.5, connectNulls: false, zIndex: 2, enableMouseTracking: false },
      // A reference line, not a status: no success/warning hue, and it says
      // what it is on the chart rather than only in the legend.
      ...(goalLbs != null ? [{
        type: 'line', name: 'Goal', color: tokens.textLow, dashStyle: 'Dash', lineWidth: 1.5, zIndex: 2,
        data: [[at(windowed[0].date), goalLbs], [at(windowed[windowed.length - 1].date), goalLbs]],
        enableMouseTracking: false,
        dataLabels: { enabled: true, allowOverlap: true, align: 'left', verticalAlign: 'bottom',
          style: { color: tokens.textLow, fontSize: '0.65rem', fontWeight: '400', textOutline: 'none' },
          formatter() { return this.point.index === 0 ? `Goal ${goalLbs} lb` : null; } },
      }] : []),
    ],
  };
}

// Tooltip dates are formatted here rather than with Highcharts.dateFormat so
// this module stays importable — and testable — without the library present.
function formatTickDate(x) {
  const d = new Date(x);
  return `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}`;
}
