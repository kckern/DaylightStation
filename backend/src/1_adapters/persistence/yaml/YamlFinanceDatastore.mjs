/**
 * YamlFinanceDatastore - YAML-based finance data persistence
 *
 * Handles all finance-related YAML files:
 * - budget.config - Budget configuration
 * - finances - Compiled budget output
 * - {date}/transactions - Fetched transactions per budget period
 * - account.balances - Current account balances
 * - mortgage.transactions - Mortgage payment transactions
 * - transaction.memos - User annotations on transactions
 * - gpt - AI categorization configuration
 *
 * Base path (via ConfigService.getHouseholdPath): household[-{id}]/common/finances/
 */
import path from 'path';
import { InfrastructureError } from '#system/utils/errors/index.mjs';
import {
  ensureDir,
  dirExists,
  fileExists,
  listDirsMatching,
  loadYamlSafe,
  saveYaml,
  yamlExists
} from '#system/utils/FileIO.mjs';

export class YamlFinanceDatastore {
  #configService;

  /**
   * @param {Object} config
   * @param {Object} config.configService - ConfigService instance for path resolution
   */
  constructor(config) {
    if (!config?.configService) {
      throw new InfrastructureError('YamlFinanceDatastore requires configService', {
        code: 'MISSING_DEPENDENCY',
        dependency: 'configService'
      });
    }
    this.#configService = config.configService;
  }

  /**
   * Get base path for finance files
   * @param {string} [householdId]
   * @returns {string}
   */
  getBasePath(householdId) {
    return this.#configService.getHouseholdPath('common/finances', householdId);
  }

  // ==========================================================================
  // Private Helpers
  // ==========================================================================

  /**
   * Read a data file
   * @private
   */
  #readData(basePath) {
    try {
      return loadYamlSafe(basePath);
    } catch (err) {
      console.error(`Error reading ${basePath}:`, err.message);
      return null;
    }
  }

  /**
   * Write a data file
   * @private
   */
  #writeData(basePath, data) {
    ensureDir(path.dirname(basePath));
    saveYaml(basePath, data, { noRefs: true });
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
    const filePath = path.join(this.getBasePath(householdId), 'budget.config');
    return this.#readData(filePath);
  }

  /**
   * Save budget configuration
   * @param {Object} config
   * @param {string} [householdId]
   */
  saveBudgetConfig(config, householdId) {
    const filePath = path.join(this.getBasePath(householdId), 'budget.config');
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
    const filePath = path.join(this.getBasePath(householdId), 'finances');
    return this.#readData(filePath);
  }

  /**
   * Save compiled finances
   * @param {{budgets: Object, mortgage: Object}} data
   * @param {string} [householdId]
   */
  saveCompiledFinances(data, householdId) {
    const filePath = path.join(this.getBasePath(householdId), 'finances');
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
      'transactions'
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

    const filePath = path.join(dirPath, 'transactions');
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
    const filePath = path.join(this.getBasePath(householdId), 'account.balances');
    const data = this.#readData(filePath);
    return data?.accountBalances || null;
  }

  /**
   * Save account balances
   * @param {Object[]} accountBalances
   * @param {string} [householdId]
   */
  saveAccountBalances(accountBalances, householdId) {
    const filePath = path.join(this.getBasePath(householdId), 'account.balances');
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
    const filePath = path.join(this.getBasePath(householdId), 'mortgage.transactions');
    const data = this.#readData(filePath);
    return data?.mortgageTransactions || null;
  }

  /**
   * Save mortgage transactions
   * @param {Object[]} mortgageTransactions
   * @param {string} [householdId]
   */
  saveMortgageTransactions(mortgageTransactions, householdId) {
    const filePath = path.join(this.getBasePath(householdId), 'mortgage.transactions');
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
    const filePath = path.join(this.getBasePath(householdId), 'transaction.memos');
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
    const filePath = path.join(this.getBasePath(householdId), 'transaction.memos');
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
    const filePath = path.join(this.getBasePath(householdId), 'gpt');
    return this.#readData(filePath);
  }

  // ==========================================================================
  // Payroll Data
  // ==========================================================================

  /**
   * Get payroll data (paychecks)
   * @param {string} [householdId]
   * @returns {{paychecks: Object}|null}
   */
  getPayrollData(householdId) {
    const filePath = path.join(this.getBasePath(householdId), 'payroll');
    return this.#readData(filePath);
  }

  /**
   * Save payroll data
   * @param {string} householdId
   * @param {{paychecks: Object}} data
   */
  savePayrollData(householdId, data) {
    const filePath = path.join(this.getBasePath(householdId), 'payroll');
    this.#writeData(filePath, data);
  }

  /**
   * Get payroll mapping dictionary (for transaction categorization)
   * @param {string} [householdId]
   * @returns {Array<{input: string, desc: string, cat: string, exclude?: boolean}>}
   */
  getPayrollMapping(householdId) {
    const filePath = path.join(this.getBasePath(householdId), 'payrollDict');
    const data = this.#readData(filePath);
    return data?.mapping || [];
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
    return yamlExists(basePath);
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
        return yamlExists(txnBasePath);
      })
      .sort();
  }
}

export default YamlFinanceDatastore;
