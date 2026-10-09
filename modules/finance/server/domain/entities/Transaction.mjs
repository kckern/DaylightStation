/**
 * Transaction Entity - Represents a financial transaction
 */

export class Transaction {
  constructor({
    id,
    date,
    amount,
    description,
    category = null,
    accountId = null,
    type = 'expense',
    tags = [],
    metadata = {}
  }) {
    this.id = id;
    this.date = date;
    this.amount = amount;
    this.description = description;
    this.category = category;
    this.accountId = accountId;
    this.type = type; // 'expense', 'income', 'transfer'
    this.tags = tags;
    this.metadata = metadata;
  }

  /**
   * Check if transaction is an expense
   */
  isExpense() {
    return this.type === 'expense';
  }

  /**
   * Check if transaction is income
   */
  isIncome() {
    return this.type === 'income';
  }

  /**
   * Check if transaction is a transfer
   */
  isTransfer() {
    return this.type === 'transfer';
  }

  /**
   * Get signed amount (negative for expenses)
   */
  getSignedAmount() {
    return this.isExpense() ? -Math.abs(this.amount) : Math.abs(this.amount);
  }

  /**
   * Get formatted date string
   */
  getDateString() {
    return this.date.split('T')[0];
  }

  /**
   * Add a tag
   */
  addTag(tag) {
    if (!this.tags.includes(tag)) {
      this.tags.push(tag);
    }
  }

  /**
   * Remove a tag
   */
  removeTag(tag) {
    this.tags = this.tags.filter(t => t !== tag);
  }

}

export default Transaction;
