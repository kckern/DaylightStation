// tests/unit/api/shims/finance.test.mjs
import { financeShims } from '#backend/src/4_api/shims/finance.mjs';

describe('Finance Shims', () => {
  describe('finance-data-v1', () => {
    const shim = financeShims['finance-data-v1'];

    it('exists with required properties', () => {
      expect(shim).toBeDefined();
      expect(shim.name).toBe('finance-data-v1');
      expect(shim.description).toBeDefined();
      expect(typeof shim.transform).toBe('function');
    });

    it('transforms new format to legacy format', () => {
      const newFormat = {
        budgets: [
          { periodStart: '2025-01-01', periodEnd: '2025-12-31', allocated: 5000 }
        ],
        mortgage: { balance: 250000, rate: 0.065 }
      };

      const legacy = shim.transform(newFormat);

      expect(legacy.budgets['2025-01-01']).toBeDefined();
      expect(legacy.budgets['2025-01-01'].allocated).toBe(5000);
      expect(legacy.budgets['2025-01-01'].budgetStart).toBe('2025-01-01');
      expect(legacy.budgets['2025-01-01'].budgetEnd).toBe('2025-12-31');
      expect(legacy.mortgage.balance).toBe(250000);
    });

    it('handles multiple budgets', () => {
      const newFormat = {
        budgets: [
          { periodStart: '2025-01-01', periodEnd: '2025-01-31', allocated: 1000 },
          { periodStart: '2025-02-01', periodEnd: '2025-02-28', allocated: 1200 },
          { periodStart: '2025-03-01', periodEnd: '2025-03-31', allocated: 1100 }
        ],
        mortgage: null
      };

      const legacy = shim.transform(newFormat);

      expect(Object.keys(legacy.budgets)).toHaveLength(3);
      expect(legacy.budgets['2025-01-01'].allocated).toBe(1000);
      expect(legacy.budgets['2025-02-01'].allocated).toBe(1200);
      expect(legacy.budgets['2025-03-01'].allocated).toBe(1100);
    });

    it('handles empty budgets array', () => {
      const newFormat = { budgets: [], mortgage: null };
      const legacy = shim.transform(newFormat);
      expect(legacy.budgets).toEqual({});
    });

    it('handles missing budgets property', () => {
      const newFormat = { mortgage: { balance: 100000 } };
      const legacy = shim.transform(newFormat);
      expect(legacy.budgets).toEqual({});
      expect(legacy.mortgage.balance).toBe(100000);
    });

    it('preserves additional budget properties', () => {
      const newFormat = {
        budgets: [
          {
            periodStart: '2025-01-01',
            periodEnd: '2025-12-31',
            allocated: 5000,
            spent: 3500,
            category: 'groceries'
          }
        ],
        mortgage: null
      };

      const legacy = shim.transform(newFormat);

      expect(legacy.budgets['2025-01-01'].spent).toBe(3500);
      expect(legacy.budgets['2025-01-01'].category).toBe('groceries');
    });
  });

  describe('finance-daytoday-v1', () => {
    const shim = financeShims['finance-daytoday-v1'];

    it('exists with required properties', () => {
      expect(shim).toBeDefined();
      expect(shim.name).toBe('finance-daytoday-v1');
      expect(shim.description).toBeDefined();
      expect(typeof shim.transform).toBe('function');
    });

    it('flattens current month data to legacy format', () => {
      const newFormat = {
        current: {
          month: '2025-01',
          spending: 1234.56,
          allocated: 1500.00,
          balance: 265.44
        }
      };

      const legacy = shim.transform(newFormat);

      expect(legacy.spending).toBe(1234.56);
      expect(legacy.budget).toBe(1500.00);
      expect(legacy.remaining).toBe(265.44);
    });

    it('handles missing current property', () => {
      const newFormat = {};

      const legacy = shim.transform(newFormat);

      expect(legacy.spending).toBeUndefined();
      expect(legacy.budget).toBeUndefined();
      expect(legacy.remaining).toBeUndefined();
    });

    it('handles null current property', () => {
      const newFormat = { current: null };

      const legacy = shim.transform(newFormat);

      expect(legacy.spending).toBeUndefined();
      expect(legacy.budget).toBeUndefined();
      expect(legacy.remaining).toBeUndefined();
    });

    it('handles zero values correctly', () => {
      const newFormat = {
        current: {
          month: '2025-01',
          spending: 0,
          allocated: 0,
          balance: 0
        }
      };

      const legacy = shim.transform(newFormat);

      expect(legacy.spending).toBe(0);
      expect(legacy.budget).toBe(0);
      expect(legacy.remaining).toBe(0);
    });

    it('handles negative balance (overspent)', () => {
      const newFormat = {
        current: {
          month: '2025-01',
          spending: 1800.00,
          allocated: 1500.00,
          balance: -300.00
        }
      };

      const legacy = shim.transform(newFormat);

      expect(legacy.spending).toBe(1800.00);
      expect(legacy.budget).toBe(1500.00);
      expect(legacy.remaining).toBe(-300.00);
    });
  });
});
