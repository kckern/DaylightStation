import { describe, it, expect, beforeEach } from 'vitest';
import { CostBudget } from '#domains/cost/entities/CostBudget.mjs';
import { Money } from '#domains/cost/value-objects/Money.mjs';
import { CostCategory } from '#domains/cost/value-objects/CostCategory.mjs';
import { BudgetPeriod } from '#domains/cost/value-objects/BudgetPeriod.mjs';
import { Thresholds } from '#domains/cost/value-objects/Thresholds.mjs';
import { ValidationError } from '#domains/core/errors/index.mjs';

describe('CostBudget', () => {
  // Common test fixtures
  let validAmount;
  let validPeriod;
  let validCategory;
  let validThresholds;

  beforeEach(() => {
    validAmount = new Money(500);
    validPeriod = new BudgetPeriod('monthly');
    validCategory = CostCategory.fromString('ai/openai');
    validThresholds = new Thresholds({ warning: 0.8, critical: 0.95 });
  });

  describe('constructor', () => {
    it('should create a CostBudget with all required fields', () => {
      const budget = new CostBudget({
        id: 'budget-001',
        name: 'AI Services Budget',
        category: validCategory,
        period: validPeriod,
        amount: validAmount,
        thresholds: validThresholds,
        householdId: 'default'
      });

      expect(budget.id).toBe('budget-001');
      expect(budget.name).toBe('AI Services Budget');
      expect(budget.category).toBe(validCategory);
      expect(budget.period).toBe(validPeriod);
      expect(budget.amount).toBe(validAmount);
      expect(budget.thresholds).toBe(validThresholds);
      expect(budget.householdId).toBe('default');
    });

    it('should create a CostBudget with null category (global budget)', () => {
      const budget = new CostBudget({
        id: 'budget-001',
        name: 'Global Budget',
        category: null,
        period: validPeriod,
        amount: validAmount,
        householdId: 'default'
      });

      expect(budget.category).toBeNull();
    });

    it('should accept period as string and convert to BudgetPeriod', () => {
      const budget = new CostBudget({
        id: 'budget-001',
        name: 'AI Budget',
        period: 'monthly',
        amount: validAmount,
        householdId: 'default'
      });

      expect(budget.period).toBeInstanceOf(BudgetPeriod);
      expect(budget.period.type).toBe('monthly');
    });

    it('should use default Thresholds if not provided', () => {
      const budget = new CostBudget({
        id: 'budget-001',
        name: 'AI Budget',
        period: validPeriod,
        amount: validAmount,
        householdId: 'default'
      });

      expect(budget.thresholds).toBeInstanceOf(Thresholds);
      expect(budget.thresholds.warning).toBe(0.8);
      expect(budget.thresholds.critical).toBe(1.0);
    });

    it('should throw ValidationError if id is missing', () => {
      expect(() => new CostBudget({
        name: 'AI Budget',
        period: validPeriod,
        amount: validAmount,
        householdId: 'default'
      })).toThrow(ValidationError);
    });

    it('should throw ValidationError if name is missing', () => {
      expect(() => new CostBudget({
        id: 'budget-001',
        period: validPeriod,
        amount: validAmount,
        householdId: 'default'
      })).toThrow(ValidationError);
    });

    it('should throw ValidationError if householdId is missing', () => {
      expect(() => new CostBudget({
        id: 'budget-001',
        name: 'AI Budget',
        period: validPeriod,
        amount: validAmount
      })).toThrow(ValidationError);
    });

    it('should include error code for missing required field', () => {
      try {
        new CostBudget({
          name: 'AI Budget',
          period: validPeriod,
          amount: validAmount,
          householdId: 'default'
        });
      } catch (error) {
        expect(error.code).toBe('MISSING_REQUIRED_FIELD');
      }
    });
  });

  describe('getRemaining', () => {
    it('should return the remaining budget amount', () => {
      const budget = new CostBudget({
        id: 'budget-001',
        name: 'AI Budget',
        period: validPeriod,
        amount: new Money(500),
        householdId: 'default'
      });

      const spent = new Money(200);
      const remaining = budget.getRemaining(spent);

      expect(remaining).toBeInstanceOf(Money);
      expect(remaining.amount).toBe(300);
    });

    it('should return zero if spent equals budget', () => {
      const budget = new CostBudget({
        id: 'budget-001',
        name: 'AI Budget',
        period: validPeriod,
        amount: new Money(500),
        householdId: 'default'
      });

      const spent = new Money(500);
      const remaining = budget.getRemaining(spent);

      expect(remaining.amount).toBe(0);
    });

    it('should throw if spent exceeds budget (Money cannot be negative)', () => {
      const budget = new CostBudget({
        id: 'budget-001',
        name: 'AI Budget',
        period: validPeriod,
        amount: new Money(500),
        householdId: 'default'
      });

      const spent = new Money(600);

      // Money.subtract throws if result would be negative
      expect(() => budget.getRemaining(spent)).toThrow(ValidationError);
    });
  });

  describe('getPercentSpent', () => {
    it('should return percent spent as 0-100 value', () => {
      const budget = new CostBudget({
        id: 'budget-001',
        name: 'AI Budget',
        period: validPeriod,
        amount: new Money(500),
        householdId: 'default'
      });

      const spent = new Money(250);
      const percent = budget.getPercentSpent(spent);

      expect(percent).toBe(50);
    });

    it('should return 0 when nothing spent', () => {
      const budget = new CostBudget({
        id: 'budget-001',
        name: 'AI Budget',
        period: validPeriod,
        amount: new Money(500),
        householdId: 'default'
      });

      const spent = new Money(0);
      const percent = budget.getPercentSpent(spent);

      expect(percent).toBe(0);
    });

    it('should return 100 when spent equals budget', () => {
      const budget = new CostBudget({
        id: 'budget-001',
        name: 'AI Budget',
        period: validPeriod,
        amount: new Money(500),
        householdId: 'default'
      });

      const spent = new Money(500);
      const percent = budget.getPercentSpent(spent);

      expect(percent).toBe(100);
    });

    it('should return value over 100 when over budget', () => {
      const budget = new CostBudget({
        id: 'budget-001',
        name: 'AI Budget',
        period: validPeriod,
        amount: new Money(500),
        householdId: 'default'
      });

      const spent = new Money(600);
      const percent = budget.getPercentSpent(spent);

      expect(percent).toBe(120);
    });
  });

  describe('isOverBudget', () => {
    it('should return false when under budget', () => {
      const budget = new CostBudget({
        id: 'budget-001',
        name: 'AI Budget',
        period: validPeriod,
        amount: new Money(500),
        householdId: 'default'
      });

      expect(budget.isOverBudget(new Money(400))).toBe(false);
    });

    it('should return false when exactly at budget', () => {
      const budget = new CostBudget({
        id: 'budget-001',
        name: 'AI Budget',
        period: validPeriod,
        amount: new Money(500),
        householdId: 'default'
      });

      expect(budget.isOverBudget(new Money(500))).toBe(false);
    });

    it('should return true when over budget', () => {
      const budget = new CostBudget({
        id: 'budget-001',
        name: 'AI Budget',
        period: validPeriod,
        amount: new Money(500),
        householdId: 'default'
      });

      expect(budget.isOverBudget(new Money(500.01))).toBe(true);
    });
  });

  describe('isAtWarningLevel', () => {
    it('should return false when below warning threshold', () => {
      const budget = new CostBudget({
        id: 'budget-001',
        name: 'AI Budget',
        period: validPeriod,
        amount: new Money(100),
        thresholds: new Thresholds({ warning: 0.8, critical: 0.95 }),
        householdId: 'default'
      });

      // 70% spent, warning is at 80%
      expect(budget.isAtWarningLevel(new Money(70))).toBe(false);
    });

    it('should return true when at warning threshold', () => {
      const budget = new CostBudget({
        id: 'budget-001',
        name: 'AI Budget',
        period: validPeriod,
        amount: new Money(100),
        thresholds: new Thresholds({ warning: 0.8, critical: 0.95 }),
        householdId: 'default'
      });

      // 80% spent, warning is at 80%
      expect(budget.isAtWarningLevel(new Money(80))).toBe(true);
    });

    it('should return true when between warning and critical thresholds', () => {
      const budget = new CostBudget({
        id: 'budget-001',
        name: 'AI Budget',
        period: validPeriod,
        amount: new Money(100),
        thresholds: new Thresholds({ warning: 0.8, critical: 0.95 }),
        householdId: 'default'
      });

      // 90% spent, between warning (80%) and critical (95%)
      expect(budget.isAtWarningLevel(new Money(90))).toBe(true);
    });

    it('should return false when at or above critical threshold', () => {
      const budget = new CostBudget({
        id: 'budget-001',
        name: 'AI Budget',
        period: validPeriod,
        amount: new Money(100),
        thresholds: new Thresholds({ warning: 0.8, critical: 0.95 }),
        householdId: 'default'
      });

      // 95% spent, critical is at 95%
      expect(budget.isAtWarningLevel(new Money(95))).toBe(false);
    });

    it('should return false when over budget', () => {
      const budget = new CostBudget({
        id: 'budget-001',
        name: 'AI Budget',
        period: validPeriod,
        amount: new Money(100),
        thresholds: new Thresholds({ warning: 0.8, critical: 0.95 }),
        householdId: 'default'
      });

      // 120% spent
      expect(budget.isAtWarningLevel(new Money(120))).toBe(false);
    });
  });

  describe('isAtCriticalLevel', () => {
    it('should return false when below critical threshold', () => {
      const budget = new CostBudget({
        id: 'budget-001',
        name: 'AI Budget',
        period: validPeriod,
        amount: new Money(100),
        thresholds: new Thresholds({ warning: 0.8, critical: 0.95 }),
        householdId: 'default'
      });

      // 90% spent, critical is at 95%
      expect(budget.isAtCriticalLevel(new Money(90))).toBe(false);
    });

    it('should return true when at critical threshold', () => {
      const budget = new CostBudget({
        id: 'budget-001',
        name: 'AI Budget',
        period: validPeriod,
        amount: new Money(100),
        thresholds: new Thresholds({ warning: 0.8, critical: 0.95 }),
        householdId: 'default'
      });

      // 95% spent, critical is at 95%
      expect(budget.isAtCriticalLevel(new Money(95))).toBe(true);
    });

    it('should return true when over critical threshold', () => {
      const budget = new CostBudget({
        id: 'budget-001',
        name: 'AI Budget',
        period: validPeriod,
        amount: new Money(100),
        thresholds: new Thresholds({ warning: 0.8, critical: 0.95 }),
        householdId: 'default'
      });

      // 100% spent
      expect(budget.isAtCriticalLevel(new Money(100))).toBe(true);
    });

    it('should return true when over budget', () => {
      const budget = new CostBudget({
        id: 'budget-001',
        name: 'AI Budget',
        period: validPeriod,
        amount: new Money(100),
        thresholds: new Thresholds({ warning: 0.8, critical: 0.95 }),
        householdId: 'default'
      });

      // 120% spent
      expect(budget.isAtCriticalLevel(new Money(120))).toBe(true);
    });
  });

  describe('toJSON', () => {
    it('should serialize all fields correctly', () => {
      const budget = new CostBudget({
        id: 'budget-001',
        name: 'AI Services Budget',
        category: validCategory,
        period: validPeriod,
        amount: validAmount,
        thresholds: validThresholds,
        householdId: 'default'
      });

      const json = budget.toJSON();

      expect(json.id).toBe('budget-001');
      expect(json.name).toBe('AI Services Budget');
      expect(json.category).toBe('ai/openai');
      expect(json.period).toEqual({ type: 'monthly', anchor: null });
      expect(json.amount).toEqual({ amount: 500, currency: 'USD' });
      expect(json.thresholds).toEqual({ warning: 0.8, critical: 0.95, pace: true });
      expect(json.householdId).toBe('default');
    });

    it('should serialize null category correctly', () => {
      const budget = new CostBudget({
        id: 'budget-001',
        name: 'Global Budget',
        category: null,
        period: validPeriod,
        amount: validAmount,
        householdId: 'default'
      });

      const json = budget.toJSON();

      expect(json.category).toBeNull();
    });
  });

  describe('fromJSON', () => {
    it('should reconstruct a CostBudget from JSON', () => {
      const json = {
        id: 'budget-001',
        name: 'AI Services Budget',
        category: 'ai/openai',
        period: { type: 'monthly', anchor: null },
        amount: { amount: 500, currency: 'USD' },
        thresholds: { warning: 0.8, critical: 0.95, pace: true },
        householdId: 'default'
      };

      const budget = CostBudget.fromJSON(json);

      expect(budget.id).toBe('budget-001');
      expect(budget.name).toBe('AI Services Budget');
      expect(budget.category.toString()).toBe('ai/openai');
      expect(budget.period.type).toBe('monthly');
      expect(budget.amount.amount).toBe(500);
      expect(budget.thresholds.warning).toBe(0.8);
      expect(budget.householdId).toBe('default');
    });

    it('should handle null category from JSON', () => {
      const json = {
        id: 'budget-001',
        name: 'Global Budget',
        category: null,
        period: { type: 'monthly', anchor: null },
        amount: { amount: 500, currency: 'USD' },
        householdId: 'default'
      };

      const budget = CostBudget.fromJSON(json);

      expect(budget.category).toBeNull();
    });

    it('should round-trip toJSON and fromJSON correctly', () => {
      const original = new CostBudget({
        id: 'budget-001',
        name: 'AI Budget',
        category: validCategory,
        period: validPeriod,
        amount: validAmount,
        thresholds: validThresholds,
        householdId: 'default'
      });

      const json = original.toJSON();
      const reconstructed = CostBudget.fromJSON(json);

      expect(reconstructed.id).toBe(original.id);
      expect(reconstructed.name).toBe(original.name);
      expect(reconstructed.category.toString()).toBe(original.category.toString());
      expect(reconstructed.period.type).toBe(original.period.type);
      expect(reconstructed.amount.amount).toBe(original.amount.amount);
      expect(reconstructed.thresholds.warning).toBe(original.thresholds.warning);
      expect(reconstructed.householdId).toBe(original.householdId);
    });
  });
});
