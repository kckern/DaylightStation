import { describe, it, expect } from 'vitest';
import { normalizeWeightEntries } from '../today/weightSeries.js';
import {
  windowEntries, tickIntervalFor, axisRange, waterValue, monthBoundaries,
  daysToGoal, goalDate, buildWeightChartOptions, at, WINDOW_DAYS,
} from './weightChart.js';

const row = (date, over = {}) => [date, {
  date, lbs: 172, measurement: 172, lbs_adjusted_average: 171, water_weight: 3.5, ...over,
}];
const entries = (...pairs) => normalizeWeightEntries(Object.fromEntries(pairs));

const tokens = { textHigh: '#e8eef3', textMid: '#94a3b8', textLow: '#6b7785',
  border: '#2d3743', accent: '#4dabf7', surface: '#1c2229' };

const seriesNamed = (options, name) => options.series.find((s) => s.name === name);

describe('windowEntries', () => {
  it('keeps twelve weeks measured from the NEWEST entry, not from today', () => {
    // A file that stopped updating months ago must still draw its own last
    // twelve weeks rather than an empty box.
    const iso = (i) => new Date(Date.UTC(2025, 0, 1 + i)).toISOString().slice(0, 10);
    const wide = entries(...Array.from({ length: 200 }, (_, i) => row(iso(i))));
    const windowed = windowEntries(wide);
    expect(windowed).toHaveLength(WINDOW_DAYS);
    expect(windowed[windowed.length - 1].date).toBe(iso(199));
  });

  it('is empty, not broken, with no entries', () => {
    expect(windowEntries([])).toEqual([]);
    expect(windowEntries(null)).toEqual([]);
  });
});

describe('tickIntervalFor', () => {
  it('draws a gridline per pound over a narrow range so a 1 lb move stays visible', () => {
    expect(tickIntervalFor(8)).toBe(1);
    expect(tickIntervalFor(12)).toBe(1);
  });

  it('steps back to 5 once per-pound lines would become noise', () => {
    expect(tickIntervalFor(13)).toBe(5);
    expect(tickIntervalFor(40)).toBe(5);
  });
});

describe('axisRange', () => {
  it('clips to the data rather than starting at zero', () => {
    const range = axisRange(entries(row('2026-09-01', { measurement: 170, lbs_adjusted_average: 171 })));
    expect(range.min).toBeGreaterThan(100);
    expect(range.min).toBe(166); // the water line (171 - 3.5) is the floor: floor(167.5) - 1
    expect(range.max).toBe(172); // ceil(171) + 1
  });

  it('includes the goal line, so a distant goal is never drawn off-chart', () => {
    const range = axisRange(entries(row('2026-09-01')), [150]);
    expect(range.min).toBe(149);
  });

  it('is null when nothing is plottable', () => {
    expect(axisRange([])).toBeNull();
    expect(axisRange(entries(row('2026-09-01', { measurement: null, lbs_adjusted_average: null, water_weight: null })))).toBeNull();
  });
});

describe('waterValue', () => {
  it('subtracts each day OWN water weight, never one day applied backwards', () => {
    const [a, b] = entries(
      row('2026-09-01', { lbs_adjusted_average: 171, water_weight: 3.0 }),
      row('2026-09-02', { lbs_adjusted_average: 171, water_weight: 5.0 }),
    );
    expect(waterValue(a)).toBe(168);
    expect(waterValue(b)).toBe(166);
  });

  it('breaks the line on a day with no water figure instead of dropping to the average', () => {
    const [only] = entries(row('2026-09-01', { water_weight: null }));
    expect(waterValue(only)).toBeNull();
  });
});

describe('monthBoundaries', () => {
  it('marks month starts, not Mondays', () => {
    const rows = entries(
      row('2026-08-30'), row('2026-08-31'), row('2026-09-01'), row('2026-09-02'),
    );
    const lines = monthBoundaries(rows, '#6b7785');
    expect(lines).toHaveLength(1);
    expect(lines[0].value).toBe(at('2026-09-01'));
    expect(lines[0].label.text).toBe('Sep');
  });

  it('labels the month horizontally, not stood on its end', () => {
    const [line] = monthBoundaries(entries(row('2026-09-01')), '#6b7785');
    expect(line.label.rotation).toBe(0); // Highcharts' plot-line default is 90
  });

  it('is drawn wider than a gridline, or it says nothing', () => {
    const [line] = monthBoundaries(entries(row('2026-09-01')), '#6b7785');
    expect(line.width).toBe(2); // gridLineWidth is 1
    expect(line.color).toBe('#6b7785');
  });

  it('draws none in a window that contains no month start', () => {
    expect(monthBoundaries(entries(row('2026-09-02'), row('2026-09-03')), '#000')).toEqual([]);
  });
});

