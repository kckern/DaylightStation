// backend/src/3_applications/agents/health-coach/tools/ComplianceToolFactory.mjs
//
// Compliance summary tool (PRD F-002). Exposes
// `get_compliance_summary({ userId, days })` which reads the per-day
// `coaching` field from the health datastore (written by SetDailyCoachingUseCase
// in F-001) and returns counts, percentages, current streak, and longest gap
// for each tracked compliance dimension over a rolling window.
//
// Dimensions covered:
//   - post_workout_protein  → boolean compliance (taken / not taken)
//   - daily_strength_micro  → engagement (logged a movement+reps) + avgReps
//   - daily_note            → engagement (wrote a non-empty note)
//
// Design notes:
//   - "Untracked" days (no coaching entry, or that dimension absent from
//     coaching) are EXCLUDED from the complianceRate denominator. Coaches
//     should distinguish "tracked-and-failed" from "didn't log".
//   - currentStreak is trailing days where the dimension is in its "logged"
//     state. Untracked breaks the streak (only positive states continue it).
//   - longestGap counts the longest consecutive run of explicit misses; for
//     post_workout_protein an "explicit miss" is taken=false. Untracked days
//     do NOT extend a gap (they're a different signal).
//   - avgReps for daily_strength_micro includes 0-rep entries (an honest
//     "tried, failed" log is signal we want to preserve).
//
// Sibling style: matches LongitudinalToolFactory — try/catch around the
// executor returning a structured `{ ..., error }` result so the agent
// receives a typed rejection rather than an exception.

import { ToolFactory } from '../../framework/ToolFactory.mjs';
import { createTool } from '../../ports/ITool.mjs';

const DEFAULT_DAYS = 30;
const MIN_DAYS = 1;
const MAX_DAYS = 365;

// Per-day status sentinels for one dimension. Streak/gap math operates over a
// chronological array of these.
const STATUS = Object.freeze({
  LOGGED: 'logged',
  MISSED: 'missed',
  UNTRACKED: 'untracked',
});

export class ComplianceToolFactory extends ToolFactory {
  static domain = 'health';

  createTools() {
    const { healthStore } = this.deps;

    return [
      createTool({
        name: 'get_compliance_summary',
        description:
          'Counts, percentages, current streak, and longest gap for each tracked ' +
          'daily-coaching dimension (post_workout_protein, daily_strength_micro, ' +
          'daily_note) over a rolling window. Untracked days are excluded from ' +
          'the complianceRate denominator. currentStreak counts trailing logged ' +
          'days; longestGap counts only consecutive explicit misses (untracked ' +
          'breaks neither).',
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
          try {
            if (!userId || typeof userId !== 'string') {
              return { windowDays: days, dimensions: emptyDimensions(days), error: 'userId is required' };
            }

            const windowDays = clampDays(days);
            const data = (healthStore && typeof healthStore.loadHealthData === 'function')
              ? (await healthStore.loadHealthData(userId)) || {}
              : {};

            const datesInWindow = computeWindowDates(windowDays);

            // Build a chronological status array for each dimension. Index 0
            // is the OLDEST day in the window; the last entry is today. This
            // ordering simplifies streak (trailing) and gap (consecutive)
            // computation.
            const proteinStatus = [];
            const strengthStatus = [];
            const noteStatus = [];

            const strengthReps = []; // mean across logged days only

            for (const date of datesInWindow) {
              const entry = data[date];
              const coaching = (entry && typeof entry === 'object') ? entry.coaching : null;

              proteinStatus.push(classifyProtein(coaching));

              const strength = classifyStrength(coaching);
              strengthStatus.push(strength.status);
              if (strength.status === STATUS.LOGGED && typeof strength.reps === 'number') {
                strengthReps.push(strength.reps);
              }

              noteStatus.push(classifyNote(coaching));
            }

            return {
              windowDays,
              dimensions: {
                post_workout_protein: summarizeBoolean(proteinStatus),
                daily_strength_micro: summarizeStrength(strengthStatus, strengthReps),
                daily_note: summarizeEngagement(noteStatus, windowDays),
              },
            };
          } catch (err) {
            return {
              windowDays: days,
              dimensions: emptyDimensions(days),
              error: err.message,
            };
          }
        },
      }),
    ];
  }
}

export default ComplianceToolFactory;

// ---------- classifiers ----------

function classifyProtein(coaching) {
  if (!coaching || typeof coaching !== 'object') return STATUS.UNTRACKED;
  const section = coaching.post_workout_protein;
  if (!section || typeof section !== 'object') return STATUS.UNTRACKED;
  if (section.taken === true) return STATUS.LOGGED;
  if (section.taken === false) return STATUS.MISSED;
  return STATUS.UNTRACKED;
}

function classifyStrength(coaching) {
  if (!coaching || typeof coaching !== 'object') return { status: STATUS.UNTRACKED };
  const section = coaching.daily_strength_micro;
  if (!section || typeof section !== 'object') return { status: STATUS.UNTRACKED };
  // Both movement (non-empty string) AND reps (number) must be present.
  const hasMovement = typeof section.movement === 'string' && section.movement.length > 0;
  const hasReps = typeof section.reps === 'number' && Number.isFinite(section.reps);
  if (!hasMovement || !hasReps) return { status: STATUS.UNTRACKED };
  return { status: STATUS.LOGGED, reps: section.reps };
}

