import { describe, it, expect, beforeEach } from 'vitest';
import { CostEntry } from '#domains/cost/entities/CostEntry.mjs';
import { Money } from '#domains/cost/value-objects/Money.mjs';
import { Usage } from '#domains/cost/value-objects/Usage.mjs';
import { CostCategory } from '#domains/cost/value-objects/CostCategory.mjs';
import { Attribution } from '#domains/cost/value-objects/Attribution.mjs';
import { SpreadSource } from '#domains/cost/value-objects/SpreadSource.mjs';
import { EntryType } from '#domains/cost/value-objects/EntryType.mjs';
import { ValidationError } from '#domains/core/errors/index.mjs';

describe('CostEntry', () => {
  // Common test fixtures
  let validAmount;
  let validCategory;
  let validAttribution;
  let validOccurredAt;

  beforeEach(() => {
    validAmount = new Money(42.50);
    validCategory = CostCategory.fromString('ai/openai/gpt-4o');
    validAttribution = new Attribution({ householdId: 'default' });
    validOccurredAt = new Date('2026-01-15T10:30:00Z');
  });

  describe('constructor', () => {
    it('should create a CostEntry with all required fields', () => {
      const entry = new CostEntry({
        id: '20260115103000-abc123',
        occurredAt: validOccurredAt,
        amount: validAmount,
        category: validCategory,
        entryType: EntryType.USAGE,
        attribution: validAttribution
      });

      expect(entry.id).toBe('20260115103000-abc123');
      expect(entry.occurredAt).toEqual(validOccurredAt);
      expect(entry.amount).toBe(validAmount);
      expect(entry.category).toBe(validCategory);
      expect(entry.entryType).toBe(EntryType.USAGE);
      expect(entry.attribution).toBe(validAttribution);
    });

    it('should create a CostEntry with optional fields', () => {
      const usage = new Usage(150, 'tokens');
      const spreadSource = new SpreadSource({
        name: 'Annual License',
        originalAmount: 120,
        spreadMonths: 12,
        startDate: new Date('2026-01-01')
      });
      const variance = new Money(5.00);

      const entry = new CostEntry({
        id: '20260115103000-abc123',
        occurredAt: validOccurredAt,
        amount: validAmount,
        category: validCategory,
        entryType: EntryType.USAGE,
        attribution: validAttribution,
        usage,
        description: 'API call to GPT-4o',
        metadata: { model: 'gpt-4o', requestId: 'req-123' },
        spreadSource,
        reconcilesUsage: true,
        variance
      });

      expect(entry.usage).toBe(usage);
      expect(entry.description).toBe('API call to GPT-4o');
      expect(entry.metadata).toEqual({ model: 'gpt-4o', requestId: 'req-123' });
      expect(entry.spreadSource).toBe(spreadSource);
      expect(entry.reconcilesUsage).toBe(true);
      expect(entry.variance).toBe(variance);
    });

    it('should default optional fields to appropriate values', () => {
      const entry = new CostEntry({
        id: '20260115103000-abc123',
        occurredAt: validOccurredAt,
        amount: validAmount,
        category: validCategory,
        entryType: EntryType.USAGE,
        attribution: validAttribution
      });

      expect(entry.usage).toBeNull();
      expect(entry.description).toBeNull();
      expect(entry.metadata).toEqual({});
      expect(entry.spreadSource).toBeNull();
      expect(entry.reconcilesUsage).toBe(false);
      expect(entry.variance).toBeNull();
    });

    it('should throw ValidationError if id is missing', () => {
      expect(() => new CostEntry({
        occurredAt: validOccurredAt,
        amount: validAmount,
        category: validCategory,
        entryType: EntryType.USAGE,
        attribution: validAttribution
      })).toThrow(ValidationError);
    });

    it('should throw ValidationError if amount is missing', () => {
      expect(() => new CostEntry({
        id: '20260115103000-abc123',
        occurredAt: validOccurredAt,
        category: validCategory,
        entryType: EntryType.USAGE,
        attribution: validAttribution
      })).toThrow(ValidationError);
    });

    it('should throw ValidationError if category is missing', () => {
      expect(() => new CostEntry({
        id: '20260115103000-abc123',
        occurredAt: validOccurredAt,
        amount: validAmount,
        entryType: EntryType.USAGE,
        attribution: validAttribution
      })).toThrow(ValidationError);
    });

    it('should throw ValidationError if entryType is missing', () => {
      expect(() => new CostEntry({
        id: '20260115103000-abc123',
        occurredAt: validOccurredAt,
        amount: validAmount,
        category: validCategory,
        attribution: validAttribution
      })).toThrow(ValidationError);
    });

    it('should throw ValidationError if attribution is missing', () => {
      expect(() => new CostEntry({
        id: '20260115103000-abc123',
        occurredAt: validOccurredAt,
        amount: validAmount,
        category: validCategory,
        entryType: EntryType.USAGE
      })).toThrow(ValidationError);
    });

    it('should include error code for missing required field', () => {
      try {
        new CostEntry({
          occurredAt: validOccurredAt,
          amount: validAmount,
          category: validCategory,
          entryType: EntryType.USAGE,
          attribution: validAttribution
        });
      } catch (error) {
        expect(error.code).toBe('MISSING_REQUIRED_FIELD');
      }
    });
  });

  describe('countsInSpend', () => {
    it('should return true for USAGE entry type', () => {
      const entry = new CostEntry({
        id: '20260115103000-abc123',
        occurredAt: validOccurredAt,
        amount: validAmount,
        category: validCategory,
        entryType: EntryType.USAGE,
        attribution: validAttribution
      });

      expect(entry.countsInSpend()).toBe(true);
    });

    it('should return true for SUBSCRIPTION entry type', () => {
      const entry = new CostEntry({
        id: '20260115103000-abc123',
        occurredAt: validOccurredAt,
        amount: validAmount,
        category: validCategory,
        entryType: EntryType.SUBSCRIPTION,
        attribution: validAttribution
      });

      expect(entry.countsInSpend()).toBe(true);
    });

    it('should return true for PURCHASE entry type', () => {
      const entry = new CostEntry({
        id: '20260115103000-abc123',
        occurredAt: validOccurredAt,
        amount: validAmount,
        category: validCategory,
        entryType: EntryType.PURCHASE,
        attribution: validAttribution
      });

      expect(entry.countsInSpend()).toBe(true);
    });

    it('should return false for TRANSACTION entry type', () => {
      const entry = new CostEntry({
        id: '20260115103000-abc123',
        occurredAt: validOccurredAt,
        amount: validAmount,
        category: validCategory,
        entryType: EntryType.TRANSACTION,
        attribution: validAttribution
      });

      expect(entry.countsInSpend()).toBe(false);
    });

    it('should return false if reconcilesUsage is true (regardless of entry type)', () => {
      const entry = new CostEntry({
        id: '20260115103000-abc123',
        occurredAt: validOccurredAt,
        amount: validAmount,
        category: validCategory,
        entryType: EntryType.USAGE,
        attribution: validAttribution,
        reconcilesUsage: true
      });

      expect(entry.countsInSpend()).toBe(false);
    });
  });

  describe('toJSON', () => {
    it('should serialize all fields correctly', () => {
      const usage = new Usage(150, 'tokens');
      const spreadSource = new SpreadSource({
        name: 'Annual License',
        originalAmount: 120,
        spreadMonths: 12,
        startDate: new Date('2026-01-01T00:00:00Z')
      });
      const variance = new Money(5.00);

      const entry = new CostEntry({
        id: '20260115103000-abc123',
        occurredAt: validOccurredAt,
        amount: validAmount,
        category: validCategory,
        entryType: EntryType.USAGE,
        attribution: validAttribution,
        usage,
        description: 'API call',
        metadata: { model: 'gpt-4o' },
        spreadSource,
        reconcilesUsage: false,
        variance
      });

      const json = entry.toJSON();

      expect(json.id).toBe('20260115103000-abc123');
      expect(json.occurredAt).toBe(validOccurredAt.toISOString());
      expect(json.amount).toEqual({ amount: 42.50, currency: 'USD' });
      expect(json.category).toBe('ai/openai/gpt-4o');
      expect(json.entryType).toBe('usage');
      expect(json.attribution).toEqual({ householdId: 'default' });
      expect(json.usage).toEqual({ quantity: 150, unit: 'tokens' });
      expect(json.description).toBe('API call');
      expect(json.metadata).toEqual({ model: 'gpt-4o' });
      expect(json.spreadSource).toEqual({
        name: 'Annual License',
        originalAmount: { amount: 120, currency: 'USD' },
        spreadMonths: 12,
        startDate: '2026-01-01T00:00:00.000Z'
      });
      expect(json.reconcilesUsage).toBe(false);
      expect(json.variance).toEqual({ amount: 5.00, currency: 'USD' });
    });

    it('should serialize null optional fields correctly', () => {
      const entry = new CostEntry({
        id: '20260115103000-abc123',
        occurredAt: validOccurredAt,
        amount: validAmount,
        category: validCategory,
        entryType: EntryType.USAGE,
        attribution: validAttribution
      });

      const json = entry.toJSON();

      expect(json.usage).toBeNull();
      expect(json.description).toBeNull();
      expect(json.metadata).toEqual({});
      expect(json.spreadSource).toBeNull();
      expect(json.reconcilesUsage).toBe(false);
      expect(json.variance).toBeNull();
    });
  });

  describe('fromJSON', () => {
    it('should reconstruct a CostEntry from JSON', () => {
      const json = {
        id: '20260115103000-abc123',
        occurredAt: '2026-01-15T10:30:00.000Z',
        amount: { amount: 42.50, currency: 'USD' },
        category: 'ai/openai/gpt-4o',
        entryType: 'usage',
        attribution: { householdId: 'default' },
        usage: { quantity: 150, unit: 'tokens' },
        description: 'API call',
        metadata: { model: 'gpt-4o' },
        reconcilesUsage: false,
        variance: { amount: 5.00, currency: 'USD' }
      };

      const entry = CostEntry.fromJSON(json);

      expect(entry.id).toBe('20260115103000-abc123');
      expect(entry.occurredAt).toEqual(new Date('2026-01-15T10:30:00.000Z'));
      expect(entry.amount.amount).toBe(42.50);
      expect(entry.category.toString()).toBe('ai/openai/gpt-4o');
      expect(entry.entryType).toBe('usage');
      expect(entry.attribution.householdId).toBe('default');
      expect(entry.usage.quantity).toBe(150);
      expect(entry.description).toBe('API call');
      expect(entry.metadata).toEqual({ model: 'gpt-4o' });
      expect(entry.reconcilesUsage).toBe(false);
      expect(entry.variance.amount).toBe(5.00);
    });

    it('should handle null optional fields from JSON', () => {
      const json = {
        id: '20260115103000-abc123',
        occurredAt: '2026-01-15T10:30:00.000Z',
        amount: { amount: 42.50, currency: 'USD' },
        category: 'ai/openai/gpt-4o',
        entryType: 'usage',
        attribution: { householdId: 'default' },
        usage: null,
        description: null,
        metadata: {},
        spreadSource: null,
        reconcilesUsage: false,
        variance: null
      };

      const entry = CostEntry.fromJSON(json);

      expect(entry.usage).toBeNull();
      expect(entry.description).toBeNull();
      expect(entry.metadata).toEqual({});
      expect(entry.spreadSource).toBeNull();
      expect(entry.variance).toBeNull();
    });

    it('should reconstruct a CostEntry with spreadSource from JSON', () => {
      const json = {
        id: '20260115103000-abc123',
        occurredAt: '2026-01-15T10:30:00.000Z',
        amount: { amount: 10, currency: 'USD' },
        category: 'subscription/software',
        entryType: 'subscription',
        attribution: { householdId: 'default' },
        spreadSource: {
          name: 'Annual License',
          originalAmount: { amount: 120, currency: 'USD' },
          spreadMonths: 12,
          startDate: '2026-01-01T00:00:00.000Z'
        }
      };

      const entry = CostEntry.fromJSON(json);

      expect(entry.spreadSource).not.toBeNull();
      expect(entry.spreadSource.name).toBe('Annual License');
      expect(entry.spreadSource.spreadMonths).toBe(12);
    });

    it('should round-trip toJSON and fromJSON correctly', () => {
      const original = new CostEntry({
        id: '20260115103000-abc123',
        occurredAt: validOccurredAt,
        amount: validAmount,
        category: validCategory,
        entryType: EntryType.USAGE,
        attribution: validAttribution,
        usage: new Usage(150, 'tokens'),
        description: 'Test entry',
        metadata: { key: 'value' }
      });

      const json = original.toJSON();
      const reconstructed = CostEntry.fromJSON(json);

      expect(reconstructed.id).toBe(original.id);
      expect(reconstructed.occurredAt.getTime()).toBe(original.occurredAt.getTime());
      expect(reconstructed.amount.amount).toBe(original.amount.amount);
      expect(reconstructed.category.toString()).toBe(original.category.toString());
      expect(reconstructed.entryType).toBe(original.entryType);
      expect(reconstructed.attribution.householdId).toBe(original.attribution.householdId);
      expect(reconstructed.usage.quantity).toBe(original.usage.quantity);
      expect(reconstructed.description).toBe(original.description);
      expect(reconstructed.metadata).toEqual(original.metadata);
    });
  });

  describe('generateId', () => {
    it('should generate an ID with timestamp prefix', () => {
      const timestamp = new Date('2026-01-30T14:30:22Z');
      const id = CostEntry.generateId(timestamp);

      expect(id).toMatch(/^20260130143022-[a-z0-9]{6}$/);
    });

    it('should generate unique IDs for the same timestamp', () => {
      const timestamp = new Date('2026-01-30T14:30:22Z');
      const id1 = CostEntry.generateId(timestamp);
      const id2 = CostEntry.generateId(timestamp);

      // The random suffix should make them unique (with high probability)
      expect(id1).not.toBe(id2);
    });

    it('should use current time if no timestamp provided', () => {
      const before = new Date();
      const id = CostEntry.generateId();
      const after = new Date();

      // Extract the timestamp part (first 14 characters before the dash)
      const timestampPart = id.split('-')[0];

      // The timestamp should be between before and after
      expect(timestampPart.length).toBe(14);
      expect(id).toMatch(/^\d{14}-[a-z0-9]{6}$/);
    });
  });
});
