import { describe, it, expect } from 'vitest';
import {
  EntryType,
  ENTRY_TYPES,
  isCountedInSpend
} from '#domains/cost/value-objects/EntryType.mjs';

describe('EntryType', () => {
  describe('enum values', () => {
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

    it('should have exactly 4 entry types', () => {
      expect(Object.keys(EntryType)).toHaveLength(4);
    });
  });

  describe('immutability', () => {
    it('should be frozen', () => {
      expect(Object.isFrozen(EntryType)).toBe(true);
    });

    it('should not allow adding new types', () => {
      expect(() => {
        EntryType.NEW_TYPE = 'new_type';
      }).toThrow();
    });

    it('should not allow modifying existing types', () => {
      expect(() => {
        EntryType.USAGE = 'modified';
      }).toThrow();
    });
  });
});

describe('ENTRY_TYPES', () => {
  it('should be an array', () => {
    expect(Array.isArray(ENTRY_TYPES)).toBe(true);
  });

  it('should contain all entry type values', () => {
    expect(ENTRY_TYPES).toContain('usage');
    expect(ENTRY_TYPES).toContain('subscription');
    expect(ENTRY_TYPES).toContain('purchase');
    expect(ENTRY_TYPES).toContain('transaction');
  });

  it('should have exactly 4 values', () => {
    expect(ENTRY_TYPES).toHaveLength(4);
  });

  it('should be frozen', () => {
    expect(Object.isFrozen(ENTRY_TYPES)).toBe(true);
  });

  it('should not allow modifications', () => {
    expect(() => {
      ENTRY_TYPES.push('new_type');
    }).toThrow();
  });

  it('should match Object.values(EntryType)', () => {
    expect(ENTRY_TYPES).toEqual(Object.values(EntryType));
  });
});

describe('isCountedInSpend', () => {
  describe('types that count toward spend', () => {
    it('should return true for USAGE', () => {
      expect(isCountedInSpend(EntryType.USAGE)).toBe(true);
    });

    it('should return true for SUBSCRIPTION', () => {
      expect(isCountedInSpend(EntryType.SUBSCRIPTION)).toBe(true);
    });

    it('should return true for PURCHASE', () => {
      expect(isCountedInSpend(EntryType.PURCHASE)).toBe(true);
    });

    it('should return true for string "usage"', () => {
      expect(isCountedInSpend('usage')).toBe(true);
    });

    it('should return true for string "subscription"', () => {
      expect(isCountedInSpend('subscription')).toBe(true);
    });

    it('should return true for string "purchase"', () => {
      expect(isCountedInSpend('purchase')).toBe(true);
    });
  });

  describe('types that do NOT count toward spend', () => {
    it('should return false for TRANSACTION', () => {
      expect(isCountedInSpend(EntryType.TRANSACTION)).toBe(false);
    });

    it('should return false for string "transaction"', () => {
      expect(isCountedInSpend('transaction')).toBe(false);
    });
  });

  describe('invalid types', () => {
    it('should return false for null', () => {
      expect(isCountedInSpend(null)).toBe(false);
    });

    it('should return false for undefined', () => {
      expect(isCountedInSpend(undefined)).toBe(false);
    });

    it('should return false for empty string', () => {
      expect(isCountedInSpend('')).toBe(false);
    });

    it('should return false for unknown string', () => {
      expect(isCountedInSpend('unknown')).toBe(false);
    });

    it('should return false for uppercase variant', () => {
      // Type checking is case-sensitive
      expect(isCountedInSpend('USAGE')).toBe(false);
    });

    it('should return false for number', () => {
      expect(isCountedInSpend(123)).toBe(false);
    });

    it('should return false for object', () => {
      expect(isCountedInSpend({})).toBe(false);
    });
  });
});
