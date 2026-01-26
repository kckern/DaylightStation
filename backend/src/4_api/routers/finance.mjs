/**
 * Finance API Router
 *
 * Endpoints:
 * - GET  /api/finance - Get finance config overview
 * - GET  /api/finance/accounts - Get account balances
 * - GET  /api/finance/transactions - Get transactions
 * - GET  /api/finance/budgets - Get all budgets
 * - GET  /api/finance/budgets/:budgetId - Get specific budget detail
 * - GET  /api/finance/mortgage - Get mortgage data
 * - POST /api/finance/transactions/:id - Update transaction
 * - POST /api/finance/refresh - Trigger full financial data refresh
 * - POST /api/finance/compile - Trigger budget compilation only
 * - POST /api/finance/categorize - Trigger AI transaction categorization
 * - GET  /api/finance/metrics - Get adapter metrics
 *
 * Legacy compatibility (preserved from /data and /harvest routes):
 * - GET  /api/finance/data - Returns compiled finances (budgets + mortgage)
 * - GET  /api/finance/data/daytoday - Returns current day-to-day budget
 */

import { nowTs24 } from '../../0_infrastructure/utils/index.mjs';
import express from 'express';

/**
 * Create finance API router
 *
 * @param {Object} config
 * @param {Object} config.buxferAdapter - BuxferAdapter instance
 * @param {Object} config.financeStore - YamlFinanceStore instance
 * @param {Object} [config.harvestService] - FinanceHarvestService instance
 * @param {Object} [config.compilationService] - BudgetCompilationService instance
 * @param {Object} [config.categorizationService] - TransactionCategorizationService instance
 * @param {Object} [config.payrollService] - PayrollSyncService instance
 * @param {Object} config.configService - ConfigService
 * @param {Object} config.logger - Logger instance
 * @returns {express.Router}
 */
