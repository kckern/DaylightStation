// backend/src/3_applications/agents/health-coach/tools/LongitudinalToolFactory.mjs
//
// Tools for longitudinal historical queries against archived health data
// (F-103). Each tool aggregates a time series at a selectable granularity so
// the coaching agent can ground its observations in personal precedent
// without consuming day-by-day rows.
//
// This factory is structured as an array of `createTool(...)` entries:
// query_historical_weight (F-103.1), query_historical_nutrition (F-103.2),
// query_historical_workouts (F-103.3), and query_named_period (F-103.4),
// the last of which is a convenience wrapper that resolves a labeled
// period from the user's playbook and runs the other three against
// the period's [from, to] range.

import { ToolFactory } from '../../framework/ToolFactory.mjs';
import { createTool } from '../../ports/ITool.mjs';

const AGGREGATIONS = ['daily', 'weekly_avg', 'monthly_avg', 'quarterly_avg'];

export class LongitudinalToolFactory extends ToolFactory {
  static domain = 'health';

  createTools() {
    const { healthStore, healthService, personalContextLoader } = this.deps;

    // Shared executors so the named-period wrapper can reuse the exact
    // logic from each underlying tool without duplicating it.
    const queryWeight = makeQueryWeightExecutor(healthStore);
    const queryNutrition = makeQueryNutritionExecutor(healthStore);
    const queryWorkouts = makeQueryWorkoutsExecutor(healthService);

    return [
      createTool({
        name: 'query_historical_weight',
        description:
          'Query weight history with selectable aggregation (daily, weekly_avg, ' +
          'monthly_avg, quarterly_avg) over an inclusive [from, to] date range. ' +
          'Returns time series with lbs, fatPercent, count, and source attribution.',
        parameters: {
          type: 'object',
          properties: {
            userId: { type: 'string', description: 'User identifier' },
            from: { type: 'string', description: 'Inclusive start date (YYYY-MM-DD)' },
            to: { type: 'string', description: 'Inclusive end date (YYYY-MM-DD)' },
            aggregation: {
              type: 'string',
              enum: AGGREGATIONS,
              default: 'daily',
              description: 'Granularity of returned rows',
            },
          },
          required: ['userId', 'from', 'to'],
        },
        execute: queryWeight,
      }),

      createTool({
        name: 'query_historical_nutrition',
        description:
          'Query nutrition history over an inclusive [from, to] date range. ' +
          'Returns per-day calories, protein, carbs, fat (and fiber/sugar/food_items ' +
          'when available). Supports filters (protein_min, tagged_with, contains_food) ' +
          'and field projection. Mirrors the reconciliation 14-day redaction policy: ' +
          'implied_intake and tracking_accuracy are stripped from any day less than ' +
          '14 days old.',
        parameters: {
          type: 'object',
          properties: {
            userId: { type: 'string', description: 'User identifier' },
            from: { type: 'string', description: 'Inclusive start date (YYYY-MM-DD)' },
            to: { type: 'string', description: 'Inclusive end date (YYYY-MM-DD)' },
            fields: {
              type: 'array',
              items: { type: 'string' },
              description: 'Optional field projection. When provided, returned days only ' +
                'include the listed keys (plus `date`). When null/omitted, all fields are returned.',
            },
            filter: {
              type: 'object',
              description: 'Optional filters applied before projection.',
              properties: {
                protein_min: { type: 'number', description: 'Keep days where protein >= this value (g)' },
                tagged_with: { type: 'string', description: 'Keep days whose tags array contains this string' },
                contains_food: {
                  type: 'string',
                  description: 'Keep days where any food_items[].name contains this substring (case-insensitive)',
                },
              },
            },
          },
          required: ['userId', 'from', 'to'],
        },
        execute: queryNutrition,
      }),

      createTool({
        name: 'query_historical_workouts',
        description:
          'Query historical workouts over an inclusive [from, to] date range. ' +
          'Reads from the household health data store (Strava + fitness trackers). ' +
          'Supports optional filters by `type` (e.g. run, ride, strength, yoga) ' +
          'and `name_contains` (case-insensitive substring match against the ' +
          'workout title/name). Returns a flat list of workouts sorted by date ascending.',
        parameters: {
          type: 'object',
          properties: {
            userId: { type: 'string', description: 'User identifier' },
            from: { type: 'string', description: 'Inclusive start date (YYYY-MM-DD)' },
            to: { type: 'string', description: 'Inclusive end date (YYYY-MM-DD)' },
            type: {
              type: 'string',
              description: 'Optional exact-match filter on workout type (e.g. run, ride, strength).',
            },
            name_contains: {
              type: 'string',
              description: 'Optional case-insensitive substring filter against workout title/name.',
            },
          },
          required: ['userId', 'from', 'to'],
        },
        execute: queryWorkouts,
      }),

      createTool({
        name: 'query_named_period',
        description:
          'Look up a named period from the user\'s personal playbook ' +
          '(e.g. "fixture-cut-2024", "rebound-2025") and return aggregated ' +
          'weight (weekly_avg), full nutrition days, and full workout list ' +
          'for the period\'s [from, to] range. Use this when the user (or ' +
          'an upstream prompt) refers to a labeled time window — it saves ' +
          'the model from having to remember the dates.',
        parameters: {
          type: 'object',
          properties: {
            userId: { type: 'string', description: 'User identifier' },
            name: {
              type: 'string',
              description: 'Period name as defined under playbook.named_periods',
            },
          },
          required: ['userId', 'name'],
        },
        execute: async ({ userId, name }) => {
          try {
            if (!personalContextLoader || typeof personalContextLoader.loadPlaybook !== 'function') {
              return { name, error: 'personalContextLoader dependency missing' };
            }

            const playbook = await personalContextLoader.loadPlaybook(userId);
            const period = playbook?.named_periods?.[name];
            if (!period) {
              return { name, error: 'Period not found' };
            }

            const from = formatDate(period.from);
            const to = formatDate(period.to);
            if (!from || !to) {
              return { name, error: 'Period has invalid from/to bounds' };
            }

            const description = typeof period.description === 'string'
              ? period.description.trim()
              : '';

            // Run the three underlying queries against the period bounds.
            const [weight, nutrition, workoutsResult] = await Promise.all([
              queryWeight({ userId, from, to, aggregation: 'weekly_avg' }),
              queryNutrition({ userId, from, to }),
              queryWorkouts({ userId, from, to }),
            ]);

            return {
              name,
              from,
              to,
              description,
              weight,
              nutrition,
              workouts: workoutsResult.workouts || [],
            };
          } catch (err) {
            return { name, error: err.message };
          }
        },
      }),
    ];
  }
}

