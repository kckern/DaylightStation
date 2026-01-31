import { describe, it, expect } from 'vitest';
import { SpreadSource } from '#domains/cost/value-objects/SpreadSource.mjs';
import { Money } from '#domains/cost/value-objects/Money.mjs';

describe('SpreadSource', () => {
  describe('construction', () => {
    it('should create with all required fields', () => {
      const source = new SpreadSource({
        name: 'Annual License',
        originalAmount: 120,
        spreadMonths: 12,
        startDate: new Date('2026-01-01')
      });

      expect(source.name).toBe('Annual License');
      expect(source.originalAmount).toBeInstanceOf(Money);
      expect(source.originalAmount.amount).toBe(120);
      expect(source.spreadMonths).toBe(12);
      expect(source.startDate).toBeInstanceOf(Date);
    });

    it('should accept Money object for originalAmount', () => {
      const amount = new Money(200, 'EUR');
      const source = new SpreadSource({
        name: 'Software',
        originalAmount: amount,
        spreadMonths: 6,
        startDate: new Date('2026-01-01')
      });

      expect(source.originalAmount.amount).toBe(200);
      expect(source.originalAmount.currency).toBe('EUR');
    });

    it('should calculate endsAt from startDate + spreadMonths', () => {
      const source = new SpreadSource({
        name: 'Subscription',
        originalAmount: 120,
        spreadMonths: 12,
        startDate: new Date('2026-01-15')
      });

      // 12 months from Jan 2026 = Jan 2027
      expect(source.endsAt.getUTCFullYear()).toBe(2027);
      expect(source.endsAt.getUTCMonth()).toBe(0); // January
    });

    it('should handle spreadMonths crossing year boundary', () => {
      const source = new SpreadSource({
        name: 'Contract',
        originalAmount: 600,
        spreadMonths: 6,
        startDate: new Date('2026-10-01')
      });

      // 6 months from Oct 2026 = Apr 2027
      expect(source.endsAt.getUTCFullYear()).toBe(2027);
      expect(source.endsAt.getUTCMonth()).toBe(3); // April
    });
  });

  describe('validation', () => {
    it('should throw ValidationError when name is missing', () => {
      expect(() => new SpreadSource({
        originalAmount: 100,
        spreadMonths: 12,
        startDate: new Date()
      })).toThrow('name is required');
    });

    it('should throw ValidationError when name is empty string', () => {
      expect(() => new SpreadSource({
        name: '',
        originalAmount: 100,
        spreadMonths: 12,
        startDate: new Date()
      })).toThrow('name is required');
    });

    it('should throw ValidationError when spreadMonths is 0', () => {
      expect(() => new SpreadSource({
        name: 'Test',
        originalAmount: 100,
        spreadMonths: 0,
        startDate: new Date()
      })).toThrow('spreadMonths must be >= 1');
    });

    it('should throw ValidationError when spreadMonths is negative', () => {
      expect(() => new SpreadSource({
        name: 'Test',
        originalAmount: 100,
        spreadMonths: -5,
        startDate: new Date()
      })).toThrow('spreadMonths must be >= 1');
    });

    it('should throw ValidationError when spreadMonths is missing', () => {
      expect(() => new SpreadSource({
        name: 'Test',
        originalAmount: 100,
        startDate: new Date()
      })).toThrow('spreadMonths must be >= 1');
    });

    it('should accept spreadMonths of 1', () => {
      const source = new SpreadSource({
        name: 'Single Month',
        originalAmount: 50,
        spreadMonths: 1,
        startDate: new Date('2026-01-01')
      });
      expect(source.spreadMonths).toBe(1);
    });
  });

  describe('immutability', () => {
    it('should be frozen', () => {
      const source = new SpreadSource({
        name: 'Test',
        originalAmount: 100,
        spreadMonths: 12,
        startDate: new Date()
      });
      expect(Object.isFrozen(source)).toBe(true);
    });
  });

  describe('getMonthlyAmount', () => {
    it('should calculate monthly amount correctly', () => {
      const source = new SpreadSource({
        name: 'Annual License',
        originalAmount: 120,
        spreadMonths: 12,
        startDate: new Date('2026-01-01')
      });

      const monthly = source.getMonthlyAmount();
      expect(monthly).toBeInstanceOf(Money);
      expect(monthly.amount).toBe(10);
    });

    it('should handle non-even division', () => {
      const source = new SpreadSource({
        name: 'Subscription',
        originalAmount: 100,
        spreadMonths: 3,
        startDate: new Date('2026-01-01')
      });

      const monthly = source.getMonthlyAmount();
      // 100 / 3 = 33.333... rounded to 33.33
      expect(monthly.amount).toBeCloseTo(33.33, 2);
    });

    it('should preserve currency from originalAmount', () => {
      const source = new SpreadSource({
        name: 'Euro Service',
        originalAmount: new Money(240, 'EUR'),
        spreadMonths: 12,
        startDate: new Date('2026-01-01')
      });

      const monthly = source.getMonthlyAmount();
      expect(monthly.currency).toBe('EUR');
      expect(monthly.amount).toBe(20);
    });

    it('should handle single month spread', () => {
      const source = new SpreadSource({
        name: 'One-time',
        originalAmount: 50,
        spreadMonths: 1,
        startDate: new Date('2026-01-01')
      });

      const monthly = source.getMonthlyAmount();
      expect(monthly.amount).toBe(50);
    });
  });

  describe('getMonthsRemaining', () => {
    const source = new SpreadSource({
      name: 'Annual License',
      originalAmount: 120,
      spreadMonths: 12,
      startDate: new Date('2026-01-01')
    });

    it('should return full spread if reference date is before start', () => {
      const remaining = source.getMonthsRemaining(new Date('2025-06-01'));
      expect(remaining).toBe(12);
    });

    it('should return correct months remaining during spread period', () => {
      // 4 months into the spread (May 2026)
      const remaining = source.getMonthsRemaining(new Date('2026-05-01'));
      expect(remaining).toBe(8);
    });

    it('should return 0 if reference date is at or after end', () => {
      const remaining = source.getMonthsRemaining(new Date('2027-01-01'));
      expect(remaining).toBe(0);
    });

    it('should return 0 if reference date is after end', () => {
      const remaining = source.getMonthsRemaining(new Date('2028-06-01'));
      expect(remaining).toBe(0);
    });

    it('should return full spread at start date', () => {
      const remaining = source.getMonthsRemaining(new Date('2026-01-01'));
      expect(remaining).toBe(12);
    });

    it('should return 1 month remaining in last month', () => {
      // December 2026 (month 11, 0-indexed)
      const remaining = source.getMonthsRemaining(new Date('2026-12-01'));
      expect(remaining).toBe(1);
    });

    it('should use current date as default', () => {
      const futureSource = new SpreadSource({
        name: 'Future',
        originalAmount: 100,
        spreadMonths: 24,
        startDate: new Date('2020-01-01') // Well in the past
      });

      // Should be 0 since spread ended years ago
      expect(futureSource.getMonthsRemaining()).toBe(0);
    });
  });

  describe('serialization', () => {
    describe('toJSON', () => {
      it('should serialize all fields', () => {
        const source = new SpreadSource({
          name: 'Annual License',
          originalAmount: 120,
          spreadMonths: 12,
          startDate: new Date('2026-01-15T00:00:00.000Z')
        });

        const json = source.toJSON();
        expect(json.name).toBe('Annual License');
        expect(json.originalAmount).toEqual({ amount: 120, currency: 'USD' });
        expect(json.spreadMonths).toBe(12);
        expect(json.startDate).toBe('2026-01-15T00:00:00.000Z');
      });

      it('should serialize Money with custom currency', () => {
        const source = new SpreadSource({
          name: 'Euro Service',
          originalAmount: new Money(200, 'EUR'),
          spreadMonths: 6,
          startDate: new Date('2026-01-01T00:00:00.000Z')
        });

        const json = source.toJSON();
        expect(json.originalAmount).toEqual({ amount: 200, currency: 'EUR' });
      });
    });

    describe('fromJSON', () => {
      it('should create from valid JSON with Money object', () => {
        const source = SpreadSource.fromJSON({
          name: 'Restored License',
          originalAmount: { amount: 150, currency: 'USD' },
          spreadMonths: 6,
          startDate: '2026-03-01T00:00:00.000Z'
        });

        expect(source.name).toBe('Restored License');
        expect(source.originalAmount.amount).toBe(150);
        expect(source.spreadMonths).toBe(6);
        expect(source.startDate.toISOString()).toBe('2026-03-01T00:00:00.000Z');
      });

      it('should create from JSON with number originalAmount', () => {
        const source = SpreadSource.fromJSON({
          name: 'Simple',
          originalAmount: 100,
          spreadMonths: 3,
          startDate: '2026-06-01T00:00:00.000Z'
        });

        expect(source.originalAmount.amount).toBe(100);
        expect(source.originalAmount.currency).toBe('USD');
      });

      it('should throw ValidationError for null input', () => {
        expect(() => SpreadSource.fromJSON(null))
          .toThrow('Invalid SpreadSource JSON: name is required');
      });

      it('should throw ValidationError for missing name', () => {
        expect(() => SpreadSource.fromJSON({
          originalAmount: 100,
          spreadMonths: 12,
          startDate: '2026-01-01'
        })).toThrow('Invalid SpreadSource JSON: name is required');
      });

      it('should throw ValidationError for missing originalAmount', () => {
        expect(() => SpreadSource.fromJSON({
          name: 'Test',
          spreadMonths: 12,
          startDate: '2026-01-01'
        })).toThrow('Invalid SpreadSource JSON: originalAmount is required');
      });

      it('should throw ValidationError for non-object input', () => {
        expect(() => SpreadSource.fromJSON('invalid'))
          .toThrow('Invalid SpreadSource JSON: name is required');
      });
    });

    it('should round-trip toJSON and fromJSON', () => {
      const original = new SpreadSource({
        name: 'Round Trip Test',
        originalAmount: new Money(360, 'EUR'),
        spreadMonths: 18,
        startDate: new Date('2026-07-01T00:00:00.000Z')
      });

      const json = original.toJSON();
      const restored = SpreadSource.fromJSON(json);

      expect(restored.name).toBe(original.name);
      expect(restored.originalAmount.amount).toBe(original.originalAmount.amount);
      expect(restored.originalAmount.currency).toBe(original.originalAmount.currency);
      expect(restored.spreadMonths).toBe(original.spreadMonths);
      expect(restored.startDate.toISOString()).toBe(original.startDate.toISOString());
    });
  });
});