export function createFinanceRouter(config) {
  const {
    buxferAdapter,
    financeStore,
    harvestService,
    compilationService,
    categorizationService,
    payrollService,
    configService,
    logger = console
  } = config;

  const router = express.Router();

  /**
   * Resolve household ID from query or use default
   */
  function resolveHouseholdId(queryHousehold) {
    return queryHousehold || configService?.getDefaultHouseholdId() || 'default';
  }

  // =============================================================================
  // Config & Overview
  // =============================================================================

  /**
   * GET /api/finance - Get finance config overview
   */
  router.get('/', (req, res) => {
    const householdId = resolveHouseholdId(req.query.household);

    try {
      const config = financeStore?.getBudgetConfig(householdId);
      if (!config) {
        return res.status(404).json({ error: 'Finance configuration not found' });
      }

      // Return sanitized config (no credentials)
      res.json({
        household: householdId,
        budgetCount: config.budget?.length || 0,
        hasMortgage: !!config.mortgage,
        accounts: config.budget?.flatMap(b => b.accounts || []).filter((v, i, a) => a.indexOf(v) === i) || [],
        configured: buxferAdapter?.isConfigured() || false
      });
    } catch (error) {
      logger.error?.('finance.config.error', { error: error.message });
      return res.status(500).json({ error: 'Failed to load finance config' });
    }
  });

  // =============================================================================
  // Legacy Data Endpoints (for frontend compatibility)
  // =============================================================================

  /**
   * GET /api/finance/data - Get compiled finances (legacy /data/budget)
   * Returns { budgets, mortgage } structure expected by frontend
   */
  router.get('/data', (req, res) => {
    const householdId = resolveHouseholdId(req.query.household);

    try {
      const finances = financeStore?.getCompiledFinances(householdId);
      if (!finances) {
        return res.status(404).json({ error: 'Compiled finances not found' });
      }

      return res.json(finances);
    } catch (error) {
      logger.error?.('finance.data.error', { error: error.message });
      return res.status(500).json({ error: 'Failed to load finances' });
    }
  });

  /**
   * GET /api/finance/data/daytoday - Get current day-to-day budget
   * Returns just the latest month's day-to-day spending summary
   */
  router.get('/data/daytoday', (req, res) => {
    const householdId = resolveHouseholdId(req.query.household);

    try {
      const finances = financeStore?.getCompiledFinances(householdId);
      if (!finances?.budgets) {
        return res.status(404).json({ error: 'Budget data not found' });
      }

      const dates = Object.keys(finances.budgets).sort((a, b) => b.localeCompare(a));
      const latestBudget = finances.budgets[dates[0]];
      if (!latestBudget?.dayToDayBudget) {
        return res.status(404).json({ error: 'Day-to-day budget not found' });
      }

      // Filter to current month or earlier (exclude future months)
      const currentMonth = nowMonth(); // YYYY-MM
      const months = Object.keys(latestBudget.dayToDayBudget)
        .filter(m => m <= currentMonth)
        .sort((a, b) => b.localeCompare(a));
      const latestMonth = months[0];
      if (!latestMonth) {
        return res.status(404).json({ error: 'No budget data for current or past months' });
      }
      const budgetData = { ...latestBudget.dayToDayBudget[latestMonth] };

      // Remove transactions for lighter response
      delete budgetData.transactions;

      return res.json(budgetData);
    } catch (error) {
      logger.error?.('finance.daytoday.error', { error: error.message });
      return res.status(500).json({ error: 'Failed to load day-to-day budget' });
    }
  });

  // =============================================================================
  // Accounts
  // =============================================================================

  /**
   * GET /api/finance/accounts - Get account balances
   */
  router.get('/accounts', async (req, res) => {
    const householdId = resolveHouseholdId(req.query.household);
    const { refresh } = req.query;

    try {
      if (refresh === 'true' && buxferAdapter?.isConfigured()) {
        // Fetch fresh data from Buxfer
        const accounts = await buxferAdapter.getAccountBalances();
        return res.json({
          accounts: accounts.map(a => a.toJSON ? a.toJSON() : a),
          source: 'buxfer',
          refreshedAt: nowTs24()
        });
      }

      // Return cached data from local files
      const balances = financeStore?.getAccountBalances(householdId) || [];
      return res.json({
        accounts: balances,
        source: 'cache',
        household: householdId
      });
    } catch (error) {
      logger.error?.('finance.accounts.error', { error: error.message });
      return res.status(500).json({ error: 'Failed to load account balances' });
    }
  });

  // =============================================================================
  // Transactions
  // =============================================================================

  /**
   * GET /api/finance/transactions - Get transactions
   */
  router.get('/transactions', async (req, res) => {
    const householdId = resolveHouseholdId(req.query.household);
    const { startDate, endDate, category, account, budgetDate } = req.query;

    try {
      let transactions;

      // If budgetDate provided, load from local cache
      if (budgetDate) {
        transactions = financeStore?.getTransactions(budgetDate, householdId) || [];
      } else if (buxferAdapter?.isConfigured() && (startDate || endDate)) {
        // Fetch from Buxfer API
        if (category) {
          transactions = await buxferAdapter.findByCategory(category, startDate, endDate);
        } else if (account) {
          transactions = await buxferAdapter.findByAccount(account);
        } else {
          transactions = await buxferAdapter.findInRange(startDate, endDate);
        }
        transactions = transactions.map(t => t.toJSON ? t.toJSON() : t);
      } else {
        // Default: load most recent budget period
        const periods = financeStore?.listBudgetPeriods(householdId) || [];
        if (periods.length > 0) {
          const latestPeriod = periods[periods.length - 1];
          transactions = financeStore?.getTransactions(latestPeriod, householdId) || [];
        } else {
          transactions = [];
        }
      }

      return res.json({
        transactions,
        count: transactions.length,
        household: householdId
      });
    } catch (error) {
      logger.error?.('finance.transactions.error', { error: error.message });
      return res.status(500).json({ error: 'Failed to load transactions' });
    }
  });

  /**
   * POST /api/finance/transactions/:id - Update transaction
   */
  router.post('/transactions/:id', async (req, res) => {
    const { id } = req.params;
    const { description, tags, memo } = req.body;

    if (!buxferAdapter?.isConfigured()) {
      return res.status(503).json({ error: 'Buxfer adapter not configured' });
    }

    try {
      const result = await buxferAdapter.updateTransaction(id, { description, tags, memo });
      return res.json({
        ok: true,
        transactionId: id,
        updated: result
      });
    } catch (error) {
      logger.error?.('finance.transactions.update.error', { id, error: error.message });
      return res.status(500).json({ error: 'Failed to update transaction' });
    }
  });

  // =============================================================================
  // Budgets
  // =============================================================================

  /**
   * GET /api/finance/budgets - Get all budgets
   */
  router.get('/budgets', (req, res) => {
    const householdId = resolveHouseholdId(req.query.household);

    try {
      const finances = financeStore?.getCompiledFinances(householdId);
      if (!finances?.budgets) {
        return res.status(404).json({ error: 'Budget data not found' });
      }

      // Return budget summaries
      const budgets = Object.entries(finances.budgets).map(([startDate, budget]) => ({
        startDate,
        endDate: budget.budgetEnd,
        accounts: budget.accounts,
        totalBudget: budget.totalBudget,
        shortTermStatus: budget.shortTermStatus
      }));

      return res.json({
        budgets,
        household: householdId
      });
    } catch (error) {
      logger.error?.('finance.budgets.error', { error: error.message });
      return res.status(500).json({ error: 'Failed to load budgets' });
    }
  });

  /**
   * GET /api/finance/budgets/:budgetId - Get specific budget detail
   */
  router.get('/budgets/:budgetId', (req, res) => {
    const householdId = resolveHouseholdId(req.query.household);
    const { budgetId } = req.params;

    try {
      const finances = financeStore?.getCompiledFinances(householdId);
      if (!finances?.budgets) {
        return res.status(404).json({ error: 'Budget data not found' });
      }

      const budget = finances.budgets[budgetId];
      if (!budget) {
        return res.status(404).json({ error: 'Budget not found', budgetId });
      }

      return res.json({
        budget,
        budgetId,
        household: householdId
      });
    } catch (error) {
      logger.error?.('finance.budgets.detail.error', { budgetId, error: error.message });
      return res.status(500).json({ error: 'Failed to load budget detail' });
    }
  });

  // =============================================================================
  // Mortgage
  // =============================================================================

  /**
   * GET /api/finance/mortgage - Get mortgage data
   */
  router.get('/mortgage', (req, res) => {
    const householdId = resolveHouseholdId(req.query.household);

    try {
      const finances = financeStore?.getCompiledFinances(householdId);
      if (!finances?.mortgage) {
        return res.status(404).json({ error: 'Mortgage data not found' });
      }

      return res.json({
        mortgage: finances.mortgage,
        household: householdId
      });
    } catch (error) {
      logger.error?.('finance.mortgage.error', { error: error.message });
      return res.status(500).json({ error: 'Failed to load mortgage data' });
    }
  });

  // =============================================================================
  // Refresh & Sync (Harvest)
  // =============================================================================

  /**
   * POST /api/finance/refresh - Trigger full financial data refresh
   * Equivalent to legacy /harvest/budget
   */
  router.post('/refresh', async (req, res) => {
    const householdId = resolveHouseholdId(req.body.household || req.query.household);
    const { skipCategorization, skipCompilation } = req.body;

    if (!harvestService) {
      return res.status(503).json({
        error: 'Harvest service not configured',
        hint: 'Initialize FinanceHarvestService in bootstrap'
      });
    }

    if (!buxferAdapter?.isConfigured()) {
      return res.status(503).json({
        error: 'Buxfer adapter not configured',
        hint: 'Configure Buxfer credentials in user auth settings'
      });
    }

    try {
      logger.info?.('finance.refresh.started', { householdId });

      const result = await harvestService.harvest(householdId, {
        skipCategorization: skipCategorization === true,
        skipCompilation: skipCompilation === true
      });

      logger.info?.('finance.refresh.completed', { householdId, result: result.status });

      return res.json(result);
    } catch (error) {
      logger.error?.('finance.refresh.error', { householdId, error: error.message });
      return res.status(500).json({ error: 'Failed to refresh financial data', details: error.message });
    }
  });

  /**
   * POST /api/finance/compile - Trigger budget compilation only (no data fetch)
   */
  router.post('/compile', async (req, res) => {
    const householdId = resolveHouseholdId(req.body.household || req.query.household);

    if (!compilationService) {
      return res.status(503).json({
        error: 'Compilation service not configured',
        hint: 'Initialize BudgetCompilationService in bootstrap'
      });
    }

    try {
      logger.info?.('finance.compile.started', { householdId });

      const result = await compilationService.compile(householdId);

      logger.info?.('finance.compile.completed', { householdId });

      return res.json({
        status: 'success',
        budgetCount: Object.keys(result.budgets).length,
        hasMortgage: !!result.mortgage
      });
    } catch (error) {
      logger.error?.('finance.compile.error', { householdId, error: error.message });
      return res.status(500).json({ error: 'Failed to compile budget', details: error.message });
    }
  });

  /**
   * POST /api/finance/categorize - Trigger AI transaction categorization
   */
  router.post('/categorize', async (req, res) => {
    const householdId = resolveHouseholdId(req.body.household || req.query.household);
    const { budgetDate, preview } = req.body;

    if (!categorizationService) {
      return res.status(503).json({
        error: 'Categorization service not configured',
        hint: 'Initialize TransactionCategorizationService in bootstrap'
      });
    }

    try {
      logger.info?.('finance.categorize.started', { householdId, budgetDate, preview });

      let transactions;
      if (budgetDate) {
        transactions = financeStore?.getTransactions(budgetDate, householdId) || [];
      } else {
        // Use latest period
        const periods = financeStore?.listBudgetPeriods(householdId) || [];
        if (periods.length > 0) {
          transactions = financeStore?.getTransactions(periods[periods.length - 1], householdId) || [];
        } else {
          transactions = [];
        }
      }

      let result;
      if (preview === true) {
        result = await categorizationService.preview(transactions, householdId);
        return res.json({
          status: 'preview',
          ...result
        });
      } else {
        result = await categorizationService.categorize(transactions, householdId);
        return res.json({
          status: 'success',
          ...result
        });
      }
    } catch (error) {
      logger.error?.('finance.categorize.error', { householdId, error: error.message });
      return res.status(500).json({ error: 'Failed to categorize transactions', details: error.message });
    }
  });

  // =============================================================================
  // Transaction Memos
  // =============================================================================

  /**
   * POST /api/finance/memos/:transactionId - Save a memo for a transaction
   */
  router.post('/memos/:transactionId', (req, res) => {
    const householdId = resolveHouseholdId(req.body.household || req.query.household);
    const { transactionId } = req.params;
    const { memo } = req.body;

    try {
      financeStore?.saveMemo(transactionId, memo, householdId);
      return res.json({ ok: true, transactionId, memo });
    } catch (error) {
      logger.error?.('finance.memo.error', { transactionId, error: error.message });
      return res.status(500).json({ error: 'Failed to save memo' });
    }
  });

  /**
   * GET /api/finance/memos - Get all memos
   */
  router.get('/memos', (req, res) => {
    const householdId = resolveHouseholdId(req.query.household);

    try {
      const memos = financeStore?.getMemos(householdId) || {};
      return res.json({ memos, household: householdId });
    } catch (error) {
      logger.error?.('finance.memos.error', { error: error.message });
      return res.status(500).json({ error: 'Failed to load memos' });
    }
  });

  // =============================================================================
  // Payroll Sync
  // =============================================================================

  /**
   * POST /api/finance/payroll/sync - Sync payroll data
   * Fetches paycheck data from external payroll API and uploads to Buxfer
   */
  router.post('/payroll/sync', async (req, res) => {
    const { token } = req.body;

    if (!payrollService) {
      return res.status(503).json({
        error: 'Payroll service not configured',
        hint: 'Initialize PayrollSyncService in bootstrap'
      });
    }

    try {
      logger.info?.('finance.payroll.sync.started', { hasToken: !!token });

      const result = await payrollService.sync({ token });

      logger.info?.('finance.payroll.sync.completed', { result: result.status });

      return res.json(result);
    } catch (error) {
      logger.error?.('finance.payroll.sync.error', { error: error.message });
      return res.status(500).json({ error: 'Payroll sync failed', details: error.message });
    }
  });

  // =============================================================================
  // Metrics
  // =============================================================================

  /**
   * GET /api/finance/metrics - Get adapter metrics
   */
  router.get('/metrics', (req, res) => {
    if (!buxferAdapter) {
      return res.json({
        adapter: 'buxfer',
        configured: false,
        message: 'Buxfer adapter not initialized'
      });
    }

    return res.json({
      adapter: 'buxfer',
      configured: buxferAdapter.isConfigured(),
      ...buxferAdapter.getMetrics()
    });
  });

  return router;
}

export default createFinanceRouter;