export default LongitudinalToolFactory;

// ---------- shared executors ----------

/**
 * Build the query_historical_weight executor. Extracted so query_named_period
 * can run the same logic against pre-computed period bounds without
 * duplicating the aggregation code path.
 */
function makeQueryWeightExecutor(healthStore) {
  return async function queryWeight({ userId, from, to, aggregation = 'daily' }) {
    try {
      if (!AGGREGATIONS.includes(aggregation)) {
        return { aggregation, rows: [], error: `Unknown aggregation: ${aggregation}` };
      }

      const weightData = await healthStore.loadWeightData(userId);
      const dates = Object.keys(weightData || {})
        .filter(d => d >= from && d <= to)
        .sort();

      if (!dates.length) return { aggregation, rows: [] };

      // Normalize each day to a canonical row.
      const dailyRows = dates.map(d => {
        const entry = weightData[d] || {};
        return {
          date: d,
          lbs: entry.lbs_adjusted_average || entry.lbs || null,
          fatPercent: entry.fat_percent_average || entry.fat_percent || null,
          source: entry.source || 'consumer-bia',
        };
      });

      if (aggregation === 'daily') {
        return {
          aggregation,
          rows: dailyRows.map(r => ({
            date: r.date,
            lbs: r.lbs,
            fatPercent: r.fatPercent,
            count: 1,
            source: r.source,
          })),
        };
      }

      const bucketKey =
        aggregation === 'weekly_avg' ? isoWeek :
        aggregation === 'monthly_avg' ? isoMonth :
        quarter; // 'quarterly_avg'

      const buckets = new Map();
      for (const row of dailyRows) {
        const key = bucketKey(row.date);
        if (!buckets.has(key)) {
          buckets.set(key, { period: key, lbs: [], fatPercent: [], sources: new Set() });
        }
        const b = buckets.get(key);
        if (row.lbs != null) b.lbs.push(row.lbs);
        if (row.fatPercent != null) b.fatPercent.push(row.fatPercent);
        if (row.source) b.sources.add(row.source);
      }

      const rows = [...buckets.values()]
        .sort((a, b) => a.period.localeCompare(b.period))
        .map(b => ({
          period: b.period,
          lbs: avg(b.lbs),
          fatPercent: avg(b.fatPercent),
          count: Math.max(b.lbs.length, b.fatPercent.length),
          source: b.sources.size === 1 ? [...b.sources][0] : [...b.sources].join(','),
        }));

      return { aggregation, rows };
    } catch (err) {
      return { aggregation, rows: [], error: err.message };
    }
  };
}

