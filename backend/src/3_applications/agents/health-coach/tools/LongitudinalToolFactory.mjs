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
// the period's [from, to] range. Plus read_notes_file (F-102), which
// reads notes/*.md and scans/*.yml from the archive with optional
// markdown section extraction and per-execution caching. And
// find_similar_period (F-104), which aggregates each playbook period's
// 30-day-equivalent stats and delegates similarity ranking to the
// injected SimilarPeriodFinder.

import path from 'node:path';
import fsPromises from 'node:fs/promises';

import { ToolFactory } from '../../framework/ToolFactory.mjs';
import { createTool } from '../../ports/ITool.mjs';
import { HealthArchiveScope } from '#domains/health/services/HealthArchiveScope.mjs';

const AGGREGATIONS = ['daily', 'weekly_avg', 'monthly_avg', 'quarterly_avg', 'yearly_avg'];

// Subtrees this tool is allowed to read from. The HealthArchiveScope whitelist
// also covers playbook/, strava/, garmin/, etc. — but read_notes_file's
// CONTRACT is narrower: only notes/ and scans/. The scope is defense-in-depth
// against path-traversal; this constant is the tool's surface contract.
const READ_NOTES_PREFIXES = ['notes/', 'scans/'];

/**
 * Hard-validate userId at every tool boundary. The four current tools delegate
 * to trusted datastore methods (loadWeightData, loadNutritionData,
 * getHealthForRange, loadPlaybook) that compose paths internally, so the
 * userId is currently the only user-supplied input on the read path. Future
 * tools (e.g. read_notes_file in F-102) WILL take user-supplied filenames —
 * those must additionally call `HealthArchiveScope.assertReadable(absPath,
 * userId)` before any read. See backend/src/2_domains/health/services/
 * HealthArchiveScope.mjs for the F-106 whitelist.
 *
 * Errors are caught by each tool's outer try/catch and surfaced as
 * `{ ..., error: '...' }` results so the agent gets a structured rejection.
 */
function guardUserId(userId) {
  HealthArchiveScope.assertValidUserId(userId);
}

export class LongitudinalToolFactory extends ToolFactory {
  static domain = 'health';

