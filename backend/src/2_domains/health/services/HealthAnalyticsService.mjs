// backend/src/2_domains/health/services/HealthAnalyticsService.mjs

import { MetricAggregator } from './MetricAggregator.mjs';

/**
 * Composition root for the analytical surface. Plan 1 only wires
 * MetricAggregator. Plans 2-4 will add MetricComparator, MetricTrendAnalyzer,
 * PeriodMemory, and HistoryReflector, exposing their methods on this service.
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
  }

  // Delegate methods. Adding more sub-services in later plans means more
  // delegate forwards here; the public surface stays a single service.
  aggregate(args)        { return this.aggregator.aggregate(args); }
  aggregateSeries(args)  { return this.aggregator.aggregateSeries(args); }
  distribution(args)     { return this.aggregator.distribution(args); }
  percentile(args)       { return this.aggregator.percentile(args); }
  snapshot(args)         { return this.aggregator.snapshot(args); }
}

export default HealthAnalyticsService;
