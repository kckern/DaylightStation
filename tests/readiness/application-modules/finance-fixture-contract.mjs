import assert from 'node:assert/strict';

// Compare the final shared fixture against the independently backed detail cases.
export function assertBudgetDetailContracts(finances, cases) {
  for (const row of cases.filter(row => row.id.startsWith('finance-private-budget-detail-'))) {
    const period = row.path.split('/').at(-1);
    assert.deepEqual(finances.budgets[period], row.expected.body.equals.budget,
      'Full reviewed budget detail was overwritten by another pack: ' + row.id);
  }
}
