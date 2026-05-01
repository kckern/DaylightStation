// backend/src/3_applications/agents/health-coach/tools/ComplianceToolFactory.mjs
//
// Compliance summary tool (PRD F-002 / F2-B). Exposes
// `get_compliance_summary({ userId, days })` which reads the per-day
// `coaching` field from the health datastore and returns counts, percentages,
// current streak, and longest gap for each tracked compliance dimension.
//
// Dimensions are NOT hardcoded — they come from the user's playbook
// (`coaching_dimensions`) loaded via `personalContextLoader`. The summarizer
// is selected by declared dimension `type`:
//   - boolean → logged/missed/untracked + miss-streak/untracked-streak/longestGap
//   - numeric → logged/untracked + per-field averages + interior-gap math
//   - text    → logged/untracked + complianceRate vs windowDays
//
// Design notes:
//   - "Untracked" days (no coaching entry, or that dimension absent from
//     coaching) are EXCLUDED from the boolean complianceRate denominator.
//     For text dimensions, complianceRate is `logged / windowDays`.
//   - currentStreak is trailing days where the dimension is in its "logged"
//     state. Untracked breaks the streak (only positive states continue it).
//   - longestGap on boolean dimensions counts the longest consecutive run
//     of explicit misses; on numeric dimensions, it's the longest gap of
//     non-logged days BETWEEN two logged days (interior gap).
//   - When the playbook has no `coaching_dimensions` array, the tool returns
//     `{ windowDays, dimensions: {} }` and logs a warn.

import { ToolFactory } from '../../framework/ToolFactory.mjs';
import { createTool } from '../../ports/ITool.mjs';

const DEFAULT_DAYS = 30;
const MIN_DAYS = 1;
const MAX_DAYS = 365;

const STATUS = Object.freeze({
  LOGGED: 'logged',
  MISSED: 'missed',
  UNTRACKED: 'untracked',
});

export class ComplianceToolFactory extends ToolFactory {
  static domain = 'health';

  createTools() {
    const { healthStore, personalContextLoader, logger } = this.deps;
    const log = logger || (typeof console !== 'undefined' ? console : null);

    return [
      createTool({
        name: 'get_compliance_summary',
        description:
          'Counts, percentages, current streak, and longest gap for each tracked ' +
          'daily-coaching dimension declared in the user\'s playbook ' +
          '(coaching_dimensions). Untracked days are excluded from the ' +
          'boolean complianceRate denominator. currentStreak counts trailing ' +
          'logged days; longestGap counts only consecutive explicit misses ' +
          '(boolean) or interior untracked gaps (numeric).',
        parameters: {
          type: 'object',
          properties: {
            userId: { type: 'string', description: 'User identifier' },
            days: {
              type: 'number',
              default: DEFAULT_DAYS,
              minimum: MIN_DAYS,
              maximum: MAX_DAYS,
              description: 'Window size in days, ending at today (inclusive). Default 30.',
            },
          },
          required: ['userId'],
        },
        execute: async ({ userId, days = DEFAULT_DAYS }) => {
          const windowDays = clampDays(days);
          try {
            if (!userId || typeof userId !== 'string') {
              return { windowDays, dimensions: {}, error: 'userId is required' };
            }

            const dimensionsSchema = await loadDimensionsSchema(personalContextLoader, userId, log);
            if (!dimensionsSchema || dimensionsSchema.length === 0) {
              log?.warn?.('compliance_tool.no_dimensions_schema', { userId });
              return { windowDays, dimensions: {} };
            }

            const data = (healthStore && typeof healthStore.loadHealthData === 'function')
              ? (await healthStore.loadHealthData(userId)) || {}
              : {};
            const datesInWindow = computeWindowDates(windowDays);

            const dimensions = {};
            for (const dim of dimensionsSchema) {
              if (!dim?.key || !dim?.type) continue;
              dimensions[dim.key] = summarizeDimension(dim, datesInWindow, data, windowDays);
            }

            return { windowDays, dimensions };
          } catch (err) {
            return {
              windowDays,
              dimensions: {},
              error: err.message,
            };
          }
        },
      }),
    ];
  }
}

export default ComplianceToolFactory;

// ---------- schema loading ----------

async function loadDimensionsSchema(personalContextLoader, userId, logger) {
  if (!personalContextLoader || typeof personalContextLoader.loadPlaybook !== 'function') {
    return null;
  }
  try {
    const playbook = await personalContextLoader.loadPlaybook(userId);
    const dims = playbook?.coaching_dimensions;
    if (Array.isArray(dims) && dims.length > 0) return dims;
    return null;
  } catch (err) {
    logger?.warn?.('compliance_tool.schema_load_failed', {
      userId,
      error: err?.message || String(err),
    });
    return null;
  }
}

// ---------- dimension summarizer dispatch ----------

function summarizeDimension(dim, dates, data, windowDays) {
  if (dim.type === 'boolean') return summarizeBoolean(dim, dates, data);
  if (dim.type === 'numeric') return summarizeNumeric(dim, dates, data);
  if (dim.type === 'text') return summarizeText(dim, dates, data, windowDays);
  return { logged: 0, untracked: windowDays };
}

