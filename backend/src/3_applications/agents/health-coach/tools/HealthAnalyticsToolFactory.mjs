// backend/src/3_applications/agents/health-coach/tools/HealthAnalyticsToolFactory.mjs

import { ToolFactory } from '../../framework/ToolFactory.mjs';
import { createTool } from '../../ports/ITool.mjs';

/**
 * Wraps HealthAnalyticsService methods as agent tools.
 *
 * Plan 1 surface: aggregate_metric, aggregate_series, metric_distribution,
 * metric_percentile, metric_snapshot. Each tool:
 *   - has a structured JSON-schema parameter list (the model uses this
 *     directly to construct calls)
 *   - returns the service's response shape on success, or
 *     { error: <message> } on failure (no throws — matches the existing
 *     tool-factory pattern)
 *
 * The polymorphic period input is documented as an object with one of
 * { rolling, calendar, named, deduced, from+to }. Plan 1 only resolves
 * rolling, calendar, and from+to; named/deduced surface a clear error.
 */
export class HealthAnalyticsToolFactory extends ToolFactory {
  static domain = 'health';

  createTools() {
    const { healthAnalyticsService } = this.deps;
    if (!healthAnalyticsService) {
      throw new Error('HealthAnalyticsToolFactory requires healthAnalyticsService dep');
    }

    const periodSchema = {
      type: 'object',
      description:
        'Polymorphic period input. Pass exactly one of: ' +
        '{ rolling: \'last_30d\' } | { calendar: \'2024-Q3\' } | ' +
        '{ from: \'YYYY-MM-DD\', to: \'YYYY-MM-DD\' }. ' +
        '(Named periods and deduced periods are added in Plan 4.)',
    };

    return [
      createTool({
        name: 'aggregate_metric',
        description:
          'Single-value summary of a metric over a period. ' +
          'Returns { value, unit, statistic, daysCovered, daysInPeriod }.',
        parameters: {
          type: 'object',
          properties: {
            userId: { type: 'string' },
            metric: { type: 'string' },
            period: periodSchema,
            statistic: {
              type: 'string',
              enum: ['mean','median','min','max','count','sum','p25','p75','stdev'],
              default: 'mean',
            },
          },
          required: ['userId', 'metric', 'period'],
        },
        execute: async ({ userId, metric, period, statistic }) => {
          try {
            return await healthAnalyticsService.aggregate({ userId, metric, period, statistic });
          } catch (err) {
            return { error: err.message };
          }
        },
      }),

      createTool({
        name: 'aggregate_series',
        description:
          'Bucketed series — one value per bucket over a period. ' +
          'Granularity: daily | weekly | monthly | quarterly | yearly.',
        parameters: {
          type: 'object',
          properties: {
            userId: { type: 'string' },
            metric: { type: 'string' },
            period: periodSchema,
            granularity: { type: 'string', enum: ['daily','weekly','monthly','quarterly','yearly'] },
            statistic: { type: 'string', enum: ['mean','median','min','max','count','sum','p25','p75','stdev'], default: 'mean' },
          },
          required: ['userId', 'metric', 'period', 'granularity'],
        },
        execute: async (args) => {
          try { return await healthAnalyticsService.aggregateSeries(args); }
          catch (err) { return { error: err.message }; }
        },
      }),

      createTool({
        name: 'metric_distribution',
        description:
          'Quartiles + optional histogram for a metric over a period.',
        parameters: {
          type: 'object',
          properties: {
            userId: { type: 'string' },
            metric: { type: 'string' },
            period: periodSchema,
            bins:   { type: 'number', minimum: 1 },
          },
          required: ['userId', 'metric', 'period'],
        },
        execute: async (args) => {
          try { return await healthAnalyticsService.distribution(args); }
          catch (err) { return { error: err.message }; }
        },
      }),

      createTool({
        name: 'metric_percentile',
        description:
          'Where a specific value sits in the metric\'s distribution over a period.',
        parameters: {
          type: 'object',
          properties: {
            userId: { type: 'string' },
            metric: { type: 'string' },
            period: periodSchema,
            value:  { type: 'number' },
          },
          required: ['userId', 'metric', 'period', 'value'],
        },
        execute: async (args) => {
          try { return await healthAnalyticsService.percentile(args); }
          catch (err) { return { error: err.message }; }
        },
      }),

      createTool({
        name: 'metric_snapshot',
        description:
          'Multi-metric "vital signs" view of a period. One row per metric. ' +
          'Default metric set: weight_lbs, fat_percent, calories, protein_g, ' +
          'workout_count, workout_duration_min, tracking_density. Pass ' +
          '`metrics: [...]` to override.',
        parameters: {
          type: 'object',
          properties: {
            userId:  { type: 'string' },
            period:  periodSchema,
            metrics: { type: 'array', items: { type: 'string' } },
          },
          required: ['userId', 'period'],
        },
        execute: async (args) => {
          try { return await healthAnalyticsService.snapshot(args); }
          catch (err) { return { error: err.message }; }
        },
      }),

      createTool({
        name: 'compare_metric',
        description:
          'Compare a metric across two periods. Returns delta, percentChange, ' +
          'and reliability scoring based on data coverage.',
        parameters: {
          type: 'object',
          properties: {
            userId: { type: 'string' },
            metric: { type: 'string' },
            period_a: periodSchema,
            period_b: periodSchema,
            statistic: {
              type: 'string',
              enum: ['mean','median','min','max','count','sum','p25','p75','stdev'],
              default: 'mean',
            },
          },
          required: ['userId', 'metric', 'period_a', 'period_b'],
        },
        execute: async (args) => {
          try { return await healthAnalyticsService.compare(args); }
          catch (err) { return { error: err.message }; }
        },
      }),

      createTool({
        name: 'summarize_change',
        description:
          'Richer comparison than compare_metric — classifies change shape ' +
          '(monotonic/volatile/step/reversal), reports inflection date and ' +
          'per-side variance.',
        parameters: {
          type: 'object',
          properties: {
            userId: { type: 'string' },
            metric: { type: 'string' },
            period_a: periodSchema,
            period_b: periodSchema,
            statistic: {
              type: 'string',
              enum: ['mean','median','min','max','count','sum','p25','p75','stdev'],
              default: 'mean',
            },
          },
          required: ['userId', 'metric', 'period_a', 'period_b'],
        },
        execute: async (args) => {
          try { return await healthAnalyticsService.summarizeChange(args); }
          catch (err) { return { error: err.message }; }
        },
      }),

      createTool({
        name: 'conditional_aggregate',
        description:
          'Compute a metric statistic for days matching a condition vs not. ' +
          'Conditions: { tracked }, { workout }, { weekday }, { weekend }, ' +
          '{ since: \'YYYY-MM-DD\' }, { before: \'YYYY-MM-DD\' }.',
        parameters: {
          type: 'object',
          properties: {
            userId: { type: 'string' },
            metric: { type: 'string' },
            period: periodSchema,
            condition: { type: 'object', description: 'Structured condition object — see description.' },
            statistic: {
              type: 'string',
              enum: ['mean','median','min','max','count','sum','p25','p75','stdev'],
              default: 'mean',
            },
          },
          required: ['userId', 'metric', 'period', 'condition'],
        },
        execute: async (args) => {
          try { return await healthAnalyticsService.conditionalAggregate(args); }
          catch (err) { return { error: err.message }; }
        },
      }),

      createTool({
        name: 'correlate_metrics',
        description:
          'Joint behavior of two metrics over a period. Returns Spearman ' +
          'and Pearson correlations, paired-observation count, and a coarse ' +
          'interpretation (strong/weak positive/negative or none).',
        parameters: {
          type: 'object',
          properties: {
            userId: { type: 'string' },
            metric_a: { type: 'string' },
            metric_b: { type: 'string' },
            period: periodSchema,
            granularity: {
              type: 'string',
              enum: ['daily','weekly','monthly','quarterly','yearly'],
              default: 'daily',
            },
          },
          required: ['userId', 'metric_a', 'metric_b', 'period'],
        },
        execute: async (args) => {
          try { return await healthAnalyticsService.correlateMetrics(args); }
          catch (err) { return { error: err.message }; }
        },
      }),

      createTool({
        name: 'metric_trajectory',
        description:
          'Slope, direction, and r² over a period. Optional bucketed series ' +
          'when granularity provided.',
        parameters: {
          type: 'object',
          properties: {
            userId: { type: 'string' },
            metric: { type: 'string' },
            period: periodSchema,
            granularity: { type: 'string', enum: ['daily','weekly','monthly','quarterly','yearly'] },
            statistic: { type: 'string', enum: ['mean','median','min','max','count','sum','p25','p75','stdev'], default: 'mean' },
          },
          required: ['userId', 'metric', 'period'],
        },
        execute: async (args) => {
          try { return await healthAnalyticsService.trajectory(args); }
          catch (err) { return { error: err.message }; }
        },
      }),

      createTool({
        name: 'detect_regime_change',
        description:
          'Find inflection points where a metric\'s mean shifted significantly. ' +
          'Returns up to max_results ranked candidates with before/after stats.',
        parameters: {
          type: 'object',
          properties: {
            userId: { type: 'string' },
            metric: { type: 'string' },
            period: periodSchema,
            max_results: { type: 'number', minimum: 1, default: 3 },
          },
          required: ['userId', 'metric', 'period'],
        },
        execute: async (args) => {
          try { return await healthAnalyticsService.detectRegimeChange(args); }
          catch (err) { return { error: err.message }; }
        },
      }),

      createTool({
        name: 'detect_anomalies',
        description:
          'Days where the metric deviates from rolling baseline by more than ' +
          'zScore_threshold standard deviations.',
        parameters: {
          type: 'object',
          properties: {
            userId: { type: 'string' },
            metric: { type: 'string' },
            period: periodSchema,
            zScore_threshold: { type: 'number', default: 2 },
            baseline_window_days: { type: 'number', default: 30 },
          },
          required: ['userId', 'metric', 'period'],
        },
        execute: async (args) => {
          try { return await healthAnalyticsService.detectAnomalies(args); }
          catch (err) { return { error: err.message }; }
        },
      }),

      createTool({
        name: 'detect_sustained',
        description:
          'Find consecutive-day runs satisfying a condition for at least ' +
          'min_duration_days. Conditions: { value_range: [min, max] }, ' +
          '{ field_above: value }, { field_below: value }.',
        parameters: {
          type: 'object',
          properties: {
            userId: { type: 'string' },
            metric: { type: 'string' },
            period: periodSchema,
            condition: { type: 'object', description: 'Structured condition; see description.' },
            min_duration_days: { type: 'number', minimum: 1 },
          },
          required: ['userId', 'metric', 'period', 'condition', 'min_duration_days'],
        },
        execute: async (args) => {
          try { return await healthAnalyticsService.detectSustained(args); }
          catch (err) { return { error: err.message }; }
        },
      }),
    ];
  }
}

export default HealthAnalyticsToolFactory;
