/**
 * CostBudgetService - Application service for budget evaluation and alerts
 * @module applications/cost/services/CostBudgetService
 *
 * Evaluates budgets against current spending and triggers alerts when
 * thresholds are crossed. Implements alert deduplication to prevent
 * sending repeated alerts for the same threshold in the same period.
 *
 * @example
 * const service = new CostBudgetService({
 *   budgetRepository: yamlBudgetRepository,
 *   costRepository: yamlCostRepository,
 *   alertGateway: telegramAlertGateway,
 *   logger
 * });
 *
 * // Evaluate all budgets for a household
 * const statuses = await service.evaluateBudgets('default');
 */

import { CostAnalysisService } from '#domains/cost';

/**
 * CostBudgetService
 * Application service for evaluating budgets and triggering alerts
 *
 * @class CostBudgetService
 */
export class CostBudgetService {
  /** @type {ICostBudgetRepository} */
  #budgetRepository;

  /** @type {ICostRepository} */
  #costRepository;

  /** @type {ICostAlertGateway|null} */
  #alertGateway;

  /** @type {CostAnalysisService} */
  #analysisService;

  /** @type {Object} */
  #logger;

  /**
   * Map for alert deduplication
   * Tracks budgetId -> { warning: Date, critical: Date }
   * @type {Map<string, { warning: Date|null, critical: Date|null }>}
   */
  #lastAlerts;

  /**
   * Create a CostBudgetService instance
   *
   * @param {Object} config - Service configuration
   * @param {ICostBudgetRepository} config.budgetRepository - Repository for budget definitions (required)
   * @param {ICostRepository} config.costRepository - Repository for cost entries (required)
   * @param {ICostAlertGateway|null} [config.alertGateway=null] - Gateway for sending alerts (optional)
   * @param {CostAnalysisService} [config.analysisService] - Analysis service (creates new if not provided)
   * @param {Object} [config.logger=console] - Logger instance
   * @throws {Error} If budgetRepository or costRepository is not provided
   */
  constructor({ budgetRepository, costRepository, alertGateway = null, analysisService, logger = console }) {
    if (!budgetRepository) {
      throw new Error('budgetRepository is required');
    }
    if (!costRepository) {
      throw new Error('costRepository is required');
    }

    this.#budgetRepository = budgetRepository;
    this.#costRepository = costRepository;
    this.#alertGateway = alertGateway;
    this.#analysisService = analysisService || new CostAnalysisService();
    this.#logger = logger;
    this.#lastAlerts = new Map();
  }

  /**
   * Evaluate all budgets for a household
   *
   * Loads all budgets, calculates current spending, and triggers
   * alerts if thresholds are crossed.
   *
   * @param {string} householdId - Household identifier
   * @returns {Promise<BudgetStatus[]>} Array of budget status objects
   */
  async evaluateBudgets(householdId) {
    // Load all budgets for household
    const budgets = await this.#budgetRepository.findAll(householdId);

    if (budgets.length === 0) {
      return [];
    }

    const statuses = [];

    // Evaluate each budget
    for (const budget of budgets) {
      const status = await this.#evaluateBudget(budget);
      statuses.push(status);

      // Check and send alerts if needed
      await this.#checkAndAlert(budget, status);
    }

    return statuses;
  }

  /**
   * Evaluate a single budget against current spending
   *
   * @private
   * @param {CostBudget} budget - Budget to evaluate
   * @returns {Promise<BudgetStatus>} Status object with spending details
   */
  async #evaluateBudget(budget) {
    // Get period boundaries from budget
    const periodStart = budget.period.getCurrentPeriodStart();
    const periodEnd = budget.period.getCurrentPeriodEnd();

    // Build filter for cost query
    const filter = {
      category: budget.category
    };

    // Find entries within period
    const entries = await this.#costRepository.findByPeriod(periodStart, periodEnd, filter);

