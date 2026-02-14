// backend/src/3_applications/agents/health-coach/tools/DashboardToolFactory.mjs

import { ToolFactory } from '../../framework/ToolFactory.mjs';
import { createTool } from '../../ports/ITool.mjs';

export class DashboardToolFactory extends ToolFactory {
  static domain = 'dashboard';

  createTools() {
    const { dataService, healthStore } = this.deps;

    return [
      createTool({
        name: 'write_dashboard',
        description: 'Write the structured dashboard YAML to per-user, per-date datastore',
        parameters: {
          type: 'object',
          properties: {
            userId: { type: 'string' },
            date: { type: 'string', description: 'YYYY-MM-DD' },
            dashboard: { type: 'object', description: 'Dashboard data matching the dashboard schema' },
          },
          required: ['userId', 'date', 'dashboard'],
        },
        execute: async ({ userId, date, dashboard }) => {
          try {
            dataService.user.write(`health-dashboard/${date}`, dashboard, userId);
            return { success: true, path: `health-dashboard/${date}` };
          } catch (err) {
            return { error: err.message, success: false };
          }
        },
      }),

      createTool({
        name: 'get_user_goals',
        description: 'Read the user\'s health and fitness goals (weight target, calorie target, etc.)',
        parameters: {
          type: 'object',
          properties: {
            userId: { type: 'string' },
          },
          required: ['userId'],
        },
        execute: async ({ userId }) => {
          try {
            const goals = dataService.user.read('agents/health-coach/goals', userId);
            return { goals: goals || null };
          } catch (err) {
            return { error: err.message, goals: null };
          }
        },
      }),

      createTool({
        name: 'log_coaching_note',
        description: 'Save a coaching observation, milestone, or recommendation to history',
        parameters: {
          type: 'object',
          properties: {
            userId: { type: 'string' },
            date: { type: 'string', description: 'YYYY-MM-DD' },
            note: {
              type: 'object',
              properties: {
                type: { type: 'string', enum: ['observation', 'milestone', 'recommendation'] },
                text: { type: 'string' },
              },
              required: ['type', 'text'],
            },
          },
          required: ['userId', 'date', 'note'],
        },
        execute: async ({ userId, date, note }) => {
          try {
            const existing = await healthStore.loadCoachingData(userId) || {};
            const dayNotes = existing[date] || [];
            dayNotes.push({ ...note, timestamp: new Date().toISOString() });
            existing[date] = dayNotes;
            await healthStore.saveCoachingData(userId, existing);
            return { success: true };
          } catch (err) {
            return { error: err.message, success: false };
          }
        },
      }),
    ];
  }
}
