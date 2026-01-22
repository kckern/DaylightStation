/**
 * YamlFinanceStore - YAML-based finance data persistence
 *
 * Handles all finance-related YAML files:
 * - budget.config.yml - Budget configuration
 * - finances.yml - Compiled budget output
 * - {date}/transactions.yml - Fetched transactions per budget period
 * - account.balances.yml - Current account balances
 * - mortgage.transactions.yml - Mortgage payment transactions
 * - transaction.memos.yml - User annotations on transactions
 * - gpt.yml - AI categorization configuration
 *
 * Base path: households/{hid}/apps/finances/
 */
import path from 'path';
import {
  ensureDir,
  dirExists,
  fileExists,
  listDirsMatching,
  loadYamlFromPath,
  saveYamlToPath,
  resolveYamlPath
} from '../../../0_infrastructure/utils/FileIO.mjs';

export class YamlFinanceStore {
  #dataRoot;
  #defaultHouseholdId;

  /**
   * @param {Object} config
   * @param {string} config.dataRoot - Base data directory
   * @param {string} [config.defaultHouseholdId='default'] - Default household ID
   */
  constructor(config) {
    if (!config?.dataRoot) {
      throw new Error('YamlFinanceStore requires dataRoot');
    }
    this.#dataRoot = config.dataRoot;
    this.#defaultHouseholdId = config.defaultHouseholdId || 'default';
  }

  /**
   * Get base path for finance files
   * @param {string} [householdId]
   * @returns {string}
   */
  getBasePath(householdId) {
    const hid = householdId || this.#defaultHouseholdId;
    return path.join(this.#dataRoot, 'households', hid, 'apps', 'finances');
  }

  // ==========================================================================
  // Private Helpers
  // ==========================================================================

  /**
   * Read a data file (handles .yml/.yaml)
   * @private
   */
  #readData(filePath) {
    const basePath = filePath.replace(/\.yml$/, '');
    const resolvedPath = resolveYamlPath(basePath);
    if (!resolvedPath) return null;
    try {
      return loadYamlFromPath(resolvedPath);
    } catch (err) {
      console.error(`Error reading ${filePath}:`, err.message);
      return null;
    }
  }

