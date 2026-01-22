// tests/unit/domains/finance/entities/Budget.test.mjs
import { Budget } from '#backend/src/1_domains/finance/entities/Budget.mjs';

describe('Budget', () => {
  let budget;

  beforeEach(() => {
    budget = new Budget({
      id: 'groceries',
      name: 'Groceries',
      amount: 500,
      spent: 350,
      period: 'monthly',
      category: 'food'
    });
  });

  describe('constructor', () => {
    test('creates budget with properties', () => {
      expect(budget.id).toBe('groceries');
      expect(budget.name).toBe('Groceries');
      expect(budget.amount).toBe(500);
      expect(budget.spent).toBe(350);
    });

    test('defaults spent to 0', () => {
      const b = new Budget({ id: 'test', name: 'Test', amount: 100 });
      expect(b.spent).toBe(0);
    });
  });

  describe('getRemaining', () => {
    test('calculates remaining amount', () => {
      expect(budget.getRemaining()).toBe(150);
    });
  });

  describe('getPercentSpent', () => {
    test('calculates percentage', () => {
      expect(budget.getPercentSpent()).toBe(70);
    });

    test('returns 0 for zero amount budget', () => {
      budget.amount = 0;
      expect(budget.getPercentSpent()).toBe(0);
    });
  });

  describe('isOverBudget', () => {
    test('returns false when under budget', () => {
      expect(budget.isOverBudget()).toBe(false);
    });

    test('returns true when over budget', () => {
      budget.spent = 600;
      expect(budget.isOverBudget()).toBe(true);
    });
  });

  describe('addSpending', () => {
    test('adds to spent amount', () => {
      budget.addSpending(50);
      expect(budget.spent).toBe(400);
    });
  });

  describe('reset', () => {
    test('resets spent to 0', () => {
      budget.reset();
      expect(budget.spent).toBe(0);
    });
  });

  describe('isAtWarningLevel', () => {
    test('returns true at 80%+', () => {
      budget.spent = 450; // 90%
      expect(budget.isAtWarningLevel()).toBe(true);
    });

    test('returns false under 80%', () => {
      budget.spent = 300; // 60%
      expect(budget.isAtWarningLevel()).toBe(false);
    });

    test('returns false when over budget', () => {
      budget.spent = 600;
      expect(budget.isAtWarningLevel()).toBe(false);
    });
  });

  describe('toJSON/fromJSON', () => {
    test('round-trips budget data', () => {
      const json = budget.toJSON();
      const restored = Budget.fromJSON(json);
      expect(restored.id).toBe(budget.id);
      expect(restored.amount).toBe(budget.amount);
    });
  });
});
