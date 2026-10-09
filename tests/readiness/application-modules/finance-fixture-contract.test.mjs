import test from 'node:test';
import assert from 'node:assert/strict';
import { assertBudgetDetailContracts } from './finance-fixture-contract.mjs';

test('monthly summary projection cannot discard a separately reviewed full budget detail', () => {
  const period = '2025-01-01';
  const budget = { accounts: ['synthetic-account'], dayToDayBudget: {
    '2025-01': { spent: 10, transactions: [{ id: 'synthetic-transaction', amount: 10 }] }
  } };
  const cases = [{ id: 'finance-private-budget-detail-1', path: '/api/v1/finance/budgets/' + period,
    expected: { body: { equals: { budget: structuredClone(budget) } } } }];
  const collided = { budgets: { [period]: { ...budget, dayToDayBudget: { '2025-01': { spent: 10 } } } } };
  assert.throws(() => assertBudgetDetailContracts(collided, cases), /Full reviewed budget detail was overwritten/);
  const preserved = { budgets: { [period]: structuredClone(budget) } };
  assertBudgetDetailContracts(preserved, cases);
  const { transactions, ...summary } = preserved.budgets[period].dayToDayBudget['2025-01'];
  assert.deepEqual(summary, { spent: 10 });
  assert.equal(transactions.length, 1);
  assertBudgetDetailContracts(preserved, cases);
});
