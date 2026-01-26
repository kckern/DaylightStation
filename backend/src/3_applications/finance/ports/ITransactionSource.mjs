/**
 * ITransactionSource - Port interface for transaction data
 */

export const ITransactionSource = {
  /**
   * Find transactions by category
   * @param {string} category - Category name
   * @param {string} startDate - Start date
   * @param {string} endDate - End date
   * @returns {Promise<Object[]>}
   */
  async findByCategory(category, startDate, endDate) {},

  /**
   * Find transactions in date range
   * @param {string} startDate - Start date
   * @param {string} endDate - End date
   * @returns {Promise<Object[]>}
   */
  async findInRange(startDate, endDate) {},

  /**
   * Find transactions by account
   * @param {string} accountId - Account ID
   * @returns {Promise<Object[]>}
   */
  async findByAccount(accountId) {}
};

export default ITransactionSource;
