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
    ];
  }
}

export default HealthAnalyticsToolFactory;
