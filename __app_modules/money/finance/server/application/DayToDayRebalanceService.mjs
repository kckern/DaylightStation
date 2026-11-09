/**
 * DayToDayRebalanceService
 *
 * Runs inside the Buxfer budget sync (FinanceHarvestService.harvest, after
 * compilation): for each open budget period with a `dayToDay.rebalance` rule,
 * plans the current month (on its burn-down as of today) and the month before
 * it (landing on $0), retags the fungible purchases in Buxfer, mirrors the new
 * tags into the stored period transactions, and recompiles when anything moved.
 * See domain/services/DayToDayRebalancer.mjs for the rule.
 *
 * @module applications/finance/DayToDayRebalanceService
 */

import { nowDate } from '#system/utils/time.mjs';
import { ValidationError } from '#apps/common/errors/SemanticErrors.mjs';
import { planDayToDayRebalance, previousMonth } from '../domain/services/DayToDayRebalancer.mjs';

const toDateString = (value) => (value instanceof Date ? value.toISOString().slice(0, 10) : String(value).slice(0, 10));

export class DayToDayRebalanceService {
  #financeStore;
  #transactionGateway;
  #compilationService;
  #today;
  #logger;

  /**
   * @param {Object} deps
   * @param {Object} deps.financeStore - getBudgetConfig / getCompiledFinances / getTransactions / saveTransactions
   * @param {Object} deps.transactionGateway - updateTransaction(id, { tags })
   * @param {Object} deps.compilationService - compile(householdId)
   * @param {() => string} [deps.today] - household-local YYYY-MM-DD
   * @param {Object} [deps.logger]
   */
  constructor({ financeStore, transactionGateway, compilationService, today = nowDate, logger = console }) {
    if (!financeStore) throw new ValidationError('DayToDayRebalanceService requires financeStore', { field: 'financeStore' });
    if (!transactionGateway) throw new ValidationError('DayToDayRebalanceService requires transactionGateway', { field: 'transactionGateway' });
    this.#financeStore = financeStore;
    this.#transactionGateway = transactionGateway;
    this.#compilationService = compilationService;
    this.#today = today;
    this.#logger = logger;
  }

  /**
   * @param {string} [householdId]
   * @returns {Promise<{ months: Object[], moved: number, failed: number, recompiled: boolean }>}
   */
  async rebalance(householdId) {
    const today = this.#today();
    const config = this.#financeStore.getBudgetConfig(householdId);
    const compiled = this.#financeStore.getCompiledFinances(householdId);
    const result = { months: [], moved: 0, failed: 0, recompiled: false };
    if (!config?.budget || !compiled?.budgets) return result;

    for (const period of config.budget) {
      const rule = period.dayToDay?.rebalance;
      if (period.closed || !rule) continue;
      const periodId = toDateString(period.timeframe.start);
      const budget = compiled.budgets[periodId];
      if (!budget?.dayToDayBudget) continue;

      const retagged = new Map(); // id → new tagNames
      for (const month of [previousMonth(today.slice(0, 7)), today.slice(0, 7)]) {
        const monthData = budget.dayToDayBudget[month];
        if (!monthData) continue;
        const plan = planDayToDayRebalance({ month, monthData, shortTermBuckets: budget.shortTermBuckets, rule, today });
        if (!plan) continue;

        const summary = {
          month, status: plan.status, asOf: plan.asOf, balance: plan.balance, target: plan.target,
          gap: plan.gap, candidates: plan.candidateCount ?? 0, moves: [], balanceAfter: plan.balance,
        };
        if (plan.status !== 'on-pace' && !plan.moves.length) {
          // No fungible purchases to move — Groceries, Fuel etc. stay where they are.
          this.#logger.info?.('finance.rebalance.no_wiggle_room', { month, status: plan.status, gap: plan.gap, from: plan.from });
        }

        let movedTotal = 0;
        for (const move of plan.moves) {
          try {
            await this.#transactionGateway.updateTransaction(move.id, { tags: move.tags });
            retagged.set(String(move.id), move.tags);
            movedTotal += move.amount;
            summary.moves.push({ id: move.id, date: move.date, description: move.description, amount: move.amount, from: move.from, to: move.to });
            this.#logger.info?.('finance.rebalance.moved', { month, id: move.id, date: move.date, amount: move.amount, from: move.from, to: move.to });
          } catch (error) {
            result.failed++;
            this.#logger.warn?.('finance.rebalance.move_failed', { month, id: move.id, error: error.message });
          }
        }
        movedTotal = Math.round(movedTotal * 100) / 100;
        summary.balanceAfter = Math.round((plan.status === 'overspent' ? plan.balance + movedTotal : plan.balance - movedTotal) * 100) / 100;
        result.moved += summary.moves.length;
        result.months.push(summary);
        this.#logger.info?.('finance.rebalance.month', { ...summary, moves: summary.moves.length, movedTotal });
      }

      if (retagged.size) this.#mirrorTags(periodId, retagged, householdId);
    }

    if (result.moved && this.#compilationService) {
      await this.#compilationService.compile(householdId);
      result.recompiled = true;
    }
    return result;
  }

  /** Write the new tags into the stored period so the recompile sees them without a re-fetch. */
  #mirrorTags(periodId, retagged, householdId) {
    const transactions = this.#financeStore.getTransactions(periodId, householdId) || [];
    const updated = transactions.map((txn) => {
      const tags = retagged.get(String(txn.id));
      return tags ? { ...txn, tagNames: tags, tags: tags.join(',') } : txn;
    });
    this.#financeStore.saveTransactions(periodId, updated, householdId);
  }
}

export default DayToDayRebalanceService;
