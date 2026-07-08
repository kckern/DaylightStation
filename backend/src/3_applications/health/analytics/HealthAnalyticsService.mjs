// backend/src/3_applications/health/analytics/HealthAnalyticsService.mjs

import { MetricAggregator } from './MetricAggregator.mjs';
import { MetricComparator } from './MetricComparator.mjs';
import { MetricTrendAnalyzer } from './MetricTrendAnalyzer.mjs';
import { PeriodMemory } from './PeriodMemory.mjs';
import { HistoryReflector } from './HistoryReflector.mjs';
import { PeriodResolver } from './PeriodResolver.mjs';
import { ValidationError, DomainInvariantError } from '#domains/core/errors/index.mjs';

export class HealthAnalyticsService {
  constructor(deps) {
    if (!deps?.healthStore)    throw new ValidationError('HealthAnalyticsService requires healthStore', { code: 'MISSING_HEALTH_STORE', field: 'healthStore' });
    if (!deps?.healthService)  throw new ValidationError('HealthAnalyticsService requires healthService', { code: 'MISSING_HEALTH_SERVICE', field: 'healthService' });
    if (!deps?.periodResolver) throw new ValidationError('HealthAnalyticsService requires periodResolver', { code: 'MISSING_PERIOD_RESOLVER', field: 'periodResolver' });

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
    if (!this.periodMemory) throw new DomainInvariantError('HealthAnalyticsService.listPeriods requires workingMemoryAdapter dep', { code: 'LIST_PERIODS_REQUIRES_WORKING_MEMORY' });
    return this.periodMemory.listPeriods(args);
  }
  deducePeriod(args) {
    if (!this.periodMemory) throw new DomainInvariantError('HealthAnalyticsService.deducePeriod requires workingMemoryAdapter dep', { code: 'DEDUCE_PERIOD_REQUIRES_WORKING_MEMORY' });
    return this.periodMemory.deducePeriod(args);
  }
  rememberPeriod(args) {
    if (!this.periodMemory) throw new DomainInvariantError('HealthAnalyticsService.rememberPeriod requires workingMemoryAdapter dep', { code: 'REMEMBER_PERIOD_REQUIRES_WORKING_MEMORY' });
    return this.periodMemory.rememberPeriod(args);
  }
  forgetPeriod(args) {
    if (!this.periodMemory) throw new DomainInvariantError('HealthAnalyticsService.forgetPeriod requires workingMemoryAdapter dep', { code: 'FORGET_PERIOD_REQUIRES_WORKING_MEMORY' });
    return this.periodMemory.forgetPeriod(args);
  }

  // HistoryReflector delegate (guarded)
  analyzeHistory(args) {
    if (!this.historyReflector) throw new DomainInvariantError('HealthAnalyticsService.analyzeHistory requires workingMemoryAdapter dep', { code: 'ANALYZE_HISTORY_REQUIRES_WORKING_MEMORY' });
    return this.historyReflector.analyzeHistory(args);
  }
}

export default HealthAnalyticsService;
