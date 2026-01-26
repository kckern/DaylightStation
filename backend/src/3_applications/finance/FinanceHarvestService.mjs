/**
 * FinanceHarvestService - Orchestrates financial data refresh
 *
 * Coordinates the harvesting of financial data from external sources:
 * - Fetches transactions from Buxfer for each budget period
 * - Updates account balances
 * - Fetches mortgage transactions
 * - Optionally categorizes transactions using AI
 * - Triggers budget compilation after data refresh
 *
 * Dependencies:
 * - BuxferAdapter: External transaction source
 * - TransactionCategorizationService: AI categorization
 * - BudgetCompilationService: Budget compilation
 * - YamlFinanceStore: Persistence
 */

import { nowDate } from '../../0_infrastructure/utils/time.mjs';

export class FinanceHarvestService {
  #transactionSource;
  #financeStore;
  #categorizationService;
  #compilationService;
  #logger;

  /**
   * @param {Object} deps - Dependencies
   * @param {Object} deps.transactionSource - BuxferAdapter instance
   * @param {Object} deps.financeStore - YamlFinanceStore instance
   * @param {Object} [deps.categorizationService] - TransactionCategorizationService instance
   * @param {Object} [deps.compilationService] - BudgetCompilationService instance
   * @param {Object} [deps.logger] - Logger instance
   */
  constructor({
    transactionSource,
    financeStore,
    categorizationService,
    compilationService,
    logger
  }) {
    if (!transactionSource) {
      throw new Error('FinanceHarvestService requires transactionSource');
    }
    if (!financeStore) {
      throw new Error('FinanceHarvestService requires financeStore');
    }
    this.#transactionSource = transactionSource;
    this.#financeStore = financeStore;
    this.#categorizationService = categorizationService;
    this.#compilationService = compilationService;
    this.#logger = logger || console;
  }

  /**
   * Refresh all financial data for a household
   *
   * @param {string} [householdId] - Household ID
   * @param {Object} [options] - Harvest options
   * @param {boolean} [options.skipCategorization=false] - Skip AI categorization
   * @param {boolean} [options.skipCompilation=false] - Skip budget compilation
   * @returns {Promise<{status: string, details: Object}>}
   */
  async harvest(householdId, options = {}) {
    const { skipCategorization = false, skipCompilation = false } = options;

    this.#log('info', 'harvest.start', { householdId, options });

    const config = this.#financeStore.getBudgetConfig(householdId);
    if (!config) {
      throw new Error('Budget configuration not found');
    }

    const { budget: budgets, mortgage } = config;
    const results = {
      budgetPeriods: [],
      accounts: [],
      accountBalances: null,
      mortgageTransactions: null,
      categorization: null,
      compilation: null
    };

    // Collect all unique accounts across budget periods
    const allAccounts = new Set();

    // Process each budget period
    for (const budget of budgets) {
      if (budget.closed) {
        this.#log('debug', 'harvest.period.skipped', {
          start: budget.timeframe.start,
          reason: 'closed'
        });
        continue;
      }

      const startDate = this.#toDateString(budget.timeframe.start);
      const endDate = this.#toDateString(budget.timeframe.end);

      // Add accounts to set
      budget.accounts?.forEach(acc => allAccounts.add(acc));

      this.#log('info', 'harvest.period.start', { startDate, endDate });

