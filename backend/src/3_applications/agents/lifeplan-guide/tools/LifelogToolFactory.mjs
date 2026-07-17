import { ToolFactory } from '../../framework/ToolFactory.mjs';
import { createTool } from '../../ports/ITool.mjs';

export class LifelogToolFactory extends ToolFactory {
  static domain = 'lifelog';

  createTools() {
    const { aggregator, metricsStore, driftService } = this.deps;

    return [
      createTool({
        name: 'query_lifelog_range',
        description: 'Get lifelog data for a date range. Returns per-day sources, categories, and summaries.',
        parameters: {
          type: 'object',
          properties: {
            userId: { type: 'string' },
            start: { type: 'string', description: 'Start date (YYYY-MM-DD)' },
            end: { type: 'string', description: 'End date (YYYY-MM-DD)' },
          },
          required: ['userId', 'start', 'end'],
        },
        execute: async ({ userId, start, end }) => {
          try {
            return await aggregator.aggregateRange(userId, start, end);
          } catch (err) {
            return { error: err.message, days: {} };
          }
        },
      }),

      createTool({
        name: 'get_available_sources',
        description: 'List all available lifelog data sources (strava, calendar, todoist, etc.)',
        parameters: { type: 'object', properties: {} },
        execute: async () => {
          const sources = aggregator.getAvailableSources?.() || [];
          return { sources };
        },
      }),

      createTool({
        name: 'get_metrics_snapshot',
        description: 'Get the latest metrics snapshot (drift computation, allocation data)',
        parameters: {
          type: 'object',
          properties: { userId: { type: 'string' } },
          required: ['userId'],
        },
        execute: async ({ userId }) => {
          const snapshot = metricsStore?.getLatest?.(userId);
          return snapshot || { error: 'No snapshot available' };
        },
      }),

      createTool({
        name: 'get_value_allocation',
        description: 'Get current value drift and time allocation analysis',
        parameters: {
          type: 'object',
          properties: { userId: { type: 'string' } },
          required: ['userId'],
        },
        execute: async ({ userId }) => {
          const snapshot = driftService?.getLatestSnapshot?.(userId);
          return snapshot || { error: 'No drift data available' };
        },
      }),
    ];
  }
}
