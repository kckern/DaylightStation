import { describe, it, expect } from 'vitest';
import { Money } from '#domains/cost/value-objects/Money.mjs';
import { ValidationError } from '#domains/core/errors/index.mjs';

describe('Money', () => {
  describe('constructor', () => {
    it('should create a Money with amount and default USD currency', () => {
      const money = new Money(100);
      expect(money.amount).toBe(100);
      expect(money.currency).toBe('USD');
    });

    it('should create a Money with specified currency', () => {
      const money = new Money(50.25, 'EUR');
      expect(money.amount).toBe(50.25);
      expect(money.currency).toBe('EUR');
    });

    it('should round amount to 2 decimal places', () => {
      const money = new Money(10.999);
      expect(money.amount).toBe(11);
    });

    it('should round 10.555 correctly (bankers rounding)', () => {
      const money = new Money(10.555);
      expect(money.amount).toBe(10.56);
    });

    it('should round 10.544 down', () => {
      const money = new Money(10.544);
      expect(money.amount).toBe(10.54);
    });

    it('should allow zero amount', () => {
      const money = new Money(0);
      expect(money.amount).toBe(0);
    });

    it('should throw ValidationError for negative amount', () => {
      expect(() => new Money(-5)).toThrow(ValidationError);
      expect(() => new Money(-5)).toThrow('Amount cannot be negative');
    });

    it('should include error code for negative amount', () => {
      try {
        new Money(-5);
      } catch (error) {
        expect(error.code).toBe('NEGATIVE_AMOUNT');
      }
    });
  });

  describe('immutability', () => {
    it('should be frozen (immutable)', () => {
      const money = new Money(100);
      expect(Object.isFrozen(money)).toBe(true);
    });

    it('should not allow modification of amount', () => {
      const money = new Money(100);
      expect(() => {
        money.amount = 200;
      }).toThrow();
    });
  });

  describe('getters', () => {
    it('should return amount via getter', () => {
      const money = new Money(42.50);
      expect(money.amount).toBe(42.50);
    });

    it('should return currency via getter', () => {
      const money = new Money(42.50, 'GBP');
      expect(money.currency).toBe('GBP');
    });
  });

  describe('add', () => {
    it('should add two Money objects with same currency', () => {
      const m1 = new Money(10.50);
      const m2 = new Money(5.25);
      const result = m1.add(m2);
      expect(result.amount).toBe(15.75);
      expect(result.currency).toBe('USD');
    });

    it('should return a new Money instance (immutability)', () => {
      const m1 = new Money(10);
      const m2 = new Money(5);
      const result = m1.add(m2);
      expect(result).not.toBe(m1);
      expect(result).not.toBe(m2);
      expect(m1.amount).toBe(10); // original unchanged
    });

    it('should throw ValidationError for currency mismatch', () => {
      const usd = new Money(10, 'USD');
      const eur = new Money(5, 'EUR');
      expect(() => usd.add(eur)).toThrow(ValidationError);
      expect(() => usd.add(eur)).toThrow('Currency mismatch');
    });

    it('should include error code for currency mismatch', () => {
      const usd = new Money(10, 'USD');
      const eur = new Money(5, 'EUR');
      try {
        usd.add(eur);
      } catch (error) {
        expect(error.code).toBe('CURRENCY_MISMATCH');
      }
    });
  });

  describe('subtract', () => {
    it('should subtract two Money objects with same currency', () => {
      const m1 = new Money(10.50);
      const m2 = new Money(3.25);
      const result = m1.subtract(m2);
      expect(result.amount).toBe(7.25);
      expect(result.currency).toBe('USD');
    });

    it('should return a new Money instance (immutability)', () => {
      const m1 = new Money(10);
      const m2 = new Money(3);
      const result = m1.subtract(m2);
      expect(result).not.toBe(m1);
      expect(result).not.toBe(m2);
      expect(m1.amount).toBe(10); // original unchanged
    });

    it('should throw ValidationError for currency mismatch', () => {
      const usd = new Money(10, 'USD');
      const eur = new Money(5, 'EUR');
      expect(() => usd.subtract(eur)).toThrow(ValidationError);
      expect(() => usd.subtract(eur)).toThrow('Currency mismatch');
    });

    it('should throw ValidationError if result would be negative', () => {
      const m1 = new Money(5);
      const m2 = new Money(10);
      expect(() => m1.subtract(m2)).toThrow(ValidationError);
      expect(() => m1.subtract(m2)).toThrow('Amount cannot be negative');
    });
  });

  describe('multiply', () => {
    it('should multiply by a positive factor', () => {
      const money = new Money(10);
      const result = money.multiply(2.5);
      expect(result.amount).toBe(25);
      expect(result.currency).toBe('USD');
    });

    it('should multiply by zero', () => {
      const money = new Money(10);
      const result = money.multiply(0);
      expect(result.amount).toBe(0);
    });

    it('should round result to 2 decimal places', () => {
      const money = new Money(10);
      const result = money.multiply(0.333);
      expect(result.amount).toBe(3.33);
    });

    it('should return a new Money instance (immutability)', () => {
      const money = new Money(10);
      const result = money.multiply(2);
      expect(result).not.toBe(money);
      expect(money.amount).toBe(10); // original unchanged
    });

    it('should throw ValidationError for negative factor', () => {
      const money = new Money(10);
      expect(() => money.multiply(-1)).toThrow(ValidationError);
      expect(() => money.multiply(-1)).toThrow('Factor cannot be negative');
    });
  });

  describe('equals', () => {
    it('should return true for equal Money objects', () => {
      const m1 = new Money(10.50, 'USD');
      const m2 = new Money(10.50, 'USD');
      expect(m1.equals(m2)).toBe(true);
    });

    it('should return false for different amounts', () => {
      const m1 = new Money(10, 'USD');
      const m2 = new Money(20, 'USD');
      expect(m1.equals(m2)).toBe(false);
    });

    it('should return false for different currencies', () => {
      const m1 = new Money(10, 'USD');
      const m2 = new Money(10, 'EUR');
      expect(m1.equals(m2)).toBe(false);
    });

    it('should return false for null', () => {
      const money = new Money(10);
      expect(money.equals(null)).toBe(false);
    });

    it('should return false for undefined', () => {
      const money = new Money(10);
      expect(money.equals(undefined)).toBe(false);
    });
  });

  describe('toJSON', () => {
    it('should return object with amount and currency', () => {
      const money = new Money(42.50, 'EUR');
      const json = money.toJSON();
      expect(json).toEqual({ amount: 42.50, currency: 'EUR' });
    });
  });

  describe('fromJSON', () => {
    it('should create Money from JSON object', () => {
      const money = Money.fromJSON({ amount: 99.99, currency: 'USD' });
      expect(money.amount).toBe(99.99);
      expect(money.currency).toBe('USD');
    });

    it('should use default USD if currency not provided', () => {
      const money = Money.fromJSON({ amount: 50 });
      expect(money.currency).toBe('USD');
    });

    it('should throw ValidationError for invalid JSON', () => {
      expect(() => Money.fromJSON(null)).toThrow(ValidationError);
      expect(() => Money.fromJSON({})).toThrow(ValidationError);
    });
  });

  describe('zero', () => {
    it('should create zero Money with default USD', () => {
      const money = Money.zero();
      expect(money.amount).toBe(0);
      expect(money.currency).toBe('USD');
    });

    it('should create zero Money with specified currency', () => {
      const money = Money.zero('EUR');
      expect(money.amount).toBe(0);
      expect(money.currency).toBe('EUR');
    });
  });

  describe('toString', () => {
    it('should return formatted string representation', () => {
      const money = new Money(42.50, 'USD');
      expect(money.toString()).toBe('42.50 USD');
    });
  });
});