    // Calculate spend using analysis service
    const spent = this.#analysisService.calculateSpend(entries, {
      category: budget.category
    });

    // Build status object using budget's domain methods
    return {
      budgetId: budget.id,
      budgetName: budget.name,
      spent: spent.amount,
      limit: budget.amount.amount,
      percentSpent: budget.getPercentSpent(spent),
      remaining: this.#calculateRemaining(budget, spent),
      isOverBudget: budget.isOverBudget(spent),
      isWarning: budget.isAtWarningLevel(spent),
      isCritical: budget.isAtCriticalLevel(spent),
      periodStart,
      periodEnd
    };
  }

  /**
   * Calculate remaining budget, handling over-budget case
   *
   * @private
   * @param {CostBudget} budget - Budget to check
   * @param {Money} spent - Amount spent
   * @returns {number} Remaining amount (0 if over budget)
   */
  #calculateRemaining(budget, spent) {
    try {
      return budget.getRemaining(spent).amount;
    } catch {
      // Money.subtract throws if result would be negative
      return 0;
    }
  }

  /**
   * Check if alerts should be sent and send them
   *
   * Implements deduplication - only sends one alert per threshold
   * level per budget per period.
   *
   * @private
   * @param {CostBudget} budget - Budget being evaluated
   * @param {BudgetStatus} status - Current budget status
   * @returns {Promise<void>}
   */
  async #checkAndAlert(budget, status) {
    // No gateway means no alerts
    if (!this.#alertGateway) {
      return;
    }

    // Nothing to alert about
    if (!status.isWarning && !status.isCritical) {
      return;
    }

    // Get or initialize alert tracking for this budget
    let alertRecord = this.#lastAlerts.get(budget.id);
    if (!alertRecord) {
      alertRecord = { warning: null, critical: null };
      this.#lastAlerts.set(budget.id, alertRecord);
    }

    // Check if we should send a critical alert
    if (status.isCritical && !this.#alreadyAlertedThisPeriod(alertRecord.critical, status.periodStart)) {
      await this.#sendAlert(budget, status, 'critical');
      alertRecord.critical = new Date();
    }
    // Check if we should send a warning alert (only if not already critical)
    else if (status.isWarning && !this.#alreadyAlertedThisPeriod(alertRecord.warning, status.periodStart)) {
      await this.#sendAlert(budget, status, 'warning');
      alertRecord.warning = new Date();
    }
  }

  /**
   * Check if we've already alerted for this period
   *
   * @private
   * @param {Date|null} lastAlert - Time of last alert for this level
   * @param {Date} periodStart - Start of current period
   * @returns {boolean} True if already alerted this period
   */
  #alreadyAlertedThisPeriod(lastAlert, periodStart) {
    if (!lastAlert) {
      return false;
    }
    // If last alert was after period start, we've already alerted this period
    return lastAlert >= periodStart;
  }

  /**
   * Send an alert through the gateway
   *
   * @private
   * @param {CostBudget} budget - Budget that triggered alert
   * @param {BudgetStatus} status - Current status
   * @param {string} severity - 'warning' or 'critical'
   * @returns {Promise<void>}
   */
  async #sendAlert(budget, status, severity) {
    const alertType = severity === 'critical' ? 'budget_critical' : 'budget_warning';
    const percentStr = Math.round(status.percentSpent);

    const message = severity === 'critical'
      ? `${budget.name} has reached ${percentStr}% of budget (critical threshold)`
      : `${budget.name} has reached ${percentStr}% of budget (warning threshold)`;

    const alert = {
      type: alertType,
      severity,
      budgetId: budget.id,
      budgetName: budget.name,
      budget: {
        id: budget.id,
        name: budget.name,
        category: budget.category?.toString() || null,
        amount: budget.amount.toJSON()
      },
      currentSpend: {
        amount: status.spent,
        currency: 'USD'
      },
      percentSpent: status.percentSpent,
      message
    };

    try {
      await this.#alertGateway.sendAlert(alert);

      this.#logger.info?.('cost.alert.sent', {
        budgetId: budget.id,
        severity,
        percentSpent: status.percentSpent
      });
    } catch (error) {
      this.#logger.error?.('cost.alert.failed', {
        budgetId: budget.id,
        severity,
        error: error.message
      });
    }
  }
}

export default CostBudgetService;
