import { describe, it, expect, beforeEach, vi } from 'vitest';
import { CostBudgetService } from '../../../../../../src/3_applications/cost/services/CostBudgetService.mjs';
import { CostBudget } from '../../../../../../src/1_domains/cost/entities/CostBudget.mjs';
import { CostEntry } from '../../../../../../src/1_domains/cost/entities/CostEntry.mjs';
import { CostAnalysisService } from '../../../../../../src/1_domains/cost/services/CostAnalysisService.mjs';
import { Money } from '../../../../../../src/1_domains/cost/value-objects/Money.mjs';
import { CostCategory } from '../../../../../../src/1_domains/cost/value-objects/CostCategory.mjs';
import { Attribution } from '../../../../../../src/1_domains/cost/value-objects/Attribution.mjs';
import { BudgetPeriod } from '../../../../../../src/1_domains/cost/value-objects/BudgetPeriod.mjs';
import { Thresholds } from '../../../../../../src/1_domains/cost/value-objects/Thresholds.mjs';
import { EntryType } from '../../../../../../src/1_domains/cost/value-objects/EntryType.mjs';

describe('CostBudgetService', () => {
  let mockBudgetRepository;
  let mockCostRepository;
  let mockAlertGateway;
  let mockLogger;
  let service;

  // Helper to create test budgets
  function createBudget(overrides = {}) {
    const defaults = {
      id: `budget-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      name: 'Test Budget',
      category: CostCategory.fromString('ai/openai'),
      period: new BudgetPeriod('monthly'),
      amount: new Money(100),
      thresholds: new Thresholds({ warning: 0.8, critical: 0.95 }),
      householdId: 'default'
    };

    return new CostBudget({ ...defaults, ...overrides });
  }

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
    // Reset mocks
    mockBudgetRepository = {
      findAll: vi.fn().mockResolvedValue([]),
      findByCategory: vi.fn().mockResolvedValue([]),
      save: vi.fn().mockResolvedValue(undefined)
    };

    mockCostRepository = {
      findByPeriod: vi.fn().mockResolvedValue([]),
      findByCategory: vi.fn().mockResolvedValue([]),
      save: vi.fn().mockResolvedValue(undefined)
    };

    mockAlertGateway = {
      sendAlert: vi.fn().mockResolvedValue(undefined)
    };

    mockLogger = {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn()
    };
  });

  describe('constructor', () => {
    it('should require budgetRepository', () => {
      expect(() => new CostBudgetService({
        costRepository: mockCostRepository
      })).toThrow('budgetRepository is required');
    });

    it('should require costRepository', () => {
      expect(() => new CostBudgetService({
        budgetRepository: mockBudgetRepository
      })).toThrow('costRepository is required');
    });

    it('should accept optional alertGateway as null', () => {
      const service = new CostBudgetService({
        budgetRepository: mockBudgetRepository,
        costRepository: mockCostRepository,
        alertGateway: null,
        logger: mockLogger
      });

      expect(service).toBeInstanceOf(CostBudgetService);
    });

    it('should accept optional analysisService', () => {
      const customAnalysisService = new CostAnalysisService();

      const service = new CostBudgetService({
        budgetRepository: mockBudgetRepository,
        costRepository: mockCostRepository,
        analysisService: customAnalysisService,
        logger: mockLogger
      });

      expect(service).toBeInstanceOf(CostBudgetService);
    });

    it('should create analysisService if not provided', () => {
      const service = new CostBudgetService({
        budgetRepository: mockBudgetRepository,
        costRepository: mockCostRepository,
        logger: mockLogger
      });

      expect(service).toBeInstanceOf(CostBudgetService);
    });

    it('should default logger to console', () => {
      // Should not throw
      const service = new CostBudgetService({
        budgetRepository: mockBudgetRepository,
        costRepository: mockCostRepository
      });

      expect(service).toBeInstanceOf(CostBudgetService);
    });
  });

  describe('evaluateBudgets', () => {
    beforeEach(() => {
      service = new CostBudgetService({
        budgetRepository: mockBudgetRepository,
        costRepository: mockCostRepository,
        alertGateway: mockAlertGateway,
        logger: mockLogger
      });
    });

    it('should return empty array when no budgets exist', async () => {
      mockBudgetRepository.findAll.mockResolvedValue([]);

      const result = await service.evaluateBudgets('default');

      expect(result).toEqual([]);
    });

    it('should load all budgets for household', async () => {
      const budget = createBudget({ householdId: 'my-household' });
      mockBudgetRepository.findAll.mockResolvedValue([budget]);

      await service.evaluateBudgets('my-household');

      expect(mockBudgetRepository.findAll).toHaveBeenCalledWith('my-household');
    });

    it('should evaluate each budget and return status objects', async () => {
      const budget = createBudget({
        id: 'budget-1',
        name: 'AI Budget',
        amount: new Money(100)
      });
      mockBudgetRepository.findAll.mockResolvedValue([budget]);

      // Return entries summing to $50
      const entries = [
        createEntry({ amount: new Money(30) }),
        createEntry({ amount: new Money(20) })
      ];
      mockCostRepository.findByPeriod.mockResolvedValue(entries);

      const result = await service.evaluateBudgets('default');

      expect(result).toHaveLength(1);
      expect(result[0]).toMatchObject({
        budgetId: 'budget-1',
        budgetName: 'AI Budget',
        spent: 50,
        limit: 100,
        percentSpent: 50,
        remaining: 50,
        isOverBudget: false,
        isWarning: false,
        isCritical: false
      });
    });

    it('should detect warning level correctly', async () => {
      const budget = createBudget({
        id: 'budget-1',
        amount: new Money(100),
        thresholds: new Thresholds({ warning: 0.8, critical: 0.95 })
      });
      mockBudgetRepository.findAll.mockResolvedValue([budget]);

      // Return entries summing to $85 (85% - above warning, below critical)
      const entries = [
        createEntry({ amount: new Money(85) })
      ];
      mockCostRepository.findByPeriod.mockResolvedValue(entries);

      const result = await service.evaluateBudgets('default');

      expect(result[0].isWarning).toBe(true);
      expect(result[0].isCritical).toBe(false);
    });

    it('should detect critical level correctly', async () => {
      const budget = createBudget({
        id: 'budget-1',
        amount: new Money(100),
        thresholds: new Thresholds({ warning: 0.8, critical: 0.95 })
      });
      mockBudgetRepository.findAll.mockResolvedValue([budget]);

      // Return entries summing to $96 (96% - at or above critical)
      const entries = [
        createEntry({ amount: new Money(96) })
      ];
      mockCostRepository.findByPeriod.mockResolvedValue(entries);

      const result = await service.evaluateBudgets('default');

      expect(result[0].isWarning).toBe(false); // Not warning when critical
      expect(result[0].isCritical).toBe(true);
    });

    it('should detect over budget correctly', async () => {
      const budget = createBudget({
        id: 'budget-1',
        amount: new Money(100)
      });
      mockBudgetRepository.findAll.mockResolvedValue([budget]);

      // Return entries summing to $120 (120% - over budget)
      const entries = [
        createEntry({ amount: new Money(120) })
      ];
      mockCostRepository.findByPeriod.mockResolvedValue(entries);

      const result = await service.evaluateBudgets('default');

      expect(result[0].isOverBudget).toBe(true);
      expect(result[0].spent).toBe(120);
    });

    it('should query cost repository with correct period dates', async () => {
      const budget = createBudget({
        period: new BudgetPeriod('monthly')
      });
      mockBudgetRepository.findAll.mockResolvedValue([budget]);

      // Manually check that findByPeriod is called with correct dates
      await service.evaluateBudgets('default');

      expect(mockCostRepository.findByPeriod).toHaveBeenCalled();
      const [start, end, filter] = mockCostRepository.findByPeriod.mock.calls[0];
      expect(start).toBeInstanceOf(Date);
      expect(end).toBeInstanceOf(Date);
      expect(filter).toHaveProperty('category');
    });

    it('should evaluate multiple budgets', async () => {
      const budget1 = createBudget({
        id: 'budget-1',
        name: 'AI Budget',
        category: CostCategory.fromString('ai'),
        amount: new Money(100)
      });
      const budget2 = createBudget({
        id: 'budget-2',
        name: 'Energy Budget',
        category: CostCategory.fromString('energy'),
        amount: new Money(200)
      });
      mockBudgetRepository.findAll.mockResolvedValue([budget1, budget2]);

      // Return entries with categories that match each budget
      mockCostRepository.findByPeriod
        .mockResolvedValueOnce([createEntry({
          amount: new Money(50),
          category: CostCategory.fromString('ai/openai')
        })])
        .mockResolvedValueOnce([createEntry({
          amount: new Money(80),
          category: CostCategory.fromString('energy/electricity')
        })]);

      const result = await service.evaluateBudgets('default');

      expect(result).toHaveLength(2);
      expect(result[0].budgetId).toBe('budget-1');
      expect(result[0].spent).toBe(50);
      expect(result[1].budgetId).toBe('budget-2');
      expect(result[1].spent).toBe(80);
    });

    it('should include period start and end in status', async () => {
      const budget = createBudget({
        period: new BudgetPeriod('monthly')
      });
      mockBudgetRepository.findAll.mockResolvedValue([budget]);

      const result = await service.evaluateBudgets('default');

      expect(result[0].periodStart).toBeInstanceOf(Date);
      expect(result[0].periodEnd).toBeInstanceOf(Date);
    });
  });

  describe('alert deduplication', () => {
    beforeEach(() => {
      service = new CostBudgetService({
        budgetRepository: mockBudgetRepository,
        costRepository: mockCostRepository,
        alertGateway: mockAlertGateway,
        logger: mockLogger
      });
    });

    it('should send alert when warning threshold crossed', async () => {
      const budget = createBudget({
        id: 'budget-1',
        name: 'AI Budget',
        amount: new Money(100),
        thresholds: new Thresholds({ warning: 0.8, critical: 0.95 })
      });
      mockBudgetRepository.findAll.mockResolvedValue([budget]);

      // 85% spent - at warning level
      const entries = [createEntry({ amount: new Money(85) })];
      mockCostRepository.findByPeriod.mockResolvedValue(entries);

      await service.evaluateBudgets('default');

      expect(mockAlertGateway.sendAlert).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'budget_warning',
          severity: 'warning',
          budgetId: 'budget-1',
          budgetName: 'AI Budget'
        })
      );
    });

    it('should send alert when critical threshold crossed', async () => {
      const budget = createBudget({
        id: 'budget-1',
        name: 'AI Budget',
        amount: new Money(100),
        thresholds: new Thresholds({ warning: 0.8, critical: 0.95 })
      });
      mockBudgetRepository.findAll.mockResolvedValue([budget]);

      // 96% spent - at critical level
      const entries = [createEntry({ amount: new Money(96) })];
      mockCostRepository.findByPeriod.mockResolvedValue(entries);

      await service.evaluateBudgets('default');

      expect(mockAlertGateway.sendAlert).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'budget_critical',
          severity: 'critical',
          budgetId: 'budget-1'
        })
      );
    });

    it('should not send duplicate warning alert in same period', async () => {
      const budget = createBudget({
        id: 'budget-1',
        amount: new Money(100),
        thresholds: new Thresholds({ warning: 0.8, critical: 0.95 })
      });
      mockBudgetRepository.findAll.mockResolvedValue([budget]);

      // 85% spent - at warning level
      const entries = [createEntry({ amount: new Money(85) })];
      mockCostRepository.findByPeriod.mockResolvedValue(entries);

      // First evaluation - should send alert
      await service.evaluateBudgets('default');
      expect(mockAlertGateway.sendAlert).toHaveBeenCalledTimes(1);

      // Second evaluation - should NOT send duplicate alert
      await service.evaluateBudgets('default');
      expect(mockAlertGateway.sendAlert).toHaveBeenCalledTimes(1);
    });

    it('should not send duplicate critical alert in same period', async () => {
      const budget = createBudget({
        id: 'budget-1',
        amount: new Money(100),
        thresholds: new Thresholds({ warning: 0.8, critical: 0.95 })
      });
      mockBudgetRepository.findAll.mockResolvedValue([budget]);

      // 96% spent - at critical level
      const entries = [createEntry({ amount: new Money(96) })];
      mockCostRepository.findByPeriod.mockResolvedValue(entries);

      // First evaluation - should send alert
      await service.evaluateBudgets('default');
      expect(mockAlertGateway.sendAlert).toHaveBeenCalledTimes(1);

      // Second evaluation - should NOT send duplicate
      await service.evaluateBudgets('default');
      expect(mockAlertGateway.sendAlert).toHaveBeenCalledTimes(1);
    });

    it('should send critical alert even if warning was already sent', async () => {
      const budget = createBudget({
        id: 'budget-1',
        amount: new Money(100),
        thresholds: new Thresholds({ warning: 0.8, critical: 0.95 })
      });
      mockBudgetRepository.findAll.mockResolvedValue([budget]);

      // First: 85% spent - warning level
      mockCostRepository.findByPeriod.mockResolvedValue([
        createEntry({ amount: new Money(85) })
      ]);
      await service.evaluateBudgets('default');
      expect(mockAlertGateway.sendAlert).toHaveBeenCalledTimes(1);

      // Second: 96% spent - critical level
      mockCostRepository.findByPeriod.mockResolvedValue([
        createEntry({ amount: new Money(96) })
      ]);
      await service.evaluateBudgets('default');
      expect(mockAlertGateway.sendAlert).toHaveBeenCalledTimes(2);

      // Verify the second alert was critical
      expect(mockAlertGateway.sendAlert).toHaveBeenLastCalledWith(
        expect.objectContaining({
          type: 'budget_critical',
          severity: 'critical'
        })
      );
    });

    it('should not send alert when below warning threshold', async () => {
      const budget = createBudget({
        id: 'budget-1',
        amount: new Money(100),
        thresholds: new Thresholds({ warning: 0.8, critical: 0.95 })
      });
      mockBudgetRepository.findAll.mockResolvedValue([budget]);

      // 50% spent - below warning
      const entries = [createEntry({ amount: new Money(50) })];
      mockCostRepository.findByPeriod.mockResolvedValue(entries);

      await service.evaluateBudgets('default');

      expect(mockAlertGateway.sendAlert).not.toHaveBeenCalled();
    });

    it('should not send alert when alertGateway is null', async () => {
      service = new CostBudgetService({
        budgetRepository: mockBudgetRepository,
        costRepository: mockCostRepository,
        alertGateway: null,
        logger: mockLogger
      });

      const budget = createBudget({
        id: 'budget-1',
        amount: new Money(100),
        thresholds: new Thresholds({ warning: 0.8, critical: 0.95 })
      });
      mockBudgetRepository.findAll.mockResolvedValue([budget]);

      // 96% spent - critical level
      const entries = [createEntry({ amount: new Money(96) })];
      mockCostRepository.findByPeriod.mockResolvedValue(entries);

      // Should not throw even without alertGateway
      await expect(service.evaluateBudgets('default')).resolves.toBeDefined();
    });

    it('should track alerts separately per budget', async () => {
      const budget1 = createBudget({
        id: 'budget-1',
        name: 'Budget 1',
        category: CostCategory.fromString('ai'),
        amount: new Money(100)
      });
      const budget2 = createBudget({
        id: 'budget-2',
        name: 'Budget 2',
        category: CostCategory.fromString('energy'),
        amount: new Money(100)
      });
      mockBudgetRepository.findAll.mockResolvedValue([budget1, budget2]);

      // Both at warning level (85%) - with matching categories
      mockCostRepository.findByPeriod
        .mockResolvedValueOnce([createEntry({
          amount: new Money(85),
          category: CostCategory.fromString('ai/openai')
        })])
        .mockResolvedValueOnce([createEntry({
          amount: new Money(85),
          category: CostCategory.fromString('energy/electricity')
        })]);

      // First evaluation - both should alert
      await service.evaluateBudgets('default');
      expect(mockAlertGateway.sendAlert).toHaveBeenCalledTimes(2);

      // Mock again for second call - with matching categories
      mockCostRepository.findByPeriod
        .mockResolvedValueOnce([createEntry({
          amount: new Money(85),
          category: CostCategory.fromString('ai/openai')
        })])
        .mockResolvedValueOnce([createEntry({
          amount: new Money(85),
          category: CostCategory.fromString('energy/electricity')
        })]);

      // Second evaluation - neither should alert again
      await service.evaluateBudgets('default');
      expect(mockAlertGateway.sendAlert).toHaveBeenCalledTimes(2);
    });

    it('should include spend information in alert', async () => {
      const budget = createBudget({
        id: 'budget-1',
        name: 'AI Budget',
        amount: new Money(100),
        category: CostCategory.fromString('ai/openai'),
        thresholds: new Thresholds({ warning: 0.8, critical: 0.95 })
      });
      mockBudgetRepository.findAll.mockResolvedValue([budget]);

      const entries = [createEntry({ amount: new Money(85) })];
      mockCostRepository.findByPeriod.mockResolvedValue(entries);

      await service.evaluateBudgets('default');

      expect(mockAlertGateway.sendAlert).toHaveBeenCalledWith(
        expect.objectContaining({
          currentSpend: expect.objectContaining({ amount: 85 }),
          budget: expect.objectContaining({
            id: 'budget-1',
            name: 'AI Budget'
          }),
          message: expect.stringContaining('85')
        })
      );
    });
  });

  describe('alert content', () => {
    beforeEach(() => {
      service = new CostBudgetService({
        budgetRepository: mockBudgetRepository,
        costRepository: mockCostRepository,
        alertGateway: mockAlertGateway,
        logger: mockLogger
      });
    });

    it('should include budget details in alert', async () => {
      const budget = createBudget({
        id: 'test-budget',
        name: 'Test Budget Name',
        amount: new Money(500),
        category: CostCategory.fromString('utilities/electric')
      });
      mockBudgetRepository.findAll.mockResolvedValue([budget]);
      mockCostRepository.findByPeriod.mockResolvedValue([
        createEntry({
          amount: new Money(425), // 85%
          category: CostCategory.fromString('utilities/electric/power')
        })
      ]);

      await service.evaluateBudgets('default');

      expect(mockAlertGateway.sendAlert).toHaveBeenCalledWith(
        expect.objectContaining({
          budgetId: 'test-budget',
          budgetName: 'Test Budget Name',
          budget: expect.objectContaining({
            id: 'test-budget',
            name: 'Test Budget Name'
          })
        })
      );
    });

    it('should generate meaningful message for warning', async () => {
      const budget = createBudget({
        name: 'AI Services',
        amount: new Money(100)
      });
      mockBudgetRepository.findAll.mockResolvedValue([budget]);
      mockCostRepository.findByPeriod.mockResolvedValue([
        createEntry({ amount: new Money(85) })
      ]);

      await service.evaluateBudgets('default');

      const alertCall = mockAlertGateway.sendAlert.mock.calls[0][0];
      expect(alertCall.message).toContain('AI Services');
      expect(alertCall.message).toMatch(/warning|85/i);
    });

    it('should generate meaningful message for critical', async () => {
      const budget = createBudget({
        name: 'Server Costs',
        amount: new Money(100)
      });
      mockBudgetRepository.findAll.mockResolvedValue([budget]);
      mockCostRepository.findByPeriod.mockResolvedValue([
        createEntry({ amount: new Money(96) })
      ]);

      await service.evaluateBudgets('default');

      const alertCall = mockAlertGateway.sendAlert.mock.calls[0][0];
      expect(alertCall.message).toContain('Server Costs');
      expect(alertCall.message).toMatch(/critical|96/i);
    });
  });

  describe('error handling', () => {
    beforeEach(() => {
      service = new CostBudgetService({
        budgetRepository: mockBudgetRepository,
        costRepository: mockCostRepository,
        alertGateway: mockAlertGateway,
        logger: mockLogger
      });
    });

    it('should propagate repository errors', async () => {
      mockBudgetRepository.findAll.mockRejectedValue(new Error('Database error'));

      await expect(service.evaluateBudgets('default')).rejects.toThrow('Database error');
    });

    it('should handle alert gateway errors gracefully', async () => {
      const budget = createBudget({
        id: 'budget-1',
        amount: new Money(100)
      });
      mockBudgetRepository.findAll.mockResolvedValue([budget]);
      mockCostRepository.findByPeriod.mockResolvedValue([
        createEntry({ amount: new Money(85) })
      ]);
      mockAlertGateway.sendAlert.mockRejectedValue(new Error('Alert failed'));

      // Should not throw - alert errors are logged but don't fail the evaluation
      const result = await service.evaluateBudgets('default');

      expect(result).toHaveLength(1);
      expect(mockLogger.error).toHaveBeenCalledWith(
        expect.stringContaining('alert'),
        expect.objectContaining({
          error: expect.stringContaining('Alert failed')
        })
      );
    });
  });
});