function classifyNote(coaching) {
  if (!coaching || typeof coaching !== 'object') return STATUS.UNTRACKED;
  const note = coaching.daily_note;
  if (typeof note !== 'string') return STATUS.UNTRACKED;
  if (note.trim().length === 0) return STATUS.UNTRACKED;
  return STATUS.LOGGED;
}

// ---------- summarizers ----------

/**
 * Boolean compliance: post_workout_protein. Has a true "missed" channel
 * (taken=false), so the complianceRate excludes untracked from the
 * denominator.
 */
function summarizeBoolean(statusArr) {
  const counts = countStatuses(statusArr);
  const denom = counts.logged + counts.missed;
  const complianceRate = denom > 0 ? counts.logged / denom : 0;
  return {
    logged: counts.logged,
    missed: counts.missed,
    untracked: counts.untracked,
    complianceRate,
    currentStreak: trailingLoggedStreak(statusArr),
    longestGap: longestRunOf(statusArr, STATUS.MISSED),
  };
}

/**
 * Engagement summary: daily_strength_micro. There's no explicit "missed"
 * channel — either the user logged a movement+reps that day or they didn't.
 * avgReps is the mean across logged days; null when no logged days exist.
 */
function summarizeStrength(statusArr, repsArr) {
  const counts = countStatuses(statusArr);
  const avgReps = repsArr.length
    ? repsArr.reduce((s, n) => s + n, 0) / repsArr.length
    : null;
  return {
    logged: counts.logged,
    untracked: counts.untracked,
    avgReps,
    currentStreak: trailingLoggedStreak(statusArr),
    // For dimensions without an explicit miss channel, longestGap counts the
    // longest run of untracked days BETWEEN logged days. Trailing/leading
    // untracked runs (no logged day on the other side) don't count — they
    // signal "user hasn't started/has stopped logging" rather than a gap in
    // an otherwise-engaged streak. This matches the no-data case where 30
    // untracked days yield longestGap=0.
    longestGap: longestInteriorGap(statusArr),
  };
}

/**
 * Engagement summary: daily_note. Like strength, no explicit miss channel —
 * but we DO compute complianceRate as logged/windowDays for symmetry with
 * the spec's expected output. Untracked days remain untracked.
 */
function summarizeEngagement(statusArr, windowDays) {
  const counts = countStatuses(statusArr);
  const complianceRate = windowDays > 0 ? counts.logged / windowDays : 0;
  return {
    logged: counts.logged,
    untracked: counts.untracked,
    complianceRate,
  };
}

// ---------- streak/gap math ----------

/**
 * Count the number of trailing entries (from end-of-array backward) whose
 * status is LOGGED. The first non-LOGGED entry breaks the streak. Untracked
 * does NOT continue a streak — only explicit logged days do.
 */
function trailingLoggedStreak(statusArr) {
  let streak = 0;
  for (let i = statusArr.length - 1; i >= 0; i--) {
    if (statusArr[i] === STATUS.LOGGED) streak++;
    else break;
  }
  return streak;
}

/**
 * Length of the longest consecutive run of `target` in statusArr. Used for
 * longestGap on the boolean dimension where target=MISSED.
 */
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

/**
 * For dimensions without an explicit miss channel: the longest gap is the
 * longest run of NON-logged days that sits BETWEEN two logged days. Leading
 * untracked-only runs (before the first logged day) and trailing
 * untracked-only runs (after the last logged day) do not count — those mean
 * the user hasn't started or has stopped logging, not that they took a break
 * inside an active period.
 *
 * If there are fewer than two logged days, longestGap is 0 (there's no
 * "interior" to the engagement period).
 */
function longestInteriorGap(statusArr) {
  // Find first and last LOGGED indices. Anything outside that range can't
  // be an interior gap.
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

/**
 * Build the chronological list of dates in the rolling window. The window
 * extends from (today - days + 1) through today, INCLUSIVE. Today is
 * computed in UTC to align with how the health datastore keys its entries.
 *
 * Future dates (date > today) are intentionally not represented here — the
 * window only looks backward, so any future-dated entry in the datastore is
 * outside the window and won't be counted.
 */
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

/**
 * Empty dimensions object used when execution fails before any computation
 * could complete. Keeps the result shape stable for the caller.
 */
function emptyDimensions(days) {
  const windowDays = clampDays(days);
  return {
    post_workout_protein: {
      logged: 0,
      missed: 0,
      untracked: windowDays,
      complianceRate: 0,
      currentStreak: 0,
      longestGap: 0,
    },
    daily_strength_micro: {
      logged: 0,
      untracked: windowDays,
      avgReps: null,
      currentStreak: 0,
      longestGap: 0,
    },
    daily_note: {
      logged: 0,
      untracked: windowDays,
      complianceRate: 0,
    },
  };
}
