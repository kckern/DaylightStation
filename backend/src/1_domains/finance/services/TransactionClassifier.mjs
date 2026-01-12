/**
 * TransactionClassifier - Categorizes transactions into budget buckets
 *
 * Pure domain service that classifies transactions based on their tags
 * into the following buckets:
 * - income: Income transactions
 * - day: Day-to-day spending (groceries, gas, etc.)
 * - monthly: Fixed monthly expenses (rent, utilities, etc.)
 * - shortTerm: Short-term savings goals (vacation, emergency fund)
 * - transfer: Internal transfers between accounts
 */

/**
 * @typedef {Object} BucketConfig
 * @property {Object} income - Income configuration
 * @property {string[]} income.tags - Tags that identify income
 * @property {Object} dayToDay - Day-to-day spending configuration
 * @property {string[]} dayToDay.tags - Tags for day-to-day spending
 * @property {Object[]} monthly - Monthly expense categories
 * @property {string} monthly[].label - Category label
 * @property {string[]} monthly[].tags - Tags for this category
 * @property {Object[]} shortTerm - Short-term bucket categories
 * @property {string} shortTerm[].label - Bucket label
 * @property {string[]} shortTerm[].tags - Tags for this bucket
 */

/**
 * @typedef {Object} ClassificationResult
 * @property {string} label - The label for this transaction
 * @property {'income'|'day'|'monthly'|'shortTerm'|'transfer'} bucket - The bucket type
 */

/**
 * @typedef {Object} Transaction
 * @property {string} id - Transaction ID
 * @property {string} type - Transaction type (expense, income, transfer, investment)
 * @property {string[]} tagNames - Array of tags on the transaction
 * @property {number} amount - Transaction amount
 * @property {string} description - Transaction description
 */

export class TransactionClassifier {
  #incomeTags;
  #dayToDayTags;
  #monthlyTagDict;
  #shortTermTagDict;

  /**
   * @param {BucketConfig} config - Budget bucket configuration
   */
  constructor(config) {
    if (!config) {
      throw new Error('TransactionClassifier requires bucket configuration');
    }

    this.#incomeTags = config.income?.tags || [];
    this.#dayToDayTags = config.dayToDay?.tags || [];

    // Build monthly tag dictionary: tag -> label
    this.#monthlyTagDict = (config.monthly || []).reduce((acc, { tags, label }) => {
      const categoryLabel = label || 'Shopping';
      tags?.forEach(tag => {
        acc[tag] = categoryLabel;
        acc[categoryLabel] = categoryLabel; // Also map label to itself
      });
      return acc;
    }, {});

    // Build short-term tag dictionary: tag -> label
    this.#shortTermTagDict = (config.shortTerm || []).reduce((acc, { tags, label }) => {
      (tags || []).forEach(tag => {
        acc[tag] = label;
        acc[label] = label; // Also map label to itself
      });
      return acc;
    }, {});
  }

  /**
   * Classify a transaction into a budget bucket
   * @param {Transaction} transaction - Transaction to classify
   * @returns {ClassificationResult}
   */
  classify(transaction) {
    const txnTags = this.#normalizeTags(transaction.tagNames);
    const mainTag = txnTags[0];
    const txnType = transaction.type;

    // Check for transfers first
    if (this.#isTransfer(txnType, mainTag)) {
      return { label: mainTag || 'Transfer', bucket: 'transfer' };
    }

    // Check for income
    if (this.#arraysOverlap(this.#incomeTags, txnTags)) {
      return { label: mainTag || 'Income', bucket: 'income' };
    }

    // Check for day-to-day spending
    if (this.#arraysOverlap(this.#dayToDayTags, txnTags)) {
      return { label: 'Day-to-Day', bucket: 'day' };
    }

    // Check for monthly expenses
    const monthlyTags = Object.keys(this.#monthlyTagDict);
    if (this.#arraysOverlap(monthlyTags, txnTags)) {
      return { label: this.#monthlyTagDict[mainTag] || 'Monthly', bucket: 'monthly' };
    }

    // Check for short-term buckets
    const shortTermTags = Object.keys(this.#shortTermTagDict);
    if (this.#arraysOverlap(shortTermTags, txnTags)) {
      return { label: this.#shortTermTagDict[mainTag] || 'Short-term', bucket: 'shortTerm' };
    }

    // Default to unbudgeted (goes to short-term bucket)
    return { label: 'Unbudgeted', bucket: 'shortTerm' };
  }

  /**
   * Classify multiple transactions
   * @param {Transaction[]} transactions - Transactions to classify
   * @returns {Map<string, Transaction[]>} Transactions grouped by bucket
   */
  classifyAll(transactions) {
    const buckets = new Map([
      ['income', []],
      ['day', []],
      ['monthly', []],
      ['shortTerm', []],
      ['transfer', []]
    ]);

    for (const txn of transactions) {
      const { label, bucket } = this.classify(txn);
      const enrichedTxn = { ...txn, label, bucket };
      buckets.get(bucket).push(enrichedTxn);
    }

    return buckets;
  }

  /**
   * Group transactions by their labels within a bucket
   * @param {Transaction[]} transactions - Already classified transactions
   * @param {'monthly'|'shortTerm'} bucketType - Bucket type to group
   * @returns {Object<string, Transaction[]>} Transactions grouped by label
   */
  groupByLabel(transactions, bucketType) {
    const grouped = {};

    for (const txn of transactions) {
      const { label, bucket } = this.classify(txn);
      if (bucket !== bucketType) continue;

      if (!grouped[label]) {
        grouped[label] = [];
      }
      grouped[label].push({ ...txn, label, bucket });
    }

    return grouped;
  }

  /**
   * Get all configured category labels
   * @returns {Object} Labels by bucket type
   */
  getConfiguredLabels() {
    return {
      monthly: [...new Set(Object.values(this.#monthlyTagDict))],
      shortTerm: [...new Set(Object.values(this.#shortTermTagDict))]
    };
  }

  /**
   * Check if a transaction is a transfer
   * @private
   */
  #isTransfer(txnType, mainTag) {
    return /transfer|investment/i.test(txnType) || mainTag === 'Transfer';
  }

  /**
   * Normalize tags to array format
   * @private
   */
  #normalizeTags(tagNames) {
    if (!tagNames) return [];
    return Array.isArray(tagNames) ? tagNames : [tagNames];
  }

  /**
   * Check if two arrays have any overlapping elements
   * @private
   */
  #arraysOverlap(a, b) {
    return a.some(tag => b.includes(tag));
  }
}

export default TransactionClassifier;