// ---------- shared classification helpers ----------

function pickCoaching(entry) {
  if (!entry || typeof entry !== 'object') return null;
  const coaching = entry.coaching;
  if (!coaching || typeof coaching !== 'object') return null;
  return coaching;
}

function pickDimensionPayload(coaching, dimKey) {
  if (!coaching) return null;
  const value = coaching[dimKey];
  if (value === undefined || value === null) return null;
  return value;
}

// ---------- summarizers ----------

/**
 * Boolean compliance summary (e.g., post_workout_protein).
 *   logged: required boolean field === true
 *   missed: required boolean field === false
 *   untracked: dimension not present, or required field absent
 */
function summarizeBoolean(dim, dates, data) {
  const requiredBool = findRequiredFieldOfType(dim, 'boolean');
  const statusArr = [];
  for (const date of dates) {
    const coaching = pickCoaching(data[date]);
    const payload = pickDimensionPayload(coaching, dim.key);
    statusArr.push(classifyBoolean(payload, requiredBool?.name));
  }
  const counts = countStatuses(statusArr);
  const denom = counts.logged + counts.missed;
  const complianceRate = denom > 0 ? counts.logged / denom : 0;
  return {
    logged: counts.logged,
    missed: counts.missed,
    untracked: counts.untracked,
    complianceRate,
    currentStreak: trailingStreakOf(statusArr, STATUS.LOGGED),
    currentMissStreak: trailingStreakOf(statusArr, STATUS.MISSED),
    currentUntrackedStreak: trailingStreakOf(statusArr, STATUS.UNTRACKED),
    longestGap: longestRunOf(statusArr, STATUS.MISSED),
  };
}

function classifyBoolean(payload, fieldName) {
  if (!payload) return STATUS.UNTRACKED;
  // Bare boolean payload is supported (e.g., trust-mode entries).
  if (typeof payload === 'boolean') {
    return payload ? STATUS.LOGGED : STATUS.MISSED;
  }
  if (typeof payload !== 'object') return STATUS.UNTRACKED;
  const value = fieldName ? payload[fieldName] : payload.taken;
  if (value === true) return STATUS.LOGGED;
  if (value === false) return STATUS.MISSED;
  return STATUS.UNTRACKED;
}

/**
 * Numeric (engagement) summary (e.g., daily_strength_micro).
 *   logged: all required fields present (string/numeric); numeric fields
 *           must be finite numbers
 *   untracked: dimension absent or required fields missing
 *
 * `avgValue` is the mean of the dimension's `average_field` (an explicit
 * declaration in the schema). When unset, falls back to the first required
 * integer/number field. `null` if no logged days.
 *
 * For multi-numeric dimensions, `averages` carries per-field means for
 * every required numeric field.
 */
function summarizeNumeric(dim, dates, data) {
  const requiredFields = collectRequiredFields(dim);
  const numericFields = requiredFields.filter(([, decl]) =>
    decl.type === 'integer' || decl.type === 'number'
  );
  const averageFieldName = dim.average_field
    || (numericFields[0] ? numericFields[0][0] : null);

  const statusArr = [];
  const numericValues = {}; // fieldName → array of logged values
  for (const [fieldName] of numericFields) numericValues[fieldName] = [];

  for (const date of dates) {
    const coaching = pickCoaching(data[date]);
    const payload = pickDimensionPayload(coaching, dim.key);
    const cls = classifyNumeric(payload, requiredFields, numericFields);
    statusArr.push(cls.status);
    if (cls.status === STATUS.LOGGED) {
      for (const [fieldName] of numericFields) {
        const v = payload[fieldName];
        if (typeof v === 'number' && Number.isFinite(v)) {
          numericValues[fieldName].push(v);
        }
      }
    }
  }

  const counts = countStatuses(statusArr);
  const averages = {};
  for (const [fieldName, values] of Object.entries(numericValues)) {
    averages[fieldName] = values.length
      ? values.reduce((s, n) => s + n, 0) / values.length
      : null;
  }

  const result = {
    logged: counts.logged,
    untracked: counts.untracked,
    currentStreak: trailingStreakOf(statusArr, STATUS.LOGGED),
    currentUntrackedStreak: trailingStreakOf(statusArr, STATUS.UNTRACKED),
    longestGap: longestInteriorGap(statusArr),
    averages,
  };
  if (averageFieldName) {
    // avgValue is the mean of the declared average field; preserved as
    // `avgReps` alias when the average field is "reps" (legacy compat).
    result.avgValue = averages[averageFieldName] ?? null;
    if (averageFieldName === 'reps') {
      result.avgReps = result.avgValue;
    }
  }
  return result;
}

