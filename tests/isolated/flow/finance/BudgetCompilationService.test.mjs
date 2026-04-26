/**
 * BudgetCompilationService Tests
 */

import { vi, describe, it, expect, beforeEach } from 'vitest';
import { BudgetCompilationService } from '#backend/src/3_applications/finance/BudgetCompilationService.mjs';

describe('BudgetCompilationService', () => {
  let service;
  let mockFinanceStore;
  let mockLogger;

  const mockBudgetConfig = {
    budget: [
      {
        timeframe: { start: '2026-01-01', end: '2026-06-30' },
        accounts: ['Checking', 'Credit'],
        income: {
          salary: {
            amount: 60000,
            payCheckCount: 24,
            payFrequencyInDays: 14,
            firstPaycheckDate: '2026-01-10'
          },
          tags: ['Income', 'Bonus'],
          extra: []
        },
        dayToDay: { amount: 800, tags: ['Groceries', 'Gas'] },
        monthly: [
          { label: 'Rent', amount: 1500, tags: ['Rent'] },
          { label: 'Utilities', amount: 200, tags: ['Utilities'] }
        ],
        shortTerm: [
          { label: 'Travel', amount: 500, flex: 1, tags: ['Travel'] },
          { label: 'Shopping', amount: 300, flex: 0.5, tags: ['Shopping'] }
        ]
      }
    ],
    mortgage: {
      mortgageStartValue: 300000,
      accountId: 'mortgage-1',
      startDate: '2020-01-01',
      interestRate: 0.065,
      minimumPayment: 2000,
      accounts: ['Mortgage'],
      paymentPlans: [
        { id: 'standard', title: 'Standard Payments' }
      ]
    }
  };

  const mockTransactions = [
    {
      id: '1',
      date: '2026-01-15',
      amount: 2500,
      expenseAmount: -2500,
      description: 'Paycheck',
      tagNames: ['Income'],
      type: 'income'
    },
    {
      id: '2',
      date: '2026-01-18',
      amount: 50,
      expenseAmount: 50,
      description: 'Walmart',
      tagNames: ['Groceries'],
      type: 'expense'
    },
    {
      id: '3',
      date: '2026-01-20',
      amount: 1500,
      expenseAmount: 1500,
      description: 'Rent payment',
      tagNames: ['Rent'],
      type: 'expense'
    }
  ];

  const mockAccountBalances = [
    { name: 'Checking', balance: 5000 },
    { name: 'Credit', balance: -500 },
    { name: 'Mortgage', balance: -250000 }
  ];

  const mockMortgageTransactions = [
    { id: 'm1', date: '2026-01-01', amount: 2000 }
  ];

  beforeEach(() => {
    mockFinanceStore = {
      getBudgetConfig: vi.fn().mockReturnValue(mockBudgetConfig),
      getTransactions: vi.fn().mockReturnValue(mockTransactions),
      getAccountBalances: vi.fn().mockReturnValue(mockAccountBalances),
      getMortgageTransactions: vi.fn().mockReturnValue(mockMortgageTransactions),
      // Production now also queries statement data; default to empty so amortization-only path runs
      getMortgageStatements: vi.fn().mockReturnValue(null),
      applyMemos: vi.fn().mockImplementation(txns => txns),
      saveCompiledFinances: vi.fn()
    };

    mockLogger = {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn()
    };

    service = new BudgetCompilationService({
      financeStore: mockFinanceStore,
      logger: mockLogger
    });
  });

  describe('constructor', () => {
    it('throws if financeStore is missing', () => {
      expect(() => new BudgetCompilationService({})).toThrow('requires financeStore');
    });
  });

  describe('compile', () => {
    it('throws when budget config is not found', async () => {
      mockFinanceStore.getBudgetConfig.mockReturnValue(null);

      await expect(service.compile()).rejects.toThrow('Budget configuration');
    });

    it('compiles budget and mortgage data', async () => {
      const result = await service.compile();

      expect(result).toHaveProperty('budgets');
      expect(result).toHaveProperty('mortgage');
      expect(mockFinanceStore.saveCompiledFinances).toHaveBeenCalledWith(
        result,
        undefined
      );
    });

    it('applies memos to transactions', async () => {
      await service.compile();

      expect(mockFinanceStore.applyMemos).toHaveBeenCalled();
    });

    it('processes each budget period', async () => {
      const result = await service.compile();

      expect(result.budgets).toHaveProperty('2026-01-01');
      expect(result.budgets['2026-01-01']).toHaveProperty('budgetStart', '2026-01-01');
      expect(result.budgets['2026-01-01']).toHaveProperty('budgetEnd', '2026-06-30');
    });

    it('compiles mortgage status', async () => {
      const result = await service.compile();

      expect(result.mortgage).toHaveProperty('balance');
      expect(result.mortgage).toHaveProperty('paymentPlans');
      expect(result.mortgage.balance).toBe(250000); // abs of -250000
    });

    it('uses household ID when provided', async () => {
      await service.compile('test-household');

      expect(mockFinanceStore.getBudgetConfig).toHaveBeenCalledWith('test-household');
      expect(mockFinanceStore.getTransactions).toHaveBeenCalledWith('2026-01-01', 'test-household');
    });
  });

  describe('budget period compilation', () => {
    it('includes day-to-day budget breakdown', async () => {
      const result = await service.compile();
      const budget = result.budgets['2026-01-01'];

      expect(budget).toHaveProperty('dayToDayBudget');
    });

    it('includes monthly budget breakdown', async () => {
      const result = await service.compile();
      const budget = result.budgets['2026-01-01'];

      expect(budget).toHaveProperty('monthlyBudget');
    });

    it('includes short-term buckets', async () => {
      const result = await service.compile();
      const budget = result.budgets['2026-01-01'];

      expect(budget).toHaveProperty('shortTermBuckets');
    });

    it('includes short-term status summary', async () => {
      const result = await service.compile();
      const budget = result.budgets['2026-01-01'];

      expect(budget).toHaveProperty('shortTermStatus');
      expect(budget.shortTermStatus).toHaveProperty('budget');
      expect(budget.shortTermStatus).toHaveProperty('spending');
      expect(budget.shortTermStatus).toHaveProperty('balance');
    });

    it('includes transfer transactions', async () => {
      const result = await service.compile();
      const budget = result.budgets['2026-01-01'];

      expect(budget).toHaveProperty('transferTransactions');
      expect(budget.transferTransactions).toHaveProperty('amount');
      expect(budget.transferTransactions).toHaveProperty('transactions');
    });

    it('includes total budget summary', async () => {
      const result = await service.compile();
      const budget = result.budgets['2026-01-01'];

      expect(budget).toHaveProperty('totalBudget');
    });
  });

  describe('transaction classification', () => {
    it('classifies income transactions correctly', async () => {
      const result = await service.compile();
      const budget = result.budgets['2026-01-01'];

      // Check that monthly budget has income data
      const months = Object.keys(budget.monthlyBudget);
      expect(months.length).toBeGreaterThan(0);

      const januaryBudget = budget.monthlyBudget['2026-01'];
      if (januaryBudget) {
        expect(januaryBudget).toHaveProperty('income');
        expect(januaryBudget.income).toBeGreaterThan(0);
      }
    });

    it('classifies day-to-day transactions correctly', async () => {
      const result = await service.compile();
      const budget = result.budgets['2026-01-01'];

      expect(budget.dayToDayBudget).toBeDefined();
    });

    it('classifies monthly expense transactions correctly', async () => {
      const result = await service.compile();
      const budget = result.budgets['2026-01-01'];

      const januaryBudget = budget.monthlyBudget['2026-01'];
      if (januaryBudget) {
        expect(januaryBudget).toHaveProperty('monthlyCategories');
        expect(januaryBudget.monthlyCategories).toHaveProperty('Rent');
      }
    });
  });

  describe('surplus allocation', () => {
    it('allocates surplus to flex buckets', async () => {
      const result = await service.compile();
      const budget = result.budgets['2026-01-01'];

      // Flex buckets should exist
      expect(budget.shortTermBuckets).toHaveProperty('Travel');
      expect(budget.shortTermBuckets).toHaveProperty('Shopping');
    });
  });

  describe('mortgage calculations', () => {
    it('calculates mortgage status from config', async () => {
      const result = await service.compile();

      expect(result.mortgage).toHaveProperty('mortgageStartValue', 300000);
      expect(result.mortgage).toHaveProperty('interestRate', 0.065);
    });

    it('includes payment plans', async () => {
      const result = await service.compile();

      expect(result.mortgage).toHaveProperty('paymentPlans');
      expect(result.mortgage.paymentPlans.length).toBeGreaterThan(0);
    });

    it('handles missing mortgage config', async () => {
      mockFinanceStore.getBudgetConfig.mockReturnValue({
        ...mockBudgetConfig,
        mortgage: null
      });

      const result = await service.compile();

      expect(result.mortgage).toBeNull();
    });
  });

  describe('error handling', () => {
    it('handles missing transactions gracefully', async () => {
      mockFinanceStore.getTransactions.mockReturnValue(null);

      const result = await service.compile();

      // Should still compile, just with empty data
      expect(result.budgets).toBeDefined();
    });

    it('handles missing account balances', async () => {
      mockFinanceStore.getAccountBalances.mockReturnValue(null);

      const result = await service.compile();

      expect(result.mortgage).toBeDefined();
    });

    it('handles missing mortgage transactions', async () => {
      mockFinanceStore.getMortgageTransactions.mockReturnValue(null);

      const result = await service.compile();

      expect(result.mortgage).toBeDefined();
    });
  });

  describe('daily balance continuity', () => {
    it('carries forward zero balance without resetting to budget', async () => {
      // Transactions that exactly consume the $800 budget by day 15
      const zeroOutTransactions = [
        { id: '1', date: '2026-01-15', amount: 2500, expenseAmount: -2500, description: 'Paycheck', tagNames: ['Income'], type: 'income' },
        { id: '2', date: '2026-01-05', amount: 400, expenseAmount: 400, description: 'Groceries', tagNames: ['Groceries'], type: 'expense' },
        { id: '3', date: '2026-01-15', amount: 400, expenseAmount: 400, description: 'More Groceries', tagNames: ['Groceries'], type: 'expense' },
        { id: '4', date: '2026-01-20', amount: 1500, expenseAmount: 1500, description: 'Rent', tagNames: ['Rent'], type: 'expense' },
      ];
      mockFinanceStore.getTransactions.mockReturnValue(zeroOutTransactions);

      const result = await service.compile();
      const dtd = result.budgets['2026-01-01'].dayToDayBudget['2026-01'];
      const balances = dtd.dailyBalances;

      // After spending $800 (400+400) on a $800 budget, balance should be 0
      // Day after should start at 0, NOT reset to 800
      const jan15 = balances['2026-01-15'];
      expect(jan15.endingBalance).toBe(0);

      const jan16 = balances['2026-01-16'];
      expect(jan16.startingBalance).toBe(0);
      expect(jan16.endingBalance).toBe(0);

      // Last day should also be 0, not the budget
      const jan31 = balances['2026-01-31'];
      expect(jan31.startingBalance).toBe(0);
      expect(jan31.endingBalance).toBe(0);
    });

    it('emits displayBalance and overspent fields on daily balances', async () => {
      const pastBudgetConfig = {
        budget: [{
          timeframe: { start: '2025-01-01', end: '2025-06-30' },
          accounts: ['Checking'],
          income: {
            salary: { amount: 60000, payCheckCount: 24, payFrequencyInDays: 14, firstPaycheckDate: '2025-01-10' },
            tags: ['Income'],
            extra: []
          },
          dayToDay: { amount: 500, tags: ['Groceries'] },
          monthly: [{ label: 'Rent', amount: 1500, tags: ['Rent'] }],
          shortTerm: [{ label: 'Travel', amount: 500, flex: 1, tags: ['Travel'] }]
        }],
        mortgage: null
      };

      // $600 spent on $500 budget = $100 overspend
      const overspendTransactions = [
        { id: '1', date: '2025-01-15', amount: 2500, expenseAmount: -2500, description: 'Paycheck', tagNames: ['Income'], type: 'income' },
        { id: '2', date: '2025-01-10', amount: 300, expenseAmount: 300, description: 'Groceries', tagNames: ['Groceries'], type: 'expense' },
        { id: '3', date: '2025-01-20', amount: 300, expenseAmount: 300, description: 'More Groceries', tagNames: ['Groceries'], type: 'expense' },
        { id: '4', date: '2025-01-25', amount: 1500, expenseAmount: 1500, description: 'Rent', tagNames: ['Rent'], type: 'expense' },
      ];

      mockFinanceStore.getBudgetConfig.mockReturnValue(pastBudgetConfig);
      mockFinanceStore.getTransactions.mockReturnValue(overspendTransactions);

      const result = await service.compile();
      const dtd = result.budgets['2025-01-01'].dayToDayBudget['2025-01'];
      const balances = dtd.dailyBalances;

      // Day with positive balance (before any spending)
      const jan01 = balances['2025-01-01'];
      expect(jan01.displayBalance).toBe(500);
      expect(jan01.overspent).toBe(false);

      // Day with negative balance (after $600 spent on $500 budget)
      const jan31 = balances['2025-01-31'];
      expect(jan31.endingBalance).toBe(-100);
      expect(jan31.displayBalance).toBe(100);
      expect(jan31.overspent).toBe(true);

      // Start entry should also have the fields
      const start = balances['2025-01-start'];
      expect(start.displayBalance).toBe(500);
      expect(start.overspent).toBe(false);
    });

    it('uses configured budget for past months, not spending', async () => {
      // Use a budget period in the past (2025-01-01 to 2025-06-30)
      const pastBudgetConfig = {
        budget: [{
          timeframe: { start: '2025-01-01', end: '2025-06-30' },
          accounts: ['Checking'],
          income: {
            salary: { amount: 60000, payCheckCount: 24, payFrequencyInDays: 14, firstPaycheckDate: '2025-01-10' },
            tags: ['Income'],
            extra: []
          },
          dayToDay: { amount: 800, tags: ['Groceries'] },
          monthly: [{ label: 'Rent', amount: 1500, tags: ['Rent'] }],
          shortTerm: [{ label: 'Travel', amount: 500, flex: 1, tags: ['Travel'] }]
        }],
        mortgage: null
      };

      // Past month transactions that overspend: $900 on an $800 budget
      const overspendTransactions = [
        { id: '1', date: '2025-01-15', amount: 2500, expenseAmount: -2500, description: 'Paycheck', tagNames: ['Income'], type: 'income' },
        { id: '2', date: '2025-01-10', amount: 500, expenseAmount: 500, description: 'Groceries', tagNames: ['Groceries'], type: 'expense' },
        { id: '3', date: '2025-01-20', amount: 400, expenseAmount: 400, description: 'More Groceries', tagNames: ['Groceries'], type: 'expense' },
        { id: '4', date: '2025-01-25', amount: 1500, expenseAmount: 1500, description: 'Rent', tagNames: ['Rent'], type: 'expense' },
      ];

      mockFinanceStore.getBudgetConfig.mockReturnValue(pastBudgetConfig);
      mockFinanceStore.getTransactions.mockReturnValue(overspendTransactions);

      const result = await service.compile();
      const dtd = result.budgets['2025-01-01'].dayToDayBudget['2025-01'];

      // Budget should be the configured amount, not spending
      expect(dtd.budget).toBe(800);

      // With $900 spent on $800 budget, balance goes negative
      const jan31 = dtd.dailyBalances['2025-01-31'];
      expect(jan31.endingBalance).toBe(-100);
    });
  });
});
