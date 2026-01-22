/**
 * FinanceHarvestService Tests
 */

import { jest, describe, it, expect, beforeEach } from '@jest/globals';
import { FinanceHarvestService } from '@backend/src/3_applications/finance/FinanceHarvestService.mjs';

describe('FinanceHarvestService', () => {
  let service;
  let mockTransactionSource;
  let mockFinanceStore;
  let mockCategorizationService;
  let mockCompilationService;
  let mockLogger;

  const mockBudgetConfig = {
    budget: [
      {
        timeframe: { start: '2026-01-01', end: '2026-06-30' },
        accounts: ['Checking', 'Credit'],
        closed: false
      },
      {
        timeframe: { start: '2025-07-01', end: '2025-12-31' },
        accounts: ['Checking'],
        closed: true
      }
    ],
    mortgage: {
      accounts: ['Mortgage'],
      startDate: '2020-01-01'
    }
  };

  const mockTransactions = [
    { id: '1', date: '2026-01-15', amount: 50, description: 'Grocery' },
    { id: '2', date: '2026-01-20', amount: 100, description: 'Gas' }
  ];

  const mockAccounts = [
    { name: 'Checking', balance: 5000 },
    { name: 'Credit', balance: -500 },
    { name: 'Mortgage', balance: -250000 }
  ];

  beforeEach(() => {
    mockTransactionSource = {
      getTransactions: jest.fn().mockResolvedValue(mockTransactions),
      getAccounts: jest.fn().mockResolvedValue(mockAccounts)
    };

    mockFinanceStore = {
      getBudgetConfig: jest.fn().mockReturnValue(mockBudgetConfig),
      saveTransactions: jest.fn(),
      saveAccountBalances: jest.fn(),
      saveMortgageTransactions: jest.fn(),
      getTransactions: jest.fn().mockReturnValue(mockTransactions)
    };

    mockCategorizationService = {
      categorize: jest.fn().mockResolvedValue({ processed: [], failed: [] })
    };

    mockCompilationService = {
      compile: jest.fn().mockResolvedValue({ budgets: {}, mortgage: {} })
    };

    mockLogger = {
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
      debug: jest.fn()
    };

    service = new FinanceHarvestService({
      transactionSource: mockTransactionSource,
      financeStore: mockFinanceStore,
      categorizationService: mockCategorizationService,
      compilationService: mockCompilationService,
      logger: mockLogger
    });
  });

  describe('constructor', () => {
    it('throws if transactionSource is missing', () => {
      expect(() => new FinanceHarvestService({
        financeStore: mockFinanceStore
      })).toThrow('requires transactionSource');
    });

    it('throws if financeStore is missing', () => {
      expect(() => new FinanceHarvestService({
        transactionSource: mockTransactionSource
      })).toThrow('requires financeStore');
    });

    it('works without optional services', () => {
      const svc = new FinanceHarvestService({
        transactionSource: mockTransactionSource,
        financeStore: mockFinanceStore
      });
      expect(svc).toBeDefined();
    });
  });

  describe('harvest', () => {
    it('fetches and saves transactions for open budget periods', async () => {
      const result = await service.harvest();

      expect(result.status).toBe('success');
      expect(result.details.budgetPeriods).toHaveLength(1);
      expect(result.details.budgetPeriods[0].startDate).toBe('2026-01-01');
      expect(result.details.budgetPeriods[0].transactionCount).toBe(2);
      expect(mockFinanceStore.saveTransactions).toHaveBeenCalledTimes(1);
    });

    it('skips closed budget periods', async () => {
      await service.harvest();

      // Only one saveTransactions call (for the open period)
      expect(mockFinanceStore.saveTransactions).toHaveBeenCalledTimes(1);
      expect(mockLogger.debug).toHaveBeenCalledWith('harvest.period.skipped', expect.any(Object));
    });

    it('fetches and saves account balances', async () => {
      await service.harvest();

      expect(mockFinanceStore.saveAccountBalances).toHaveBeenCalled();
      const savedBalances = mockFinanceStore.saveAccountBalances.mock.calls[0][0];
      expect(savedBalances.length).toBeGreaterThan(0);
    });

    it('fetches and saves mortgage transactions', async () => {
      await service.harvest();

      expect(mockTransactionSource.getTransactions).toHaveBeenCalledWith(
        expect.objectContaining({
          accounts: ['Mortgage'],
          startDate: '2020-01-01'
        })
      );
      expect(mockFinanceStore.saveMortgageTransactions).toHaveBeenCalled();
    });

    it('runs categorization by default', async () => {
      await service.harvest();

      expect(mockCategorizationService.categorize).toHaveBeenCalled();
    });

    it('skips categorization when option is set', async () => {
      await service.harvest(undefined, { skipCategorization: true });

      expect(mockCategorizationService.categorize).not.toHaveBeenCalled();
    });

    it('runs compilation by default', async () => {
      await service.harvest();

      expect(mockCompilationService.compile).toHaveBeenCalled();
    });

    it('skips compilation when option is set', async () => {
      await service.harvest(undefined, { skipCompilation: true });

      expect(mockCompilationService.compile).not.toHaveBeenCalled();
    });

    it('throws when budget config is not found', async () => {
      mockFinanceStore.getBudgetConfig.mockReturnValue(null);

      await expect(service.harvest()).rejects.toThrow('Budget configuration not found');
    });
  });

  describe('refreshPeriod', () => {
    it('fetches and saves transactions for a specific period', async () => {
      const result = await service.refreshPeriod(
        '2026-01-01',
        '2026-06-30',
        ['Checking', 'Credit']
      );

      expect(result.status).toBe('success');
      expect(result.transactionCount).toBe(2);
      expect(mockTransactionSource.getTransactions).toHaveBeenCalledWith({
        startDate: '2026-01-01',
        endDate: '2026-06-30',
        accounts: ['Checking', 'Credit']
      });
      expect(mockFinanceStore.saveTransactions).toHaveBeenCalledWith(
        '2026-01-01',
        mockTransactions,
        undefined
      );
    });
  });

  describe('refreshBalances', () => {
    it('fetches and saves account balances', async () => {
      const result = await service.refreshBalances(['Checking', 'Credit']);

      expect(result.status).toBe('success');
      expect(result.balances).toBeDefined();
      expect(mockFinanceStore.saveAccountBalances).toHaveBeenCalled();
    });
  });

  describe('refreshMortgage', () => {
    it('fetches and saves mortgage transactions', async () => {
      const result = await service.refreshMortgage(['Mortgage'], '2020-01-01');

      expect(result.status).toBe('success');
      expect(result.transactionCount).toBe(2);
      expect(mockFinanceStore.saveMortgageTransactions).toHaveBeenCalled();
    });
  });

  describe('categorizeAll', () => {
    it('runs categorization on all budget periods', async () => {
      mockCategorizationService.categorize.mockResolvedValue({
        processed: [{ id: '1' }, { id: '2' }],
        failed: []
      });

      const result = await service.categorizeAll();

      expect(result.processed).toBe(2);
      expect(result.failed).toBe(0);
    });

    it('throws when categorization service is not configured', async () => {
      const svc = new FinanceHarvestService({
        transactionSource: mockTransactionSource,
        financeStore: mockFinanceStore
      });

      await expect(svc.categorizeAll()).rejects.toThrow('Categorization service not configured');
    });
  });
});
