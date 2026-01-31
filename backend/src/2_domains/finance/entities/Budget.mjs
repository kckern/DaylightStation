/**
 * Budget Entity - Represents a budget category
 */

export class Budget {
  constructor({
    id,
    name,
    amount,
    spent = 0,
    period = 'monthly',
    category = null,
    tags = []
  }) {
    this.id = id;
    this.name = name;
    this.amount = amount;
    this.spent = spent;
    this.period = period;
    this.category = category;
    this.tags = tags;
  }

  /**
   * Get remaining budget
   */
  getRemaining() {
    return this.amount - this.spent;
  }

  /**
   * Get percentage spent
   */
  getPercentSpent() {
    if (this.amount === 0) return 0;
    return Math.round((this.spent / this.amount) * 100);
  }

  /**
   * Check if over budget
   */
  isOverBudget() {
    return this.spent > this.amount;
  }

  /**
   * Add spending to budget
   */
  addSpending(amount) {
    this.spent += amount;
  }

  /**
   * Reset spent amount
   */
  reset() {
    this.spent = 0;
  }

  /**
   * Check if budget is at warning level (>80% spent)
   */
  isAtWarningLevel() {
    return this.getPercentSpent() >= 80 && !this.isOverBudget();
  }

  toJSON() {
    return {
      id: this.id,
      name: this.name,
      amount: this.amount,
      spent: this.spent,
      period: this.period,
      category: this.category,
      tags: this.tags
    };
  }

  static fromJSON(data) {
    return new Budget(data);
  }
}

export default Budget;
