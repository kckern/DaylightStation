/**
 * Adapts the finance YAML store to semantic payroll sync sessions. Legacy date
 * keys, modern check IDs, duplicate-date RSU suffixes, and persistence shape
 * stay behind this repository.
 */
export class FinanceStorePayrollRepository {
  #financeStore;
  #logger;

  constructor({ financeStore, logger = console }) {
    this.#financeStore = financeStore;
    this.#logger = logger;
  }

  beginSync(householdId, checks) {
    const existingData = this.#financeStore?.getPayrollData?.(householdId) || { paychecks: {} };
    const paychecks = { ...(existingData.paychecks || {}) };
    const knownIds = new Set();
    const legacyDates = new Set();

    for (const [key, data] of Object.entries(paychecks)) {
      if (data._checkId) knownIds.add(data._checkId);
      const date = key.replace(/-rsu$/, '');
      if (/^\d{4}-\d{2}-\d{2}$/.test(date)) legacyDates.add(date);
    }

    const pendingChecks = [];
    for (const check of checks) {
      if (!check.payEndDate) continue;
      if (knownIds.has(check.id)) {
        this.#logger.debug?.('payroll.paycheck.skip', {
          payEndDt: check.payEndDate,
          id: check.id,
          reason: 'id-known',
        });
        continue;
      }
      if (legacyDates.has(check.payEndDate) && !paychecks[`${check.payEndDate}-rsu`]) {
        const legacy = paychecks[check.payEndDate];
        if (legacy && !legacy._checkId) {
          legacy._checkId = check.id;
          knownIds.add(check.id);
          this.#logger.info?.('payroll.paycheck.legacy_id_attached', {
            payEndDt: check.payEndDate,
            id: check.id,
          });
          continue;
        }
      }
      pendingChecks.push(check);
    }

    let newCount = 0;
    return {
      pendingChecks,
      record: ({ id, payEndDate, data }) => {
        let storageKey = payEndDate;
        if (paychecks[storageKey]) storageKey = `${payEndDate}-rsu`;
        paychecks[storageKey] = { ...data, _checkId: id };
        knownIds.add(id);
        newCount++;
        this.#logger.info?.('payroll.paycheck.fetched', { date: payEndDate, storageKey, id });
      },
      getPaychecks: () => paychecks,
      getNewCount: () => newCount,
      commit: () => {
        if (newCount > 0 && this.#financeStore?.savePayrollData) {
          this.#financeStore.savePayrollData(householdId, { paychecks });
          this.#logger.info?.('payroll.sync.saved', { newCount });
        }
      },
    };
  }

  getMapping(householdId) {
    return this.#financeStore?.getPayrollMapping?.(householdId) || [];
  }

  getTransactionEntries(householdId) {
    const data = this.#financeStore?.getPayrollData?.(householdId) || { paychecks: {} };
    return Object.values(data.paychecks || {})
      .filter((paycheck) => paycheck.header?.checkDt && paycheck.detail)
      .map((paycheck) => {
        const detail = paycheck.detail;
        const projectItems = (items, amountFields) => (items || []).map((item) => ({
          description: item.desc || item.taxDesc || item.curEarnsDesc,
          amount: Number.parseFloat(amountFields.map((field) => item[field]).find(Boolean) || 0),
        }));
        return {
          date: paycheck.header.checkDt,
          netPay: Number.parseFloat(detail.totals?.curNetPay || 0),
          deductions: projectItems(
            [...(detail.preTaxDedns || []), ...(detail.postTaxDedns || []), ...(detail.taxWithholdings || [])],
            ['curTaxes', 'curDedns'],
          ),
          earnings: projectItems(detail.earns, ['curEarnsEarn']),
        };
      });
  }
}

export default FinanceStorePayrollRepository;