/**
 * Build the query_historical_nutrition executor. Extracted for reuse from
 * the named-period wrapper.
 */
function makeQueryNutritionExecutor(healthStore) {
  return async function queryNutrition({ userId, from, to, fields = null, filter = {} }) {
    try {
      const nutritionData = await healthStore.loadNutritionData(userId);
      const dates = Object.keys(nutritionData || {})
        .filter(d => d >= from && d <= to)
        .sort();

      if (!dates.length) return { days: [] };

      // 14-day redaction window — match ReconciliationToolFactory.
      // Use UTC to align with our YYYY-MM-DD date keys, which are UTC dates.
      const MATURITY_DAYS = 14;
      const now = new Date();
      const todayUtc = new Date(Date.UTC(
        now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(),
      ));
      const maturityCutoff = new Date(todayUtc);
      maturityCutoff.setUTCDate(maturityCutoff.getUTCDate() - MATURITY_DAYS);

      const proteinMin = filter && typeof filter.protein_min === 'number'
        ? filter.protein_min : null;
      const taggedWith = filter && typeof filter.tagged_with === 'string'
        ? filter.tagged_with : null;
      const containsFood = filter && typeof filter.contains_food === 'string'
        ? filter.contains_food.toLowerCase() : null;

      const days = [];
      for (const date of dates) {
        const entry = nutritionData[date] || {};

        // ---- filtering ----
        if (proteinMin != null && (entry.protein ?? 0) < proteinMin) continue;
        if (taggedWith != null) {
          const tags = Array.isArray(entry.tags) ? entry.tags : [];
          if (!tags.includes(taggedWith)) continue;
        }
        if (containsFood != null) {
          const foods = Array.isArray(entry.food_items) ? entry.food_items : [];
          const match = foods.some(f =>
            typeof f?.name === 'string' && f.name.toLowerCase().includes(containsFood),
          );
          if (!match) continue;
        }

        // ---- canonical day shape ----
        const day = {
          date,
          calories: entry.calories ?? null,
          protein: entry.protein ?? null,
          carbs: entry.carbs ?? null,
          fat: entry.fat ?? null,
        };
        if (entry.fiber !== undefined) day.fiber = entry.fiber;
        if (entry.sugar !== undefined) day.sugar = entry.sugar;
        if (entry.food_items !== undefined) day.food_items = entry.food_items;
        if (entry.tags !== undefined) day.tags = entry.tags;
        if (entry.implied_intake !== undefined) day.implied_intake = entry.implied_intake;
        if (entry.tracking_accuracy !== undefined) day.tracking_accuracy = entry.tracking_accuracy;

        // ---- redaction (recent days < 14 days old) ----
        const dateObj = new Date(date + 'T00:00:00Z');
        const isMature = dateObj <= maturityCutoff;
        if (!isMature) {
          delete day.implied_intake;
          delete day.tracking_accuracy;
        }

        // ---- projection ----
        if (Array.isArray(fields) && fields.length) {
          const projected = { date: day.date };
          for (const key of fields) {
            if (key === 'date') continue;
            if (key in day) projected[key] = day[key];
          }
          days.push(projected);
        } else {
          days.push(day);
        }
      }

      return { days };
    } catch (err) {
      return { days: [], error: err.message };
    }
  };
}

