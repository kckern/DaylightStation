/**
 * PayrollSyncService
 *
 * Syncs payroll data from external payroll API and uploads transactions to finance gateway.
 *
 * @module applications/finance/PayrollSyncService
 */

import { isPayrollGateway } from './ports/IPayrollGateway.mjs';
import { isPayrollRepository } from './ports/IPayrollRepository.mjs';

/**
 * Payroll sync service
 */
export class PayrollSyncService {
  #payrollGateway;
  #payrollRepository;
  #transactionGateway;
  #householdId;
  #payrollAccountId;
  #directDepositAccountId;
  #logger;

  /**
   * @param {Object} config
   * @param {Object} config.payrollGateway - Semantic payroll source
   * @param {Object} config.payrollRepository - Payroll persistence repository
   * @param {Object} config.transactionGateway - Gateway for transaction uploads
   * @param {string} [config.householdId='default']
   * @param {string} [config.payrollAccountId]
   * @param {string} [config.directDepositAccountId]
   * @param {Object} [config.logger] - Logger instance
   */
  constructor({
    payrollGateway,
    payrollRepository,
    transactionGateway,
    householdId = 'default',
    payrollAccountId,
    directDepositAccountId,
    logger = console,
  }) {
    if (!isPayrollGateway(payrollGateway)) {
      throw new TypeError('PayrollSyncService requires payrollGateway');
    }
    if (!isPayrollRepository(payrollRepository)) {
      throw new TypeError('PayrollSyncService requires payrollRepository');
    }

    this.#payrollGateway = payrollGateway;
    this.#payrollRepository = payrollRepository;
    this.#transactionGateway = transactionGateway;
    this.#householdId = householdId;
    this.#payrollAccountId = payrollAccountId;
    this.#directDepositAccountId = directDepositAccountId;
    this.#logger = logger;
  }

  /**
   * Sync payroll data
   * @param {Object} options
   * @param {string} [options.token] - Auth token override
   * @returns {Promise<Object>} Sync result
   */
  async sync({ token } = {}) {
    this.#logger.info?.('payroll.sync.start', { householdId: this.#householdId });
    const checks = await this.#payrollGateway.listPaychecks({ token });
    this.#logger.info?.('payroll.sync.found', { count: checks.length });
    const syncSession = this.#payrollRepository.beginSync(this.#householdId, checks);
    for (const check of syncSession.pendingChecks) {
      try {
        const paycheck = await this.#payrollGateway.getPaycheck(check, { token });
        if (paycheck) syncSession.record(paycheck);
      } catch (error) {
        this.#logger.warn?.('payroll.paycheck.error', { id: check.id, error: error.message });
      }
    }
    syncSession.commit();
    const newCount = syncSession.getNewCount();

    // Upload transactions if gateway available
    let uploadResult = { uploadedCount: 0, failures: [] };
    if (this.#transactionGateway && this.#payrollAccountId) {
      uploadResult = await this.#uploadTransactions({
        payrollAccountId: this.#payrollAccountId,
        directDepositAccountId: this.#directDepositAccountId,
        householdId: this.#householdId,
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
  async #uploadTransactions({ payrollAccountId, directDepositAccountId, householdId }) {
    // Load transaction mapping
    const mapping = this.#payrollRepository.getMapping(householdId);

    const allTransactions = [];

    for (const entry of this.#payrollRepository.getTransactionEntries(householdId)) {
      const debits = this.#mapTransactions(entry.deductions, mapping, entry.date);
      const credits = this.#mapTransactions(entry.earnings, mapping, entry.date);

      // Net pay transfer
      const netPay = entry.netPay;
      if (netPay) {
        allTransactions.push({
          desc: 'Net Pay',
          amount: -netPay,
          date: entry.date,
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

    if (allTransactions.length === 0) return { uploadedCount: 0, failures: [] };

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
        desc: item.description,
        amount: item.amount,
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
