import { describe, it, expect, beforeEach } from 'vitest';
import { BudgetPeriod, PERIOD_TYPES } from '#domains/cost/value-objects/BudgetPeriod.mjs';
import { ValidationError } from '#domains/core/errors/index.mjs';

describe('BudgetPeriod', () => {
  describe('constructor', () => {
    it('should create a BudgetPeriod with valid type', () => {
      const period = new BudgetPeriod('monthly');
      expect(period.type).toBe('monthly');
    });

    it('should create a BudgetPeriod with anchor date', () => {
      const anchor = new Date('2026-01-15');
      const period = new BudgetPeriod('monthly', anchor);
      expect(period.type).toBe('monthly');
      expect(period.anchor).toEqual(anchor);
    });

    it('should allow null anchor (default)', () => {
      const period = new BudgetPeriod('weekly');
      expect(period.anchor).toBeNull();
    });

    it('should throw ValidationError for invalid type', () => {
      expect(() => new BudgetPeriod('invalid')).toThrow(ValidationError);
      expect(() => new BudgetPeriod('invalid')).toThrow('Invalid budget period type');
    });

    it('should include error code for invalid type', () => {
      try {
        new BudgetPeriod('quarterly');
      } catch (error) {
        expect(error.code).toBe('INVALID_PERIOD_TYPE');
      }
    });
  });

  describe('PERIOD_TYPES constant', () => {
    it('should include all valid period types', () => {
      expect(PERIOD_TYPES).toContain('daily');
      expect(PERIOD_TYPES).toContain('weekly');
      expect(PERIOD_TYPES).toContain('monthly');
      expect(PERIOD_TYPES).toContain('yearly');
    });

    it('should be frozen', () => {
      expect(Object.isFrozen(PERIOD_TYPES)).toBe(true);
    });
  });

  describe('immutability', () => {
    it('should be frozen (immutable)', () => {
      const period = new BudgetPeriod('monthly');
      expect(Object.isFrozen(period)).toBe(true);
    });
  });

  describe('getCurrentPeriodStart', () => {
    describe('daily', () => {
      it('should return start of day', () => {
        const period = new BudgetPeriod('daily');
        const ref = new Date('2026-01-15T14:30:00Z');
        const start = period.getCurrentPeriodStart(ref);
        expect(start.getUTCFullYear()).toBe(2026);
        expect(start.getUTCMonth()).toBe(0);
        expect(start.getUTCDate()).toBe(15);
        expect(start.getUTCHours()).toBe(0);
        expect(start.getUTCMinutes()).toBe(0);
        expect(start.getUTCSeconds()).toBe(0);
      });
    });

    describe('weekly', () => {
      it('should return start of week (Sunday)', () => {
        const period = new BudgetPeriod('weekly');
        // 2026-01-15 is a Thursday
        const ref = new Date('2026-01-15T14:30:00Z');
        const start = period.getCurrentPeriodStart(ref);
        // Week starts Sunday = Jan 11
        expect(start.getUTCFullYear()).toBe(2026);
        expect(start.getUTCMonth()).toBe(0);
        expect(start.getUTCDate()).toBe(11);
      });
    });

    describe('monthly', () => {
      it('should return first day of month', () => {
        const period = new BudgetPeriod('monthly');
        const ref = new Date('2026-01-15T14:30:00Z');
        const start = period.getCurrentPeriodStart(ref);
        expect(start.getUTCFullYear()).toBe(2026);
        expect(start.getUTCMonth()).toBe(0);
        expect(start.getUTCDate()).toBe(1);
      });
    });

    describe('yearly', () => {
      it('should return first day of year', () => {
        const period = new BudgetPeriod('yearly');
        const ref = new Date('2026-06-15T14:30:00Z');
        const start = period.getCurrentPeriodStart(ref);
        expect(start.getUTCFullYear()).toBe(2026);
        expect(start.getUTCMonth()).toBe(0);
        expect(start.getUTCDate()).toBe(1);
      });
    });

    it('should use current date if no reference provided', () => {
      const period = new BudgetPeriod('daily');
      const start = period.getCurrentPeriodStart();
      const now = new Date();
      expect(start.getUTCFullYear()).toBe(now.getUTCFullYear());
      expect(start.getUTCMonth()).toBe(now.getUTCMonth());
      expect(start.getUTCDate()).toBe(now.getUTCDate());
    });
  });

  describe('getCurrentPeriodEnd', () => {
    describe('daily', () => {
      it('should return end of day', () => {
        const period = new BudgetPeriod('daily');
        const ref = new Date('2026-01-15T14:30:00Z');
        const end = period.getCurrentPeriodEnd(ref);
        expect(end.getUTCFullYear()).toBe(2026);
        expect(end.getUTCMonth()).toBe(0);
        expect(end.getUTCDate()).toBe(15);
        expect(end.getUTCHours()).toBe(23);
        expect(end.getUTCMinutes()).toBe(59);
        expect(end.getUTCSeconds()).toBe(59);
      });
    });

    describe('weekly', () => {
      it('should return end of week (Saturday)', () => {
        const period = new BudgetPeriod('weekly');
        // 2026-01-15 is a Thursday
        const ref = new Date('2026-01-15T14:30:00Z');
        const end = period.getCurrentPeriodEnd(ref);
        // Week ends Saturday = Jan 17
        expect(end.getUTCFullYear()).toBe(2026);
        expect(end.getUTCMonth()).toBe(0);
        expect(end.getUTCDate()).toBe(17);
      });
    });

    describe('monthly', () => {
      it('should return last day of month', () => {
        const period = new BudgetPeriod('monthly');
        const ref = new Date('2026-01-15T14:30:00Z');
        const end = period.getCurrentPeriodEnd(ref);
        expect(end.getUTCFullYear()).toBe(2026);
        expect(end.getUTCMonth()).toBe(0);
        expect(end.getUTCDate()).toBe(31);
      });

      it('should handle February (non-leap year)', () => {
        const period = new BudgetPeriod('monthly');
        const ref = new Date('2026-02-15T14:30:00Z');
        const end = period.getCurrentPeriodEnd(ref);
        expect(end.getUTCDate()).toBe(28);
      });
    });

    describe('yearly', () => {
      it('should return last day of year', () => {
        const period = new BudgetPeriod('yearly');
        const ref = new Date('2026-06-15T14:30:00Z');
        const end = period.getCurrentPeriodEnd(ref);
        expect(end.getUTCFullYear()).toBe(2026);
        expect(end.getUTCMonth()).toBe(11);
        expect(end.getUTCDate()).toBe(31);
      });
    });
  });

  describe('toJSON', () => {
    it('should return object with type', () => {
      const period = new BudgetPeriod('monthly');
      const json = period.toJSON();
      expect(json).toEqual({ type: 'monthly', anchor: null });
    });

    it('should include anchor if present', () => {
      const anchor = new Date('2026-01-15T00:00:00Z');
      const period = new BudgetPeriod('monthly', anchor);
      const json = period.toJSON();
      expect(json.type).toBe('monthly');
      expect(json.anchor).toBe(anchor.toISOString());
    });
  });

  describe('fromJSON', () => {
    it('should create BudgetPeriod from JSON object', () => {
      const period = BudgetPeriod.fromJSON({ type: 'weekly' });
      expect(period.type).toBe('weekly');
      expect(period.anchor).toBeNull();
    });

    it('should parse anchor date from ISO string', () => {
      const period = BudgetPeriod.fromJSON({
        type: 'monthly',
        anchor: '2026-01-15T00:00:00.000Z'
      });
      expect(period.type).toBe('monthly');
      expect(period.anchor).toBeInstanceOf(Date);
      expect(period.anchor.toISOString()).toBe('2026-01-15T00:00:00.000Z');
    });

    it('should throw ValidationError for invalid JSON', () => {
      expect(() => BudgetPeriod.fromJSON(null)).toThrow(ValidationError);
      expect(() => BudgetPeriod.fromJSON({})).toThrow(ValidationError);
    });
  });
});