/**
 * Build the query_historical_workouts executor. Extracted for reuse from
 * the named-period wrapper.
 */
function makeQueryWorkoutsExecutor(healthService) {
  return async function queryWorkouts({ userId, from, to, type = null, name_contains = null }) {
    try {
      const healthData = await healthService.getHealthForRange(userId, from, to);

      const needle = typeof name_contains === 'string' && name_contains.length
        ? name_contains.toLowerCase()
        : null;

      const workouts = [];
      for (const [date, metric] of Object.entries(healthData || {})) {
        for (const w of (metric?.workouts || [])) {
          if (type != null && w.type !== type) continue;
          if (needle != null) {
            const label = (w.title || w.name || '').toLowerCase();
            if (!label.includes(needle)) continue;
          }
          workouts.push({
            date,
            title: w.title || w.name,
            type: w.type,
            duration: w.duration,
            calories: w.calories,
            avgHr: w.avgHr,
          });
        }
      }

      // Sort by date ascending (chronological).
      workouts.sort((a, b) => a.date.localeCompare(b.date));

      return { workouts };
    } catch (err) {
      return { workouts: [], error: err.message };
    }
  };
}

// ---------- helpers ----------

/**
 * Normalize a YAML-derived date value (string or Date) to YYYY-MM-DD.
 * Returns null for falsy/invalid input.
 */
function formatDate(value) {
  if (!value) return null;
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return null;
    return value.toISOString().slice(0, 10);
  }
  return String(value);
}

function avg(arr) {
  if (!arr.length) return null;
  const sum = arr.reduce((s, n) => s + n, 0);
  return sum / arr.length;
}

function isoMonth(dateStr) {
  // 'YYYY-MM-DD' → 'YYYY-MM'
  return dateStr.slice(0, 7);
}

function quarter(dateStr) {
  // 'YYYY-MM-DD' → 'YYYY-Qn'  (Q1 = Jan-Mar, Q2 = Apr-Jun, ...)
  const year = dateStr.slice(0, 4);
  const month = parseInt(dateStr.slice(5, 7), 10);
  const q = Math.ceil(month / 3);
  return `${year}-Q${q}`;
}

/**
 * ISO 8601 week. Returns 'YYYY-Www' where YYYY is the ISO week-numbering
 * year (which can differ from the calendar year for early-Jan / late-Dec
 * dates) and ww is the zero-padded ISO week number (01-53).
 */
function isoWeek(dateStr) {
  const [y, m, d] = dateStr.split('-').map(Number);
  // Use UTC to avoid TZ drift.
  const date = new Date(Date.UTC(y, m - 1, d));
  // Per ISO 8601, week starts Monday. JavaScript getUTCDay(): Sun=0..Sat=6.
  // Shift so Monday=1..Sunday=7.
  const dayOfWeek = date.getUTCDay() || 7;
  // Move to the Thursday of this week (ISO weeks are anchored on Thursday).
  date.setUTCDate(date.getUTCDate() + 4 - dayOfWeek);
  const isoYear = date.getUTCFullYear();
  // Jan 4th is always in ISO week 1.
  const yearStart = new Date(Date.UTC(isoYear, 0, 4));
  const yearStartDow = yearStart.getUTCDay() || 7;
  yearStart.setUTCDate(yearStart.getUTCDate() + 4 - yearStartDow);
  const weekNum = Math.ceil(((date - yearStart) / 86400000 + 1) / 7);
  return `${isoYear}-W${String(weekNum).padStart(2, '0')}`;
}
