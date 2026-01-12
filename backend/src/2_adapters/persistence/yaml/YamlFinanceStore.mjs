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
import fs from 'fs';
import path from 'path';
import yaml from 'js-yaml';

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
  // Budget Configuration
  // ==========================================================================

  /**
   * Get budget configuration
   * @param {string} [householdId]
   * @returns {Object|null}
   */
  getBudgetConfig(householdId) {
    const filePath = path.join(this.getBasePath(householdId), 'budget.config.yml');
    return this.#readYaml(filePath);
  }

  /**
   * Save budget configuration
   * @param {Object} config
   * @param {string} [householdId]
   */
  saveBudgetConfig(config, householdId) {
    const filePath = path.join(this.getBasePath(householdId), 'budget.config.yml');
    this.#writeYaml(filePath, config);
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
    return this.#readYaml(filePath);
  }

  /**
   * Save compiled finances
   * @param {{budgets: Object, mortgage: Object}} data
   * @param {string} [householdId]
   */
  saveCompiledFinances(data, householdId) {
    const filePath = path.join(this.getBasePath(householdId), 'finances.yml');
    this.#writeYaml(filePath, data);
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
    const data = this.#readYaml(filePath);
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
    this.#ensureDir(dirPath);

    const filePath = path.join(dirPath, 'transactions.yml');
    this.#writeYaml(filePath, { transactions });
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
    const data = this.#readYaml(filePath);
    return data?.accountBalances || null;
  }

  /**
   * Save account balances
   * @param {Object[]} accountBalances
   * @param {string} [householdId]
   */
  saveAccountBalances(accountBalances, householdId) {
    const filePath = path.join(this.getBasePath(householdId), 'account.balances.yml');
    this.#writeYaml(filePath, { accountBalances });
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
    const data = this.#readYaml(filePath);
    return data?.mortgageTransactions || null;
  }

  /**
   * Save mortgage transactions
   * @param {Object[]} mortgageTransactions
   * @param {string} [householdId]
   */
  saveMortgageTransactions(mortgageTransactions, householdId) {
    const filePath = path.join(this.getBasePath(householdId), 'mortgage.transactions.yml');
    this.#writeYaml(filePath, { mortgageTransactions });
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
    return this.#readYaml(filePath) || {};
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
    this.#writeYaml(filePath, memos);
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
    return this.#readYaml(filePath);
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
    const configPath = path.join(this.getBasePath(householdId), 'budget.config.yml');
    return fs.existsSync(configPath);
  }

  /**
   * List budget periods (directories with transactions)
   * @param {string} [householdId]
   * @returns {string[]} Array of YYYY-MM-DD strings
   */
  listBudgetPeriods(householdId) {
    const basePath = this.getBasePath(householdId);
    if (!fs.existsSync(basePath)) return [];

    return fs.readdirSync(basePath)
      .filter(name => /^\d{4}-\d{2}-\d{2}$/.test(name))
      .filter(name => {
        const txnPath = path.join(basePath, name, 'transactions.yml');
        return fs.existsSync(txnPath);
      })
      .sort();
  }

  // ==========================================================================
  // Private Helpers
  // ==========================================================================

  /**
   * Read YAML file
   * @private
   */
  #readYaml(filePath) {
    try {
      if (!fs.existsSync(filePath)) return null;
      const content = fs.readFileSync(filePath, 'utf8');
      return yaml.load(content);
    } catch (err) {
      console.error(`Error reading ${filePath}:`, err.message);
      return null;
    }
  }

  /**
   * Write YAML file
   * @private
   */
  #writeYaml(filePath, data) {
    const dir = path.dirname(filePath);
    this.#ensureDir(dir);
    const content = yaml.dump(data, { lineWidth: -1, noRefs: true });
    fs.writeFileSync(filePath, content, 'utf8');
  }

  /**
   * Ensure directory exists
   * @private
   */
  #ensureDir(dirPath) {
    if (!fs.existsSync(dirPath)) {
      fs.mkdirSync(dirPath, { recursive: true });
    }
  }
}

export default YamlFinanceStore;
