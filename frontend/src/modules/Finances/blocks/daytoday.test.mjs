import { buildDayToDayBudgetOptions } from './daytoday.jsx';
import { PALETTE } from '../lib/format.mjs';

// dailyBalances for 2026-03 with a fixed daily burn, viewed as-of day `throughDay`.
function monthData({ startingBalance, dailyBurn, throughDay }) {
  const dailyBalances = { '2026-03-start': { startingBalance } };
  for (let d = 1; d <= throughDay; d++) {
    const key = `2026-03-${String(d).padStart(2, '0')}`;
    dailyBalances[key] = { endingBalance: startingBalance - dailyBurn * d, overspent: false };
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
});
