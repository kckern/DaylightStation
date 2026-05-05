/**
 * PayrollSyncService
 *
 * Syncs payroll data from external payroll API and uploads transactions to finance gateway.
 *
 * @module applications/finance/PayrollSyncService
 */

import { ValidationError } from '#system/utils/errors/index.mjs';

/**
 * Payroll sync service
 */
export class PayrollSyncService {
  #httpClient;
  #transactionGateway;
  #financeStore;
  #configService;
  #payrollConfig;
  #logger;

  /**
   * @param {Object} config
   * @param {Object} config.httpClient - HTTP client for API requests
   * @param {Object} config.transactionGateway - Gateway for transaction uploads
   * @param {Object} config.financeStore - YamlFinanceStore for persistence
   * @param {Object} config.configService - ConfigService for credentials
   * @param {Object} [config.logger] - Logger instance
   */
  constructor({ httpClient, transactionGateway, financeStore, configService, payrollConfig, logger = console }) {
    if (!httpClient) throw new ValidationError('PayrollSyncService requires httpClient', { field: 'httpClient' });
    if (!configService) throw new ValidationError('PayrollSyncService requires configService', { field: 'configService' });

    this.#httpClient = httpClient;
    this.#transactionGateway = transactionGateway;
    this.#financeStore = financeStore;
    this.#configService = configService;
    this.#payrollConfig = payrollConfig; // Pre-resolved payroll configuration
    this.#logger = logger;
  }

  /**
   * Get payroll configuration
   * @returns {Object} Payroll config
   */
  #getPayrollConfig() {
    // Prefer injected config (no config structure knowledge)
    if (this.#payrollConfig) {
      return this.#payrollConfig;
    }

