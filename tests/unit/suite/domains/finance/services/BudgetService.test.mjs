// tests/unit/domains/finance/services/BudgetService.test.mjs
import { jest } from '@jest/globals';
import { BudgetService } from '#backend/src/1_domains/finance/services/BudgetService.mjs';

describe('BudgetService', () => {
  let service;
  let mockBudgetStore;
  let mockTransactionSource;

  beforeEach(() => {
    mockBudgetStore = {
      findAll: jest.fn(),
      findById: jest.fn(),
      save: jest.fn(),
      delete: jest.fn()
    };
    mockTransactionSource = {
      findByCategory: jest.fn()
    };
    service = new BudgetService({
      budgetStore: mockBudgetStore,
      transactionSource: mockTransactionSource
    });
  });

  describe('getAllBudgets', () => {
    test('returns all budgets', async () => {
      mockBudgetStore.findAll.mockResolvedValue([
        { id: 'b1', name: 'Food', amount: 500, spent: 0 },
        { id: 'b2', name: 'Gas', amount: 200, spent: 0 }
      ]);

      const budgets = await service.getAllBudgets();
      expect(budgets).toHaveLength(2);
    });
  });

  describe('getBudget', () => {
    test('returns budget by ID', async () => {
      mockBudgetStore.findById.mockResolvedValue({
        id: 'b1',
        name: 'Food',
        amount: 500,
        spent: 100
      });

      const budget = await service.getBudget('b1');
      expect(budget.name).toBe('Food');
    });

    test('returns null for nonexistent', async () => {
      mockBudgetStore.findById.mockResolvedValue(null);
      const budget = await service.getBudget('nonexistent');
      expect(budget).toBeNull();
    });
  });

  describe('createBudget', () => {
    test('creates and saves budget', async () => {
      const budget = await service.createBudget({
        id: 'new',
        name: 'Entertainment',
        amount: 300
      });

      expect(budget.name).toBe('Entertainment');
      expect(mockBudgetStore.save).toHaveBeenCalled();
    });
  });

  describe('updateBudget', () => {
    test('updates and saves budget', async () => {
      mockBudgetStore.findById.mockResolvedValue({
        id: 'b1',
        name: 'Food',
        amount: 500,
        spent: 0
      });

      const budget = await service.updateBudget('b1', { amount: 600 });
      expect(budget.amount).toBe(600);
      expect(mockBudgetStore.save).toHaveBeenCalled();
    });

    test('throws for nonexistent', async () => {
      mockBudgetStore.findById.mockResolvedValue(null);
      await expect(service.updateBudget('none', {}))
        .rejects.toThrow('Budget not found');
    });
  });

  describe('syncBudgetSpending', () => {
    test('syncs spending from transactions', async () => {
      mockBudgetStore.findById.mockResolvedValue({
        id: 'b1',
        name: 'Food',
        amount: 500,
        spent: 0,
        category: 'food'
      });
      mockTransactionSource.findByCategory.mockResolvedValue([
        { type: 'expense', amount: 50 },
        { type: 'expense', amount: 75 },
        { type: 'income', amount: 10 }
      ]);

      const budget = await service.syncBudgetSpending('b1', '2026-01-01', '2026-01-31');
      expect(budget.spent).toBe(125);
    });
  });

  describe('getBudgetSummary', () => {
    test('calculates summary', async () => {
      mockBudgetStore.findAll.mockResolvedValue([
        { id: 'b1', name: 'Food', amount: 500, spent: 450 },
        { id: 'b2', name: 'Gas', amount: 200, spent: 250 }
      ]);

      const summary = await service.getBudgetSummary();
      expect(summary.totalBudgeted).toBe(700);
      expect(summary.totalSpent).toBe(700);
      expect(summary.overBudgetCount).toBe(1);
      expect(summary.warningCount).toBe(1);
    });
  });
});
