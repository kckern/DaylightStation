export class FinanceApiService {
  #provider;
  #providerDescriptor;
  #store;
  #harvest;
  #compilation;
  #categorization;
  #payroll;
  #defaultHouseholdId;
  #currentMonth;
  #timestamp;
  #logger;

  constructor({
    provider = null,
    providerDescriptor = {
      source: 'provider',
      adapter: 'provider',
      unavailableMessage: 'Finance provider not initialized',
    },
    store = null,
    harvestService = null,
    compilationService = null,
    categorizationService = null,
    payrollService = null,
    defaultHouseholdId = () => 'default',
    currentMonth,
    timestamp,
    logger = console,
  } = {}) {
    this.#provider = provider;
    this.#providerDescriptor = providerDescriptor;
    this.#store = store;
    this.#harvest = harvestService;
    this.#compilation = compilationService;
    this.#categorization = categorizationService;
    this.#payroll = payrollService;
    this.#defaultHouseholdId = defaultHouseholdId;
    this.#currentMonth = currentMonth;
    this.#timestamp = timestamp;
    this.#logger = logger;
  }

  householdId(requested) {
    return requested || this.#defaultHouseholdId?.() || 'default';
  }

  #providerConfigured() {
    return this.#provider?.isConfigured() || false;
  }

  overview(householdId) {
    const config = this.#store?.getBudgetConfig(householdId);
    if (!config) return null;
    return {
      household: householdId,
      budgetCount: config.budget?.length || 0,
      hasMortgage: !!config.mortgage,
      accounts: config.budget?.flatMap(budget => budget.accounts || [])
        .filter((value, index, all) => all.indexOf(value) === index) || [],
      configured: this.#providerConfigured(),
    };
  }

  compiled(householdId) {
    return this.#store?.getCompiledFinances(householdId) || null;
  }

  dayToDay(householdId) {
    const finances = this.#store?.getCompiledFinances(householdId);
    if (!finances?.budgets) return { kind: 'budget_not_found' };

    const currentMonth = this.#currentMonth();
    const dates = Object.keys(finances.budgets).sort((a, b) => b.localeCompare(a));
    for (const startDate of dates) {
      const dayToDayBudget = finances.budgets[startDate]?.dayToDayBudget;
      if (!dayToDayBudget) continue;
      const months = Object.keys(dayToDayBudget)
        .filter(month => month <= currentMonth)
        .sort((a, b) => b.localeCompare(a));
      if (months.length === 0) continue;
      const budget = { ...dayToDayBudget[months[0]] };
      delete budget.transactions;
      return { kind: 'ok', budget };
    }
    return { kind: 'period_not_found' };
  }

  async accounts({ householdId, refresh }) {
    if (refresh && this.#providerConfigured()) {
      const accounts = await this.#provider.getAccountBalances();
      return { accounts, source: this.#providerDescriptor.source, refreshedAt: this.#timestamp() };
    }
    return {
      accounts: this.#store?.getAccountBalances(householdId) || [],
      source: 'cache',
      household: householdId,
    };
  }

  async transactions({ householdId, startDate, endDate, category, account, budgetDate }) {
    let transactions;
    if (budgetDate) {
      transactions = this.#store?.getTransactions(budgetDate, householdId) || [];
    } else if (this.#providerConfigured() && (startDate || endDate)) {
      if (category) transactions = await this.#provider.findByCategory(category, startDate, endDate);
      else if (account) transactions = await this.#provider.findByAccount(account);
      else transactions = await this.#provider.findInRange(startDate, endDate);
    } else {
      const periods = this.#store?.listBudgetPeriods(householdId) || [];
      transactions = periods.length > 0
        ? this.#store?.getTransactions(periods[periods.length - 1], householdId) || []
        : [];
    }
    return { transactions, count: transactions.length, household: householdId };
  }

  async updateTransaction(id, patch) {
    if (!this.#providerConfigured()) return null;
    const updated = await this.#provider.updateTransaction(id, patch);
    return { ok: true, transactionId: id, updated };
  }

  budgets(householdId) {
    const finances = this.#store?.getCompiledFinances(householdId);
    if (!finances?.budgets) return null;
    return {
      budgets: Object.entries(finances.budgets).map(([startDate, budget]) => ({
        startDate,
        endDate: budget.budgetEnd,
        accounts: budget.accounts,
        totalBudget: budget.totalBudget,
        shortTermStatus: budget.shortTermStatus,
      })),
      household: householdId,
    };
  }

  budget(householdId, budgetId) {
    const finances = this.#store?.getCompiledFinances(householdId);
    if (!finances?.budgets) return { kind: 'data_not_found' };
    const budget = finances.budgets[budgetId];
    return budget
      ? { kind: 'ok', value: { budget, budgetId, household: householdId } }
      : { kind: 'budget_not_found' };
  }

  mortgage(householdId) {
    const mortgage = this.#store?.getCompiledFinances(householdId)?.mortgage;
    return mortgage ? { mortgage, household: householdId } : null;
  }

  async refresh(householdId, { skipCategorization, skipCompilation }) {
    if (!this.#harvest) return { kind: 'service_not_configured' };
    if (!this.#providerConfigured()) return { kind: 'provider_not_configured' };
    this.#logger.info?.('finance.refresh.started', { householdId });
    const result = await this.#harvest.harvest(householdId, {
      skipCategorization: skipCategorization === true,
      skipCompilation: skipCompilation === true,
    });
    this.#logger.info?.('finance.refresh.completed', { householdId, result: result.status });
    return { kind: 'ok', result };
  }

  async compile(householdId) {
    if (!this.#compilation) return null;
    this.#logger.info?.('finance.compile.started', { householdId });
    const result = await this.#compilation.compile(householdId);
    this.#logger.info?.('finance.compile.completed', { householdId });
    return { status: 'success', budgetCount: Object.keys(result.budgets).length, hasMortgage: !!result.mortgage };
  }

  async categorize(householdId, { budgetDate, preview }) {
    if (!this.#categorization) return null;
    this.#logger.info?.('finance.categorize.started', { householdId, budgetDate, preview });
    let transactions;
    if (budgetDate) {
      transactions = this.#store?.getTransactions(budgetDate, householdId) || [];
    } else {
      const periods = this.#store?.listBudgetPeriods(householdId) || [];
      transactions = periods.length > 0
        ? this.#store?.getTransactions(periods[periods.length - 1], householdId) || []
        : [];
    }
    const result = preview === true
      ? await this.#categorization.preview(transactions, householdId)
      : await this.#categorization.categorize(transactions, householdId);
    return { status: preview === true ? 'preview' : 'success', ...result };
  }

  saveMemo(householdId, transactionId, { memo, effectiveDate }) {
    const value = effectiveDate ? { ...(memo ? { memo } : {}), effectiveDate } : memo;
    this.#store?.saveMemo(transactionId, value, householdId);
    return { ok: true, transactionId, memo: value };
  }

  memos(householdId) {
    return { memos: this.#store?.getMemos(householdId) || {}, household: householdId };
  }

  pairs(householdId) {
    return { pairs: this.#store?.getPairs(householdId) || [], household: householdId };
  }

  async addPair(householdId, { debit, credit, desc }) {
    this.#store?.addPair({ debit: Number(debit), credit: Number(credit), desc: desc || '' }, householdId);
    if (this.#compilation) await this.#compilation.compile(householdId);
    return { ok: true, debit, credit, desc };
  }

  async removePair(householdId, { debit, credit }) {
    this.#store?.removePair(Number(debit), Number(credit), householdId);
    if (this.#compilation) await this.#compilation.compile(householdId);
    return { ok: true, debit, credit };
  }

  async syncPayroll({ token }) {
    if (!this.#payroll) return null;
    this.#logger.info?.('finance.payroll.sync.started', { hasToken: !!token });
    const result = await this.#payroll.sync({ token });
    this.#logger.info?.('finance.payroll.sync.completed', { result: result.status });
    return result;
  }

  metrics() {
    if (!this.#provider) {
      return {
        adapter: this.#providerDescriptor.adapter,
        configured: false,
        message: this.#providerDescriptor.unavailableMessage,
      };
    }
    return {
      adapter: this.#providerDescriptor.adapter,
      configured: this.#provider.isConfigured(),
      ...this.#provider.getMetrics(),
    };
  }
}