describe('Thresholds', () => {
  // Import dynamically in test to keep file organized
  let Thresholds;

  beforeEach(async () => {
    const mod = await import('#domains/cost/value-objects/Thresholds.mjs');
    Thresholds = mod.Thresholds;
  });

  describe('constructor', () => {
    it('should create with default values', () => {
      const thresholds = new Thresholds({});
      expect(thresholds.warning).toBe(0.8);
      expect(thresholds.critical).toBe(1.0);
      expect(thresholds.pace).toBe(true);
    });

    it('should create with custom values', () => {
      const thresholds = new Thresholds({ warning: 0.7, critical: 0.9, pace: false });
      expect(thresholds.warning).toBe(0.7);
      expect(thresholds.critical).toBe(0.9);
      expect(thresholds.pace).toBe(false);
    });

    it('should allow empty constructor (use all defaults)', () => {
      const thresholds = new Thresholds();
      expect(thresholds.warning).toBe(0.8);
      expect(thresholds.critical).toBe(1.0);
      expect(thresholds.pace).toBe(true);
    });
  });

  describe('immutability', () => {
    it('should be frozen (immutable)', () => {
      const thresholds = new Thresholds({});
      expect(Object.isFrozen(thresholds)).toBe(true);
    });
  });

  describe('defaults factory', () => {
    it('should create Thresholds with default values', () => {
      const thresholds = Thresholds.defaults();
      expect(thresholds.warning).toBe(0.8);
      expect(thresholds.critical).toBe(1.0);
      expect(thresholds.pace).toBe(true);
    });
  });

  describe('toJSON', () => {
    it('should return object with all values', () => {
      const thresholds = new Thresholds({ warning: 0.75, critical: 0.95, pace: false });
      const json = thresholds.toJSON();
      expect(json).toEqual({ warning: 0.75, critical: 0.95, pace: false });
    });
  });

  describe('fromJSON', () => {
    it('should create Thresholds from JSON object', () => {
      const thresholds = Thresholds.fromJSON({ warning: 0.6, critical: 0.85, pace: true });
      expect(thresholds.warning).toBe(0.6);
      expect(thresholds.critical).toBe(0.85);
      expect(thresholds.pace).toBe(true);
    });

    it('should use defaults for missing values', () => {
      const thresholds = Thresholds.fromJSON({ warning: 0.5 });
      expect(thresholds.warning).toBe(0.5);
      expect(thresholds.critical).toBe(1.0);
      expect(thresholds.pace).toBe(true);
    });

    it('should handle null input gracefully', () => {
      const thresholds = Thresholds.fromJSON(null);
      expect(thresholds.warning).toBe(0.8);
      expect(thresholds.critical).toBe(1.0);
    });
  });
});

