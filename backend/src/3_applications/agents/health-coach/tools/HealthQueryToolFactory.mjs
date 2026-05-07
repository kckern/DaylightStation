// backend/src/3_applications/agents/health-coach/tools/HealthQueryToolFactory.mjs

import { ToolFactory } from '../../framework/ToolFactory.mjs';
import { createTool } from '../../ports/ITool.mjs';

/**
 * Wraps HealthQueryService, ComputeSandbox, PersonalConstantsService, and
 * EventQueryService into the five ToolFactory-shaped tools the health-coach
 * agent calls:
 *
 *   - query_health        SQL-flavored health data query (metric × period × aggregate)
 *   - compute             Sandboxed JS math evaluator for arithmetic on query results
 *   - personal_constants  User calibration values (height, age, sex, PAL, etc.)
 *   - query_events        List individual events (workouts) with natural identifiers
 *   - get_event_detail    Fetch full detail for a specific event by ID
 *
 * Tool descriptions include enough vocabulary that the LLM can compose calls
 * without reading additional documentation.
 */
export class HealthQueryToolFactory extends ToolFactory {
  static domain = 'health-coach';
  #queryService;
  #sandbox;
  #constantsService;
  #eventQueryService;

  constructor({ queryService, sandbox, constantsService, eventQueryService }) {
    super({ queryService, sandbox, constantsService, eventQueryService });
    if (!queryService)      throw new Error('HealthQueryToolFactory: queryService required');
    if (!sandbox)           throw new Error('HealthQueryToolFactory: sandbox required');
    if (!constantsService)  throw new Error('HealthQueryToolFactory: constantsService required');
    if (!eventQueryService) throw new Error('HealthQueryToolFactory: eventQueryService required');
    this.#queryService = queryService;
    this.#sandbox = sandbox;
    this.#constantsService = constantsService;
    this.#eventQueryService = eventQueryService;
  }

