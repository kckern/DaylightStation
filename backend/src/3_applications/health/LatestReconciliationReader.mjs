/** Returns the most recent dated reconciliation record for prompt enrichment. */
export class LatestReconciliationReader {
  constructor({ store, defaultUserId }) {
    this.store = store;
    this.defaultUserId = defaultUserId;
  }

  async read() {
    try {
      const data = await this.store.loadReconciliationData(this.defaultUserId() || 'user_1');
      const dates = Object.keys(data).sort();
      return dates.length > 0 ? data[dates[dates.length - 1]] : null;
    } catch {
      return null;
    }
  }
}

export default LatestReconciliationReader;
