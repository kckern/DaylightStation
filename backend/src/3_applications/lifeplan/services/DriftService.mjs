import { ValueDriftCalculator } from '#domains/lifeplan/services/ValueDriftCalculator.mjs';

export class DriftService {
  #lifePlanStore;
  #metricsStore;
  #aggregator;
  #cadenceService;
  #clock;
  #calculator;

  constructor({ lifePlanStore, metricsStore, aggregator, cadenceService, clock }) {
    this.#lifePlanStore = lifePlanStore;
    this.#metricsStore = metricsStore;
    this.#aggregator = aggregator;
    this.#cadenceService = cadenceService;
    this.#clock = clock;
    this.#calculator = new ValueDriftCalculator();
  }

  async computeAndSave(username) {
    const plan = this.#lifePlanStore.load(username);
    if (!plan) return null;

    const today = this.#clock ? this.#clock.today() : new Date().toISOString().slice(0, 10);
    const cadence = plan.cadence || {};
    const resolved = this.#cadenceService.resolve(cadence, today);

    const cycleStart = resolved.cycle.startDate.toISOString().slice(0, 10);
    const lifelogRange = await this.#aggregator.aggregateRange(username, cycleStart, today);

    const allocation = this.#calculator.calculateAllocation(
      lifelogRange,
      plan.value_mapping || {},
      plan.values
    );

    const drift = this.#calculator.calculateDrift(allocation, plan.values);

    const snapshot = {
      date: today,
      period_id: resolved.cycle.periodId,
      allocation,
      ...drift,
      timestamp: this.#clock ? this.#clock.now().toISOString() : new Date().toISOString(),
    };

    this.#metricsStore.saveSnapshot(username, snapshot);
    return snapshot;
  }

  getLatestSnapshot(username) {
    return this.#metricsStore.getLatest(username);
  }

  getHistory(username) {
    return this.#metricsStore.getHistory(username);
  }
}