  createTools() {
    const queryService = this.#queryService;
    const sandbox = this.#sandbox;
    const constantsService = this.#constantsService;
    const eventQueryService = this.#eventQueryService;

    return [
      createTool({
        name: 'query_health',
        description:
          'Query the user\'s health data. SQL-flavored: pass a metric, a period, optional ' +
          'aggregate / group_by / filter / join / correlate / rolling. Returns rows or an ' +
          'aggregate value. Metric vocabulary: weight_lbs, weight_kg, fat_pct, lean_mass_lbs, ' +
          'calories, protein_g, carbs_g, fat_g, fiber_g, tracking_density, workout_count, ' +
          'workout_duration_min, workout_kcal, hr_avg, hr_max, hr_minutes_zone2.',
        parameters: {
          type: 'object',
          properties: {
            metric: {
              type: 'string',
              description:
                'Metric name. Vocabulary: weight_lbs, weight_kg, fat_pct, lean_mass_lbs, ' +
                'calories, protein_g, carbs_g, fat_g, fiber_g, tracking_density, ' +
                'workout_count, workout_duration_min, workout_kcal, hr_avg, hr_max, ' +
                'hr_minutes_zone2.',
            },
            period: {
              type: 'object',
              description:
                'Polymorphic period. Pass exactly one key: ' +
                '{ rolling: "last_30d" } | { calendar: "2024" } | ' +
                '{ named: "2017-cut" } | { from: "YYYY-MM-DD", to: "YYYY-MM-DD" }.',
            },
            granularity: {
              type: 'string',
              enum: ['raw', 'daily', 'weekly', 'monthly'],
              default: 'daily',
              description: 'Row granularity. Defaults to daily.',
            },
            aggregate: {
              description:
                'Aggregate function: none | mean | sum | min | max | count | ' +
                'p10 | p50 | p90 | stdev | regression | histogram. ' +
                'For histogram also pass { bins: number }.',
            },
            group_by: {
              description:
                'Group rows: day_of_week | weekday_vs_weekend | workout_type | month | year.',
            },
            filter: {
              type: 'array',
              description:
                'Chainable AND filters: [{ field, op: "<" | "<=" | "==" | ">" | ">=" | ' +
                '"in" | "not_in", value }].',
            },
            join: {
              type: 'array',
              items: { type: 'string' },
              description: 'Additional metric names to join onto each row by date.',
            },
            correlate: {
              type: 'object',
              description:
                'Correlation options: { with: metricName, method: "pearson" | "spearman", lag: number }.',
            },
            rolling: {
              type: 'object',
              description:
                'Rolling window: { fn: "mean" | "sum" | "min" | "max", window: number }.',
            },
            userId: { type: 'string' },
          },
          required: ['metric', 'period', 'userId'],
        },
        execute: async (args) => {
          try {
            return await queryService.query(args);
          } catch (err) {
            return { error: err.message };
          }
        },
      }),

      createTool({
        name: 'compute',
        description:
          'Sandboxed math evaluator. Pass a JS expression; bind values via inputs. ' +
          'Use this for any arithmetic on query_health results — do NOT do mental math ' +
          'in prose. The Math object is available; no I/O or async.',
        parameters: {
          type: 'object',
          properties: {
            expression: {
              type: 'string',
              description:
                'A JS expression evaluated in a sandboxed context. ' +
                'Example: "(intake - tdee) * 30 / 3500". ' +
                'Math object available; no I/O, no async.',
            },
            inputs: {
              type: 'object',
              description: 'Named values bound as identifiers in the expression scope.',
            },
          },
          required: ['expression'],
        },
        execute: async ({ expression, inputs }) => {
          try {
            return sandbox.evaluate(expression, inputs ?? {});
          } catch (err) {
            return { error: err.message };
          }
        },
      }),

      createTool({
        name: 'personal_constants',
        description:
          'Return the user\'s personal calibration values: weight_kg, weight_lbs, ' +
          'height_cm, age, sex, activity_pal, scale_bias_lbs, bmr_formula, ' +
          'calorie_per_lb_fat. Read these before any metabolic calculation.',
        parameters: {
          type: 'object',
          properties: {
            userId: { type: 'string' },
          },
          required: ['userId'],
        },
        execute: async ({ userId }) => {
          try {
            return await constantsService.get(userId);
          } catch (err) {
            return { error: err.message };
          }
        },
      }),

      createTool({
        name: 'query_events',
        description:
          'List individual events (workouts, etc.) with their natural identifiers — ' +
          'sessionId, strava_id, type, date, duration, kcal, hr_avg, hr_max, distance_mi. ' +
          'Use this when the user asks about specific events ("how was my run today?"); ' +
          'include the IDs in your prose so follow-up questions can drill in via get_event_detail.',
        parameters: {
          type: 'object',
          properties: {
            kind:   { type: 'string', enum: ['workout'], description: 'Event kind. Currently only "workout" is supported.' },
            period: { description: '{ rolling: "last_30d" } | { from, to } | bare string shorthand' },
            filter: { type: 'object', description: 'Optional filter, e.g. { type: "Run" }' },
            limit:  { type: 'number' },
            userId: { type: 'string' },
          },
          required: ['kind', 'period', 'userId'],
        },
        execute: async (args) => eventQueryService.queryEvents(args),
      }),

      createTool({
        name: 'get_event_detail',
        description:
          'Fetch full detail for a specific event by ID. Pass either the sessionId ' +
          '(YYYYMMDDHHmmss) or the Strava activity ID. Returns the event\'s metadata + ' +
          'timeline.series (HR per second) + events. Use this for follow-up drill-down ' +
          'after query_events surfaces an ID.',
        parameters: {
          type: 'object',
          properties: {
            id:     { description: 'sessionId (string) or Strava activity ID (number).' },
            kind:   { type: 'string', enum: ['workout'], default: 'workout' },
            userId: { type: 'string' },
          },
          required: ['id', 'userId'],
        },
        execute: async ({ id, kind }) => kind
          ? eventQueryService.getEventDetail({ id, kind })
          : eventQueryService.getEventDetail({ id }),
      }),
    ];
  }
}

export default HealthQueryToolFactory;