      // Fetch transactions for this period
      const transactions = await this.#fetchTransactions(
        startDate,
        endDate,
        budget.accounts
      );

      // Save transactions
      this.#financeStore.saveTransactions(startDate, transactions, householdId);

      results.budgetPeriods.push({
        startDate,
        endDate,
        transactionCount: transactions.length
      });

      this.#log('info', 'harvest.period.complete', {
        startDate,
        transactionCount: transactions.length
      });
    }

    results.accounts = Array.from(allAccounts);

    // Add mortgage accounts to balance query
    mortgage?.accounts?.forEach(acc => allAccounts.add(acc));

    // Fetch and save account balances
    const accountBalances = await this.#fetchAccountBalances(Array.from(allAccounts));
    this.#financeStore.saveAccountBalances(accountBalances, householdId);
    results.accountBalances = accountBalances.length;
    this.#log('info', 'harvest.balances.saved', { count: accountBalances.length });

    // Fetch and save mortgage transactions
    if (mortgage?.accounts?.length && mortgage?.startDate) {
      const mortgageTransactions = await this.#fetchMortgageTransactions(
        mortgage.accounts,
        mortgage.startDate
      );
      this.#financeStore.saveMortgageTransactions(mortgageTransactions, householdId);
      results.mortgageTransactions = mortgageTransactions.length;
      this.#log('info', 'harvest.mortgage.saved', { count: mortgageTransactions.length });
    }

    // AI categorization (optional)
    if (!skipCategorization && this.#categorizationService) {
      results.categorization = await this.#runCategorization(householdId, budgets);
    }

    // Compile budget (optional)
    if (!skipCompilation && this.#compilationService) {
      await this.#compilationService.compile(householdId);
      results.compilation = 'success';
      this.#log('info', 'harvest.compilation.complete');
    }

    this.#log('info', 'harvest.complete', { results });

    return { status: 'success', details: results };
  }

  /**
   * Refresh only transactions for a specific budget period
   *
   * @param {string} startDate - Budget period start date (YYYY-MM-DD)
   * @param {string} endDate - Budget period end date (YYYY-MM-DD)
   * @param {string[]} accounts - Accounts to fetch
   * @param {string} [householdId] - Household ID
   * @returns {Promise<{status: string, transactionCount: number}>}
   */
  async refreshPeriod(startDate, endDate, accounts, householdId) {
    this.#log('info', 'harvest.period.refresh', { startDate, endDate, accounts });

    const transactions = await this.#fetchTransactions(startDate, endDate, accounts);
    this.#financeStore.saveTransactions(startDate, transactions, householdId);

    return { status: 'success', transactionCount: transactions.length };
  }

  /**
   * Refresh only account balances
   *
   * @param {string[]} accounts - Accounts to fetch
   * @param {string} [householdId] - Household ID
   * @returns {Promise<{status: string, balances: Object[]}>}
   */
  async refreshBalances(accounts, householdId) {
    const balances = await this.#fetchAccountBalances(accounts);
    this.#financeStore.saveAccountBalances(balances, householdId);
    return { status: 'success', balances };
  }

  /**
   * Refresh only mortgage transactions
   *
   * @param {string[]} accounts - Mortgage accounts
   * @param {string} startDate - Mortgage start date
   * @param {string} [householdId] - Household ID
   * @returns {Promise<{status: string, transactionCount: number}>}
   */
  async refreshMortgage(accounts, startDate, householdId) {
    const transactions = await this.#fetchMortgageTransactions(accounts, startDate);
    this.#financeStore.saveMortgageTransactions(transactions, householdId);
    return { status: 'success', transactionCount: transactions.length };
  }

  /**
   * Run categorization on all current transactions
   *
   * @param {string} [householdId] - Household ID
   * @returns {Promise<{processed: number, failed: number}>}
   */
  async categorizeAll(householdId) {
    if (!this.#categorizationService) {
      throw new Error('Categorization service not configured');
    }

    const config = this.#financeStore.getBudgetConfig(householdId);
    if (!config) {
      throw new Error('Budget configuration not found');
    }

    return this.#runCategorization(householdId, config.budget);
  }

  // ==========================================================================
  // Private Methods
  // ==========================================================================

  /**
   * Fetch transactions from external source
   */
  async #fetchTransactions(startDate, endDate, accounts) {
    this.#log('debug', 'harvest.transactions.fetch', { startDate, endDate, accounts });

    // BuxferAdapter.getTransactions returns raw transaction objects
    const transactions = await this.#transactionSource.getTransactions({
      startDate,
      endDate,
      accounts
    });

    return transactions;
  }

  /**
   * Fetch account balances from external source
   */
  async #fetchAccountBalances(accounts) {
    this.#log('debug', 'harvest.balances.fetch', { accounts });

    // Get accounts from Buxfer
    const allAccounts = await this.#transactionSource.getAccounts();

    // Filter and map to balance objects
    return allAccounts
      .filter(acc => accounts.includes(acc.name))
      .map(acc => ({ name: acc.name, balance: acc.balance }));
  }

  /**
   * Fetch mortgage transactions from external source
   */
  async #fetchMortgageTransactions(accounts, startDate) {
    const endDate = this.#getCurrentDate();
    this.#log('debug', 'harvest.mortgage.fetch', { accounts, startDate, endDate });

    return this.#transactionSource.getTransactions({
      startDate,
      endDate,
      accounts
    });
  }

  /**
   * Run categorization on all budget periods
   */
  async #runCategorization(householdId, budgets) {
    let totalProcessed = 0;
    let totalFailed = 0;

    for (const budget of budgets) {
      if (budget.closed) continue;

      const startDate = this.#toDateString(budget.timeframe.start);
      const transactions = this.#financeStore.getTransactions(startDate, householdId);

      if (!transactions?.length) continue;

      const { processed, failed } = await this.#categorizationService.categorize(
        transactions,
        householdId
      );

      // Update saved transactions with categorization results
      if (processed.length > 0) {
        this.#financeStore.saveTransactions(startDate, transactions, householdId);
      }

      totalProcessed += processed.length;
      totalFailed += failed.length;
    }

    this.#log('info', 'harvest.categorization.complete', {
      processed: totalProcessed,
      failed: totalFailed
    });

    return { processed: totalProcessed, failed: totalFailed };
  }

  #toDateString(date) {
    return new Date(date).toISOString().slice(0, 10);
  }

  #getCurrentDate() {
    return nowDate();
  }

  #log(level, message, data = {}) {
    if (this.#logger[level]) {
      this.#logger[level](message, data);
    }
  }
}

export default FinanceHarvestService;
