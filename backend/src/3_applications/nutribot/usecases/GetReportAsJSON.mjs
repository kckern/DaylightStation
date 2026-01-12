/**
 * Get Report as JSON Use Case
 * @module nutribot/usecases/GetReportAsJSON
 *
 * Returns nutrition data as structured JSON for API consumption.
 */

/**
 * Get report as JSON use case
 */
export class GetReportAsJSON {
  #foodLogStore;
  #nutriListStore;
  #config;
  #logger;

  constructor(deps) {
    if (!deps.foodLogStore) throw new Error('foodLogStore is required');
    if (!deps.nutriListStore) throw new Error('nutriListStore is required');
    if (!deps.config) throw new Error('config is required');

    this.#foodLogStore = deps.foodLogStore;
    this.#nutriListStore = deps.nutriListStore;
    this.#config = deps.config;
    this.#logger = deps.logger || console;
  }

  /**
   * Execute the use case
   * @param {Object} input
   * @param {string} input.userId
   * @param {string} [input.date]
   * @returns {Promise<Object>}
   */
  async execute(input) {
    const { userId } = input;
    const date = input.date || this.#getTodayDate(userId);

    this.#logger.debug?.('report.json.start', { userId, date });

    // Get pending count
    const pendingLogs = await this.#foodLogStore.findPending(userId);
    const pending = pendingLogs.length;

    // Get accepted logs for date
    const logs = await this.#foodLogStore.findByDate(userId, date);
    const acceptedLogs = logs.filter(log => log.isAccepted);

    // Build items array
    const items = [];
    const totals = {
      grams: 0,
      greenGrams: 0,
      yellowGrams: 0,
      orangeGrams: 0,
      itemCount: 0,
    };

    for (const log of acceptedLogs) {
      for (const item of log.items) {
        items.push({
          id: item.id,
          logId: log.id,
          label: item.label,
          icon: item.icon,
          grams: item.grams,
          unit: item.unit,
          amount: item.amount,
          color: item.color,
          meal: log.meal,
          createdAt: log.createdAt,
        });

        totals.grams += item.grams;
        totals.itemCount += 1;

        if (item.color === 'green') totals.greenGrams += item.grams;
        else if (item.color === 'yellow') totals.yellowGrams += item.grams;
        else if (item.color === 'orange') totals.orangeGrams += item.grams;
      }
    }

    // Sort items by calories descending
    items.sort((a, b) => (b.calories || 0) - (a.calories || 0));

    // Calculate percentages
    if (totals.grams > 0) {
      totals.greenPercent = Math.round((totals.greenGrams / totals.grams) * 100);
      totals.yellowPercent = Math.round((totals.yellowGrams / totals.grams) * 100);
      totals.orangePercent = Math.round((totals.orangeGrams / totals.grams) * 100);
    } else {
      totals.greenPercent = 0;
      totals.yellowPercent = 0;
      totals.orangePercent = 0;
    }

    this.#logger.debug?.('report.json.complete', { userId, date, itemCount: items.length, pending });

    return {
      date,
      items,
      totals,
      pending,
    };
  }

  #getTodayDate(userId) {
    const timezone = this.#config?.getUserTimezone?.(userId) || 'America/Los_Angeles';
    return new Date().toLocaleDateString('en-CA', { timeZone: timezone });
  }
}

export default GetReportAsJSON;
