/**
 * Handles self-reported metrics that don't come from external sources.
 * Reads from the user's lifeplan data where manual entries are stored.
 */
export class SelfReportMetricAdapter {
  #lifePlanStore;

  constructor({ lifePlanStore }) {
    this.#lifePlanStore = lifePlanStore;
  }

  getMetricValue(username, measure, date) {
    const plan = this.#lifePlanStore.load(username);
    if (!plan) return null;

    // Look through goal metrics for self-reported values
    for (const goal of (plan.goals || [])) {
      for (const metric of (goal.metrics || [])) {
        if (metric.name === measure || metric.id === measure) {
          // If metric has entries keyed by date
          if (metric.entries?.[date] !== undefined) {
            return metric.entries[date];
          }
          // Otherwise return current value
          return metric.current;
        }
      }
    }

    // Check self_reports array in plan
    const reports = plan.self_reports || [];
    const entry = reports.find(r => r.date === date && r.measure === measure);
    return entry?.value ?? null;
  }

  recordMetric(username, measure, value, date) {
    const plan = this.#lifePlanStore.load(username);
    if (!plan) return;

    if (!plan.self_reports) plan.self_reports = [];
    plan.self_reports.push({
      measure,
      value,
      date: date || new Date().toISOString().slice(0, 10),
      recorded_at: new Date().toISOString(),
    });

    this.#lifePlanStore.save(username, plan);
  }
}