describe('EntryType', () => {
  let EntryType, ENTRY_TYPES, isCountedInSpend;

  beforeEach(async () => {
    const mod = await import('#domains/cost/value-objects/EntryType.mjs');
    EntryType = mod.EntryType;
    ENTRY_TYPES = mod.ENTRY_TYPES;
    isCountedInSpend = mod.isCountedInSpend;
  });

  describe('EntryType enum', () => {
    it('should have USAGE type', () => {
      expect(EntryType.USAGE).toBe('usage');
    });

    it('should have SUBSCRIPTION type', () => {
      expect(EntryType.SUBSCRIPTION).toBe('subscription');
    });

    it('should have PURCHASE type', () => {
      expect(EntryType.PURCHASE).toBe('purchase');
    });

    it('should have TRANSACTION type', () => {
      expect(EntryType.TRANSACTION).toBe('transaction');
    });

    it('should be frozen', () => {
      expect(Object.isFrozen(EntryType)).toBe(true);
    });
  });

  describe('ENTRY_TYPES constant', () => {
    it('should contain all entry type values', () => {
      expect(ENTRY_TYPES).toContain('usage');
      expect(ENTRY_TYPES).toContain('subscription');
      expect(ENTRY_TYPES).toContain('purchase');
      expect(ENTRY_TYPES).toContain('transaction');
    });

    it('should be frozen', () => {
      expect(Object.isFrozen(ENTRY_TYPES)).toBe(true);
    });
  });

  describe('isCountedInSpend', () => {
    it('should return true for usage', () => {
      expect(isCountedInSpend(EntryType.USAGE)).toBe(true);
    });

    it('should return true for subscription', () => {
      expect(isCountedInSpend(EntryType.SUBSCRIPTION)).toBe(true);
    });

    it('should return true for purchase', () => {
      expect(isCountedInSpend(EntryType.PURCHASE)).toBe(true);
    });

    it('should return false for transaction', () => {
      expect(isCountedInSpend(EntryType.TRANSACTION)).toBe(false);
    });

    it('should return false for unknown types', () => {
      expect(isCountedInSpend('unknown')).toBe(false);
    });
  });
});

