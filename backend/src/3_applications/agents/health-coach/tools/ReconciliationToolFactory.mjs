// backend/src/3_applications/agents/health-coach/tools/ReconciliationToolFactory.mjs

import { ToolFactory } from '../../framework/ToolFactory.mjs';
import { createTool } from '../../ports/ITool.mjs';

export class ReconciliationToolFactory extends ToolFactory {
  static domain = 'reconciliation';

  createTools() {
    const { healthStore } = this.deps;

    return [
      createTool({
        name: 'get_reconciliation_summary',
        description: 'Calorie reconciliation data: tracking accuracy, implied vs tracked intake, and trend over recent days',
        parameters: {
          type: 'object',
          properties: {
            userId: { type: 'string', description: 'User identifier' },
            days: { type: 'number', description: 'Lookback window in days', default: 7 },
          },
          required: ['userId'],
        },
        execute: async ({ userId, days = 7 }) => {
          try {
            const data = await healthStore.loadReconciliationData(userId);
            const allDates = Object.keys(data || {}).sort().reverse();
            const windowDates = allDates.slice(0, days);

            // Build day entries — only dates present in window
            const dayEntries = windowDates.map(date => ({
              date,
              tracking_accuracy: data[date].tracking_accuracy ?? 0,
              implied_intake: data[date].implied_intake ?? null,
              tracked_calories: data[date].tracked_calories ?? 0,
              exercise_calories: data[date].exercise_calories ?? 0,
            }));

            // Count missed days (zero accuracy within the window)
            const missedDays = dayEntries.filter(d => !d.tracking_accuracy).length;

            // Average accuracy across all days in window
            const avgAccuracy = dayEntries.length
              ? dayEntries.reduce((sum, d) => sum + (d.tracking_accuracy || 0), 0) / dayEntries.length
              : 0;

            // Best / worst by accuracy (among days that have an entry)
            const tracked = dayEntries.filter(d => d.tracking_accuracy > 0);
            const bestDay = tracked.length
              ? tracked.reduce((best, d) => d.tracking_accuracy > best.tracking_accuracy ? d : best)
              : null;
            const worstDay = tracked.length
              ? tracked.reduce((worst, d) => d.tracking_accuracy < worst.tracking_accuracy ? d : worst)
              : null;

            // Accuracy trend: compare first half vs second half (chronological order)
            const chronological = [...dayEntries].reverse();
            const mid = Math.floor(chronological.length / 2);
            const firstHalf = chronological.slice(0, mid);
            const secondHalf = chronological.slice(mid);
            const halfAvg = arr => arr.length ? arr.reduce((s, d) => s + (d.tracking_accuracy || 0), 0) / arr.length : 0;
            const firstAvg = halfAvg(firstHalf);
            const secondAvg = halfAvg(secondHalf);
            let accuracyTrend = 'stable';
            if (secondAvg - firstAvg > 0.05) accuracyTrend = 'improving';
            else if (firstAvg - secondAvg > 0.05) accuracyTrend = 'declining';

            return {
              avgAccuracy,
              days: dayEntries,
              missedDays,
              bestDay: bestDay ? { date: bestDay.date, accuracy: bestDay.tracking_accuracy } : null,
              worstDay: worstDay ? { date: worstDay.date, accuracy: worstDay.tracking_accuracy } : null,
              accuracyTrend,
            };
          } catch (err) {
            return { error: err.message, avgAccuracy: null, days: [], missedDays: null, bestDay: null, worstDay: null, accuracyTrend: null };
          }
        },
      }),

      createTool({
        name: 'get_adjusted_nutrition',
        description: 'Adjusted nutrition targets accounting for tracking accuracy, phantom calories, and portion multipliers',
        parameters: {
          type: 'object',
          properties: {
            userId: { type: 'string', description: 'User identifier' },
            days: { type: 'number', description: 'Lookback window in days', default: 7 },
          },
          required: ['userId'],
        },
        execute: async ({ userId, days = 7 }) => {
          try {
            const data = await healthStore.loadAdjustedNutritionData(userId);
            const dates = Object.keys(data || {}).sort().reverse().slice(0, days);

            const dayEntries = dates.map(date => ({
              date,
              calories: data[date].calories ?? null,
              protein: data[date].protein ?? null,
              carbs: data[date].carbs ?? null,
              fat: data[date].fat ?? null,
              portion_multiplier: data[date].portion_multiplier ?? null,
              phantom_calories: data[date].phantom_calories ?? null,
              tracking_accuracy: data[date].tracking_accuracy ?? null,
            }));

            return { days: dayEntries };
          } catch (err) {
            return { error: err.message, days: [] };
          }
        },
      }),

      createTool({
        name: 'get_coaching_history',
        description: 'Past coaching messages sent to the user, grouped by date',
        parameters: {
          type: 'object',
          properties: {
            userId: { type: 'string', description: 'User identifier' },
            days: { type: 'number', description: 'Lookback window in days', default: 7 },
          },
          required: ['userId'],
        },
        execute: async ({ userId, days = 7 }) => {
          try {
            const data = await healthStore.loadCoachingData(userId);
            const dates = Object.keys(data || {}).sort().reverse().slice(0, days);

            const entries = dates.map(date => ({
              date,
              messages: (data[date] || []).map(entry => ({
                message: entry.message,
                timestamp: entry.timestamp,
              })),
            }));

            return { entries };
          } catch (err) {
            return { error: err.message, entries: [] };
          }
        },
      }),
    ];
  }
}
