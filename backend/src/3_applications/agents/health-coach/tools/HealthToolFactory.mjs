// backend/src/3_applications/agents/health-coach/tools/HealthToolFactory.mjs

import { ToolFactory } from '../../framework/ToolFactory.mjs';
import { createTool } from '../../ports/ITool.mjs';

export class HealthToolFactory extends ToolFactory {
  static domain = 'health';

  createTools() {
    const { healthStore, healthService } = this.deps;

    return [
      createTool({
        name: 'get_weight_trend',
        description: 'Current weight, body fat %, 7-day trend, and recent history',
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
            const weightData = await healthStore.loadWeightData(userId);
            const dates = Object.keys(weightData).sort().reverse();
            const recent = dates.slice(0, days);

            if (!recent.length) return { current: null, trend: null, history: [] };

            const latest = weightData[recent[0]];
            return {
              current: {
                lbs: latest.lbs_adjusted_average || latest.lbs,
                fatPercent: latest.fat_percent_average || latest.fat_percent,
                date: latest.date,
              },
              trend: {
                sevenDay: latest.lbs_adjusted_average_7day_trend || null,
                fourteenDay: latest.lbs_adjusted_average_14day_trend || null,
              },
              history: recent.map(d => ({
                date: d,
                lbs: weightData[d].lbs_adjusted_average || weightData[d].lbs,
                fatPercent: weightData[d].fat_percent_average || weightData[d].fat_percent,
              })),
            };
          } catch (err) {
            return { error: err.message, current: null, trend: null, history: [] };
          }
        },
      }),

      createTool({
        name: 'get_today_nutrition',
        description: "Today's calorie and macro summary",
        parameters: {
          type: 'object',
          properties: {
            userId: { type: 'string' },
          },
          required: ['userId'],
        },
        execute: async ({ userId }) => {
          try {
            const nutritionData = await healthStore.loadNutritionData(userId);
            const today = new Date().toISOString().split('T')[0];
            const todayData = nutritionData?.[today];

            if (!todayData) return { logged: false, date: today, calories: 0, protein: 0, carbs: 0, fat: 0 };

            return {
              logged: true,
              date: today,
              calories: todayData.calories || 0,
              protein: todayData.protein || 0,
              carbs: todayData.carbs || 0,
              fat: todayData.fat || 0,
              foodCount: todayData.foodCount || 0,
            };
          } catch (err) {
            return { error: err.message, logged: false, date: new Date().toISOString().split('T')[0] };
          }
        },
      }),

      createTool({
        name: 'get_nutrition_history',
        description: 'Multi-day nutrition data with daily breakdowns and averages',
        parameters: {
          type: 'object',
          properties: {
            userId: { type: 'string' },
            days: { type: 'number', default: 7 },
          },
          required: ['userId'],
        },
        execute: async ({ userId, days = 7 }) => {
          try {
            const nutritionData = await healthStore.loadNutritionData(userId);
            const dates = Object.keys(nutritionData || {}).sort().reverse().slice(0, days);

            const dailyData = dates.map(d => ({
              date: d,
              calories: nutritionData[d]?.calories || 0,
              protein: nutritionData[d]?.protein || 0,
              carbs: nutritionData[d]?.carbs || 0,
              fat: nutritionData[d]?.fat || 0,
            }));

            const avg = (arr, key) => arr.length ? Math.round(arr.reduce((s, d) => s + d[key], 0) / arr.length) : 0;

            return {
              days: dailyData,
              averages: {
                calories: avg(dailyData, 'calories'),
                protein: avg(dailyData, 'protein'),
                carbs: avg(dailyData, 'carbs'),
                fat: avg(dailyData, 'fat'),
              },
            };
          } catch (err) {
            return { error: err.message, days: [], averages: {} };
          }
        },
      }),

      createTool({
        name: 'get_recent_workouts',
        description: 'Recent workout sessions from Strava and fitness trackers',
        parameters: {
          type: 'object',
          properties: {
            userId: { type: 'string' },
            days: { type: 'number', default: 7 },
          },
          required: ['userId'],
        },
        execute: async ({ userId, days = 7 }) => {
          try {
            const healthData = await healthService.getHealthForRange(userId, daysAgo(days), today());
            const workouts = [];

            for (const [date, metric] of Object.entries(healthData || {})) {
              for (const w of (metric?.workouts || [])) {
                workouts.push({
                  date,
                  title: w.title || w.type,
                  type: w.type,
                  duration: w.duration,
                  calories: w.calories,
                  avgHr: w.avgHr,
                });
              }
            }

            return {
              workouts: workouts.sort((a, b) => b.date.localeCompare(a.date)),
              totalThisWeek: workouts.length,
              lastWorkoutDate: workouts[0]?.date || null,
            };
          } catch (err) {
            return { error: err.message, workouts: [], totalThisWeek: 0 };
          }
        },
      }),

      createTool({
        name: 'get_health_summary',
        description: 'Comprehensive daily health snapshot: weight, nutrition, workouts',
        parameters: {
          type: 'object',
          properties: {
            userId: { type: 'string' },
          },
          required: ['userId'],
        },
        execute: async ({ userId }) => {
          try {
            const todayDate = today();
            const metric = await healthService.getHealthForDate(userId, todayDate);

            return {
              date: todayDate,
              weight: metric?.weight || null,
              nutrition: metric?.nutrition || null,
              workouts: metric?.workouts || [],
            };
          } catch (err) {
            return { error: err.message, date: today() };
          }
        },
      }),
    ];
  }
}

function today() {
  return new Date().toISOString().split('T')[0];
}

function daysAgo(n) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString().split('T')[0];
}
