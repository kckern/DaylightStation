/**
 * The program-report contract (design: school program interface). Pure.
 *
 * Every School program — quizzes, materials, language study, and writing and
 * typing when they land — answers the same four questions about a learner:
 * who has been studying, how far along they are, how they are doing, and what
 * is next. This file is that contract.
 *
 * `METRIC_KINDS` is a **closed set in code**, exactly like `categories.mjs`:
 * config selects from it, nothing invents a new one. That removes a whole
 * failure class rather than validating against it — a program cannot emit a
 * shape the parent view has no renderer for, because the shape does not exist.
 * A seventh kind is a code change in this file plus one renderer branch, which
 * is the point.
 *
 * Programs emit whichever kinds apply. A language course has a streak; a
 * writing assignment has a word count; neither is obliged to pretend.
 */

/**
 * @typedef {'progress'|'count'|'score'|'streak'|'trend'|'duration'} MetricKind
 */
export const METRIC_KINDS = {
  // How far through a finite body of material. Renders as a bar.
  progress: {
    required: ['value', 'total'],
    coerce: (m) => ({
      value: Number(m.value),
      total: Number(m.total),
      unit: m.unit ? String(m.unit) : null,
    }),
    valid: (m) => Number.isFinite(m.value) && Number.isFinite(m.total) && m.total > 0,
  },
  // A cumulative tally with no ceiling — recordings made, words written.
  count: {
    required: ['value'],
    coerce: (m) => ({ value: Number(m.value), unit: m.unit ? String(m.unit) : null }),
    valid: (m) => Number.isFinite(m.value) && m.value >= 0,
  },
  // A ratio in [0,1]. Stored as a ratio, not a percentage, so the renderer
  // owns the formatting and two programs cannot disagree about it.
  score: {
    required: ['value'],
    coerce: (m) => ({ value: Number(m.value) }),
    valid: (m) => Number.isFinite(m.value) && m.value >= 0 && m.value <= 1,
  },
  // Consistency. Days by default, but the unit is the program's to name.
  streak: {
    required: ['value'],
    coerce: (m) => ({ value: Number(m.value), unit: m.unit ? String(m.unit) : 'days' }),
    valid: (m) => Number.isFinite(m.value) && m.value >= 0,
  },
  // Direction over time. Points are pre-bucketed by the program, because only
  // the program knows whether its natural bucket is a day, a session or a unit.
  trend: {
    required: ['points'],
    coerce: (m) => ({
      points: (Array.isArray(m.points) ? m.points : [])
        .map((p) => ({ at: String(p.at), value: Number(p.value) }))
        .filter((p) => Number.isFinite(p.value)),
      unit: m.unit ? String(m.unit) : null,
    }),
    valid: (m) => m.points.length > 0,
  },
  // Time spent, in milliseconds. Formatting is the renderer's job.
  duration: {
    required: ['ms'],
    coerce: (m) => ({ ms: Number(m.ms) }),
    valid: (m) => Number.isFinite(m.ms) && m.ms >= 0,
  },
};

export const METRIC_KIND_IDS = Object.keys(METRIC_KINDS);

/**
 * What a program is doing for this learner right now.
 *
 * `blocked` is distinct from `idle`: idle means nothing is stopping them,
 * blocked means something is. Only `blocked` obliges a `blockedReason`.
 */
export const PROGRAM_STATES = ['not-started', 'active', 'idle', 'complete', 'blocked'];

/**
 * Normalise one metric, or return null if it cannot be trusted.
 *
 * Fail-closed but LOUD, matching `resolveCategory`: an unknown kind or a
 * malformed payload is dropped and logged naming the program, rather than
 * reaching a renderer that has no branch for it. A silently missing metric is
 * recoverable; a crashed report panel takes every other program down with it.
 */
export function normalizeMetric(raw, { logger, program } = {}) {
  if (!raw || typeof raw !== 'object') return null;

  const spec = METRIC_KINDS[raw.kind];
  if (!spec) {
    logger?.warn?.('school.report.metric-kind-unknown', { program, kind: raw.kind });
    return null;
  }
  for (const field of spec.required) {
    if (raw[field] === undefined || raw[field] === null) {
      logger?.warn?.('school.report.metric-incomplete', { program, kind: raw.kind, missing: field });
      return null;
    }
  }

  const payload = spec.coerce(raw);
  if (!spec.valid(payload)) {
    logger?.warn?.('school.report.metric-invalid', { program, kind: raw.kind });
    return null;
  }

  return {
    id: String(raw.id ?? raw.kind),
    kind: raw.kind,
    label: String(raw.label ?? raw.kind),
    ...payload,
  };
}

/**
 * Normalise a whole program report.
 *
 * A report that cannot be normalised at all returns null and is omitted from
 * the view — one broken program must never blank the board for the others.
 *
 * @param {object} raw - as emitted by a program's `summarize()`
 * @param {{logger?: object}} [opts]
 * @returns {object|null}
 */
export function normalizeReport(raw, { logger } = {}) {
  if (!raw || typeof raw !== 'object') return null;
  const program = raw.program ? String(raw.program) : null;
  if (!program) {
    logger?.warn?.('school.report.program-missing', {});
    return null;
  }

  const state = PROGRAM_STATES.includes(raw.state) ? raw.state : 'not-started';

  let next = null;
  if (raw.next && typeof raw.next === 'object' && raw.next.label) {
    const blocked = raw.next.blocked === true;
    // A blocked step that does not say what to do is the silent lock the
    // materials framework exists to prevent. Rather than drop the step (which
    // hides the work entirely), it is surfaced with an explicit admission that
    // the program failed to explain itself — visible, and traceable to whoever
    // emitted it.
    if (blocked && !raw.next.blockedReason) {
      logger?.warn?.('school.report.blocked-without-reason', { program });
    }
    next = {
      label: String(raw.next.label),
      detail: raw.next.detail ? String(raw.next.detail) : null,
      blocked,
      blockedReason: blocked ? String(raw.next.blockedReason ?? 'Blocked — reason not given') : null,
    };
  }

  const metrics = (Array.isArray(raw.metrics) ? raw.metrics : [])
    .map((m) => normalizeMetric(m, { logger, program }))
    .filter(Boolean);

  return {
    program,
    label: String(raw.label ?? program),
    userId: raw.userId ? String(raw.userId) : null,
    state,
    lastActivity: raw.lastActivity ? String(raw.lastActivity) : null,
    headline: raw.headline ? String(raw.headline) : null,
    next,
    metrics,
  };
}

/**
 * Order reports so the board answers "who needs attention" top-down:
 * blocked first, then active, then everything that needs nothing.
 */
const STATE_ORDER = { blocked: 0, active: 1, idle: 2, 'not-started': 3, complete: 4 };

export function compareReports(a, b) {
  const byState = (STATE_ORDER[a.state] ?? 9) - (STATE_ORDER[b.state] ?? 9);
  if (byState !== 0) return byState;
  // Within a state, most recently touched first — the stale ones sink.
  return String(b.lastActivity ?? '').localeCompare(String(a.lastActivity ?? ''));
}