function classifyNumeric(payload, requiredFields, numericFields) {
  if (!payload || typeof payload !== 'object') return { status: STATUS.UNTRACKED };
  for (const [fieldName, decl] of requiredFields) {
    const v = payload[fieldName];
    if (decl.type === 'integer' || decl.type === 'number') {
      if (typeof v !== 'number' || !Number.isFinite(v)) {
        return { status: STATUS.UNTRACKED };
      }
    } else if (decl.type === 'string') {
      if (typeof v !== 'string' || v.length === 0) {
        return { status: STATUS.UNTRACKED };
      }
    } else if (decl.type === 'boolean') {
      if (typeof v !== 'boolean') return { status: STATUS.UNTRACKED };
    }
  }
  // If schema had no required fields at all, treat presence as logged.
  if (requiredFields.length === 0 && Object.keys(payload).length === 0) {
    return { status: STATUS.UNTRACKED };
  }
  return { status: STATUS.LOGGED };
}

/**
 * Text summary (e.g., daily_note).
 *   logged: payload is a non-empty string OR object whose required string
 *           field is non-empty after trim
 *   untracked: dimension absent / payload empty
 *
 * complianceRate = logged / windowDays (no explicit miss channel).
 */
function summarizeText(dim, dates, data, windowDays) {
  const required = findRequiredFieldOfType(dim, 'string')
    || findFirstFieldOfType(dim, 'string');

  const statusArr = [];
  for (const date of dates) {
    const coaching = pickCoaching(data[date]);
    const payload = pickDimensionPayload(coaching, dim.key);
    statusArr.push(classifyText(payload, required?.name));
  }
  const counts = countStatuses(statusArr);
  const complianceRate = windowDays > 0 ? counts.logged / windowDays : 0;
  return {
    logged: counts.logged,
    untracked: counts.untracked,
    complianceRate,
  };
}

function classifyText(payload, fieldName) {
  if (payload === null || payload === undefined) return STATUS.UNTRACKED;
  if (typeof payload === 'string') {
    return payload.trim().length > 0 ? STATUS.LOGGED : STATUS.UNTRACKED;
  }
  if (typeof payload === 'object') {
    const v = fieldName ? payload[fieldName] : null;
    if (typeof v === 'string' && v.trim().length > 0) return STATUS.LOGGED;
    return STATUS.UNTRACKED;
  }
  return STATUS.UNTRACKED;
}

// ---------- streak/gap math ----------

function trailingStreakOf(statusArr, target) {
  let streak = 0;
  for (let i = statusArr.length - 1; i >= 0; i--) {
    if (statusArr[i] === target) streak++;
    else break;
  }
  return streak;
}

function longestRunOf(statusArr, target) {
  let longest = 0;
  let current = 0;
  for (const s of statusArr) {
    if (s === target) {
      current++;
      if (current > longest) longest = current;
    } else {
      current = 0;
    }
  }
  return longest;
}

function longestInteriorGap(statusArr) {
  let first = -1;
  let last = -1;
  for (let i = 0; i < statusArr.length; i++) {
    if (statusArr[i] === STATUS.LOGGED) {
      if (first === -1) first = i;
      last = i;
    }
  }
  if (first === -1 || first === last) return 0;
  let longest = 0;
  let current = 0;
  for (let i = first + 1; i < last; i++) {
    if (statusArr[i] !== STATUS.LOGGED) {
      current++;
      if (current > longest) longest = current;
    } else {
      current = 0;
    }
  }
  return longest;
}

// ---------- helpers ----------

function countStatuses(statusArr) {
  const counts = { logged: 0, missed: 0, untracked: 0 };
  for (const s of statusArr) {
    if (s === STATUS.LOGGED) counts.logged++;
    else if (s === STATUS.MISSED) counts.missed++;
    else counts.untracked++;
  }
  return counts;
}

function clampDays(days) {
  const n = Number(days);
  if (!Number.isFinite(n)) return DEFAULT_DAYS;
  if (n < MIN_DAYS) return MIN_DAYS;
  if (n > MAX_DAYS) return MAX_DAYS;
  return Math.floor(n);
}

function computeWindowDates(days) {
  const now = new Date();
  const todayUtc = new Date(Date.UTC(
    now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(),
  ));
  const dates = [];
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(todayUtc);
    d.setUTCDate(d.getUTCDate() - i);
    dates.push(d.toISOString().slice(0, 10));
  }
  return dates;
}

function findRequiredFieldOfType(dim, typeName) {
  if (!dim?.fields || typeof dim.fields !== 'object') return null;
  for (const [name, decl] of Object.entries(dim.fields)) {
    if (decl?.required && decl?.type === typeName) return { name, decl };
  }
  return null;
}

function findFirstFieldOfType(dim, typeName) {
  if (!dim?.fields || typeof dim.fields !== 'object') return null;
  for (const [name, decl] of Object.entries(dim.fields)) {
    if (decl?.type === typeName) return { name, decl };
  }
  return null;
}

function collectRequiredFields(dim) {
  if (!dim?.fields || typeof dim.fields !== 'object') return [];
  const out = [];
  for (const [name, decl] of Object.entries(dim.fields)) {
    if (decl?.required) out.push([name, decl]);
  }
  return out;
}
