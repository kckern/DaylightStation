// backend/src/2_domains/health/services/HealthAnalyticsService.mjs

import { MetricAggregator } from './MetricAggregator.mjs';
import { MetricComparator } from './MetricComparator.mjs';
import { MetricTrendAnalyzer } from './MetricTrendAnalyzer.mjs';
import { PeriodMemory } from './PeriodMemory.mjs';
import { HistoryReflector } from './HistoryReflector.mjs';
import { PeriodResolver } from './PeriodResolver.mjs';

export class HealthAnalyticsService {
  constructor(deps) {
    if (!deps?.healthStore)    throw new Error('HealthAnalyticsService requires healthStore');
    if (!deps?.healthService)  throw new Error('HealthAnalyticsService requires healthService');
    if (!deps?.periodResolver) throw new Error('HealthAnalyticsService requires periodResolver');

    // If the resolver was constructed without playbookLoader/workingMemoryAdapter,
    // and we have those deps, replace it with one that does.
    let periodResolver = deps.periodResolver;
    if ((deps.playbookLoader || deps.workingMemoryAdapter)
        && !periodResolver.playbookLoader && !periodResolver.workingMemoryAdapter) {
      periodResolver = new PeriodResolver({
        now: periodResolver.now,
        playbookLoader: deps.playbookLoader,
        workingMemoryAdapter: deps.workingMemoryAdapter,
      });
    }

    this.aggregator = new MetricAggregator({ ...deps, periodResolver });
    this.comparator = new MetricComparator({
      aggregator: this.aggregator,
      periodResolver,
      healthStore: deps.healthStore,
      healthService: deps.healthService,
    });
    this.trendAnalyzer = new MetricTrendAnalyzer({
      aggregator: this.aggregator,
      periodResolver,
    });

    if (deps.workingMemoryAdapter) {
      this.periodMemory = new PeriodMemory({
        workingMemoryAdapter: deps.workingMemoryAdapter,
        playbookLoader: deps.playbookLoader,
        trendAnalyzer: this.trendAnalyzer,
      });
      this.historyReflector = new HistoryReflector({
        aggregator: this.aggregator,
        trendAnalyzer: this.trendAnalyzer,
        periodMemory: this.periodMemory,
      });
    } else {
      this.periodMemory = null;
      this.historyReflector = null;
    }
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

  // PeriodMemory delegates (guarded)
  listPeriods(args) {
    if (!this.periodMemory) throw new Error('HealthAnalyticsService.listPeriods requires workingMemoryAdapter dep');
    return this.periodMemory.listPeriods(args);
  }
  deducePeriod(args) {
    if (!this.periodMemory) throw new Error('HealthAnalyticsService.deducePeriod requires workingMemoryAdapter dep');
    return this.periodMemory.deducePeriod(args);
  }
  rememberPeriod(args) {
    if (!this.periodMemory) throw new Error('HealthAnalyticsService.rememberPeriod requires workingMemoryAdapter dep');
    return this.periodMemory.rememberPeriod(args);
  }
  forgetPeriod(args) {
    if (!this.periodMemory) throw new Error('HealthAnalyticsService.forgetPeriod requires workingMemoryAdapter dep');
    return this.periodMemory.forgetPeriod(args);
  }

  // HistoryReflector delegate (guarded)
  analyzeHistory(args) {
    if (!this.historyReflector) throw new Error('HealthAnalyticsService.analyzeHistory requires workingMemoryAdapter dep');
    return this.historyReflector.analyzeHistory(args);
  }
}

export default HealthAnalyticsService;
