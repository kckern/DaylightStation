import { gatherShortTermTransactions } from './blocks/shortterm.jsx';
import { collectSpendingTransactions } from './blocks.jsx';
import { loadCellTransactions } from './blocks/monthly.jsx';

const budget = {
  budgetStart: '2026-04-01',
  shortTermBuckets: {
    Vacation: { transactions: [ { amount: 500, expenseAmount: 500 }, { amount: -100, expenseAmount: -100 } ] }
  },
  dayToDayBudget: {
    '2026-04': { budget: 1000, transactions: [{ amount: 20, expenseAmount: 20, tagNames: ['Groceries'] }] }
  },
  monthlyBudget: {
    '2026-04': {
      incomeTransactions: [{ amount: 5000, description: 'Paycheck' }],
      monthlyCategories: { Utilities: { amount: 300, credits: 0, debits: 280, transactions: [{ amount: 280, expenseAmount: 280, tagNames: ['Electric'] }] } }
    }
  }
};

describe('drawer descriptor resolvers', () => {
  test('gatherShortTermTransactions splits spent vs gained', () => {
    expect(gatherShortTermTransactions(budget, 'budget')).toHaveLength(2);
    expect(gatherShortTermTransactions(budget, 'spent')).toHaveLength(1);
    expect(gatherShortTermTransactions(budget, 'gained')).toHaveLength(1);
  });

  test('collectSpendingTransactions gathers expenses across all sections', () => {
    const txns = collectSpendingTransactions(budget);
    // groceries (day-to-day) + electric (monthly) + Vacation's positive-expenseAmount
    // entry (short-term) — collectSpendingTransactions folds in shortTermBuckets too,
    // matching the pre-existing BudgetSpending logic it was extracted from.
    // Income/credits (negative expenseAmount) are excluded.
    expect(txns).toHaveLength(3);
    expect(txns.every(t => t.expenseAmount > 0)).toBe(true);
  });

  test('loadCellTransactions resolves per-month income and fixed cells', () => {
    expect(loadCellTransactions(budget, '2026-04', 'income')).toHaveLength(1);
    expect(loadCellTransactions(budget, '2026-04', 'fixed')).toHaveLength(1);
  });
});
