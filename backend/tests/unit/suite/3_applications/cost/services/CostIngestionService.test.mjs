import { describe, it, expect, beforeEach, vi } from 'vitest';
import { CostIngestionService } from '#applications/cost/services/CostIngestionService.mjs';
import { CostEntry } from '#domains/cost/entities/CostEntry.mjs';
import { Money } from '#domains/cost/value-objects/Money.mjs';
import { CostCategory } from '#domains/cost/value-objects/CostCategory.mjs';
import { Attribution } from '#domains/cost/value-objects/Attribution.mjs';
import { EntryType } from '#domains/cost/value-objects/EntryType.mjs';

describe('CostIngestionService', () => {
  let mockRepository;
  let mockBudgetService;
  let mockLogger;
  let mockSource;
  let service;

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
    // Reset mocks
    mockRepository = {
      save: vi.fn().mockResolvedValue(undefined),
      saveBatch: vi.fn().mockResolvedValue(undefined),
      findByPeriod: vi.fn().mockResolvedValue([])
    };

    mockBudgetService = {
      evaluateBudgets: vi.fn().mockResolvedValue(undefined)
    };

    mockLogger = {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn()
    };

    mockSource = {
      getSourceId: vi.fn().mockReturnValue('test-source'),
      getSupportedCategories: vi.fn().mockReturnValue(['ai/test']),
      fetchCosts: vi.fn().mockResolvedValue([]),
      onCost: vi.fn()
    };
  });

  describe('constructor', () => {
    it('should require costRepository', () => {
      expect(() => new CostIngestionService({
        budgetService: mockBudgetService
      })).toThrow('costRepository is required');
    });

    it('should accept optional budgetService as null', () => {
      const service = new CostIngestionService({
        costRepository: mockRepository,
        budgetService: null,
        logger: mockLogger
      });

      expect(service).toBeInstanceOf(CostIngestionService);
    });

    it('should accept sources array in constructor', () => {
      const service = new CostIngestionService({
        costRepository: mockRepository,
        sources: [mockSource],
        logger: mockLogger
      });

      // Source should be registered
      expect(mockSource.onCost).toHaveBeenCalled();
    });

    it('should default to empty sources array', () => {
      const service = new CostIngestionService({
        costRepository: mockRepository,
        logger: mockLogger
      });

      expect(service).toBeInstanceOf(CostIngestionService);
    });

    it('should default logger to console', () => {
      // Should not throw
      const service = new CostIngestionService({
        costRepository: mockRepository
      });

      expect(service).toBeInstanceOf(CostIngestionService);
    });
  });

  describe('registerSource', () => {
    beforeEach(() => {
      service = new CostIngestionService({
        costRepository: mockRepository,
        budgetService: mockBudgetService,
        logger: mockLogger
      });
    });

    it('should register source and subscribe to onCost callback', () => {
      service.registerSource(mockSource);

      expect(mockSource.onCost).toHaveBeenCalledTimes(1);
      expect(typeof mockSource.onCost.mock.calls[0][0]).toBe('function');
    });

    it('should log registration', () => {
      service.registerSource(mockSource);

      expect(mockLogger.info).toHaveBeenCalledWith(
        expect.stringContaining('source.registered'),
        expect.objectContaining({ sourceId: 'test-source' })
      );
    });

    it('should store source by sourceId', () => {
      service.registerSource(mockSource);

      // Verify by trying to reconcile - should call source's fetchCosts
      service.reconcile('test-source');

      expect(mockSource.fetchCosts).toHaveBeenCalled();
    });

    it('should handle multiple sources', () => {
      const mockSource2 = {
        getSourceId: vi.fn().mockReturnValue('second-source'),
        getSupportedCategories: vi.fn().mockReturnValue(['energy/electricity']),
        fetchCosts: vi.fn().mockResolvedValue([]),
        onCost: vi.fn()
      };

      service.registerSource(mockSource);
      service.registerSource(mockSource2);

      expect(mockSource.onCost).toHaveBeenCalledTimes(1);
      expect(mockSource2.onCost).toHaveBeenCalledTimes(1);
    });
  });

  describe('handleCostEvent', () => {
    beforeEach(() => {
      service = new CostIngestionService({
        costRepository: mockRepository,
        budgetService: mockBudgetService,
        logger: mockLogger
      });
    });

    it('should save entry to repository', async () => {
      const entry = createEntry({ id: 'test-entry-1' });

      await service.handleCostEvent(entry);

      expect(mockRepository.save).toHaveBeenCalledWith(entry);
    });

    it('should log the cost event', async () => {
      const entry = createEntry({
        id: 'test-entry-2',
        amount: new Money(25.50),
        category: CostCategory.fromString('ai/openai/gpt-4o'),
        attribution: new Attribution({ householdId: 'household-1' })
      });

      await service.handleCostEvent(entry);

      expect(mockLogger.info).toHaveBeenCalledWith(
        expect.stringContaining('cost.received'),
        expect.objectContaining({
          entryId: 'test-entry-2',
          amount: 25.50,
          category: 'ai/openai/gpt-4o',
          householdId: 'household-1'
        })
      );
    });

    it('should trigger budget evaluation when budgetService exists', async () => {
      const entry = createEntry({
        attribution: new Attribution({ householdId: 'my-household' })
      });

      await service.handleCostEvent(entry);

      expect(mockBudgetService.evaluateBudgets).toHaveBeenCalledWith('my-household');
    });

    it('should not trigger budget evaluation when budgetService is null', async () => {
      const serviceWithoutBudget = new CostIngestionService({
        costRepository: mockRepository,
        budgetService: null,
        logger: mockLogger
      });

      const entry = createEntry();

      await serviceWithoutBudget.handleCostEvent(entry);

      expect(mockRepository.save).toHaveBeenCalled();
      // No error should be thrown
    });

    it('should handle repository errors gracefully', async () => {
      mockRepository.save.mockRejectedValue(new Error('Save failed'));

      const entry = createEntry();

      await expect(service.handleCostEvent(entry)).rejects.toThrow('Save failed');
    });
  });

  describe('cost event callback from source', () => {
    beforeEach(() => {
      service = new CostIngestionService({
        costRepository: mockRepository,
        budgetService: mockBudgetService,
        logger: mockLogger
      });
    });

    it('should save entries received from source onCost callback', async () => {
      service.registerSource(mockSource);

      // Get the callback that was passed to onCost
      const callback = mockSource.onCost.mock.calls[0][0];

      const entry = createEntry({ id: 'from-source-callback' });
      await callback(entry);

      expect(mockRepository.save).toHaveBeenCalledWith(entry);
    });

    it('should trigger budget evaluation for entries from source', async () => {
      service.registerSource(mockSource);

      const callback = mockSource.onCost.mock.calls[0][0];

      const entry = createEntry({
        attribution: new Attribution({ householdId: 'source-household' })
      });
      await callback(entry);

      expect(mockBudgetService.evaluateBudgets).toHaveBeenCalledWith('source-household');
    });
  });

  describe('reconcile', () => {
    beforeEach(() => {
      service = new CostIngestionService({
        costRepository: mockRepository,
        budgetService: mockBudgetService,
        logger: mockLogger
      });
      service.registerSource(mockSource);
    });

    it('should fetch costs from specific source when sourceId provided', async () => {
      const since = new Date('2026-01-01');

      await service.reconcile('test-source', since);

      expect(mockSource.fetchCosts).toHaveBeenCalledWith(since);
    });

    it('should save fetched costs via repository.saveBatch', async () => {
      const entries = [
        createEntry({ id: 'reconciled-1' }),
        createEntry({ id: 'reconciled-2' })
      ];
      mockSource.fetchCosts.mockResolvedValue(entries);

      await service.reconcile('test-source');

      expect(mockRepository.saveBatch).toHaveBeenCalledWith(entries);
    });

    it('should log reconciliation results', async () => {
      const entries = [createEntry()];
      mockSource.fetchCosts.mockResolvedValue(entries);

      await service.reconcile('test-source');

      expect(mockLogger.info).toHaveBeenCalledWith(
        expect.stringContaining('reconcile.complete'),
        expect.objectContaining({
          sourceId: 'test-source',
          entriesCount: 1
        })
      );
    });

    it('should reconcile all sources when no sourceId provided', async () => {
      const mockSource2 = {
        getSourceId: vi.fn().mockReturnValue('second-source'),
        getSupportedCategories: vi.fn().mockReturnValue(['energy']),
        fetchCosts: vi.fn().mockResolvedValue([]),
        onCost: vi.fn()
      };

      service.registerSource(mockSource2);

      await service.reconcile();

      expect(mockSource.fetchCosts).toHaveBeenCalled();
      expect(mockSource2.fetchCosts).toHaveBeenCalled();
    });

    it('should pass since date to all sources when reconciling all', async () => {
      const mockSource2 = {
        getSourceId: vi.fn().mockReturnValue('second-source'),
        getSupportedCategories: vi.fn().mockReturnValue(['energy']),
        fetchCosts: vi.fn().mockResolvedValue([]),
        onCost: vi.fn()
      };

      service.registerSource(mockSource2);

      const since = new Date('2026-01-10');
      await service.reconcile(undefined, since);

      expect(mockSource.fetchCosts).toHaveBeenCalledWith(since);
      expect(mockSource2.fetchCosts).toHaveBeenCalledWith(since);
    });

    it('should return total entries count when reconciling all sources', async () => {
      const mockSource2 = {
        getSourceId: vi.fn().mockReturnValue('second-source'),
        getSupportedCategories: vi.fn().mockReturnValue(['energy']),
        fetchCosts: vi.fn().mockResolvedValue([createEntry({ id: 'source2-entry' })]),
        onCost: vi.fn()
      };

      mockSource.fetchCosts.mockResolvedValue([
        createEntry({ id: 'source1-entry-1' }),
        createEntry({ id: 'source1-entry-2' })
      ]);

      service.registerSource(mockSource2);

      const result = await service.reconcile();

      expect(result.totalEntries).toBe(3);
      expect(result.sources).toHaveLength(2);
    });

    it('should handle unknown sourceId gracefully', async () => {
      const result = await service.reconcile('unknown-source');

      expect(result.totalEntries).toBe(0);
      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.stringContaining('reconcile.source.unknown'),
        expect.objectContaining({ sourceId: 'unknown-source' })
      );
    });

    it('should handle empty sources gracefully', async () => {
      const emptyService = new CostIngestionService({
        costRepository: mockRepository,
        logger: mockLogger
      });

      const result = await emptyService.reconcile();

      expect(result.totalEntries).toBe(0);
      expect(result.sources).toHaveLength(0);
    });

    it('should handle source fetch errors and continue with other sources', async () => {
      mockSource.fetchCosts.mockRejectedValue(new Error('Fetch failed'));

      const mockSource2 = {
        getSourceId: vi.fn().mockReturnValue('second-source'),
        getSupportedCategories: vi.fn().mockReturnValue(['energy']),
        fetchCosts: vi.fn().mockResolvedValue([createEntry({ id: 'success-entry' })]),
        onCost: vi.fn()
      };

      service.registerSource(mockSource2);

      const result = await service.reconcile();

      expect(mockLogger.error).toHaveBeenCalledWith(
        expect.stringContaining('reconcile.source.error'),
        expect.objectContaining({
          sourceId: 'test-source',
          error: 'Fetch failed'
        })
      );
      expect(result.totalEntries).toBe(1); // Only from source2
    });
  });
});
