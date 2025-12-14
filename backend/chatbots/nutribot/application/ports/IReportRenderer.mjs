/**
 * IReportRenderer Port
 * @module nutribot/application/ports/IReportRenderer
 * 
 * Port interface for generating visual nutrition reports.
 */

/**
 * @typedef {Object} NutritionReport
 * @property {string} date
 * @property {Object} totals - { calories, protein, carbs, fat }
 * @property {Object} goals - { calories, protein, carbs, fat }
 * @property {Array} items - Food items logged
 * @property {Array} [history] - Past days data for chart
 */

/**
 * Report renderer interface
 * @interface IReportRenderer
 */
export class IReportRenderer {
  /**
   * Render daily nutrition report as image
   * @param {NutritionReport} report - Report data
   * @returns {Promise<Buffer>} PNG image buffer
   */
  async renderDailyReport(report) {
    throw new Error('IReportRenderer.renderDailyReport must be implemented');
  }

  /**
   * Render food card for UPC items
   * @param {Object} item - Food item
   * @param {string} [imageUrl] - Optional product image URL
   * @returns {Promise<Buffer>} PNG image buffer
   */
  async renderFoodCard(item, imageUrl) {
    throw new Error('IReportRenderer.renderFoodCard must be implemented');
  }
}

export default IReportRenderer;
