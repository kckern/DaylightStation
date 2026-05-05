// backend/src/2_domains/health/services/HealthAnalyticsService.mjs

import { MetricAggregator } from './MetricAggregator.mjs';
import { MetricComparator } from './MetricComparator.mjs';
import { MetricTrendAnalyzer } from './MetricTrendAnalyzer.mjs';

export class HealthAnalyticsService {
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
    this.trendAnalyzer = new MetricTrendAnalyzer({
      aggregator: this.aggregator,
      periodResolver: deps.periodResolver,
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

  // TrendAnalyzer delegates
  trajectory(args)         { return this.trendAnalyzer.trajectory(args); }
  detectRegimeChange(args) { return this.trendAnalyzer.detectRegimeChange(args); }
  detectAnomalies(args)    { return this.trendAnalyzer.detectAnomalies(args); }
  detectSustained(args)    { return this.trendAnalyzer.detectSustained(args); }
}

export default HealthAnalyticsService;
