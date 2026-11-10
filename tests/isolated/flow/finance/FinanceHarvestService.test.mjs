/**
 * FinanceHarvestService Tests
 */

import { vi, describe, it, expect, beforeEach } from 'vitest';
import { FinanceHarvestService } from "../../../../__app_modules/money/finance/server/application/FinanceHarvestService.mjs";

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

  // Fixed clock so the fixture's 2026-06-30 period is not "finished" by the real date.
  const TODAY = '2026-07-15';

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
      getTransactions: vi.fn().mockResolvedValue(mockTransactions),
      getAccounts: vi.fn().mockResolvedValue(mockAccounts)
    };

    mockFinanceStore = {
      getBudgetConfig: vi.fn().mockReturnValue(mockBudgetConfig),
      saveTransactions: vi.fn(),
      saveAccountBalances: vi.fn(),
      saveMortgageTransactions: vi.fn(),
      getTransactions: vi.fn().mockReturnValue(mockTransactions)
    };

    mockCategorizationService = {
      categorize: vi.fn().mockResolvedValue({ processed: [], failed: [] })
    };

    mockCompilationService = {
      compile: vi.fn().mockResolvedValue({ budgets: {}, mortgage: {} })
    };

    mockLogger = {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn()
    };

    service = new FinanceHarvestService({
      transactionSource: mockTransactionSource,
      financeStore: mockFinanceStore,
      categorizationService: mockCategorizationService,
      compilationService: mockCompilationService,
      logger: mockLogger,
      today: () => TODAY
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
      mockFinanceStore.getTransactions.mockReturnValue(null); // nothing stored yet
      const result = await service.harvest();

      expect(result.status).toBe('success');
      expect(result.details.budgetPeriods).toHaveLength(1);
      expect(result.details.budgetPeriods[0].startDate).toBe('2026-01-01');
      expect(result.details.budgetPeriods[0].transactionCount).toBe(2);
      expect(mockFinanceStore.saveTransactions).toHaveBeenCalledTimes(1);
    });

    it('skips closed budget periods', async () => {
      mockFinanceStore.getTransactions.mockReturnValue(null); // nothing stored yet
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

    describe('day-to-day rebalance', () => {
      const withRebalance = (rebalanceService) => new FinanceHarvestService({
        transactionSource: mockTransactionSource,
        financeStore: mockFinanceStore,
        compilationService: mockCompilationService,
        rebalanceService,
        logger: mockLogger
      });

      it('runs after compilation and reports its result', async () => {
        const order = [];
        mockCompilationService.compile.mockImplementation(async () => { order.push('compile'); });
        const rebalanceService = { rebalance: vi.fn(async () => { order.push('rebalance'); return { moved: 2 }; }) };

        const result = await withRebalance(rebalanceService).harvest('default');

        expect(order).toEqual(['compile', 'rebalance']);
        expect(rebalanceService.rebalance).toHaveBeenCalledWith('default');
        expect(result.details.rebalance).toEqual({ moved: 2 });
      });

      it('skips when option is set, and when compilation is skipped', async () => {
        const rebalanceService = { rebalance: vi.fn() };
        await withRebalance(rebalanceService).harvest(undefined, { skipRebalance: true });
        await withRebalance(rebalanceService).harvest(undefined, { skipCompilation: true });
        expect(rebalanceService.rebalance).not.toHaveBeenCalled();
      });

      it('a rebalance failure does not fail the sync', async () => {
        const rebalanceService = { rebalance: vi.fn().mockRejectedValue(new Error('buxfer down')) };
        const result = await withRebalance(rebalanceService).harvest();
        expect(result.status).toBe('success');
        expect(result.details.rebalance).toEqual({ error: 'buxfer down' });
        expect(mockLogger.warn).toHaveBeenCalledWith('harvest.rebalance.failed', { error: 'buxfer down' });
      });
    });

    describe('finished periods', () => {
      const withToday = (today) => new FinanceHarvestService({
        transactionSource: mockTransactionSource,
        financeStore: mockFinanceStore,
        logger: mockLogger,
        today: () => today
      });
      const periodEnding = (end, start = '2025-04-01') => ({
        budget: [{ timeframe: { start, end }, accounts: ['Checking'], closed: false }]
      });

      it('does not fetch or save a period that ended long ago, and logs why', async () => {
        mockFinanceStore.getBudgetConfig.mockReturnValue({
          budget: [
            ...periodEnding('2025-03-31', '2024-04-01').budget,
            ...mockBudgetConfig.budget.slice(0, 1)
          ]
        });
        const result = await withToday('2026-11-09').harvest();

        expect(result.details.budgetPeriods).toEqual([]);
        expect(mockFinanceStore.saveTransactions).not.toHaveBeenCalled();
        expect(mockLogger.debug).toHaveBeenCalledWith('harvest.period.skipped', expect.objectContaining({ reason: 'finished' }));
      });

      it('fetches a period that ended exactly 60 days before today', async () => {
        mockFinanceStore.getBudgetConfig.mockReturnValue(periodEnding('2026-09-10'));
        mockFinanceStore.getTransactions.mockReturnValue(null);
        const result = await withToday('2026-11-09').harvest(undefined, { skipCategorization: true });
        expect(result.details.budgetPeriods).toHaveLength(1);
      });

      it('skips a period that ended 61 days before today', async () => {
        mockFinanceStore.getBudgetConfig.mockReturnValue(periodEnding('2026-09-09'));
        const result = await withToday('2026-11-09').harvest();
        expect(result.details.budgetPeriods).toEqual([]);
      });
    });

    describe('unchanged periods', () => {
      it('does not save when Buxfer returns the stored rows (any order), and reports changed:false', async () => {
        mockFinanceStore.getTransactions.mockReturnValue([...mockTransactions].reverse().map(t => ({ ...t })));
        const result = await service.harvest(undefined, { skipCategorization: true });

        expect(mockFinanceStore.saveTransactions).not.toHaveBeenCalled();
        expect(result.details.budgetPeriods[0].changed).toBe(false);
        expect(mockLogger.debug).toHaveBeenCalledWith('harvest.period.unchanged', { startDate: '2026-01-01', transactionCount: 2 });
      });

      it('saves when a row differs, and reports changed:true', async () => {
        mockFinanceStore.getTransactions.mockReturnValue([
          mockTransactions[0],
          { ...mockTransactions[1], tagNames: ['Fuel'] }
        ]);
        const result = await service.harvest(undefined, { skipCategorization: true });

        expect(mockFinanceStore.saveTransactions).toHaveBeenCalledTimes(1);
        expect(result.details.budgetPeriods[0].changed).toBe(true);
      });

      it('treats a row with reordered keys as unchanged', async () => {
        mockFinanceStore.getTransactions.mockReturnValue(mockTransactions.map(t => Object.fromEntries(Object.entries(t).reverse())));
        await service.harvest(undefined, { skipCategorization: true });
        expect(mockFinanceStore.saveTransactions).not.toHaveBeenCalled();
      });

      it('treats duplicate-id rows given in swapped order as unchanged', async () => {
        const dup = [
          { id: 7, date: '2026-01-02', description: 'Transfer', amount: -50, accountId: 1 },
          { id: 7, date: '2026-01-02', description: 'Transfer', amount: 50, accountId: 2 }
        ];
        mockTransactionSource.getTransactions.mockResolvedValue(dup);
        mockFinanceStore.getTransactions.mockReturnValue([dup[1], dup[0]].map(t => ({ ...t })));
        const result = await service.harvest(undefined, { skipCategorization: true });

        expect(mockFinanceStore.saveTransactions).not.toHaveBeenCalled();
        expect(result.details.budgetPeriods[0].changed).toBe(false);
      });

      it('saves when nothing is stored yet', async () => {
        mockFinanceStore.getTransactions.mockReturnValue(null);
        const result = await service.harvest(undefined, { skipCategorization: true });

        expect(mockFinanceStore.saveTransactions).toHaveBeenCalledTimes(1);
        expect(result.details.budgetPeriods[0].changed).toBe(true);
      });

      it('refreshPeriod skips the write when nothing changed', async () => {
        const result = await service.refreshPeriod('2026-01-01', '2026-06-30', ['Checking']);
        expect(mockFinanceStore.saveTransactions).not.toHaveBeenCalled();
        expect(result).toEqual({ status: 'success', transactionCount: 2, changed: false });
      });
    });

    describe('single-flight', () => {
      const deferred = () => { let release; const promise = new Promise(r => { release = r; }); return { promise, release }; };

      it('a second harvest while one is running joins it instead of starting another', async () => {
        const gate = deferred();
        mockTransactionSource.getTransactions.mockImplementation(async () => { await gate.promise; return mockTransactions; });

        const a = service.harvest('default');
        const b = service.harvest('default', { skipCompilation: true });
        gate.release();
        const [ra, rb] = await Promise.all([a, b]);

        // One harvest's worth: one open period + one mortgage fetch.
        expect(mockTransactionSource.getTransactions).toHaveBeenCalledTimes(2);
        expect(mockCompilationService.compile).toHaveBeenCalledTimes(1);
        expect(rb).toBe(ra);
        expect(mockLogger.info).toHaveBeenCalledWith('harvest.joined', { householdId: 'default' });
      });

      it('harvest(undefined) and harvest("default") share one flight', async () => {
        const gate = deferred();
        mockTransactionSource.getTransactions.mockImplementation(async () => { await gate.promise; return mockTransactions; });

        const a = service.harvest(undefined);
        const b = service.harvest('default');
        gate.release();
        const [ra, rb] = await Promise.all([a, b]);

        expect(mockTransactionSource.getTransactions).toHaveBeenCalledTimes(2);
        expect(rb).toBe(ra);
      });

      it('a failed in-flight harvest rejects both callers, and the next call starts fresh', async () => {
        const gate = deferred();
        mockTransactionSource.getTransactions.mockImplementationOnce(async () => { await gate.promise; throw new Error('buxfer down'); });

        const a = service.harvest('default');
        const b = service.harvest('default');
        const settled = Promise.allSettled([a, b]);
        gate.release();
        const [ra, rb] = await settled;
        expect(ra.status).toBe('rejected');
        expect(rb.status).toBe('rejected');
        expect(rb.reason).toBe(ra.reason);

        const next = await service.harvest('default');
        expect(next.status).toBe('success');
      });

      it('harvests for different households do not join', async () => {
        const gate = deferred();
        mockTransactionSource.getTransactions.mockImplementation(async () => { await gate.promise; return mockTransactions; });
        const a = service.harvest('one');
        const b = service.harvest('two');
        gate.release();
        await Promise.all([a, b]);
        expect(mockCompilationService.compile).toHaveBeenCalledTimes(2);
      });
    });

    it('throws when budget config is not found', async () => {
      mockFinanceStore.getBudgetConfig.mockReturnValue(null);

      await expect(service.harvest()).rejects.toThrow('Budget configuration');
    });
  });

  describe('refreshPeriod', () => {
    it('fetches and saves transactions for a specific period', async () => {
      mockFinanceStore.getTransactions.mockReturnValue(null); // nothing stored yet
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
  describe('settled-map pruning', () => {
    const twoPeriods = {
      budget: [
        { timeframe: { start: '2026-01-01', end: '2026-06-30' } },
        { timeframe: { start: '2026-07-01', end: '2026-12-31' } },
      ],
    };
    beforeEach(() => {
      mockFinanceStore.getBudgetConfig.mockReturnValue(twoPeriods);
      mockCategorizationService.pruneSettled = vi.fn();
    });

    it('does not prune when every period is empty or null', async () => {
      mockFinanceStore.getTransactions.mockReturnValueOnce(null).mockReturnValueOnce([]);
      await service.categorizeAll();
      expect(mockCategorizationService.pruneSettled).not.toHaveBeenCalled();
    });

    it('does not prune when one open period cannot be read', async () => {
      mockFinanceStore.getTransactions
        .mockReturnValueOnce([{ id: 'a1', description: 'x', tagNames: ['Dining'] }])
        .mockReturnValueOnce(null);
      await service.categorizeAll();
      expect(mockCategorizationService.pruneSettled).not.toHaveBeenCalled();
    });

    it('prunes once against the union of ids across periods', async () => {
      mockFinanceStore.getTransactions
        .mockReturnValueOnce([{ id: 'a1', description: 'x', tagNames: ['Dining'] }])
        .mockReturnValueOnce([{ id: 'b1', description: 'y', tagNames: ['Dining'] }]);
      await service.categorizeAll();
      expect(mockCategorizationService.pruneSettled).toHaveBeenCalledTimes(1);
      const [ids] = mockCategorizationService.pruneSettled.mock.calls[0];
      expect([...ids].sort()).toEqual(['a1', 'b1']);
    });
  });
});