describe('daysToGoal', () => {
  const losing = { deltaLbs: -1.4, trendDays: 7 }; // 0.2 lb/day

  it('holds lean mass constant to find the weight at the target percentage', () => {
    // 200 lb at 25% fat = 150 lb lean. At 20% fat that lean mass weighs 187.5.
    const result = daysToGoal({ lbs: 200, fatPct: 25, targetPct: 20, ...losing });
    expect(result.goalWeight).toBeCloseTo(187.5, 5);
    expect(result.days).toBe(Math.ceil(12.5 / 0.2));
    expect(result.reason).toBe('ok');
  });

  it('reports arrival rather than a negative countdown when already past the goal', () => {
    const result = daysToGoal({ lbs: 170, fatPct: 15, targetPct: 20, ...losing });
    expect(result.days).toBe(0);
    expect(result.reason).toBe('at-goal');
  });

  it('refuses to project on a flat or rising trend instead of returning Infinity', () => {
    expect(daysToGoal({ lbs: 200, fatPct: 25, targetPct: 20, deltaLbs: 0, trendDays: 7 }))
      .toMatchObject({ days: null, reason: 'diverging' });
    expect(daysToGoal({ lbs: 200, fatPct: 25, targetPct: 20, deltaLbs: 1.2, trendDays: 7 }))
      .toMatchObject({ days: null, reason: 'diverging' });
  });

  it('refuses to project with no trend at all', () => {
    expect(daysToGoal({ lbs: 200, fatPct: 25, targetPct: 20, deltaLbs: null, trendDays: null }))
      .toMatchObject({ days: null, reason: 'no-trend' });
  });

  it('refuses to project with no body composition', () => {
    expect(daysToGoal({ lbs: 200, fatPct: null, targetPct: 20, ...losing }))
      .toMatchObject({ days: null, reason: 'no-data' });
  });

  it('uses the derived delta, so the trend cell and the projection cannot disagree', () => {
    // Same weight and composition, half the rate -> twice the days.
    const fast = daysToGoal({ lbs: 200, fatPct: 25, targetPct: 20, deltaLbs: -1.4, trendDays: 7 });
    const slow = daysToGoal({ lbs: 200, fatPct: 25, targetPct: 20, deltaLbs: -0.7, trendDays: 7 });
    expect(slow.days).toBe(fast.days * 2);
  });
});

describe('goalDate', () => {
  it('projects the arrival date from the last reading', () => {
    expect(goalDate('2026-09-01', 30)).toBe('2026-10-01');
  });

  it('has no date without a day count', () => {
    expect(goalDate('2026-09-01', null)).toBeNull();
    expect(goalDate('2026-09-01', 0)).toBeNull();
  });
});

describe('buildWeightChartOptions', () => {
  const sample = entries(
    row('2026-08-30', { measurement: 173, lbs_adjusted_average: 171.8, water_weight: 3.8 }),
    row('2026-08-31', { measurement: null, lbs_adjusted_average: 171.7, water_weight: 3.7 }),
    row('2026-09-01', { measurement: 172, lbs_adjusted_average: 171.6, water_weight: null }),
    row('2026-09-02', { measurement: 170, lbs_adjusted_average: 171.4, water_weight: 3.5 }),
  );

  it('plots a dot only where someone actually weighed in', () => {
    const options = buildWeightChartOptions({ entries: sample, tokens });
    expect(seriesNamed(options, 'Measured').data).toHaveLength(3); // not 4
    expect(seriesNamed(options, 'Adjusted average').data).toHaveLength(4);
  });

  it('never marks the smoothed line, so a dot always means a reading', () => {
    const options = buildWeightChartOptions({ entries: sample, tokens });
    expect(options.plotOptions.areaspline.marker.enabled).toBe(false);
  });

  it('leaves a hole in the water line rather than plotting the average', () => {
    const options = buildWeightChartOptions({ entries: sample, tokens });
    const water = seriesNamed(options, 'Less water weight');
    expect(water.data.map(([, y]) => y)).toEqual([168, 168, null, 167.9].map((v) => (v == null ? null : expect.closeTo(v, 5))));
    expect(water.connectNulls).toBe(false);
  });

  it('carries one hue: only the average wears the accent', () => {
    const options = buildWeightChartOptions({ entries: sample, tokens });
    const colored = options.series.filter((s) => s.color === tokens.accent);
    expect(colored.map((s) => s.name)).toEqual(['Adjusted average']);
  });

  it('names every mark in a legend, since shape is what tells them apart', () => {
    const options = buildWeightChartOptions({ entries: sample, tokens, goalLbs: 165 });
    expect(options.legend.enabled).toBe(true);
    expect(options.series.map((s) => s.name)).toEqual([
      'Adjusted average', 'Measured', 'Less water weight', 'Goal',
    ]);
  });

  it('draws the goal as a labelled reference line, not in a status colour', () => {
    const options = buildWeightChartOptions({ entries: sample, tokens, goalLbs: 165 });
    const goal = seriesNamed(options, 'Goal');
    expect(goal.dashStyle).toBe('Dash');
    expect(goal.color).toBe(tokens.textLow);
    expect(goal.data).toHaveLength(2); // a flat rule, not a point per day
    expect(goal.dataLabels.enabled).toBe(true);
  });

  it('omits the goal series entirely when no goal is set', () => {
    const options = buildWeightChartOptions({ entries: sample, tokens });
    expect(seriesNamed(options, 'Goal')).toBeUndefined();
  });

  it('drops the leftmost date label, which clips against the plot edge', () => {
    const options = buildWeightChartOptions({ entries: sample, tokens });
    const { formatter } = options.xAxis.labels;
    expect(formatter.call({ isFirst: true, value: at('2026-08-30') })).toBeNull();
    expect(formatter.call({ isFirst: false, value: at('2026-09-01') })).toBe('Sep 1');
  });

  it('ships a crosshair and a shared tooltip', () => {
    const options = buildWeightChartOptions({ entries: sample, tokens });
    expect(options.tooltip.shared).toBe(true);
    expect(options.xAxis.crosshair).toBeTruthy();
  });

  it('is null rather than a broken chart before tokens or data arrive', () => {
    expect(buildWeightChartOptions({ entries: sample, tokens: null })).toBeNull();
    expect(buildWeightChartOptions({ entries: [], tokens })).toBeNull();
  });
});