    // Fallback for backwards compatibility. Accept multiple field-name
    // variants because `data/household/auth/payroll.yml` has historically
    // used snake_case (`auth_key`, `auth_cookie`) while older code looked
    // for `authkey`/`auth` — silently producing undefined cookie headers.
    const auth = this.#configService.getUserAuth?.('payroll') || {};
    return {
      baseUrl: auth.base_url || auth.base,
      authKey: auth.cookie_name || auth.authkey || auth.auth_key,
      authCookie: auth.auth_cookie || auth.auth,
      company: auth.company,
      employeeId: auth.employee_id || auth.employee,
      payrollAccountId: auth.payroll_account_id,
      directDepositAccountId: auth.direct_deposit_account_id,
    };
  }

  /**
   * Sync payroll data
   * @param {Object} options
   * @param {string} [options.token] - Auth token override
   * @returns {Promise<Object>} Sync result
   */
  async sync({ token } = {}) {
    const config = this.#getPayrollConfig();
    const { baseUrl, authKey, authCookie, company, employeeId, payrollAccountId, directDepositAccountId } = config;

    // Validate required config
    if (!baseUrl || !company || !employeeId) {
      throw new ValidationError('Payroll not configured: missing base_url, company, or employee_id', {
        baseUrl,
        company,
        employeeId
      });
    }

    const effectiveToken = token || authCookie;
    if (!effectiveToken) {
      throw new ValidationError('Payroll auth token required', { field: 'token' });
    }

    this.#logger.info?.('payroll.sync.start', { company, employeeId });

    // Load existing paycheck data
    const householdId = this.#configService.getDefaultHouseholdId?.() || 'default';
    const existingData = this.#financeStore?.getPayrollData?.(householdId) || { paychecks: {} };
    const existingDates = Object.keys(existingData.paychecks || {});

    // Fetch paycheck list
    const listUrl = `https://${baseUrl}/${company}/${employeeId}/paychecks`;
    const headers = { cookie: `${authKey}=${effectiveToken}` };

    let checksResponse;
    try {
      checksResponse = await this.#httpClient.get(listUrl, { headers });
    } catch (error) {
      if (error.response?.status === 401) {
        throw new ValidationError('Payroll auth expired - please provide a new token', { authExpired: true });
      }
      throw error;
    }

    const checks = checksResponse.data?.data?.checkSummaries || [];
    this.#logger.info?.('payroll.sync.found', { count: checks.length });

    // Build sets to detect already-fetched paychecks. We track by both
    // TriNet check ID (modern) AND payEndDt (legacy entries stored before
    // _checkId was added) — otherwise re-syncing legacy data produces
    // duplicate `<date>-rsu` entries because the new id format never
    // matches the old date-based key.
    const existingCheckIds = new Set();
    const existingPayEndDts = new Set();
    for (const [key, data] of Object.entries(existingData.paychecks || {})) {
      if (data._checkId) existingCheckIds.add(data._checkId);
      // Legacy entries used payEndDt as the storage key directly.
      const legacyDate = key.replace(/-rsu$/, '');
      if (/^\d{4}-\d{2}-\d{2}$/.test(legacyDate)) existingPayEndDts.add(legacyDate);
    }

    // Fetch details for each new paycheck
    const paychecks = { ...existingData.paychecks };
    let newCount = 0;

    for (const check of checks) {
      const { id, checkKey } = check;
      const payEndDt = checkKey?.payEndDt;

      if (!payEndDt) continue;

      // Skip if already retrieved by modern check ID, OR if a legacy entry
      // exists for this payEndDt and there is no entry for this specific id.
      // (A legitimate off-cycle RSU vest will have a different id but the
      // same payEndDt — those still need to be fetched, but we shouldn't
      // re-fetch the regular paycheck the legacy entry already represents.)
      if (existingCheckIds.has(id)) {
        this.#logger.debug?.('payroll.paycheck.skip', { payEndDt, id, reason: 'id-known' });
        continue;
      }
      if (existingPayEndDts.has(payEndDt) && !paychecks[`${payEndDt}-rsu`]) {
        // Legacy entry exists at this date and no -rsu slot is taken —
        // assume this is the same paycheck and stamp it with its real id.
        if (paychecks[payEndDt] && !paychecks[payEndDt]._checkId) {
          paychecks[payEndDt]._checkId = id;
          existingCheckIds.add(id);
          this.#logger.info?.('payroll.paycheck.legacy_id_attached', { payEndDt, id });
          continue;
        }
      }

      // Fetch paycheck details
      const detailUrl = `https://${baseUrl}/${company}/${employeeId}/paycheck-details/${id}`;
      try {
        const detailResponse = await this.#httpClient.get(detailUrl, { headers });
        const data = detailResponse.data?.data;
        const date = data?.header?.payEndDt;
        if (date) {
          // Use payEndDt as key; append '-rsu' suffix if key already taken (off-cycle RSU vests)
          let storageKey = date;
          if (paychecks[storageKey]) {
            storageKey = `${date}-rsu`;
          }
          paychecks[storageKey] = { ...data, _checkId: id };
          existingCheckIds.add(id);
          newCount++;
          this.#logger.info?.('payroll.paycheck.fetched', { date, storageKey, id });
        }
      } catch (error) {
        this.#logger.warn?.('payroll.paycheck.error', { id, error: error.message });
      }

      // Rate limit delay
      await new Promise(resolve => setTimeout(resolve, 2000));
    }

    // Save updated paycheck data
    if (newCount > 0 && this.#financeStore?.savePayrollData) {
      this.#financeStore.savePayrollData(householdId, { paychecks });
      this.#logger.info?.('payroll.sync.saved', { newCount });
    }

    // Upload transactions if gateway available
    let uploadResult = { uploadedCount: 0, failures: [] };
    if (this.#transactionGateway && payrollAccountId) {
      uploadResult = await this.#uploadTransactions(paychecks, {
        payrollAccountId,
        directDepositAccountId,
        householdId,
      });
    }

    return {
      status: uploadResult.failures.length > 0 ? 'partial_success' : 'success',
      paychecksFound: checks.length,
      newPaychecks: newCount,
      transactionsUploaded: uploadResult.uploadedCount,
      uploadFailures: uploadResult.failures,
    };
  }

  /**
   * Upload payroll transactions to transaction gateway
   * @private
   */
  async #uploadTransactions(paychecks, { payrollAccountId, directDepositAccountId, householdId }) {
    // Load transaction mapping
    const mapping = this.#financeStore?.getPayrollMapping?.(householdId) || [];

    const allTransactions = [];

    for (const [date, data] of Object.entries(paychecks)) {
      const { header, detail } = data;
      if (!header?.checkDt || !detail) continue;

      const checkDt = header.checkDt;
      const { preTaxDedns = [], postTaxDedns = [], taxWithholdings = [], earns = [], totals } = detail;

      // Map deductions
      const debits = this.#mapTransactions([...preTaxDedns, ...postTaxDedns, ...taxWithholdings], mapping, checkDt);
      const credits = this.#mapTransactions(earns, mapping, checkDt);

      // Net pay transfer
      const netPay = parseFloat(totals?.curNetPay || 0);
      if (netPay) {
        allTransactions.push({
          desc: 'Net Pay',
          amount: -netPay,
          date: checkDt,
          category: 'Payroll',
          type: 'transfer',
          toAccountId: directDepositAccountId,
        });
      }

      // Add debits (as negative) and credits
      allTransactions.push(
        ...debits.map(t => ({ ...t, amount: -Math.abs(t.amount) })),
        ...credits
      );
    }

    if (allTransactions.length === 0) return 0;

    // Sort by date
    allTransactions.sort((a, b) => new Date(a.date) - new Date(b.date));

    // Get existing transactions to avoid duplicates
    const startDate = allTransactions[0].date;
    const endDate = allTransactions[allTransactions.length - 1].date;

    let existingTransactions = [];
    try {
      existingTransactions = await this.#transactionGateway.getTransactions({
        startDate,
        endDate,
        accounts: ['Payroll'],
      });
    } catch (error) {
      this.#logger.warn?.('payroll.transaction.fetch.error', { error: error.message });
    }

    // Filter to transactions needing upload
    const toUpload = allTransactions.filter(t => {
      const amount = Math.abs(t.amount);
      const matches = existingTransactions.filter(
        b => b.date === t.date && Math.abs(b.amount) === amount
      );
      return matches.length === 0;
    });

    // Upload new transactions
    let uploadedCount = 0;
    const failures = [];
    for (const txn of toUpload) {
      const txType = txn.type || (txn.amount < 0 ? 'expense' : 'income');
      try {
        const params = {
          amount: txn.amount,
          date: txn.date,
          description: txn.desc,
          tags: txn.category ? [txn.category] : [],
          type: txType,
          status: 'cleared',
        };
        if (txType === 'transfer') {
          // Two-sided transfer: payroll account is the source, txn.toAccountId is the destination
          params.fromAccountId = payrollAccountId;
          params.toAccountId = txn.toAccountId;
        } else {
          params.accountId = payrollAccountId;
          if (txn.toAccountId) params.toAccountId = txn.toAccountId;
        }
        await this.#transactionGateway.addTransaction(params);
        uploadedCount++;
        this.#logger.info?.('payroll.upload.success', { date: txn.date, amount: txn.amount, type: txType });
      } catch (error) {
        const failure = { date: txn.date, amount: txn.amount, type: txType, desc: txn.desc, error: error.message };
        failures.push(failure);
        this.#logger.warn?.('payroll.upload.error', failure);
      }
    }

    if (failures.length > 0) {
      this.#logger.warn?.('payroll.upload.partial_failure', { uploadedCount, failureCount: failures.length });
    }

    return { uploadedCount, failures };
  }

  /**
   * Map transaction items using mapping rules
   * @private
   */
  #mapTransactions(items, mapping, checkDt) {
    return items
      .map(item => ({
        desc: item.desc || item.taxDesc || item.curEarnsDesc,
        amount: parseFloat(item.curTaxes || item.curDedns || item.curEarnsEarn || 0),
        date: checkDt,
      }))
      .filter(t => !!t.amount)
      .map(t => {
        const match = mapping.find(m => t.desc?.includes(m.input));
        if (match?.exclude) return null;
        if (!match) return t;
        return { ...t, desc: match.desc, category: match.cat };
      })
      .filter(t => t !== null);
  }
}

export default PayrollSyncService;
