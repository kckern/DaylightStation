// backend/src/2_domains/health/services/HealthAnalyticsService.mjs

import { MetricAggregator } from './MetricAggregator.mjs';
import { MetricComparator } from './MetricComparator.mjs';

/**
 * Composition root for the analytical surface. Plan 1 wires MetricAggregator.
 * Plan 2 adds MetricComparator (compare, summarizeChange, conditionalAggregate,
 * correlateMetrics). Plans 3-4 will add MetricTrendAnalyzer, PeriodMemory, etc.
 *
 * @typedef {object} HealthAnalyticsDeps
 * @property {object} healthStore
 * @property {object} healthService
 * @property {object} periodResolver
 */
export class HealthAnalyticsService {
  /** @param {HealthAnalyticsDeps} deps */
  constructor(deps) {
    if (!deps?.healthStore)    throw new Error('HealthAnalyticsService requires healthStore');
    if (!deps?.healthService)  throw new Error('HealthAnalyticsService requires healthService');
    if (!deps?.periodResolver) throw new Error('HealthAnalyticsService requires periodResolver');

    this.aggregator = new MetricAggregator(deps);
    this.comparator = new MetricComparator({
      aggregator: this.aggregator,
      periodResolver: deps.periodResolver,
      healthStore: deps.healthStore,
      healthService: deps.healthService,
    });
  }

  // Aggregator delegates
  aggregate(args)        { return this.aggregator.aggregate(args); }
  aggregateSeries(args)  { return this.aggregator.aggregateSeries(args); }
  distribution(args)     { return this.aggregator.distribution(args); }
  percentile(args)       { return this.aggregator.percentile(args); }
  snapshot(args)         { return this.aggregator.snapshot(args); }

  // Comparator delegates
  compare(args)              { return this.comparator.compare(args); }
  summarizeChange(args)      { return this.comparator.summarizeChange(args); }
  conditionalAggregate(args) { return this.comparator.conditionalAggregate(args); }
  correlateMetrics(args)     { return this.comparator.correlateMetrics(args); }
}

export default HealthAnalyticsService;
