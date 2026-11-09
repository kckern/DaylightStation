import { describe, test, expect } from 'vitest';
import { planDayToDayRebalance, closestSubset, previousMonth } from './DayToDayRebalancer.mjs';

const rule = { payees: ['Amazon'], dayTag: 'Shopping', swingTag: 'Housewares' };

// A 30-day month (2026-11) with a $3000 budget: the burn-down drops $100/day.
function month({ spendByDay = {}, transactions = [] } = {}) {
  const dailyBalances = { '2026-11-start': { startingBalance: 3000, endingBalance: 3000 } };
  let bal = 3000;
  for (let d = 1; d <= 30; d++) {
    bal -= spendByDay[d] || 0;
    dailyBalances[`2026-11-${String(d).padStart(2, '0')}`] = { endingBalance: bal, overspent: bal < 0 };
  }
  return { budget: 3000, dailyBalances, transactions };
}

const txn = (id, date, amount, description, tags) => ({ id, date, amount, expenseAmount: amount, description, tagNames: tags });

describe('closestSubset', () => {
  test('finds the exact combination when one exists', () => {
    const picked = closestSubset([500, 1200, 700, 300], 1000);
    expect(picked.map(i => [500, 1200, 700, 300][i]).reduce((a, b) => a + b, 0)).toBe(1000);
  });

  test('prefers fewer items on a tie', () => {
    expect(closestSubset([400, 600, 1000], 1000)).toEqual([2]);
  });

  test('takes nothing when every item overshoots by more than the need', () => {
    expect(closestSubset([5000], 1000)).toEqual([]);
  });
});

describe('planDayToDayRebalance', () => {
  test('returns null without a rule', () => {
    expect(planDayToDayRebalance({ month: '2026-11', monthData: month(), rule: null, today: '2026-11-10' })).toBeNull();
  });

  test('returns null for a month that has not started', () => {
    expect(planDayToDayRebalance({ month: '2026-12', monthData: month(), rule, today: '2026-11-10' })).toBeNull();
  });

  test('on pace within one day of budget by default', () => {
    // Day 10: target 2000. Spent 1050 → balance 1950, $50 under the line.
    const plan = planDayToDayRebalance({ month: '2026-11', monthData: month({ spendByDay: { 3: 1050 } }), rule, today: '2026-11-10' });
    expect(plan.status).toBe('on-pace');
    expect(plan.target).toBe(2000);
    expect(plan.gap).toBe(-50);
    expect(plan.moves).toEqual([]);
  });

  test('over pace: moves day-to-day Amazon Shopping buys out to Housewares', () => {
    // Day 10: target 2000, spent 1300 → balance 1700, $300 over pace.
    const transactions = [
      txn(1, '2026-11-02', 120, 'Amazon', ['Shopping']),
      txn(2, '2026-11-04', 180, 'AMAZON MKTPL*AB12', ['Shopping']),
      txn(3, '2026-11-05', 250, 'Amazon', ['Groceries']),      // not the day tag
      txn(4, '2026-11-06', 300, 'Target', ['Shopping']),       // not a swing payee
      txn(5, '2026-11-12', 90, 'Amazon', ['Shopping']),        // after today
      { date: '2026-11-30', amount: 1700, description: 'Anticipated Day-to-Day Spending', tagNames: ['Shopping'] },
    ];
    const plan = planDayToDayRebalance({
      month: '2026-11',
      monthData: month({ spendByDay: { 2: 1300 }, transactions }),
      rule,
      today: '2026-11-10',
    });
    expect(plan.status).toBe('overspent');
    expect(plan.gap).toBe(-300);
    expect(plan.moves.map(m => m.id)).toEqual([1, 2]);
    expect(plan.moves[0]).toMatchObject({ from: 'Shopping', to: 'Housewares', tags: ['Housewares'] });
    expect(plan.movedTotal).toBe(300);
    expect(plan.balanceAfter).toBe(2000);
  });

  test('under pace: moves Housewares Amazon buys from short-term back to Shopping', () => {
    // Day 10: target 2000, spent 600 → balance 2400, $400 under pace.
    const shortTermBuckets = {
      'Home & Auto': {
        transactions: [
          txn(10, '2026-11-03', 150, 'Amazon', ['Housewares']),
          txn(11, '2026-11-08', 260, 'Amazon', ['Housewares', 'Kids']),
          txn(12, '2026-10-28', 400, 'Amazon', ['Housewares']), // last month
          txn(13, '2026-11-04', 400, 'Home Depot', ['Housewares']),
        ],
      },
    };
    const plan = planDayToDayRebalance({
      month: '2026-11',
      monthData: month({ spendByDay: { 1: 600 } }),
      shortTermBuckets,
      rule,
      today: '2026-11-10',
    });
    expect(plan.status).toBe('underspent');
    expect(plan.moves.map(m => m.id)).toEqual([10, 11]);
    expect(plan.moves[1].tags).toEqual(['Shopping', 'Kids']);
    expect(plan.balanceAfter).toBe(1990);
  });

  test('a past month is planned to land on zero at month end', () => {
    // Closed month overspent by $200.
    const transactions = [txn(1, '2026-10-20', 75, 'Amazon', ['Shopping']), txn(2, '2026-10-21', 125, 'Amazon', ['Shopping'])];
    const dailyBalances = { '2026-10-start': { startingBalance: 3100 } };
    for (let d = 1; d <= 31; d++) dailyBalances[`2026-10-${String(d).padStart(2, '0')}`] = { endingBalance: d >= 20 ? -200 : 3100 };
    const plan = planDayToDayRebalance({ month: '2026-10', monthData: { dailyBalances, transactions }, rule, today: '2026-11-10' });
    expect(plan.asOf).toBe('2026-10-31');
    expect(plan.target).toBe(0);
    expect(plan.moves.map(m => m.id)).toEqual([1, 2]);
    expect(plan.balanceAfter).toBe(0);
  });

  test('never touches non-fungible tags, even when they are the only way back on pace', () => {
    const transactions = [
      txn(1, '2026-11-02', 200, 'Amazon Fresh', ['Groceries']),
      txn(2, '2026-11-03', 100, 'Shell', ['Fuel']),
    ];
    const plan = planDayToDayRebalance({
      month: '2026-11',
      monthData: month({ spendByDay: { 2: 1300 }, transactions }),
      rule: { dayTag: 'Shopping', swingTag: 'Housewares' },
      today: '2026-11-10',
    });
    expect(plan.status).toBe('overspent');
    expect(plan.moves).toEqual([]);
  });

  test('without payees, every purchase carrying the fungible tag is a candidate', () => {
    const transactions = [txn(1, '2026-11-02', 300, 'eBay', ['Shopping'])];
    const plan = planDayToDayRebalance({
      month: '2026-11',
      monthData: month({ spendByDay: { 2: 1300 }, transactions }),
      rule: { dayTag: 'Shopping', swingTag: 'Housewares' },
      today: '2026-11-10',
    });
    expect(plan.moves.map(m => m.id)).toEqual([1]);
  });

  test('previousMonth crosses the year boundary', () => {
    expect(previousMonth('2026-01')).toBe('2025-12');
    expect(previousMonth('2026-11')).toBe('2026-10');
  });

  test('reports no moves when no swing purchases are available', () => {
    const plan = planDayToDayRebalance({ month: '2026-11', monthData: month({ spendByDay: { 2: 1300 } }), rule, today: '2026-11-10' });
    expect(plan.status).toBe('overspent');
    expect(plan.candidateCount).toBe(0);
    expect(plan.moves).toEqual([]);
  });
});
