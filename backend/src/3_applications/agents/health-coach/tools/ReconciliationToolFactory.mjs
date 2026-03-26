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
        description: 'Calorie reconciliation data: tracked calories and exercise for recent days; implied intake, tracking accuracy, and calorie adjustments only for mature days (14+ days old, after weight smoothing settles)',
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

            // Implied intake and tracking accuracy are derived from 14-day smoothed
            // weight averages. For days less than 14 days old, these values are noise
            // and must not be exposed to the coach.
            const MATURITY_DAYS = 14;
            const today = new Date();
            today.setHours(0, 0, 0, 0);
            const maturityCutoff = new Date(today);
            maturityCutoff.setDate(maturityCutoff.getDate() - MATURITY_DAYS);

            // Build day entries — redact reconciliation-derived fields for recent days
            const dayEntries = windowDates.map(date => {
              const dateObj = new Date(date + 'T00:00:00');
              const isMature = dateObj <= maturityCutoff;

              return {
                date,
                tracked_calories: data[date].tracked_calories ?? 0,
                exercise_calories: data[date].exercise_calories ?? 0,
                // Only include reconciliation-derived fields for mature (14+ day old) data
                ...(isMature ? {
                  tracking_accuracy: data[date].tracking_accuracy ?? 0,
                  implied_intake: data[date].implied_intake ?? null,
                  calorie_adjustment: data[date].calorie_adjustment ?? null,
                } : {}),
              };
            });

            // Only compute accuracy stats from mature days (14+ days old)
            const matureDays = dayEntries.filter(d => d.tracking_accuracy !== undefined);

            // Count missed days (zero tracked calories among mature days)
            const missedDays = matureDays.filter(d => !d.tracking_accuracy).length;

            // Average accuracy across mature days only
            const avgAccuracy = matureDays.length
              ? matureDays.reduce((sum, d) => sum + (d.tracking_accuracy || 0), 0) / matureDays.length
              : null;

            // Best / worst by accuracy (among mature days that have an entry)
            const tracked = matureDays.filter(d => d.tracking_accuracy > 0);
            const bestDay = tracked.length
              ? tracked.reduce((best, d) => d.tracking_accuracy > best.tracking_accuracy ? d : best)
              : null;
            const worstDay = tracked.length
              ? tracked.reduce((worst, d) => d.tracking_accuracy < worst.tracking_accuracy ? d : worst)
              : null;

            // Accuracy trend: compare first half vs second half of mature days (chronological)
            const chronological = [...matureDays].reverse();
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
              maturity_note: 'implied_intake, tracking_accuracy, and calorie_adjustment are only present on days 14+ days old. Recent days only have tracked_calories and exercise_calories. This is by design — reconciliation data requires 14-day weight smoothing to be meaningful.',
              avgAccuracy,
              matureDayCount: matureDays.length,
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
