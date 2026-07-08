import { render, screen } from '@testing-library/react';
import { BudgetHoldings, BudgetSpending } from './blocks.jsx';

// Regression guard: blocks.jsx once re-exported formatAsCurrency without a
// local binding (`export { x } from ...`) while also CALLING it — a
// ReferenceError that only surfaced when the component actually rendered.
// Bundler and unit gates missed it; this render test would not have.

const budget = {
  transferTransactions: {
    transactions: [{ id: 't1', date: '2026-04-05', description: 'Fidelity Sweep', amount: 1234 }]
  },
  dayToDayBudget: {},
  monthlyBudget: {},
  shortTermBuckets: {}
};

describe('blocks render smoke', () => {
  test('BudgetHoldings renders a formatted transfer amount', () => {
    render(<BudgetHoldings setDrawerContent={() => {}} budget={budget} />);
    expect(screen.getByText('$1,234')).toBeInTheDocument();
    expect(screen.getByText('Fidelity Sweep')).toBeInTheDocument();
  });

  test('BudgetSpending renders its empty state when there is nothing to chart', () => {
    render(<BudgetSpending setDrawerContent={() => {}} budget={budget} />);
    expect(screen.getByText(/No transactions/)).toBeInTheDocument();
  });
});