describe('SpreadSource', () => {
  let SpreadSource, Money;

  beforeEach(async () => {
    const spreadMod = await import('#domains/cost/value-objects/SpreadSource.mjs');
    const moneyMod = await import('#domains/cost/value-objects/Money.mjs');
    SpreadSource = spreadMod.SpreadSource;
    Money = moneyMod.Money;
  });

  describe('constructor', () => {
    it('should create SpreadSource with required fields', () => {
      const source = new SpreadSource({
        name: 'Annual Software License',
        originalAmount: 120,
        spreadMonths: 12,
        startDate: new Date('2026-01-01')
      });
      expect(source.name).toBe('Annual Software License');
      expect(source.spreadMonths).toBe(12);
    });

    it('should accept Money object for originalAmount', () => {
      const source = new SpreadSource({
        name: 'Subscription',
        originalAmount: new Money(240, 'USD'),
        spreadMonths: 6,
        startDate: new Date('2026-01-01')
      });
      expect(source.originalAmount.amount).toBe(240);
      expect(source.originalAmount.currency).toBe('USD');
    });

    it('should convert number to Money for originalAmount', () => {
      const source = new SpreadSource({
        name: 'Equipment',
        originalAmount: 600,
        spreadMonths: 12,
        startDate: new Date('2026-01-01')
      });
      expect(source.originalAmount).toBeInstanceOf(Money);
      expect(source.originalAmount.amount).toBe(600);
    });

    it('should calculate endsAt correctly', () => {
      const source = new SpreadSource({
        name: 'Test',
        originalAmount: 100,
        spreadMonths: 6,
        startDate: new Date('2026-01-15')
      });
      // 6 months from Jan 15 = July 15
      expect(source.endsAt.getUTCFullYear()).toBe(2026);
      expect(source.endsAt.getUTCMonth()).toBe(6); // July = 6
    });

    it('should throw ValidationError if name is missing', () => {
      expect(() => new SpreadSource({
        originalAmount: 100,
        spreadMonths: 12,
        startDate: new Date()
      })).toThrow(ValidationError);
    });

    it('should throw ValidationError if spreadMonths < 1', () => {
      expect(() => new SpreadSource({
        name: 'Test',
        originalAmount: 100,
        spreadMonths: 0,
        startDate: new Date()
      })).toThrow(ValidationError);
    });
  });

  describe('immutability', () => {
    it('should be frozen (immutable)', () => {
      const source = new SpreadSource({
        name: 'Test',
        originalAmount: 120,
        spreadMonths: 12,
        startDate: new Date('2026-01-01')
      });
      expect(Object.isFrozen(source)).toBe(true);
    });
  });

  describe('getMonthlyAmount', () => {
    it('should return originalAmount divided by spreadMonths', () => {
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

    it('should handle non-even division (rounds to cents)', () => {
      const source = new SpreadSource({
        name: 'Test',
        originalAmount: 100,
        spreadMonths: 3,
        startDate: new Date('2026-01-01')
      });
      const monthly = source.getMonthlyAmount();
      expect(monthly.amount).toBe(33.33);
    });
  });

  describe('getMonthsRemaining', () => {
    it('should return correct months remaining', () => {
      const source = new SpreadSource({
        name: 'Test',
        originalAmount: 120,
        spreadMonths: 12,
        startDate: new Date('2026-01-01')
      });
      // 3 months into the year
      const asOf = new Date('2026-04-01');
      const remaining = source.getMonthsRemaining(asOf);
      expect(remaining).toBe(9);
    });

    it('should return 0 if past endsAt', () => {
      const source = new SpreadSource({
        name: 'Test',
        originalAmount: 120,
        spreadMonths: 6,
        startDate: new Date('2026-01-01')
      });
      // Well past July
      const asOf = new Date('2026-12-01');
      const remaining = source.getMonthsRemaining(asOf);
      expect(remaining).toBe(0);
    });

    it('should return full months if before startDate', () => {
      const source = new SpreadSource({
        name: 'Test',
        originalAmount: 120,
        spreadMonths: 12,
        startDate: new Date('2026-06-01')
      });
      const asOf = new Date('2026-01-01');
      const remaining = source.getMonthsRemaining(asOf);
      expect(remaining).toBe(12);
    });
  });

  describe('toJSON', () => {
    it('should return JSON-serializable object', () => {
      const source = new SpreadSource({
        name: 'License',
        originalAmount: 120,
        spreadMonths: 12,
        startDate: new Date('2026-01-15T00:00:00Z')
      });
      const json = source.toJSON();
      expect(json.name).toBe('License');
      expect(json.originalAmount).toEqual({ amount: 120, currency: 'USD' });
      expect(json.spreadMonths).toBe(12);
      expect(json.startDate).toBe('2026-01-15T00:00:00.000Z');
    });
  });

  describe('fromJSON', () => {
    it('should create SpreadSource from JSON object', () => {
      const source = SpreadSource.fromJSON({
        name: 'Equipment',
        originalAmount: { amount: 600, currency: 'USD' },
        spreadMonths: 24,
        startDate: '2026-01-01T00:00:00.000Z'
      });
      expect(source.name).toBe('Equipment');
      expect(source.originalAmount.amount).toBe(600);
      expect(source.spreadMonths).toBe(24);
      expect(source.startDate).toBeInstanceOf(Date);
    });

    it('should handle number for originalAmount', () => {
      const source = SpreadSource.fromJSON({
        name: 'Test',
        originalAmount: 100,
        spreadMonths: 12,
        startDate: '2026-01-01'
      });
      expect(source.originalAmount.amount).toBe(100);
    });

    it('should throw ValidationError for invalid JSON', () => {
      expect(() => SpreadSource.fromJSON(null)).toThrow(ValidationError);
      expect(() => SpreadSource.fromJSON({})).toThrow(ValidationError);
    });
  });
});
