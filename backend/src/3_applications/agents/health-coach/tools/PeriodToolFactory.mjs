// backend/src/3_applications/agents/health-coach/tools/PeriodToolFactory.mjs
//
// Period vocabulary tools: list_periods, deduce_period, remember_period,
// forget_period. These were previously bundled in HealthAnalyticsToolFactory
// and are kept alive after that factory was retired (Task 13).
//
// All four tools delegate to healthAnalyticsService, which owns period
// resolution, deduction, and working-memory persistence.

import { ToolFactory } from '../../framework/ToolFactory.mjs';
import { createTool } from '../../ports/ITool.mjs';

export class PeriodToolFactory extends ToolFactory {
  static domain = 'health';

  createTools() {
    const { healthAnalyticsService } = this.deps;
    if (!healthAnalyticsService) {
      throw new Error('PeriodToolFactory requires healthAnalyticsService dep');
    }

    return [
      createTool({
        name: 'list_periods',
        description:
          'Enumerate all addressable periods (declared in playbook + ' +
          'remembered + cached deduced). Each entry has slug, label, ' +
          'from, to, source.',
        parameters: {
          type: 'object',
          properties: { userId: { type: 'string' } },
          required: ['userId'],
        },
        execute: async (args) => {
          try { return await healthAnalyticsService.listPeriods(args); }
          catch (err) { return { error: err.message }; }
        },
      }),

      createTool({
        name: 'deduce_period',
        description:
          'Find date ranges in history matching a metric criterion. Caches ' +
          'matches under period.deduced.<slug> with a 30-day TTL. Criteria: ' +
          '{ metric, value_range: [min, max], min_duration_days } | ' +
          '{ metric, field_above, min_duration_days } | ' +
          '{ metric, field_below, min_duration_days }.',
        parameters: {
          type: 'object',
          properties: {
            userId: { type: 'string' },
            criteria: { type: 'object', description: 'Structured criteria; see description.' },
            max_results: { type: 'number', minimum: 1, default: 3 },
          },
          required: ['userId', 'criteria'],
        },
        execute: async (args) => {
          try { return await healthAnalyticsService.deducePeriod(args); }
          catch (err) { return { error: err.message }; }
        },
      }),

      createTool({
        name: 'remember_period',
        description:
          'Promote a period into long-lived agent working memory under ' +
          'period.remembered.<slug>. No TTL. Slug must be alphanumeric/' +
          'hyphen, max 64 chars.',
        parameters: {
          type: 'object',
          properties: {
            userId: { type: 'string' },
            slug: { type: 'string' },
            from: { type: 'string', description: 'YYYY-MM-DD' },
            to:   { type: 'string', description: 'YYYY-MM-DD' },
            label: { type: 'string' },
            description: { type: 'string' },
          },
          required: ['userId', 'slug', 'from', 'to', 'label'],
        },
        execute: async (args) => {
          try { return await healthAnalyticsService.rememberPeriod(args); }
          catch (err) { return { error: err.message }; }
        },
      }),

      createTool({
        name: 'forget_period',
        description:
          'Remove a remembered period from agent working memory.',
        parameters: {
          type: 'object',
          properties: {
            userId: { type: 'string' },
            slug: { type: 'string' },
          },
          required: ['userId', 'slug'],
        },
        execute: async (args) => {
          try { return await healthAnalyticsService.forgetPeriod(args); }
          catch (err) { return { error: err.message }; }
        },
      }),
    ];
  }
}

export default PeriodToolFactory;
