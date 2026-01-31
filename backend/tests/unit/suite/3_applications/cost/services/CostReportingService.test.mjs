import { describe, it, expect, beforeEach, vi } from 'vitest';
import { CostReportingService } from '#applications/cost/services/CostReportingService.mjs';
import { CostBudgetService } from '#applications/cost/services/CostBudgetService.mjs';
import { CostAnalysisService } from '#domains/cost/services/CostAnalysisService.mjs';
import { CostEntry } from '#domains/cost/entities/CostEntry.mjs';
import { Money } from '#domains/cost/value-objects/Money.mjs';
import { CostCategory } from '#domains/cost/value-objects/CostCategory.mjs';
import { Attribution } from '#domains/cost/value-objects/Attribution.mjs';
import { EntryType } from '#domains/cost/value-objects/EntryType.mjs';

describe('CostReportingService', () => {
  let mockCostRepository;
  let mockBudgetService;
  let mockLogger;
  let service;

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
    mockCostRepository = {
      findByPeriod: vi.fn().mockResolvedValue([]),
      findByCategory: vi.fn().mockResolvedValue([]),
      findByAttribution: vi.fn().mockResolvedValue([]),
      save: vi.fn().mockResolvedValue(undefined)
    };

    mockBudgetService = {
      evaluateBudgets: vi.fn().mockResolvedValue([])
    };

    mockLogger = {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn()
    };
  });

  describe('constructor', () => {
    it('should require costRepository', () => {
      expect(() => new CostReportingService({
        budgetService: mockBudgetService
      })).toThrow('costRepository is required');
    });

    it('should accept optional budgetService', () => {
      const service = new CostReportingService({
        costRepository: mockCostRepository,
        budgetService: mockBudgetService,
        logger: mockLogger
      });

      expect(service).toBeInstanceOf(CostReportingService);
    });

    it('should work without budgetService', () => {
      const service = new CostReportingService({
        costRepository: mockCostRepository,
        logger: mockLogger
      });

      expect(service).toBeInstanceOf(CostReportingService);
    });

    it('should accept optional analysisService', () => {
      const customAnalysisService = new CostAnalysisService();

      const service = new CostReportingService({
        costRepository: mockCostRepository,
        analysisService: customAnalysisService,
        logger: mockLogger
      });

      expect(service).toBeInstanceOf(CostReportingService);
    });

    it('should create analysisService if not provided', () => {
      const service = new CostReportingService({
        costRepository: mockCostRepository,
        logger: mockLogger
      });

      expect(service).toBeInstanceOf(CostReportingService);
    });

    it('should default logger to console', () => {
      // Should not throw
      const service = new CostReportingService({
        costRepository: mockCostRepository
      });

      expect(service).toBeInstanceOf(CostReportingService);
    });
  });

  describe('getDashboard', () => {
    beforeEach(() => {
      service = new CostReportingService({
        costRepository: mockCostRepository,
        budgetService: mockBudgetService,
        logger: mockLogger
      });
    });

    it('should return dashboard summary with period', async () => {
      const period = {
        start: new Date('2026-01-01'),
        end: new Date('2026-01-31')
      };

      const result = await service.getDashboard('default', period);

      expect(result.period).toEqual(period);
    });

    it('should calculate total spend from entries', async () => {
      const period = {
        start: new Date('2026-01-01'),
        end: new Date('2026-01-31')
      };

      const entries = [
        createEntry({ amount: new Money(25) }),
        createEntry({ amount: new Money(35) }),
        createEntry({ amount: new Money(40) })
      ];
      mockCostRepository.findByPeriod.mockResolvedValue(entries);

      const result = await service.getDashboard('default', period);

      expect(result.totalSpend).toBe(100);
    });

    it('should include category breakdown as object', async () => {
      const period = {
        start: new Date('2026-01-01'),
        end: new Date('2026-01-31')
      };

      const entries = [
        createEntry({
          amount: new Money(50),
          category: CostCategory.fromString('ai/openai')
        }),
        createEntry({
          amount: new Money(30),
          category: CostCategory.fromString('energy/electricity')
        })
      ];
      mockCostRepository.findByPeriod.mockResolvedValue(entries);

      const result = await service.getDashboard('default', period);

      expect(result.categoryBreakdown).toBeTypeOf('object');
      expect(result.categoryBreakdown['ai']).toBe(50);
      expect(result.categoryBreakdown['energy']).toBe(30);
    });

    it('should include budget statuses when budgetService is available', async () => {
      const period = {
        start: new Date('2026-01-01'),
        end: new Date('2026-01-31')
      };

      const budgetStatuses = [
        { budgetId: 'budget-1', spent: 50, limit: 100, percentSpent: 50 }
      ];
      mockBudgetService.evaluateBudgets.mockResolvedValue(budgetStatuses);

      const result = await service.getDashboard('default', period);

      expect(result.budgetStatuses).toEqual(budgetStatuses);
    });

    it('should return empty budget statuses when budgetService is null', async () => {
      service = new CostReportingService({
        costRepository: mockCostRepository,
        budgetService: null,
        logger: mockLogger
      });

      const period = {
        start: new Date('2026-01-01'),
        end: new Date('2026-01-31')
      };

      const result = await service.getDashboard('default', period);

      expect(result.budgetStatuses).toEqual([]);
    });

    it('should include entry count', async () => {
      const period = {
        start: new Date('2026-01-01'),
        end: new Date('2026-01-31')
      };

      const entries = [
        createEntry({ amount: new Money(25) }),
        createEntry({ amount: new Money(35) })
      ];
      mockCostRepository.findByPeriod.mockResolvedValue(entries);

      const result = await service.getDashboard('default', period);

      expect(result.entryCount).toBe(2);
    });

    it('should query repository with correct period', async () => {
      const period = {
        start: new Date('2026-01-01'),
        end: new Date('2026-01-31')
      };

      await service.getDashboard('default', period);

      expect(mockCostRepository.findByPeriod).toHaveBeenCalledWith(
        period.start,
        period.end,
        expect.objectContaining({ householdId: 'default' })
      );
    });
  });

  describe('getSpendByCategory', () => {
    beforeEach(() => {
      service = new CostReportingService({
        costRepository: mockCostRepository,
        logger: mockLogger
      });
    });

    it('should return array of category amounts sorted by amount desc', async () => {
      const period = {
        start: new Date('2026-01-01'),
        end: new Date('2026-01-31')
      };

      const entries = [
        createEntry({
          amount: new Money(30),
          category: CostCategory.fromString('ai/openai')
        }),
        createEntry({
          amount: new Money(50),
          category: CostCategory.fromString('energy/electricity')
        }),
        createEntry({
          amount: new Money(20),
          category: CostCategory.fromString('subscriptions/netflix')
        })
      ];
      mockCostRepository.findByPeriod.mockResolvedValue(entries);

      const result = await service.getSpendByCategory('default', period);

      expect(result).toHaveLength(3);
      // Sorted by amount desc
      expect(result[0].amount).toBe(50);
      expect(result[1].amount).toBe(30);
      expect(result[2].amount).toBe(20);
    });

    it('should use depth parameter for category path', async () => {
      const period = {
        start: new Date('2026-01-01'),
        end: new Date('2026-01-31')
      };

      const entries = [
        createEntry({
          amount: new Money(30),
          category: CostCategory.fromString('ai/openai/gpt-4o')
        }),
        createEntry({
          amount: new Money(20),
          category: CostCategory.fromString('ai/openai/whisper')
        })
      ];
      mockCostRepository.findByPeriod.mockResolvedValue(entries);

      // Depth 1 - should aggregate under 'ai'
      const resultDepth1 = await service.getSpendByCategory('default', period, 1);
      expect(resultDepth1).toHaveLength(1);
      expect(resultDepth1[0].category).toBe('ai');
      expect(resultDepth1[0].amount).toBe(50);

      // Depth 2 - should aggregate under 'ai/openai'
      const resultDepth2 = await service.getSpendByCategory('default', period, 2);
      expect(resultDepth2).toHaveLength(1);
      expect(resultDepth2[0].category).toBe('ai/openai');
      expect(resultDepth2[0].amount).toBe(50);
    });

    it('should default to depth 2', async () => {
      const period = {
        start: new Date('2026-01-01'),
        end: new Date('2026-01-31')
      };

      const entries = [
        createEntry({
          amount: new Money(50),
          category: CostCategory.fromString('ai/openai/gpt-4o')
        })
      ];
      mockCostRepository.findByPeriod.mockResolvedValue(entries);

      const result = await service.getSpendByCategory('default', period);

      expect(result[0].category).toBe('ai/openai');
    });
  });

  describe('getSpendByUser', () => {
    beforeEach(() => {
      service = new CostReportingService({
        costRepository: mockCostRepository,
        logger: mockLogger
      });
    });

    it('should return array of user amounts sorted by amount desc', async () => {
      const period = {
        start: new Date('2026-01-01'),
        end: new Date('2026-01-31')
      };

      const entries = [
        createEntry({
          amount: new Money(30),
          attribution: new Attribution({ householdId: 'default', userId: 'user-1' })
        }),
        createEntry({
          amount: new Money(50),
          attribution: new Attribution({ householdId: 'default', userId: 'user-2' })
        }),
        createEntry({
          amount: new Money(20),
          attribution: new Attribution({ householdId: 'default', userId: 'user-1' })
        })
      ];
      mockCostRepository.findByPeriod.mockResolvedValue(entries);

      const result = await service.getSpendByUser('default', period);

      expect(result).toHaveLength(2);
      // user-1 has 50 total (30+20), user-2 has 50
      expect(result[0].amount).toBe(50);
      expect(result[1].amount).toBe(50);
    });

    it('should use system for entries without userId', async () => {
      const period = {
        start: new Date('2026-01-01'),
        end: new Date('2026-01-31')
      };

      const entries = [
        createEntry({
          amount: new Money(30),
          attribution: new Attribution({ householdId: 'default' }) // no userId
        })
      ];
      mockCostRepository.findByPeriod.mockResolvedValue(entries);

      const result = await service.getSpendByUser('default', period);

      expect(result).toHaveLength(1);
      expect(result[0].userId).toBe('system');
      expect(result[0].amount).toBe(30);
    });
  });

  describe('getSpendByResource', () => {
    beforeEach(() => {
      service = new CostReportingService({
        costRepository: mockCostRepository,
        logger: mockLogger
      });
    });

    it('should return array of resource amounts sorted by amount desc', async () => {
      const period = {
        start: new Date('2026-01-01'),
        end: new Date('2026-01-31')
      };

      const entries = [
        createEntry({
          amount: new Money(30),
          attribution: new Attribution({ householdId: 'default', resource: 'gpt-4o' })
        }),
        createEntry({
          amount: new Money(50),
          attribution: new Attribution({ householdId: 'default', resource: 'claude-3-opus' })
        }),
        createEntry({
          amount: new Money(20),
          attribution: new Attribution({ householdId: 'default', resource: 'gpt-4o' })
        })
      ];
      mockCostRepository.findByPeriod.mockResolvedValue(entries);

      const result = await service.getSpendByResource('default', period);

      expect(result).toHaveLength(2);
      // claude-3-opus has 50, gpt-4o has 50 (30+20)
      expect(result[0].amount).toBe(50);
      expect(result[1].amount).toBe(50);
    });

    it('should skip entries without resource', async () => {
      const period = {
        start: new Date('2026-01-01'),
        end: new Date('2026-01-31')
      };

      const entries = [
        createEntry({
          amount: new Money(30),
          attribution: new Attribution({ householdId: 'default', resource: 'gpt-4o' })
        }),
        createEntry({
          amount: new Money(50),
          attribution: new Attribution({ householdId: 'default' }) // no resource
        })
      ];
      mockCostRepository.findByPeriod.mockResolvedValue(entries);

      const result = await service.getSpendByResource('default', period);

      expect(result).toHaveLength(1);
      expect(result[0].resource).toBe('gpt-4o');
      expect(result[0].amount).toBe(30);
    });
  });

  describe('getEntries', () => {
    beforeEach(() => {
      service = new CostReportingService({
        costRepository: mockCostRepository,
        logger: mockLogger
      });
    });

    it('should return paginated entries with toJSON', async () => {
      const entries = [
        createEntry({ id: 'entry-1', amount: new Money(25) }),
        createEntry({ id: 'entry-2', amount: new Money(35) })
      ];
      mockCostRepository.findByPeriod.mockResolvedValue(entries);

      const filter = {
        householdId: 'default',
        start: new Date('2026-01-01'),
        end: new Date('2026-01-31')
      };

      const result = await service.getEntries(filter);

      expect(result.entries).toHaveLength(2);
      expect(result.entries[0]).toHaveProperty('id', 'entry-1');
      expect(result.entries[1]).toHaveProperty('id', 'entry-2');
    });

    it('should include pagination info', async () => {
      const entries = Array.from({ length: 100 }, (_, i) =>
        createEntry({ id: `entry-${i}`, amount: new Money(10) })
      );
      mockCostRepository.findByPeriod.mockResolvedValue(entries);

      const filter = {
        householdId: 'default',
        start: new Date('2026-01-01'),
        end: new Date('2026-01-31')
      };

      const result = await service.getEntries(filter, { page: 1, limit: 50 });

      expect(result.total).toBe(100);
      expect(result.page).toBe(1);
      expect(result.limit).toBe(50);
      expect(result.entries).toHaveLength(50);
    });

    it('should respect page parameter', async () => {
      const entries = Array.from({ length: 100 }, (_, i) =>
        createEntry({ id: `entry-${i}`, amount: new Money(10) })
      );
      mockCostRepository.findByPeriod.mockResolvedValue(entries);

      const filter = {
        householdId: 'default',
        start: new Date('2026-01-01'),
        end: new Date('2026-01-31')
      };

      const result = await service.getEntries(filter, { page: 2, limit: 50 });

      expect(result.page).toBe(2);
      expect(result.entries).toHaveLength(50);
      expect(result.entries[0].id).toBe('entry-50');
    });

    it('should default to page 1 and limit 50', async () => {
      const entries = Array.from({ length: 100 }, (_, i) =>
        createEntry({ id: `entry-${i}`, amount: new Money(10) })
      );
      mockCostRepository.findByPeriod.mockResolvedValue(entries);

      const filter = {
        householdId: 'default',
        start: new Date('2026-01-01'),
        end: new Date('2026-01-31')
      };

      const result = await service.getEntries(filter);

      expect(result.page).toBe(1);
      expect(result.limit).toBe(50);
      expect(result.entries).toHaveLength(50);
    });

    it('should handle partial last page', async () => {
      const entries = Array.from({ length: 75 }, (_, i) =>
        createEntry({ id: `entry-${i}`, amount: new Money(10) })
      );
      mockCostRepository.findByPeriod.mockResolvedValue(entries);

      const filter = {
        householdId: 'default',
        start: new Date('2026-01-01'),
        end: new Date('2026-01-31')
      };

      const result = await service.getEntries(filter, { page: 2, limit: 50 });

      expect(result.total).toBe(75);
      expect(result.page).toBe(2);
      expect(result.entries).toHaveLength(25);
    });

    it('should return empty entries array for page beyond total', async () => {
      const entries = Array.from({ length: 30 }, (_, i) =>
        createEntry({ id: `entry-${i}`, amount: new Money(10) })
      );
      mockCostRepository.findByPeriod.mockResolvedValue(entries);

      const filter = {
        householdId: 'default',
        start: new Date('2026-01-01'),
        end: new Date('2026-01-31')
      };

      const result = await service.getEntries(filter, { page: 5, limit: 50 });

      expect(result.total).toBe(30);
      expect(result.page).toBe(5);
      expect(result.entries).toHaveLength(0);
    });

    it('should convert entries to JSON', async () => {
      const entries = [
        createEntry({
          id: 'entry-1',
          amount: new Money(25),
          category: CostCategory.fromString('ai/openai')
        })
      ];
      mockCostRepository.findByPeriod.mockResolvedValue(entries);

      const filter = {
        householdId: 'default',
        start: new Date('2026-01-01'),
        end: new Date('2026-01-31')
      };

      const result = await service.getEntries(filter);

      // Should be plain object, not CostEntry instance
      expect(result.entries[0]).not.toBeInstanceOf(CostEntry);
      expect(result.entries[0]).toHaveProperty('amount');
      expect(result.entries[0].amount).toHaveProperty('amount', 25);
    });
  });

  describe('error handling', () => {
    beforeEach(() => {
      service = new CostReportingService({
        costRepository: mockCostRepository,
        budgetService: mockBudgetService,
        logger: mockLogger
      });
    });

    it('should propagate repository errors', async () => {
      mockCostRepository.findByPeriod.mockRejectedValue(new Error('Database error'));

      const period = {
        start: new Date('2026-01-01'),
        end: new Date('2026-01-31')
      };

      await expect(service.getDashboard('default', period)).rejects.toThrow('Database error');
    });

    it('should handle budget service errors gracefully', async () => {
      mockBudgetService.evaluateBudgets.mockRejectedValue(new Error('Budget error'));

      const period = {
        start: new Date('2026-01-01'),
        end: new Date('2026-01-31')
      };

      // Should not throw - budget errors are logged but don't fail the dashboard
      const result = await service.getDashboard('default', period);

      expect(result.budgetStatuses).toEqual([]);
      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.stringContaining('budget'),
        expect.objectContaining({ error: expect.stringContaining('Budget error') })
      );
    });
  });
});
