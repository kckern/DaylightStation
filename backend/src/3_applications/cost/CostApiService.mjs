function periodRange(period, referenceTime) {
  if (!period) {
    const now = referenceTime();
    const year = now.getFullYear();
    const month = now.getMonth();
    return { start: new Date(year, month, 1), end: new Date(year, month + 1, 0, 23, 59, 59, 999) };
  }
  if (period.includes('..')) {
    const [start, end] = period.split('..');
    return { start: new Date(start), end: new Date(end) };
  }
  const [year, month] = period.split('-').map(Number);
  return { start: new Date(year, month - 1, 1), end: new Date(year, month, 0, 23, 59, 59, 999) };
}

/** Owns cost-query defaults, range semantics, and reporting orchestration. */
export class CostApiService {
  #reporting; #budgets; #referenceTime;
  constructor({ reportingService, budgetService = null, referenceTime } = {}) {
    if (!reportingService || typeof referenceTime !== 'function') {
      throw new TypeError('CostApiService requires reportingService and referenceTime');
    }
    this.#reporting = reportingService; this.#budgets = budgetService; this.#referenceTime = referenceTime;
  }
  #period(period) { return periodRange(period, this.#referenceTime); }
  dashboard({ household = 'default', period } = {}) {
    return this.#reporting.getDashboard(household, this.#period(period));
  }
  spendByCategory({ household = 'default', period, depth = 2 } = {}) {
    return this.#reporting.getSpendByCategory(household, this.#period(period), depth);
  }
  spendByUser({ household = 'default', period } = {}) {
    return this.#reporting.getSpendByUser(household, this.#period(period));
  }
  spendByResource({ household = 'default', period } = {}) {
    return this.#reporting.getSpendByResource(household, this.#period(period));
  }
  entries({ household = 'default', period, category, userId, page = 1, limit = 50 } = {}) {
    const filter = { householdId: household, ...this.#period(period) };
    if (category) filter.category = category;
    if (userId) filter.userId = userId;
    return this.#reporting.getEntries(filter, { page, limit });
  }
  async budgetStatuses({ household = 'default' } = {}) {
    if (!this.#budgets) return { budgets: [], message: 'Budget service not configured' };
    return { budgets: await this.#budgets.evaluateBudgets(household) };
  }
}

export default CostApiService;
