import { matchesTransactionFilter } from './transactionFilter.mjs';

describe('matchesTransactionFilter', () => {
  const txn = { description: 'Costco run', tagNames: ['Groceries'], label: 'Day-to-Day', bucket: 'day' };

  test('empty filter matches everything', () => {
    expect(matchesTransactionFilter(txn, {})).toBe(true);
    expect(matchesTransactionFilter(txn, undefined)).toBe(true);
  });
  test('matches by tag / description / label / bucket', () => {
    expect(matchesTransactionFilter(txn, { tags: ['Groceries'] })).toBe(true);
    expect(matchesTransactionFilter(txn, { tags: ['Fuel'] })).toBe(false);
    expect(matchesTransactionFilter(txn, { description: 'Costco' })).toBe(true);
    expect(matchesTransactionFilter(txn, { label: 'Day-to-Day' })).toBe(true);
    expect(matchesTransactionFilter(txn, { bucket: 'monthly' })).toBe(false);
  });
  test('does not crash on transactions missing tagNames or description', () => {
    expect(matchesTransactionFilter({}, { tags: ['Groceries'] })).toBe(false);
    expect(matchesTransactionFilter({}, { description: 'x' })).toBe(false);
    expect(matchesTransactionFilter({}, {})).toBe(true);
  });
});
