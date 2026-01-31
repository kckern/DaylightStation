import { describe, it, expect, beforeEach } from 'vitest';
import { CostAnalysisService } from '#domains/cost/services/CostAnalysisService.mjs';
import { CostEntry } from '#domains/cost/entities/CostEntry.mjs';
import { Money } from '#domains/cost/value-objects/Money.mjs';
import { CostCategory } from '#domains/cost/value-objects/CostCategory.mjs';
import { Attribution } from '#domains/cost/value-objects/Attribution.mjs';
import { EntryType } from '#domains/cost/value-objects/EntryType.mjs';

describe('CostAnalysisService', () => {
  let service;
  let entries;

  // Helper to create test entries
  function createEntry(overrides = {}) {
    const defaults = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      occurredAt: new Date('2026-01-15T10:00:00Z'),
      amount: new Money(10),
      category: CostCategory.fromString('ai/openai/gpt-4o'),
      entryType: EntryType.USAGE,
      attribution: new Attribution({ householdId: 'default' })
    };

    return new CostEntry({ ...defaults, ...overrides });
  }

  beforeEach(() => {
    service = new CostAnalysisService();
    entries = [];
  });

  describe('filterForSpend', () => {
    it('should return entries where countsInSpend is true', () => {
      const usageEntry = createEntry({ id: 'entry-1', entryType: EntryType.USAGE });
      const subscriptionEntry = createEntry({ id: 'entry-2', entryType: EntryType.SUBSCRIPTION });
      const purchaseEntry = createEntry({ id: 'entry-3', entryType: EntryType.PURCHASE });
      const transactionEntry = createEntry({ id: 'entry-4', entryType: EntryType.TRANSACTION });

      entries = [usageEntry, subscriptionEntry, purchaseEntry, transactionEntry];

      const result = service.filterForSpend(entries);

      expect(result).toHaveLength(3);
      expect(result).toContain(usageEntry);
      expect(result).toContain(subscriptionEntry);
      expect(result).toContain(purchaseEntry);
      expect(result).not.toContain(transactionEntry);
    });

    it('should exclude entries with reconcilesUsage=true', () => {
      const normalEntry = createEntry({ id: 'entry-1', entryType: EntryType.USAGE });
      const reconciliationEntry = createEntry({
        id: 'entry-2',
        entryType: EntryType.USAGE,
        reconcilesUsage: true
      });

      entries = [normalEntry, reconciliationEntry];

      const result = service.filterForSpend(entries);

      expect(result).toHaveLength(1);
      expect(result).toContain(normalEntry);
      expect(result).not.toContain(reconciliationEntry);
    });

    it('should return empty array for empty input', () => {
      const result = service.filterForSpend([]);
      expect(result).toEqual([]);
    });

    it('should return empty array when all entries are excluded', () => {
      const transactionEntry = createEntry({ id: 'entry-1', entryType: EntryType.TRANSACTION });
      const reconciliationEntry = createEntry({
        id: 'entry-2',
        entryType: EntryType.USAGE,
        reconcilesUsage: true
      });

      entries = [transactionEntry, reconciliationEntry];

      const result = service.filterForSpend(entries);
      expect(result).toEqual([]);
    });
  });

  describe('calculateSpend', () => {
    it('should calculate total spend from entries', () => {
      entries = [
        createEntry({ id: 'entry-1', amount: new Money(10) }),
        createEntry({ id: 'entry-2', amount: new Money(20.50) }),
        createEntry({ id: 'entry-3', amount: new Money(5.25) })
      ];

      const result = service.calculateSpend(entries);

      expect(result.amount).toBe(35.75);
      expect(result.currency).toBe('USD');
    });

    it('should exclude entries that do not count in spend', () => {
      entries = [
        createEntry({ id: 'entry-1', amount: new Money(10), entryType: EntryType.USAGE }),
        createEntry({ id: 'entry-2', amount: new Money(20), entryType: EntryType.TRANSACTION }),
        createEntry({ id: 'entry-3', amount: new Money(5), entryType: EntryType.USAGE, reconcilesUsage: true })
      ];

      const result = service.calculateSpend(entries);

      expect(result.amount).toBe(10);
    });

    it('should filter by category when provided', () => {
      entries = [
        createEntry({
          id: 'entry-1',
          amount: new Money(10),
          category: CostCategory.fromString('ai/openai/gpt-4o')
        }),
        createEntry({
          id: 'entry-2',
          amount: new Money(20),
          category: CostCategory.fromString('ai/anthropic/claude')
        }),
        createEntry({
          id: 'entry-3',
          amount: new Money(30),
          category: CostCategory.fromString('energy/electricity')
        })
      ];

      const aiCategory = CostCategory.fromString('ai');
      const result = service.calculateSpend(entries, { category: aiCategory });

      expect(result.amount).toBe(30); // 10 + 20 from AI entries
    });

    it('should return Money.zero() for empty entries', () => {
      const result = service.calculateSpend([]);

      expect(result.amount).toBe(0);
      expect(result.currency).toBe('USD');
    });

    it('should return Money.zero() when no entries match category', () => {
      entries = [
        createEntry({
          id: 'entry-1',
          amount: new Money(10),
          category: CostCategory.fromString('ai/openai')
        })
      ];

      const energyCategory = CostCategory.fromString('energy');
      const result = service.calculateSpend(entries, { category: energyCategory });

      expect(result.amount).toBe(0);
    });
  });

  describe('getCategoryBreakdown', () => {
    beforeEach(() => {
      entries = [
        createEntry({
          id: 'entry-1',
          amount: new Money(10),
          category: CostCategory.fromString('ai/openai/gpt-4o')
        }),
        createEntry({
          id: 'entry-2',
          amount: new Money(20),
          category: CostCategory.fromString('ai/anthropic/claude')
        }),
        createEntry({
          id: 'entry-3',
          amount: new Money(30),
          category: CostCategory.fromString('energy/electricity')
        }),
        createEntry({
          id: 'entry-4',
          amount: new Money(15),
          category: CostCategory.fromString('ai/openai/whisper')
        })
      ];
    });

    it('should breakdown by root category at depth=1', () => {
      const result = service.getCategoryBreakdown(entries, 1);

      expect(result.get('ai')).toBe(45); // 10 + 20 + 15
      expect(result.get('energy')).toBe(30);
    });

    it('should breakdown by subcategory at depth=2', () => {
      const result = service.getCategoryBreakdown(entries, 2);

      expect(result.get('ai/openai')).toBe(25); // 10 + 15
      expect(result.get('ai/anthropic')).toBe(20);
      expect(result.get('energy/electricity')).toBe(30);
    });

    it('should breakdown by full path at depth=3', () => {
      const result = service.getCategoryBreakdown(entries, 3);

      expect(result.get('ai/openai/gpt-4o')).toBe(10);
      expect(result.get('ai/openai/whisper')).toBe(15);
      expect(result.get('ai/anthropic/claude')).toBe(20);
      expect(result.get('energy/electricity')).toBe(30);
    });

    it('should exclude non-spend entries', () => {
      entries.push(createEntry({
        id: 'entry-5',
        amount: new Money(100),
        category: CostCategory.fromString('ai/openai'),
        entryType: EntryType.TRANSACTION
      }));

      const result = service.getCategoryBreakdown(entries, 1);

      expect(result.get('ai')).toBe(45); // Transaction entry excluded
    });

    it('should return empty Map for empty entries', () => {
      const result = service.getCategoryBreakdown([], 1);
      expect(result.size).toBe(0);
    });

    it('should use path up to depth when category is shorter', () => {
      const shortCategoryEntry = createEntry({
        id: 'entry-short',
        amount: new Money(5),
        category: CostCategory.fromString('misc')
      });
      entries.push(shortCategoryEntry);

      const result = service.getCategoryBreakdown(entries, 3);

      // 'misc' only has depth 1, so at depth=3 it should still be just 'misc'
      expect(result.get('misc')).toBe(5);
    });
  });

  describe('getUserBreakdown', () => {
    it('should breakdown spend by userId', () => {
      entries = [
        createEntry({
          id: 'entry-1',
          amount: new Money(10),
          attribution: new Attribution({ householdId: 'default', userId: 'teen' })
        }),
        createEntry({
          id: 'entry-2',
          amount: new Money(20),
          attribution: new Attribution({ householdId: 'default', userId: 'dad' })
        }),
        createEntry({
          id: 'entry-3',
          amount: new Money(15),
          attribution: new Attribution({ householdId: 'default', userId: 'teen' })
        })
      ];

      const result = service.getUserBreakdown(entries);

      expect(result.get('teen')).toBe(25); // 10 + 15
      expect(result.get('dad')).toBe(20);
    });

    it('should use "system" for entries without userId', () => {
      entries = [
        createEntry({
          id: 'entry-1',
          amount: new Money(10),
          attribution: new Attribution({ householdId: 'default', userId: 'teen' })
        }),
        createEntry({
          id: 'entry-2',
          amount: new Money(20),
          attribution: new Attribution({ householdId: 'default' }) // No userId
        })
      ];

      const result = service.getUserBreakdown(entries);

      expect(result.get('teen')).toBe(10);
      expect(result.get('system')).toBe(20);
    });

    it('should exclude non-spend entries', () => {
      entries = [
        createEntry({
          id: 'entry-1',
          amount: new Money(10),
          attribution: new Attribution({ householdId: 'default', userId: 'teen' })
        }),
        createEntry({
          id: 'entry-2',
          amount: new Money(100),
          entryType: EntryType.TRANSACTION,
          attribution: new Attribution({ householdId: 'default', userId: 'teen' })
        })
      ];

      const result = service.getUserBreakdown(entries);

      expect(result.get('teen')).toBe(10);
    });

    it('should return empty Map for empty entries', () => {
      const result = service.getUserBreakdown([]);
      expect(result.size).toBe(0);
    });
  });

  describe('getFeatureBreakdown', () => {
    it('should breakdown spend by feature', () => {
      entries = [
        createEntry({
          id: 'entry-1',
          amount: new Money(10),
          attribution: new Attribution({ householdId: 'default', feature: 'assistant' })
        }),
        createEntry({
          id: 'entry-2',
          amount: new Money(20),
          attribution: new Attribution({ householdId: 'default', feature: 'transcription' })
        }),
        createEntry({
          id: 'entry-3',
          amount: new Money(15),
          attribution: new Attribution({ householdId: 'default', feature: 'assistant' })
        })
      ];

      const result = service.getFeatureBreakdown(entries);

      expect(result.get('assistant')).toBe(25); // 10 + 15
      expect(result.get('transcription')).toBe(20);
    });

    it('should use "unattributed" for entries without feature', () => {
      entries = [
        createEntry({
          id: 'entry-1',
          amount: new Money(10),
          attribution: new Attribution({ householdId: 'default', feature: 'assistant' })
        }),
        createEntry({
          id: 'entry-2',
          amount: new Money(20),
          attribution: new Attribution({ householdId: 'default' }) // No feature
        })
      ];

      const result = service.getFeatureBreakdown(entries);

      expect(result.get('assistant')).toBe(10);
      expect(result.get('unattributed')).toBe(20);
    });

    it('should exclude non-spend entries', () => {
      entries = [
        createEntry({
          id: 'entry-1',
          amount: new Money(10),
          attribution: new Attribution({ householdId: 'default', feature: 'assistant' })
        }),
        createEntry({
          id: 'entry-2',
          amount: new Money(100),
          entryType: EntryType.TRANSACTION,
          attribution: new Attribution({ householdId: 'default', feature: 'assistant' })
        })
      ];

      const result = service.getFeatureBreakdown(entries);

      expect(result.get('assistant')).toBe(10);
    });

    it('should return empty Map for empty entries', () => {
      const result = service.getFeatureBreakdown([]);
      expect(result.size).toBe(0);
    });
  });

  describe('getResourceBreakdown', () => {
    it('should breakdown spend by resource', () => {
      entries = [
        createEntry({
          id: 'entry-1',
          amount: new Money(10),
          attribution: new Attribution({ householdId: 'default', resource: 'office_plug' })
        }),
        createEntry({
          id: 'entry-2',
          amount: new Money(20),
          attribution: new Attribution({ householdId: 'default', resource: 'server_rack' })
        }),
        createEntry({
          id: 'entry-3',
          amount: new Money(15),
          attribution: new Attribution({ householdId: 'default', resource: 'office_plug' })
        })
      ];

      const result = service.getResourceBreakdown(entries);

      expect(result.get('office_plug')).toBe(25); // 10 + 15
      expect(result.get('server_rack')).toBe(20);
    });

    it('should skip entries without resource (null resource)', () => {
      entries = [
        createEntry({
          id: 'entry-1',
          amount: new Money(10),
          attribution: new Attribution({ householdId: 'default', resource: 'office_plug' })
        }),
        createEntry({
          id: 'entry-2',
          amount: new Money(20),
          attribution: new Attribution({ householdId: 'default' }) // No resource
        })
      ];

      const result = service.getResourceBreakdown(entries);

      expect(result.get('office_plug')).toBe(10);
      expect(result.has('null')).toBe(false);
      expect(result.size).toBe(1);
    });

    it('should exclude non-spend entries', () => {
      entries = [
        createEntry({
          id: 'entry-1',
          amount: new Money(10),
          attribution: new Attribution({ householdId: 'default', resource: 'office_plug' })
        }),
        createEntry({
          id: 'entry-2',
          amount: new Money(100),
          entryType: EntryType.TRANSACTION,
          attribution: new Attribution({ householdId: 'default', resource: 'office_plug' })
        })
      ];

      const result = service.getResourceBreakdown(entries);

      expect(result.get('office_plug')).toBe(10);
    });

    it('should return empty Map for empty entries', () => {
      const result = service.getResourceBreakdown([]);
      expect(result.size).toBe(0);
    });
  });

  describe('getTagBreakdown', () => {
    it('should breakdown spend by specific tag value', () => {
      entries = [
        createEntry({
          id: 'entry-1',
          amount: new Money(10),
          attribution: new Attribution({
            householdId: 'default',
            tags: { room: 'office', device_type: 'computer' }
          })
        }),
        createEntry({
          id: 'entry-2',
          amount: new Money(20),
          attribution: new Attribution({
            householdId: 'default',
            tags: { room: 'bedroom', device_type: 'lamp' }
          })
        }),
        createEntry({
          id: 'entry-3',
          amount: new Money(15),
          attribution: new Attribution({
            householdId: 'default',
            tags: { room: 'office', device_type: 'monitor' }
          })
        })
      ];

      const result = service.getTagBreakdown(entries, 'room');

      expect(result.get('office')).toBe(25); // 10 + 15
      expect(result.get('bedroom')).toBe(20);
    });

    it('should skip entries without the specified tag', () => {
      entries = [
        createEntry({
          id: 'entry-1',
          amount: new Money(10),
          attribution: new Attribution({
            householdId: 'default',
            tags: { room: 'office' }
          })
        }),
        createEntry({
          id: 'entry-2',
          amount: new Money(20),
          attribution: new Attribution({
            householdId: 'default',
            tags: { device_type: 'lamp' } // No 'room' tag
          })
        }),
        createEntry({
          id: 'entry-3',
          amount: new Money(15),
          attribution: new Attribution({ householdId: 'default' }) // No tags at all
        })
      ];

      const result = service.getTagBreakdown(entries, 'room');

      expect(result.get('office')).toBe(10);
      expect(result.size).toBe(1); // Only entries with 'room' tag
    });

    it('should exclude non-spend entries', () => {
      entries = [
        createEntry({
          id: 'entry-1',
          amount: new Money(10),
          attribution: new Attribution({
            householdId: 'default',
            tags: { room: 'office' }
          })
        }),
        createEntry({
          id: 'entry-2',
          amount: new Money(100),
          entryType: EntryType.TRANSACTION,
          attribution: new Attribution({
            householdId: 'default',
            tags: { room: 'office' }
          })
        })
      ];

      const result = service.getTagBreakdown(entries, 'room');

      expect(result.get('office')).toBe(10);
    });

    it('should return empty Map for empty entries', () => {
      const result = service.getTagBreakdown([], 'room');
      expect(result.size).toBe(0);
    });

    it('should return empty Map when no entries have the specified tag', () => {
      entries = [
        createEntry({
          id: 'entry-1',
          amount: new Money(10),
          attribution: new Attribution({
            householdId: 'default',
            tags: { device_type: 'computer' }
          })
        })
      ];

      const result = service.getTagBreakdown(entries, 'room');
      expect(result.size).toBe(0);
    });
  });

  describe('stateless service', () => {
    it('should not require constructor dependencies', () => {
      const service1 = new CostAnalysisService();
      const service2 = new CostAnalysisService();

      // Both should work identically with the same input
      const testEntries = [createEntry({ id: 'test', amount: new Money(10) })];

      expect(service1.calculateSpend(testEntries).amount).toBe(10);
      expect(service2.calculateSpend(testEntries).amount).toBe(10);
    });
  });
});
