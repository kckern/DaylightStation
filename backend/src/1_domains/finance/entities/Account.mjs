/**
 * Account Entity - Represents a financial account
 */

import { ValidationError } from '../../core/errors/index.mjs';

export class Account {
  constructor({
    id,
    name,
    type,
    balance = 0,
    currency = 'USD',
    institution = null,
    lastUpdated = null,
    metadata = {}
  }) {
    this.id = id;
    this.name = name;
    this.type = type; // 'checking', 'savings', 'credit', 'investment', 'loan'
    this.balance = balance;
    this.currency = currency;
    this.institution = institution;
    this.lastUpdated = lastUpdated;
    this.metadata = metadata;
  }

  /**
   * Check if account is an asset (positive balance expected)
   */
  isAsset() {
    return ['checking', 'savings', 'investment'].includes(this.type);
  }

  /**
   * Check if account is a liability (negative balance expected)
   */
  isLiability() {
    return ['credit', 'loan'].includes(this.type);
  }

  /**
   * Update balance
   * @param {number} newBalance - The new balance value
   * @param {string} timestamp - ISO timestamp for the update
   */
  updateBalance(newBalance, timestamp) {
    if (!timestamp) {
      throw new ValidationError('timestamp required', { code: 'MISSING_TIMESTAMP', field: 'timestamp' });
    }
    this.balance = newBalance;
    this.lastUpdated = timestamp;
  }

  /**
   * Apply a transaction to the balance
   * @param {number} amount - The transaction amount to apply
   * @param {string} timestamp - ISO timestamp for the update
   */
  applyTransaction(amount, timestamp) {
    if (!timestamp) {
      throw new ValidationError('timestamp required', { code: 'MISSING_TIMESTAMP', field: 'timestamp' });
    }
    this.balance += amount;
    this.lastUpdated = timestamp;
  }

  /**
   * Get absolute balance value
   */
  getAbsoluteBalance() {
    return Math.abs(this.balance);
  }

  toJSON() {
    return {
      id: this.id,
      name: this.name,
      type: this.type,
      balance: this.balance,
      currency: this.currency,
      institution: this.institution,
      lastUpdated: this.lastUpdated,
      metadata: this.metadata
    };
  }

  static fromJSON(data) {
    return new Account(data);
  }
}

export default Account;
