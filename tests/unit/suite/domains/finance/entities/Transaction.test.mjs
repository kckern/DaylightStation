// tests/unit/domains/finance/entities/Transaction.test.mjs
import { Transaction } from '@backend/src/1_domains/finance/entities/Transaction.mjs';

describe('Transaction', () => {
  let transaction;

  beforeEach(() => {
    transaction = new Transaction({
      id: 'tx-001',
      date: '2026-01-11T10:00:00Z',
      amount: 50.00,
      description: 'Coffee Shop',
      category: 'dining',
      type: 'expense'
    });
  });

  describe('constructor', () => {
    test('creates transaction with properties', () => {
      expect(transaction.id).toBe('tx-001');
      expect(transaction.amount).toBe(50);
      expect(transaction.type).toBe('expense');
    });
  });

  describe('isExpense/isIncome/isTransfer', () => {
    test('identifies expense', () => {
      expect(transaction.isExpense()).toBe(true);
      expect(transaction.isIncome()).toBe(false);
      expect(transaction.isTransfer()).toBe(false);
    });

    test('identifies income', () => {
      transaction.type = 'income';
      expect(transaction.isIncome()).toBe(true);
    });

    test('identifies transfer', () => {
      transaction.type = 'transfer';
      expect(transaction.isTransfer()).toBe(true);
    });
  });

  describe('getSignedAmount', () => {
    test('returns negative for expenses', () => {
      expect(transaction.getSignedAmount()).toBe(-50);
    });

    test('returns positive for income', () => {
      transaction.type = 'income';
      expect(transaction.getSignedAmount()).toBe(50);
    });
  });

  describe('getDateString', () => {
    test('returns date portion', () => {
      expect(transaction.getDateString()).toBe('2026-01-11');
    });
  });

  describe('addTag/removeTag', () => {
    test('adds tag', () => {
      transaction.addTag('business');
      expect(transaction.tags).toContain('business');
    });

    test('does not add duplicate tag', () => {
      transaction.addTag('business');
      transaction.addTag('business');
      expect(transaction.tags.filter(t => t === 'business')).toHaveLength(1);
    });

    test('removes tag', () => {
      transaction.tags = ['a', 'b'];
      transaction.removeTag('a');
      expect(transaction.tags).toEqual(['b']);
    });
  });

  describe('toJSON/fromJSON', () => {
    test('round-trips transaction data', () => {
      transaction.tags = ['test'];
      const json = transaction.toJSON();
      const restored = Transaction.fromJSON(json);
      expect(restored.id).toBe(transaction.id);
      expect(restored.tags).toEqual(['test']);
    });
  });
});
