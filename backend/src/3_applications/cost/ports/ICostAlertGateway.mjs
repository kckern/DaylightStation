/**
 * ICostAlertGateway - Port interface for sending cost alerts
 * @module applications/cost/ports/ICostAlertGateway
 *
 * Defines the contract for adapters that send budget and cost alerts.
 * Implementations handle delivery through various channels (Telegram, email, etc.).
 *
 * @example
 * class TelegramAlertGateway extends ICostAlertGateway {
 *   async sendAlert(alert) {
 *     await this.#telegram.sendMessage(alert.recipientId, formatMessage(alert));
 *   }
 * }
 */

/**
 * ICostAlertGateway interface
 * Abstract base class for alert delivery adapters
 *
 * @class ICostAlertGateway
 */
export class ICostAlertGateway {
  /**
   * Send a cost alert
   *
   * Delivers an alert about budget status or unusual spending patterns.
   *
   * @param {Object} alert - Alert details
   * @param {string} alert.type - Alert type ('warning', 'critical', 'over_budget', 'anomaly')
   * @param {string} alert.budgetId - ID of the budget triggering the alert
   * @param {string} alert.budgetName - Human-readable budget name
   * @param {string} [alert.category] - Category path if category-specific
   * @param {number} alert.percentSpent - Percentage of budget spent
   * @param {Object} alert.spent - Amount spent (Money-compatible)
   * @param {Object} alert.limit - Budget limit (Money-compatible)
   * @param {string} alert.period - Budget period ('daily', 'weekly', 'monthly')
   * @param {string} alert.householdId - Household identifier
   * @param {Date} alert.timestamp - When the alert was generated
   * @returns {Promise<void>}
   * @throws {Error} Must be implemented by concrete class
   */
  async sendAlert(alert) {
    throw new Error('ICostAlertGateway.sendAlert must be implemented');
  }
}

export default ICostAlertGateway;