  /**
   * Write a data file
   * @private
   */
  #writeData(filePath, data) {
    const dir = path.dirname(filePath);
    ensureDir(dir);
    saveYamlToPath(filePath, data, { noRefs: true });
  }

  // ==========================================================================
  // Budget Configuration
  // ==========================================================================

  /**
   * Get budget configuration
   * @param {string} [householdId]
   * @returns {Object|null}
   */
  getBudgetConfig(householdId) {
    const filePath = path.join(this.getBasePath(householdId), 'budget.config.yml');
    return this.#readData(filePath);
  }

  /**
   * Save budget configuration
   * @param {Object} config
   * @param {string} [householdId]
   */
  saveBudgetConfig(config, householdId) {
    const filePath = path.join(this.getBasePath(householdId), 'budget.config.yml');
    this.#writeData(filePath, config);
  }

  // ==========================================================================
  // Compiled Finances (Output)
  // ==========================================================================

  /**
   * Get compiled finances (budgets + mortgage)
   * @param {string} [householdId]
   * @returns {{budgets: Object, mortgage: Object}|null}
   */
  getCompiledFinances(householdId) {
    const filePath = path.join(this.getBasePath(householdId), 'finances.yml');
    return this.#readData(filePath);
  }

  /**
   * Save compiled finances
   * @param {{budgets: Object, mortgage: Object}} data
   * @param {string} [householdId]
   */
  saveCompiledFinances(data, householdId) {
    const filePath = path.join(this.getBasePath(householdId), 'finances.yml');
    this.#writeData(filePath, data);
  }

  // ==========================================================================
  // Transactions (per budget period)
  // ==========================================================================

  /**
   * Get transactions for a budget period
   * @param {string} budgetPeriodId - Budget period start date (YYYY-MM-DD)
   * @param {string} [householdId]
   * @returns {Object[]|null}
   */
  getTransactions(budgetPeriodId, householdId) {
    const filePath = path.join(
      this.getBasePath(householdId),
      budgetPeriodId,
      'transactions.yml'
    );
    const data = this.#readData(filePath);
    return data?.transactions || null;
  }

  /**
   * Save transactions for a budget period
   * @param {string} budgetPeriodId - Budget period start date (YYYY-MM-DD)
   * @param {Object[]} transactions
   * @param {string} [householdId]
   */
  saveTransactions(budgetPeriodId, transactions, householdId) {
    const dirPath = path.join(this.getBasePath(householdId), budgetPeriodId);
    ensureDir(dirPath);

    const filePath = path.join(dirPath, 'transactions.yml');
    this.#writeData(filePath, { transactions });
  }

  /**
   * Get all transactions across budget periods
   * @param {string[]} budgetPeriodIds - Array of period IDs to load
   * @param {string} [householdId]
   * @returns {Object[]}
   */
  getAllTransactions(budgetPeriodIds, householdId) {
    const allTransactions = [];
    for (const periodId of budgetPeriodIds) {
      const transactions = this.getTransactions(periodId, householdId);
      if (transactions) {
        allTransactions.push(...transactions);
      }
    }
    return allTransactions;
  }

  // ==========================================================================
  // Account Balances
  // ==========================================================================

  /**
   * Get account balances
   * @param {string} [householdId]
   * @returns {Object[]|null}
   */
  getAccountBalances(householdId) {
    const filePath = path.join(this.getBasePath(householdId), 'account.balances.yml');
    const data = this.#readData(filePath);
    return data?.accountBalances || null;
  }

  /**
   * Save account balances
   * @param {Object[]} accountBalances
   * @param {string} [householdId]
   */
  saveAccountBalances(accountBalances, householdId) {
    const filePath = path.join(this.getBasePath(householdId), 'account.balances.yml');
    this.#writeData(filePath, { accountBalances });
  }

  // ==========================================================================
  // Mortgage Transactions
  // ==========================================================================

  /**
   * Get mortgage transactions
   * @param {string} [householdId]
   * @returns {Object[]|null}
   */
  getMortgageTransactions(householdId) {
    const filePath = path.join(this.getBasePath(householdId), 'mortgage.transactions.yml');
    const data = this.#readData(filePath);
    return data?.mortgageTransactions || null;
  }

  /**
   * Save mortgage transactions
   * @param {Object[]} mortgageTransactions
   * @param {string} [householdId]
   */
  saveMortgageTransactions(mortgageTransactions, householdId) {
    const filePath = path.join(this.getBasePath(householdId), 'mortgage.transactions.yml');
    this.#writeData(filePath, { mortgageTransactions });
  }

  // ==========================================================================
  // Transaction Memos
  // ==========================================================================

  /**
   * Get all transaction memos
   * @param {string} [householdId]
   * @returns {Object<string, string>} Map of transactionId -> memo
   */
  getMemos(householdId) {
    const filePath = path.join(this.getBasePath(householdId), 'transaction.memos.yml');
    return this.#readData(filePath) || {};
  }

  /**
   * Get memo for a specific transaction
   * @param {string} transactionId
   * @param {string} [householdId]
   * @returns {string|null}
   */
  getMemo(transactionId, householdId) {
    const memos = this.getMemos(householdId);
    return memos[transactionId] || null;
  }

  /**
   * Save memo for a transaction
   * @param {string} transactionId
   * @param {string} memo
   * @param {string} [householdId]
   */
  saveMemo(transactionId, memo, householdId) {
    const memos = this.getMemos(householdId);
    memos[transactionId] = memo;
    const filePath = path.join(this.getBasePath(householdId), 'transaction.memos.yml');
    this.#writeData(filePath, memos);
  }

  /**
   * Apply memos to transactions
   * @param {Object[]} transactions
   * @param {string} [householdId]
   * @returns {Object[]} Transactions with memos applied
   */
  applyMemos(transactions, householdId) {
    const memos = this.getMemos(householdId);
    return transactions.map(txn => {
      const memo = memos[String(txn.id)];
      return memo ? { ...txn, memo } : txn;
    });
  }

  // ==========================================================================
  // AI Categorization Config
  // ==========================================================================

  /**
   * Get AI categorization configuration
   * @param {string} [householdId]
   * @returns {{validTags: string[], chat: Object[]}|null}
   */
  getCategorizationConfig(householdId) {
    const filePath = path.join(this.getBasePath(householdId), 'gpt.yml');
    return this.#readData(filePath);
  }

  // ==========================================================================
  // Utility Methods
  // ==========================================================================

  /**
   * Check if finance data exists for household
   * @param {string} [householdId]
   * @returns {boolean}
   */
  exists(householdId) {
    const basePath = path.join(this.getBasePath(householdId), 'budget.config');
    return resolveYamlPath(basePath) !== null;
  }

  /**
   * List budget periods (directories with transactions)
   * @param {string} [householdId]
   * @returns {string[]} Array of YYYY-MM-DD strings
   */
  listBudgetPeriods(householdId) {
    const basePath = this.getBasePath(householdId);
    if (!dirExists(basePath)) return [];

    return listDirsMatching(basePath, /^\d{4}-\d{2}-\d{2}$/)
      .filter(name => {
        const txnBasePath = path.join(basePath, name, 'transactions');
        return resolveYamlPath(txnBasePath) !== null;
      })
      .sort();
  }
}

export default YamlFinanceStore;
