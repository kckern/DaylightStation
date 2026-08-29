import { sendInternalError } from '#api/utils/internalError.mjs';
/** Finance HTTP API backed by a capability-oriented application service. */
import express from 'express';
import { asyncHandler } from '#system/http/middleware/index.mjs';

function serializeAccount(account) {
  const value = typeof account?.toJSON === 'function' ? account.toJSON() : account;
  return {
    id: value.id, name: value.name, type: value.type, balance: value.balance,
    currency: value.currency, institution: value.institution,
    lastUpdated: value.lastUpdated, metadata: value.metadata,
  };
}

function serializeTransaction(transaction) {
  const value = typeof transaction?.toJSON === 'function' ? transaction.toJSON() : transaction;
  return {
    id: value.id, date: value.date, amount: value.amount, description: value.description,
    category: value.category, accountId: value.accountId, type: value.type,
    tags: value.tags, metadata: value.metadata,
  };
}

export function createFinanceRouter({ financeService, logger = console }) {
  const router = express.Router();
  const household = requested => financeService.householdId(requested);

  router.get('/', (req, res) => {
    const householdId = household(req.query.household);
    try {
      const result = financeService.overview(householdId);
      if (!result) return res.status(404).json({ error: 'Finance configuration not found' });
      return res.json(result);
    } catch (error) {
      logger.error?.('finance.config.error', { error: error.message });
      return sendInternalError(res, { error: 'Failed to load finance config' });
    }
  });

  router.get('/data', (req, res) => {
    const householdId = household(req.query.household);
    try {
      const result = financeService.compiled(householdId);
      if (!result) return res.status(404).json({ error: 'Compiled finances not found' });
      return res.json(result);
    } catch (error) {
      logger.error?.('finance.data.error', { error: error.message });
      return sendInternalError(res, { error: 'Failed to load finances' });
    }
  });

  router.get('/data/daytoday', (req, res) => {
    const householdId = household(req.query.household);
    try {
      const result = financeService.dayToDay(householdId);
      if (result.kind === 'budget_not_found') return res.status(404).json({ error: 'Budget data not found' });
      if (result.kind === 'period_not_found') return res.status(404).json({ error: 'No budget data for current or past months' });
      return res.json(result.budget);
    } catch (error) {
      logger.error?.('finance.daytoday.error', { error: error.message });
      return sendInternalError(res, { error: 'Failed to load day-to-day budget' });
    }
  });

  router.get('/accounts', asyncHandler(async (req, res) => {
    const householdId = household(req.query.household);
    const result = await financeService.accounts({ householdId, refresh: req.query.refresh === 'true' });
    return res.json({ ...result, accounts: result.accounts.map(serializeAccount) });
  }));

  router.get('/transactions', asyncHandler(async (req, res) => {
    const householdId = household(req.query.household);
    const { startDate, endDate, category, account, budgetDate } = req.query;
    const result = await financeService.transactions({ householdId, startDate, endDate, category, account, budgetDate });
    return res.json({ ...result, transactions: result.transactions.map(serializeTransaction) });
  }));

  router.post('/transactions/:id', asyncHandler(async (req, res) => {
    const { id } = req.params;
    const { description, tags, memo, type } = req.body;
    const result = await financeService.updateTransaction(id, { description, tags, memo, type });
    if (!result) return res.status(503).json({ error: 'Buxfer adapter not configured' });
    return res.json(result);
  }));

  router.get('/budgets', (req, res) => {
    const householdId = household(req.query.household);
    try {
      const result = financeService.budgets(householdId);
      if (!result) return res.status(404).json({ error: 'Budget data not found' });
      return res.json(result);
    } catch (error) {
      logger.error?.('finance.budgets.error', { error: error.message });
      return sendInternalError(res, { error: 'Failed to load budgets' });
    }
  });

  router.get('/budgets/:budgetId', (req, res) => {
    const householdId = household(req.query.household);
    const { budgetId } = req.params;
    try {
      const result = financeService.budget(householdId, budgetId);
      if (result.kind === 'data_not_found') return res.status(404).json({ error: 'Budget data not found' });
      if (result.kind === 'budget_not_found') return res.status(404).json({ error: 'Budget not found', budgetId });
      return res.json(result.value);
    } catch (error) {
      logger.error?.('finance.budgets.detail.error', { budgetId, error: error.message });
      return sendInternalError(res, { error: 'Failed to load budget detail' });
    }
  });

  router.get('/mortgage', (req, res) => {
    const householdId = household(req.query.household);
    try {
      const result = financeService.mortgage(householdId);
      if (!result) return res.status(404).json({ error: 'Mortgage data not found' });
      return res.json(result);
    } catch (error) {
      logger.error?.('finance.mortgage.error', { error: error.message });
      return sendInternalError(res, { error: 'Failed to load mortgage data' });
    }
  });

  router.post('/refresh', asyncHandler(async (req, res) => {
    const body = req.body || {};
    const householdId = household(body.household || req.query.household);
    const result = await financeService.refresh(householdId, body);
    if (result.kind === 'service_not_configured') {
      return res.status(503).json({ error: 'Harvest service not configured', hint: 'Initialize FinanceHarvestService in bootstrap' });
    }
    if (result.kind === 'provider_not_configured') {
      return res.status(503).json({ error: 'Buxfer adapter not configured', hint: 'Configure Buxfer credentials in user auth settings' });
    }
    return res.json(result.result);
  }));

  router.post('/compile', asyncHandler(async (req, res) => {
    const householdId = household(req.body.household || req.query.household);
    const result = await financeService.compile(householdId);
    if (!result) {
      return res.status(503).json({ error: 'Compilation service not configured', hint: 'Initialize BudgetCompilationService in bootstrap' });
    }
    return res.json(result);
  }));

  router.post('/categorize', asyncHandler(async (req, res) => {
    const householdId = household(req.body.household || req.query.household);
    const result = await financeService.categorize(householdId, req.body);
    if (!result) {
      return res.status(503).json({ error: 'Categorization service not configured', hint: 'Initialize TransactionCategorizationService in bootstrap' });
    }
    return res.json(result);
  }));

  router.post('/memos/:transactionId', (req, res) => {
    const householdId = household(req.body.household || req.query.household);
    const { transactionId } = req.params;
    try {
      return res.json(financeService.saveMemo(householdId, transactionId, req.body));
    } catch (error) {
      logger.error?.('finance.memo.error', { transactionId, error: error.message });
      return sendInternalError(res, { error: 'Failed to save memo' });
    }
  });

  router.get('/memos', (req, res) => {
    const householdId = household(req.query.household);
    try {
      return res.json(financeService.memos(householdId));
    } catch (error) {
      logger.error?.('finance.memos.error', { error: error.message });
      return sendInternalError(res, { error: 'Failed to load memos' });
    }
  });

  router.get('/pairs', (req, res) => {
    const householdId = household(req.query.household);
    try {
      return res.json(financeService.pairs(householdId));
    } catch (error) {
      logger.error?.('finance.pairs.get.error', { error: error.message });
      return sendInternalError(res, { error: 'Failed to load pairs' });
    }
  });

  router.post('/pairs', async (req, res) => {
    const householdId = household(req.body.household || req.query.household);
    const { debit, credit, desc } = req.body;
    if (!debit || !credit) return res.status(400).json({ error: 'debit and credit transaction IDs required' });
    try {
      return res.json(await financeService.addPair(householdId, { debit, credit, desc }));
    } catch (error) {
      logger.error?.('finance.pairs.create.error', { debit, credit, error: error.message });
      return sendInternalError(res, { error: 'Failed to create pair' });
    }
  });

  router.delete('/pairs', async (req, res) => {
    const householdId = household(req.body.household || req.query.household);
    const { debit, credit } = req.body;
    if (!debit || !credit) return res.status(400).json({ error: 'debit and credit transaction IDs required' });
    try {
      return res.json(await financeService.removePair(householdId, { debit, credit }));
    } catch (error) {
      logger.error?.('finance.pairs.delete.error', { debit, credit, error: error.message });
      return sendInternalError(res, { error: 'Failed to delete pair' });
    }
  });

  router.post('/payroll/sync', asyncHandler(async (req, res) => {
    const result = await financeService.syncPayroll({ token: req.body.token });
    if (!result) {
      return res.status(503).json({ error: 'Payroll service not configured', hint: 'Initialize PayrollSyncService in bootstrap' });
    }
    return res.json(result);
  }));

  router.get('/metrics', (req, res) => res.json(financeService.metrics()));

  return router;
}

export default createFinanceRouter;