  createTools() {
    const {
      healthStore,
      healthService,
      personalContextLoader,
      similarPeriodFinder,
      archiveScope,           // legacy: pre-factory direct injection (still
                              // accepted so existing tests keep working)
      archiveScopeFactory,    // F4-A: per-user scope factory (preferred)
      fs = fsPromises,
      dataRoot,
    } = this.deps;

    // Shared executors so the named-period wrapper can reuse the exact
    // logic from each underlying tool without duplicating it.
    const queryWeight = makeQueryWeightExecutor(healthStore);
    const queryNutrition = makeQueryNutritionExecutor(healthStore);
    const queryWorkouts = makeQueryWorkoutsExecutor(healthService);

    // Per-execution cache for read_notes_file. Closure-scoped so it lives
    // exactly as long as the returned tool set — fresh on every createTools()
    // call, which matches the agent's execution scope.
    const readNotesCache = new Map();
    const readNotesFile = makeReadNotesFileExecutor({
      archiveScope, archiveScopeFactory, fs, dataRoot, cache: readNotesCache,
    });

    // Stats aggregator for find_similar_period. Closure-scoped so it can
    // reuse healthStore from the factory deps without re-extracting.
    const computePeriodStats = makeComputePeriodStats({ healthStore });

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
            guardUserId(userId);
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

      createTool({
        name: 'read_notes_file',
        description:
          'Read a markdown note (notes/*.md) or YAML scan (scans/*.yml) from ' +
          'the user\'s health archive. The `filename` param MUST start with ' +
          '`notes/` or `scans/` — these are the only subtrees this tool can ' +
          'access. Optionally pass a `section` to extract only the content ' +
          'under that markdown heading (h1-h6); content runs until the next ' +
          'heading at the same or higher level. Results are cached per ' +
          'agent execution.',
        parameters: {
          type: 'object',
          properties: {
            userId: { type: 'string', description: 'User identifier' },
            filename: {
              type: 'string',
              description:
                'Relative path under the health archive, MUST be prefixed with ' +
                '`notes/` or `scans/`. Examples: `notes/strength-plateau.md`, ' +
                '`scans/2024-01-15-dexa.yml`.',
            },
            section: {
              type: 'string',
              description:
                'Optional markdown heading anchor. When set, only the content ' +
                'under that heading (until the next heading at the same or ' +
                'higher level) is returned. Case-insensitive trim match against ' +
                'the heading text.',
            },
          },
          required: ['userId', 'filename'],
        },
        execute: readNotesFile,
      }),

      createTool({
        name: 'find_similar_period',
        description:
          'Given a 30-day pattern signature (e.g. current weight average, ' +
          'protein average, tracking rate), surface the closest historical ' +
          'analog from the user\'s playbook of named periods. Useful when the ' +
          'agent wants to ground a current observation in personal precedent ' +
          '("the last time you were at this weight with this protein intake, ' +
          'here\'s what happened"). Returns up to `max_results` ranked ' +
          'matches with similarity scores per dimension.',
        parameters: {
          type: 'object',
          properties: {
            userId: { type: 'string', description: 'User identifier' },
            pattern_signature: {
              type: 'object',
              description:
                'A subset of the supported dimensions: weight_avg_lbs, ' +
                'weight_delta_lbs, protein_avg_g, calorie_avg, tracking_rate. ' +
                'Missing dimensions are ignored during scoring.',
              properties: {
                weight_avg_lbs: { type: 'number' },
                weight_delta_lbs: { type: 'number' },
                protein_avg_g: { type: 'number' },
                calorie_avg: { type: 'number' },
                tracking_rate: { type: 'number' },
              },
            },
            max_results: {
              type: 'number',
              default: 3,
              description: 'Max number of matches to return (default 3).',
            },
          },
          required: ['userId', 'pattern_signature'],
        },
        execute: async ({ userId, pattern_signature, max_results = 3 }) => {
          try {
            guardUserId(userId);

            // Graceful degradation when context is unavailable. We return a
            // structured no-result response rather than throwing so the agent
            // can incorporate the negative signal into its reasoning.
            if (!personalContextLoader || typeof personalContextLoader.loadPlaybook !== 'function') {
              return { matches: [], reason: 'no playbook' };
            }

            const playbook = await personalContextLoader.loadPlaybook(userId);
            const namedPeriods = playbook?.named_periods;
            if (!namedPeriods || typeof namedPeriods !== 'object') {
              return { matches: [], reason: 'no playbook' };
            }

            // Build the period descriptors the finder expects: name + stats +
            // metadata (from/to/description). Skip periods that yield no
            // usable stats — they would only dilute the rankings.
            const periods = [];
            for (const [name, raw] of Object.entries(namedPeriods)) {
              if (!raw || typeof raw !== 'object') continue;
              const from = formatDate(raw.from);
              const to = formatDate(raw.to);
              if (!from || !to) continue;

              const stats = await computePeriodStats({ userId, from, to });
              if (!hasUsableStats(stats)) continue;

              const description = typeof raw.description === 'string'
                ? raw.description.trim()
                : '';

              periods.push({ name, from, to, description, stats });
            }

            if (!similarPeriodFinder || typeof similarPeriodFinder.findSimilar !== 'function') {
              return { signature: pattern_signature, matches: [], error: 'similarPeriodFinder dependency missing' };
            }

            const matches = similarPeriodFinder.findSimilar({
              signature: pattern_signature,
              periods,
              maxResults: max_results,
            });

            return { signature: pattern_signature, matches };
          } catch (err) {
            return { signature: pattern_signature, matches: [], error: err.message };
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
      guardUserId(userId);
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
        aggregation === 'quarterly_avg' ? quarter :
        isoYear; // 'yearly_avg'

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
      guardUserId(userId);
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
      guardUserId(userId);
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

/**
 * Build the read_notes_file executor (F-102). Reads markdown notes and YAML
 * scans from the user's health archive with per-execution caching, scope
 * enforcement (HealthArchiveScope F-106), and optional markdown section
 * extraction.
 *
 * Cache key: `${userId}:${filename}:${section || ''}`. Section extraction is
 * computed against the cached raw file content, so two calls with the same
 * filename but different sections incur a single disk read.
 *
 * F4-A: prefers `archiveScopeFactory.forUser(userId)` (per-user scope).
 * Falls back to a directly-injected `archiveScope` for callers that haven't
 * migrated to the factory pattern yet (notably older tests).
 *
 * @param {object} opts
 * @param {{assertReadable: Function}} [opts.archiveScope] F-106 instance
 *   (legacy direct injection)
 * @param {{forUser: Function}} [opts.archiveScopeFactory] Per-user factory
 *   (F4-A — preferred)
 * @param {{readFile: Function}} opts.fs fs adapter (defaults to node:fs/promises in createTools)
 * @param {string} opts.dataRoot absolute data root path
 * @param {Map} opts.cache closure-scoped per-execution cache
 * @returns {Function} the tool executor
 */
function makeReadNotesFileExecutor({ archiveScope, archiveScopeFactory, fs, dataRoot, cache }) {
  return async function readNotesFile({ userId, filename, section = null }) {
    try {
      // 1) userId format
      HealthArchiveScope.assertValidUserId(userId);

      // 2) Validate filename. validatePathSegment rejects ..-traversal, NULs,
      //    absolute paths, and unsafe characters BEFORE we ever touch disk
      //    or the archive scope.
      if (typeof filename !== 'string' || !filename.length) {
        return { filename, error: 'filename must be a non-empty string' };
      }
      const normalizedFilename = HealthArchiveScope.validatePathSegment(filename);

      // 3) Tool-contract: only notes/ and scans/. Even though the F-106
      //    scope permits more (playbook/, strava/, ...), this tool is
      //    deliberately scoped narrower — those other surfaces have their
      //    own dedicated tools.
      const hasAllowedPrefix = READ_NOTES_PREFIXES.some(
        (p) => normalizedFilename.startsWith(p),
      );
      if (!hasAllowedPrefix) {
        return {
          filename,
          error: `filename must start with notes/ or scans/ (got: ${filename})`,
        };
      }

      // 4) dataRoot must be configured.
      if (!dataRoot || typeof dataRoot !== 'string') {
        return { filename, error: 'read_notes_file: dataRoot dependency missing' };
      }

      // 5) Resolve the per-user scope. Prefer the F4-A factory; fall back
      //    to the legacy direct injection for older callers/tests.
      let scope = archiveScope;
      if (archiveScopeFactory && typeof archiveScopeFactory.forUser === 'function') {
        scope = await archiveScopeFactory.forUser(userId);
      }
      if (!scope || typeof scope.assertReadable !== 'function') {
        return { filename, error: 'read_notes_file: archiveScope dependency missing' };
      }

      // 6) Compose absolute path and assert against the F-106 whitelist.
      const absPath = path.join(
        dataRoot, 'users', userId, 'lifelog/archives', normalizedFilename,
      );
      scope.assertReadable(absPath, userId);

      // 7) Cache check.
      const cacheKey = `${userId}:${normalizedFilename}:${section || ''}`;
      if (cache.has(cacheKey)) {
        return cache.get(cacheKey);
      }

      // Also cache the raw file content under a base key so
      // (filename, sectionA) and (filename, sectionB) don't double-read.
      const rawKey = `${userId}:${normalizedFilename}:`;
      let raw;
      if (cache.has(rawKey)) {
        raw = cache.get(rawKey).content;
      } else {
        raw = await fs.readFile(absPath, 'utf8');
        const rawResult = { filename: normalizedFilename, content: raw };
        cache.set(rawKey, rawResult);
        if (!section) {
          // The rawKey IS the cacheKey when no section is requested.
          return rawResult;
        }
      }

      // 8) Section extraction (markdown only).
      if (section) {
        const isMarkdown = normalizedFilename.endsWith('.md');
        if (!isMarkdown) {
          const result = { filename: normalizedFilename, section, error: 'section extraction only supported on .md files' };
          cache.set(cacheKey, result);
          return result;
        }
        const extracted = extractMarkdownSection(raw, section);
        if (extracted == null) {
          const result = { filename: normalizedFilename, section, error: 'section not found' };
          cache.set(cacheKey, result);
          return result;
        }
        const result = { filename: normalizedFilename, section, content: extracted };
        cache.set(cacheKey, result);
        return result;
      }

      // No section: return the raw content (already cached above).
      const result = { filename: normalizedFilename, content: raw };
      cache.set(cacheKey, result);
      return result;
    } catch (err) {
      return { filename, error: err.message };
    }
  };
}

/**
 * Extract content under a markdown section heading. Returns the lines under
 * the matching heading until either (a) a heading at the same or higher level
 * (lower `#` count) or (b) end of file. Returns `null` if no matching heading
 * is found. Section match is case-insensitive trim against the heading text.
 *
 * @param {string} content full file content
 * @param {string} section heading text to match
 * @returns {string|null}
 */
function extractMarkdownSection(content, section) {
  const target = String(section).trim().toLowerCase();
  const lines = content.split('\n');

  let inSection = false;
  let sectionLevel = 0;
  const collected = [];

  for (const line of lines) {
    const headingMatch = /^(#{1,6})\s+(.+?)\s*$/.exec(line);
    if (headingMatch) {
      const level = headingMatch[1].length;
      const text = headingMatch[2].trim().toLowerCase();
      if (!inSection) {
        if (text === target) {
          inSection = true;
          sectionLevel = level;
        }
        continue;
      }
      // We're inside the target section. A heading at the same or higher
      // level (smaller-or-equal `#` count) terminates the section.
      if (level <= sectionLevel) {
        break;
      }
      // Otherwise it's a nested subsection — keep it.
      collected.push(line);
      continue;
    }
    if (inSection) collected.push(line);
  }

  if (!inSection) return null;
  return collected.join('\n');
}

/**
 * Build the period-stats aggregator used by find_similar_period (F-104).
 *
 * Given a [from, to] date range, computes the canonical 5-dimension signature
 * the SimilarPeriodFinder accepts:
 *
 * - weight_avg_lbs: mean of daily adjusted/raw lbs across the range
 * - weight_delta_lbs: last weight reading minus first weight reading in range
 * - protein_avg_g: mean of daily protein over logged days only
 * - calorie_avg: mean of daily calories over logged days only
 * - tracking_rate: logged days ÷ total days in range (inclusive)
 *
 * Dimensions with no underlying data resolve to `null` so the finder can
 * skip them in scoring (it ignores non-finite values).
 *
 * @param {object} args
 * @param {object} args.healthStore datastore exposing loadWeightData / loadNutritionData
 * @returns {Function} async ({ userId, from, to }) => stats
 */
function makeComputePeriodStats({ healthStore }) {
  return async function computePeriodStats({ userId, from, to }) {
    // Total day count in [from, to] inclusive — used as the tracking_rate
    // denominator. We trust well-formed YYYY-MM-DD inputs (validated upstream).
    const fromDate = new Date(from + 'T00:00:00Z');
    const toDate = new Date(to + 'T00:00:00Z');
    const totalDays = Math.round((toDate - fromDate) / 86400000) + 1;

    const stats = {
      weight_avg_lbs: null,
      weight_delta_lbs: null,
      protein_avg_g: null,
      calorie_avg: null,
      tracking_rate: null,
    };

    // ---- weight ----
    if (typeof healthStore?.loadWeightData === 'function') {
      const weightData = await healthStore.loadWeightData(userId);
      const weightDates = Object.keys(weightData || {})
        .filter(d => d >= from && d <= to)
        .sort();
      if (weightDates.length) {
        const lbsValues = [];
        for (const d of weightDates) {
          const entry = weightData[d] || {};
          const lbs = entry.lbs_adjusted_average ?? entry.lbs ?? null;
          if (typeof lbs === 'number' && Number.isFinite(lbs)) lbsValues.push(lbs);
        }
        if (lbsValues.length) {
          stats.weight_avg_lbs = lbsValues.reduce((s, n) => s + n, 0) / lbsValues.length;
          stats.weight_delta_lbs = lbsValues[lbsValues.length - 1] - lbsValues[0];
        }
      }
    }

    // ---- nutrition + tracking_rate ----
    if (typeof healthStore?.loadNutritionData === 'function') {
      const nutritionData = await healthStore.loadNutritionData(userId);
      const nutritionDates = Object.keys(nutritionData || {})
        .filter(d => d >= from && d <= to);

      const proteinValues = [];
      const calorieValues = [];
      for (const d of nutritionDates) {
        const entry = nutritionData[d] || {};
        if (typeof entry.protein === 'number' && Number.isFinite(entry.protein)) {
          proteinValues.push(entry.protein);
        }
        if (typeof entry.calories === 'number' && Number.isFinite(entry.calories)) {
          calorieValues.push(entry.calories);
        }
      }
      if (proteinValues.length) {
        stats.protein_avg_g = proteinValues.reduce((s, n) => s + n, 0) / proteinValues.length;
      }
      if (calorieValues.length) {
        stats.calorie_avg = calorieValues.reduce((s, n) => s + n, 0) / calorieValues.length;
      }
      if (totalDays > 0) {
        stats.tracking_rate = nutritionDates.length / totalDays;
      }
    }

    return stats;
  };
}

/**
 * True iff a stats object has at least one finite numeric dimension we can
 * actually score against. Periods that produced no usable data are excluded
 * from the candidate set so they don't dilute rankings.
 */
function hasUsableStats(stats) {
  if (!stats || typeof stats !== 'object') return false;
  for (const v of Object.values(stats)) {
    if (typeof v === 'number' && Number.isFinite(v)) return true;
  }
  return false;
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

function isoYear(dateStr) {
  // 'YYYY-MM-DD' → 'YYYY'
  return dateStr.slice(0, 4);
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
