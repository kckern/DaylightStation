import { buildDayToDayBudgetOptions } from "./dayToDayChartOptions.js";
import { PALETTE } from "../lib/format.mjs";

// dailyBalances for 2026-03 with a fixed daily burn, viewed as-of day `throughDay`.
function monthData({ startingBalance, dailyBurn, throughDay }) {
  const dailyBalances = { '2026-03-start': { startingBalance } };
  for (let d = 1; d <= throughDay; d++) {
    const key = `2026-03-${String(d).padStart(2, '0')}`;
    dailyBalances[key] = { endingBalance: startingBalance - dailyBurn * d, overspent: startingBalance - dailyBurn * d < 0 };
  }
  return { month: '2026-03', dailyBalances, transactions: [] };
}

describe('buildDayToDayBudgetOptions', () => {
  test('projection line is red when the burn rate overshoots the budget', () => {
    // $300 budget, $60/day for 5 days → $0 left, 26 days to go → deep negative.
    const options = buildDayToDayBudgetOptions(
      monthData({ startingBalance: 300, dailyBurn: 60, throughDay: 5 }),
      null,
      { now: '2026-03-05' }
    );
    const projection = options.series.find(s => s.name === 'Projected Data');
    expect(projection.color).toBe(PALETTE.projectionOver);
  });

  test('projection line is green when the pace fits the budget', () => {
    // $300 budget, $5/day → month ends around $145. Comfortably positive.
    const options = buildDayToDayBudgetOptions(
      monthData({ startingBalance: 300, dailyBurn: 5, throughDay: 5 }),
      null,
      { now: '2026-03-05' }
    );
    const projection = options.series.find(s => s.name === 'Projected Data');
    expect(projection.color).toBe(PALETTE.projectionOk);
  });

  test('yAxis.max grows to fit balances above the initial budget (mid-month credits)', () => {
    const data = monthData({ startingBalance: 300, dailyBurn: 5, throughDay: 5 });
    data.dailyBalances['2026-03-03'].endingBalance = 350; // credit pushed above budget
    const options = buildDayToDayBudgetOptions(data, null, { now: '2026-03-05' });
    expect(options.yAxis.max).toBeGreaterThanOrEqual(350);
  });

  test('overspent days plot true negative balances and the axis includes them', () => {
    // $300 budget at $60/day goes negative on day 6 (300 - 360 = -60).
    const options = buildDayToDayBudgetOptions(
      monthData({ startingBalance: 300, dailyBurn: 60, throughDay: 6 }),
      null,
      { now: '2026-03-06' }
    );
    const actual = options.series.find(s => s.name === 'Actual Data');
    expect(actual.data[6].y).toBe(-60); // day 6 sits at x=6
    expect(options.yAxis.min).toBeLessThanOrEqual(-60);
  });
  test('day N bar sits on the day-N category, aligned with the baseline', () => {
    // $310 budget, $10/day: day 1 closes at 300, which is the baseline's own day-1 value.
    const options = buildDayToDayBudgetOptions(
      monthData({ startingBalance: 310, dailyBurn: 10, throughDay: 5 }),
      null,
      { now: '2026-03-05' }
    );
    const baseline = options.series.find(s => s.name === 'Baseline');
    const actual = options.series.find(s => s.name === 'Actual Data');
    expect(options.xAxis.categories[1]).toBe('1');
    expect(actual.data[0].y).toBeNull();          // x=0 is the month's opening, no bar
    expect(actual.data[1].y).toBe(300);           // day 1
    expect(baseline.data[1]).toBe(300);           // baseline after one day
    expect(actual.data[5].y).toBe(baseline.data[5]);
  });

  test('projection burns at (budget - today) / days elapsed and ends on the last day', () => {
    // $300 budget, $10/day for 5 days: 250 left, pace 10/day, 26 days to go → ends at -10.
    // Measuring the pace from day 1's close (290) instead of the budget reads 8/day and ends green.
    const options = buildDayToDayBudgetOptions(
      monthData({ startingBalance: 300, dailyBurn: 10, throughDay: 5 }),
      null,
      { now: '2026-03-05' }
    );
    const projection = options.series.find(s => s.name === 'Projected Data');
    const points = projection.data.map((p, x) => [x, p.y]).filter(([, y]) => y !== null);
    expect(points[0]).toEqual([5, 250]);          // starts on today's bar
    expect(points[points.length - 1][0]).toBe(31); // ends on March 31
    expect(points[1][1]).toBe(240);
    expect(projection.color).toBe(PALETTE.projectionOver);
  });

  test('tooltip names the date of the bar under the cursor', () => {
    const options = buildDayToDayBudgetOptions(
      monthData({ startingBalance: 300, dailyBurn: 10, throughDay: 5 }),
      null,
      { now: '2026-03-05' }
    );
    const html = options.tooltip.formatter.call({
      key: '2', x: 2, y: 280, series: { name: 'Actual Data' }, point: { actualBalance: 280 },
    });
    expect(html).toContain('March 2, 2026');
  });

  test('overspent shading starts on the first overspent day', () => {
    const options = buildDayToDayBudgetOptions(
      monthData({ startingBalance: 300, dailyBurn: 60, throughDay: 6 }),
      null,
      { now: '2026-03-06' }
    );
    expect(options.xAxis.plotBands[0].from).toBe(6);
  });
});
