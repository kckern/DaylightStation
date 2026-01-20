/**
 * BudgetService - Budget management operations
 */

import { Budget } from '../entities/Budget.mjs';

export class BudgetService {
  constructor({ budgetStore, transactionSource }) {
    this.budgetStore = budgetStore;
    this.transactionSource = transactionSource;
  }

  /**
   * Get all budgets
   */
  async getAllBudgets() {
    const budgets = await this.budgetStore.findAll();
    return budgets.map(b => Budget.fromJSON(b));
  }

  /**
   * Get budget by ID
   */
  async getBudget(id) {
    const data = await this.budgetStore.findById(id);
    return data ? Budget.fromJSON(data) : null;
  }

  /**
   * Create a budget
   */
  async createBudget(data) {
    const budget = new Budget(data);
    await this.budgetStore.save(budget);
    return budget;
  }

  /**
   * Update a budget
   */
  async updateBudget(id, updates) {
    const budget = await this.getBudget(id);
    if (!budget) throw new Error(`Budget not found: ${id}`);

    Object.assign(budget, updates);
    await this.budgetStore.save(budget);
    return budget;
  }

  /**
   * Delete a budget
   */
  async deleteBudget(id) {
    await this.budgetStore.delete(id);
  }

  /**
   * Sync budget spending from transactions
   */
  async syncBudgetSpending(budgetId, startDate, endDate) {
    const budget = await this.getBudget(budgetId);
    if (!budget) throw new Error(`Budget not found: ${budgetId}`);

    const transactions = await this.transactionSource.findByCategory(
      budget.category,
      startDate,
      endDate
    );

    const totalSpent = transactions
      .filter(t => t.type === 'expense')
      .reduce((sum, t) => sum + Math.abs(t.amount), 0);

    budget.spent = totalSpent;
    await this.budgetStore.save(budget);
    return budget;
  }

  /**
   * Get budget summary
   */
  async getBudgetSummary() {
    const budgets = await this.getAllBudgets();

    const totalBudgeted = budgets.reduce((sum, b) => sum + b.amount, 0);
    const totalSpent = budgets.reduce((sum, b) => sum + b.spent, 0);
    const overBudgetCount = budgets.filter(b => b.isOverBudget()).length;
    const warningCount = budgets.filter(b => b.isAtWarningLevel()).length;

    return {
      totalBudgeted,
      totalSpent,
      totalRemaining: totalBudgeted - totalSpent,
      budgetCount: budgets.length,
      overBudgetCount,
      warningCount
    };
  }

  /**
   * Get budgets by category
   */
  async getBudgetsByCategory(category) {
    const budgets = await this.getAllBudgets();
    return budgets.filter(b => b.category === category);
  }
}

export default BudgetService;
