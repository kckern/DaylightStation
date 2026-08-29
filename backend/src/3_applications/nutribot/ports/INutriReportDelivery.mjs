/** Semantic capability for preparing and delivering a rendered nutrition report. */
export class INutriReportDelivery {
  /**
   * Prepare a report without exposing temporary-file locators to the application.
   * @returns {Promise<{sendTo(messaging: object, caption: string, options?: object): Promise<object>}>}
   */
  async prepare(_report) { throw new Error('INutriReportDelivery.prepare not implemented'); }
}

export default INutriReportDelivery;
