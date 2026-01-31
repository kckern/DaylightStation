import { describe, it, expect, beforeEach, vi } from 'vitest';
import { YamlCostDatastore } from '#adapters/cost/YamlCostDatastore.mjs';
import { ICostRepository } from '#applications/cost/ports/ICostRepository.mjs';
import { CostEntry } from '#domains/cost/entities/CostEntry.mjs';
import { Money } from '#domains/cost/value-objects/Money.mjs';
import { CostCategory } from '#domains/cost/value-objects/CostCategory.mjs';
import { Attribution } from '#domains/cost/value-objects/Attribution.mjs';
import { EntryType } from '#domains/cost/value-objects/EntryType.mjs';

describe('YamlCostDatastore', () => {
  let mockIo;
  let datastore;

  // Helper to create test entries
  function createEntry(overrides = {}) {
    const defaults = {
      id: `entry-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      occurredAt: new Date('2026-01-15T10:00:00Z'),
      amount: new Money(10),
      category: CostCategory.fromString('ai/openai/gpt-4o'),
      entryType: EntryType.USAGE,
      attribution: new Attribution({ householdId: 'default' })
    };

    return new CostEntry({ ...defaults, ...overrides });
  }

  beforeEach(() => {
    // Mock IO object for file operations
    mockIo = {
      read: vi.fn().mockResolvedValue(null),
      write: vi.fn().mockResolvedValue(undefined),
      ensureDir: vi.fn().mockResolvedValue(undefined),
      exists: vi.fn().mockResolvedValue(false)
    };
  });

  describe('constructor', () => {
    it('should require dataRoot', () => {
      expect(() => new YamlCostDatastore({})).toThrow('dataRoot is required');
    });

    it('should accept dataRoot and optional io', () => {
      const datastore = new YamlCostDatastore({
        dataRoot: '/data/cost',
        io: mockIo
      });

      expect(datastore).toBeInstanceOf(YamlCostDatastore);
    });

    it('should extend ICostRepository', () => {
      const datastore = new YamlCostDatastore({
        dataRoot: '/data/cost',
        io: mockIo
      });

      expect(datastore).toBeInstanceOf(ICostRepository);
    });
  });

  describe('save', () => {
    beforeEach(() => {
      datastore = new YamlCostDatastore({
        dataRoot: '/data/cost',
        io: mockIo
      });
    });

    it('should save entry to correct month file based on occurredAt', async () => {
      const entry = createEntry({
        occurredAt: new Date('2026-01-15T10:00:00Z')
      });

      // Simulate empty file initially
      mockIo.read.mockResolvedValue(null);

      await datastore.save(entry);

      // Should ensure directory exists
      expect(mockIo.ensureDir).toHaveBeenCalledWith('/data/cost/2026-01');

      // Should write to correct file
      expect(mockIo.write).toHaveBeenCalledWith(
        '/data/cost/2026-01/entries.yml',
        expect.objectContaining({
          entries: expect.arrayContaining([
            expect.objectContaining({ id: entry.id })
          ])
        })
      );
    });

    it('should append to existing entries in file', async () => {
      const existingEntry = createEntry({
        id: 'existing-entry',
        occurredAt: new Date('2026-01-10T10:00:00Z')
      });

      const newEntry = createEntry({
        id: 'new-entry',
        occurredAt: new Date('2026-01-15T10:00:00Z')
      });

      // Simulate existing entries
      mockIo.read.mockResolvedValue({
        entries: [existingEntry.toJSON()]
      });

      await datastore.save(newEntry);

      expect(mockIo.write).toHaveBeenCalledWith(
        '/data/cost/2026-01/entries.yml',
        expect.objectContaining({
          entries: expect.arrayContaining([
            expect.objectContaining({ id: 'existing-entry' }),
            expect.objectContaining({ id: 'new-entry' })
          ])
        })
      );
    });

    it('should replace entry if same id already exists', async () => {
      const existingEntry = createEntry({
        id: 'same-id',
        occurredAt: new Date('2026-01-10T10:00:00Z'),
        amount: new Money(10)
      });

      const updatedEntry = createEntry({
        id: 'same-id',
        occurredAt: new Date('2026-01-15T10:00:00Z'),
        amount: new Money(20)
      });

      mockIo.read.mockResolvedValue({
        entries: [existingEntry.toJSON()]
      });

      await datastore.save(updatedEntry);

      const writtenData = mockIo.write.mock.calls[0][1];
      expect(writtenData.entries).toHaveLength(1);
      expect(writtenData.entries[0].amount.amount).toBe(20);
    });
  });

  describe('saveBatch', () => {
    beforeEach(() => {
      datastore = new YamlCostDatastore({
        dataRoot: '/data/cost',
        io: mockIo
      });
    });

    it('should group entries by month and save to correct files', async () => {
      const januaryEntry = createEntry({
        id: 'jan-entry',
        occurredAt: new Date('2026-01-15T10:00:00Z')
      });

      const februaryEntry = createEntry({
        id: 'feb-entry',
        occurredAt: new Date('2026-02-15T10:00:00Z')
      });

      mockIo.read.mockResolvedValue(null);

      await datastore.saveBatch([januaryEntry, februaryEntry]);

      // Should write to both month files
      expect(mockIo.write).toHaveBeenCalledTimes(2);
      expect(mockIo.ensureDir).toHaveBeenCalledWith('/data/cost/2026-01');
      expect(mockIo.ensureDir).toHaveBeenCalledWith('/data/cost/2026-02');
    });

    it('should handle empty array', async () => {
      await datastore.saveBatch([]);

      expect(mockIo.write).not.toHaveBeenCalled();
    });

    it('should aggregate multiple entries for same month', async () => {
      const entry1 = createEntry({
        id: 'entry-1',
        occurredAt: new Date('2026-01-10T10:00:00Z')
      });

      const entry2 = createEntry({
        id: 'entry-2',
        occurredAt: new Date('2026-01-20T10:00:00Z')
      });

      mockIo.read.mockResolvedValue(null);

      await datastore.saveBatch([entry1, entry2]);

      // Should write once to January file
      expect(mockIo.write).toHaveBeenCalledTimes(1);
      const writtenData = mockIo.write.mock.calls[0][1];
      expect(writtenData.entries).toHaveLength(2);
    });
  });

  describe('findByPeriod', () => {
    beforeEach(() => {
      datastore = new YamlCostDatastore({
        dataRoot: '/data/cost',
        io: mockIo
      });
    });

    it('should find entries within date range', async () => {
      const entry = createEntry({
        id: 'in-range-entry',
        occurredAt: new Date('2026-01-15T10:00:00Z')
      });

      mockIo.read.mockResolvedValue({
        entries: [entry.toJSON()]
      });

      const start = new Date('2026-01-01T00:00:00Z');
      const end = new Date('2026-01-31T23:59:59Z');

      const results = await datastore.findByPeriod(start, end);

      expect(results).toHaveLength(1);
      expect(results[0]).toBeInstanceOf(CostEntry);
      expect(results[0].id).toBe('in-range-entry');
    });

    it('should query all months in range', async () => {
      // Setup mock to return different data per path
      mockIo.read.mockImplementation(async (path) => {
        if (path.includes('2026-01')) {
          return {
            entries: [createEntry({
              id: 'jan-entry',
              occurredAt: new Date('2026-01-15T10:00:00Z')
            }).toJSON()]
          };
        }
        if (path.includes('2026-02')) {
          return {
            entries: [createEntry({
              id: 'feb-entry',
              occurredAt: new Date('2026-02-15T10:00:00Z')
            }).toJSON()]
          };
        }
        return null;
      });

      const start = new Date('2026-01-01T00:00:00Z');
      const end = new Date('2026-02-28T23:59:59Z');

      const results = await datastore.findByPeriod(start, end);

      expect(results).toHaveLength(2);
      expect(mockIo.read).toHaveBeenCalledWith('/data/cost/2026-01/entries.yml');
      expect(mockIo.read).toHaveBeenCalledWith('/data/cost/2026-02/entries.yml');
    });

    it('should filter by category using matches()', async () => {
      const aiEntry = createEntry({
        id: 'ai-entry',
        occurredAt: new Date('2026-01-15T10:00:00Z'),
        category: CostCategory.fromString('ai/openai/gpt-4o')
      });

      const energyEntry = createEntry({
        id: 'energy-entry',
        occurredAt: new Date('2026-01-15T10:00:00Z'),
        category: CostCategory.fromString('energy/electricity')
      });

      mockIo.read.mockResolvedValue({
        entries: [aiEntry.toJSON(), energyEntry.toJSON()]
      });

      const start = new Date('2026-01-01T00:00:00Z');
      const end = new Date('2026-01-31T23:59:59Z');
      const filter = { category: CostCategory.fromString('ai') };

      const results = await datastore.findByPeriod(start, end, filter);

      expect(results).toHaveLength(1);
      expect(results[0].id).toBe('ai-entry');
    });

    it('should filter by userId', async () => {
      const userEntry = createEntry({
        id: 'user-entry',
        occurredAt: new Date('2026-01-15T10:00:00Z'),
        attribution: new Attribution({ householdId: 'default', userId: 'teen' })
      });

      const systemEntry = createEntry({
        id: 'system-entry',
        occurredAt: new Date('2026-01-15T10:00:00Z'),
        attribution: new Attribution({ householdId: 'default' })
      });

      mockIo.read.mockResolvedValue({
        entries: [userEntry.toJSON(), systemEntry.toJSON()]
      });

      const start = new Date('2026-01-01T00:00:00Z');
      const end = new Date('2026-01-31T23:59:59Z');
      const filter = { userId: 'teen' };

      const results = await datastore.findByPeriod(start, end, filter);

      expect(results).toHaveLength(1);
      expect(results[0].id).toBe('user-entry');
    });

    it('should exclude reconciliation entries by default', async () => {
      const normalEntry = createEntry({
        id: 'normal-entry',
        occurredAt: new Date('2026-01-15T10:00:00Z'),
        reconcilesUsage: false
      });

      const reconciliationEntry = createEntry({
        id: 'reconciliation-entry',
        occurredAt: new Date('2026-01-15T10:00:00Z'),
        reconcilesUsage: true
      });

      mockIo.read.mockResolvedValue({
        entries: [normalEntry.toJSON(), reconciliationEntry.toJSON()]
      });

      const start = new Date('2026-01-01T00:00:00Z');
      const end = new Date('2026-01-31T23:59:59Z');

      const results = await datastore.findByPeriod(start, end);

      expect(results).toHaveLength(1);
      expect(results[0].id).toBe('normal-entry');
    });

    it('should include reconciliation entries when excludeReconciliation is false', async () => {
      const normalEntry = createEntry({
        id: 'normal-entry',
        occurredAt: new Date('2026-01-15T10:00:00Z'),
        reconcilesUsage: false
      });

      const reconciliationEntry = createEntry({
        id: 'reconciliation-entry',
        occurredAt: new Date('2026-01-15T10:00:00Z'),
        reconcilesUsage: true
      });

      mockIo.read.mockResolvedValue({
        entries: [normalEntry.toJSON(), reconciliationEntry.toJSON()]
      });

      const start = new Date('2026-01-01T00:00:00Z');
      const end = new Date('2026-01-31T23:59:59Z');
      const filter = { excludeReconciliation: false };

      const results = await datastore.findByPeriod(start, end, filter);

      expect(results).toHaveLength(2);
    });

    it('should return empty array when no entries match', async () => {
      mockIo.read.mockResolvedValue(null);

      const start = new Date('2026-01-01T00:00:00Z');
      const end = new Date('2026-01-31T23:59:59Z');

      const results = await datastore.findByPeriod(start, end);

      expect(results).toEqual([]);
    });

    it('should filter entries outside date range within same month', async () => {
      const earlyEntry = createEntry({
        id: 'early-entry',
        occurredAt: new Date('2026-01-05T10:00:00Z')
      });

      const inRangeEntry = createEntry({
        id: 'in-range-entry',
        occurredAt: new Date('2026-01-15T10:00:00Z')
      });

      const lateEntry = createEntry({
        id: 'late-entry',
        occurredAt: new Date('2026-01-25T10:00:00Z')
      });

      mockIo.read.mockResolvedValue({
        entries: [earlyEntry.toJSON(), inRangeEntry.toJSON(), lateEntry.toJSON()]
      });

      const start = new Date('2026-01-10T00:00:00Z');
      const end = new Date('2026-01-20T23:59:59Z');

      const results = await datastore.findByPeriod(start, end);

      expect(results).toHaveLength(1);
      expect(results[0].id).toBe('in-range-entry');
    });
  });

  describe('findByCategory', () => {
    beforeEach(() => {
      datastore = new YamlCostDatastore({
        dataRoot: '/data/cost',
        io: mockIo
      });
    });

    it('should delegate to findByPeriod with category filter', async () => {
      const aiEntry = createEntry({
        id: 'ai-entry',
        occurredAt: new Date('2026-01-15T10:00:00Z'),
        category: CostCategory.fromString('ai/openai/gpt-4o')
      });

      mockIo.read.mockResolvedValue({
        entries: [aiEntry.toJSON()]
      });

      const category = CostCategory.fromString('ai');
      const period = {
        start: new Date('2026-01-01T00:00:00Z'),
        end: new Date('2026-01-31T23:59:59Z')
      };

      const results = await datastore.findByCategory(category, period);

      expect(results).toHaveLength(1);
      expect(results[0].id).toBe('ai-entry');
    });
  });

  describe('findByAttribution', () => {
    beforeEach(() => {
      datastore = new YamlCostDatastore({
        dataRoot: '/data/cost',
        io: mockIo
      });
    });

    it('should filter by householdId', async () => {
      const defaultEntry = createEntry({
        id: 'default-entry',
        occurredAt: new Date('2026-01-15T10:00:00Z'),
        attribution: new Attribution({ householdId: 'default' })
      });

      const otherEntry = createEntry({
        id: 'other-entry',
        occurredAt: new Date('2026-01-15T10:00:00Z'),
        attribution: new Attribution({ householdId: 'other' })
      });

      mockIo.read.mockResolvedValue({
        entries: [defaultEntry.toJSON(), otherEntry.toJSON()]
      });

      const attribution = { householdId: 'default' };
      const period = {
        start: new Date('2026-01-01T00:00:00Z'),
        end: new Date('2026-01-31T23:59:59Z')
      };

      const results = await datastore.findByAttribution(attribution, period);

      expect(results).toHaveLength(1);
      expect(results[0].id).toBe('default-entry');
    });

    it('should filter by memberId/userId', async () => {
      const teenEntry = createEntry({
        id: 'teen-entry',
        occurredAt: new Date('2026-01-15T10:00:00Z'),
        attribution: new Attribution({ householdId: 'default', userId: 'teen' })
      });

      const parentEntry = createEntry({
        id: 'parent-entry',
        occurredAt: new Date('2026-01-15T10:00:00Z'),
        attribution: new Attribution({ householdId: 'default', userId: 'parent' })
      });

      mockIo.read.mockResolvedValue({
        entries: [teenEntry.toJSON(), parentEntry.toJSON()]
      });

      const attribution = { memberId: 'teen' };
      const period = {
        start: new Date('2026-01-01T00:00:00Z'),
        end: new Date('2026-01-31T23:59:59Z')
      };

      const results = await datastore.findByAttribution(attribution, period);

      expect(results).toHaveLength(1);
      expect(results[0].id).toBe('teen-entry');
    });
  });

  describe('compact', () => {
    beforeEach(() => {
      datastore = new YamlCostDatastore({
        dataRoot: '/data/cost',
        io: mockIo
      });
    });

    it('should return placeholder statistics', async () => {
      const olderThan = new Date('2026-01-01');

      const result = await datastore.compact(olderThan);

      expect(result).toEqual({
        entriesCompacted: 0,
        summariesCreated: 0,
        bytesReclaimed: 0
      });
    });
  });

  describe('archive', () => {
    beforeEach(() => {
      datastore = new YamlCostDatastore({
        dataRoot: '/data/cost',
        io: mockIo
      });
    });

    it('should be a placeholder that returns undefined', async () => {
      const entries = [createEntry()];

      const result = await datastore.archive(entries, '/archive/path');

      expect(result).toBeUndefined();
    });
  });

  describe('month path calculation', () => {
    beforeEach(() => {
      datastore = new YamlCostDatastore({
        dataRoot: '/data/cost',
        io: mockIo
      });
    });

    it('should use UTC month for path calculation', async () => {
      // Entry at end of January UTC
      const entry = createEntry({
        occurredAt: new Date('2026-01-31T23:59:59Z')
      });

      mockIo.read.mockResolvedValue(null);

      await datastore.save(entry);

      expect(mockIo.ensureDir).toHaveBeenCalledWith('/data/cost/2026-01');
    });

    it('should handle February edge case', async () => {
      const entry = createEntry({
        occurredAt: new Date('2026-02-01T00:00:00Z')
      });

      mockIo.read.mockResolvedValue(null);

      await datastore.save(entry);

      expect(mockIo.ensureDir).toHaveBeenCalledWith('/data/cost/2026-02');
    });
  });
});
