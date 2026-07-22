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
 *
 * Every metric also declares an AUDIENCE, and that is not a display hint — the
 * service filters on it so a learner-scoped request never receives the others
 * over the wire. The reason is specific. Identity here is a soft tap with no
 * PIN, and the household board shows every learner side by side on a panel in a
 * hallway. A percentage next to a name, beside a sibling's percentage, is a
 * public ranking whether or not one was intended; a child who works out that
 * their scores appear on the family board has a rational incentive to stop
 * claiming their profile, and guest work is right there and untracked. Two
 * individually defensible decisions — soft identity, household board — combine
 * into a lesson in avoidance. Filtering at the source is what stops them.
 */

/**
 * Who a metric is FOR.
 *
 *  - `learner` — safe on a child's own surface.
 *  - `parent`  — instrumentation. Real diagnostic value to an adult, and
 *                corrosive to the child it describes.
 *  - `both`    — the default.
 */
export const AUDIENCES = ['learner', 'parent', 'both'];

/**
 * @typedef {'progress'|'count'|'score'|'streak'|'trend'|'duration'} MetricKind
 */
export const METRIC_KINDS = {
  // How far through a bounded set.
  //
  // `scope` is load-bearing, not decoration. "3 of 12 today" is a child's core
  // competence signal at the moment they decide whether to start: bounded,
  // reachable, and visibly moved by one sitting. "130 of 4143 ever" is the same
  // shape carrying the opposite message — a bar at 3% that will not visibly
  // move for a year tells a child they are nowhere. Only `today` is defaulted
  // to a learner audience.
  progress: {
    required: ['value', 'total'],
    coerce: (m) => ({
      value: Number(m.value),
      total: Number(m.total),
      unit: m.unit ? String(m.unit) : null,
      scope: m.scope === 'today' ? 'today' : 'total',
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
  // Consistency — and PARENT-ONLY by default, deliberately.
  //
  // A streak reframes "I want to study this" as "I must not lose the number",
  // which works until it breaks. On a shared wall panel it breaks for reasons
  // the child does not control: a family trip, illness, a sibling holding the
  // device. At that moment the structure says the accumulated effort was
  // voided, and re-entry becomes aversive exactly when re-engagement matters
  // most. In a classroom an adult repairs that. On an unattended kiosk nobody
  // does. A DAY COUNTER is the opposite and belongs to the learner: it only
  // ever advances or holds, and cannot be taken away — an odometer, not a fuse.
  streak: {
    required: ['value'],
    coerce: (m) => ({ value: Number(m.value), unit: m.unit ? String(m.unit) : 'days' }),
    valid: (m) => Number.isFinite(m.value) && m.value >= 0,
  },
  // Direction over time — parent instrumentation. A child cannot act on a
  // sparkline, and a declining one is discouragement without instruction.
  // Points are pre-bucketed by the program, because only the program knows
  // whether its natural bucket is a day, a session or a unit.
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
  // Time spent — parent-only, and the codebase already argued why: course
  // completion here is comprehension-based because "an attention check only
  // proves a body was in the room". Showing hours to a child teaches that time
  // is the unit of learning. It is the unit of compliance.
  duration: {
    required: ['ms'],
    coerce: (m) => ({ ms: Number(m.ms) }),
    valid: (m) => Number.isFinite(m.ms) && m.ms >= 0,
  },
};

export const METRIC_KIND_IDS = Object.keys(METRIC_KINDS);

/**
 * Where a kind lands when a program does not say. Chosen so that the safe
 * option is the one you get by not thinking about it.
 */
const DEFAULT_AUDIENCE = {
  progress: 'both',     // narrowed to parent below when scope is 'total'
  count: 'both',
  score: 'parent',
  streak: 'parent',
  trend: 'parent',
  duration: 'parent',
};

/**
 * What a program is doing for this learner right now.
 *
 * `blocked` is distinct from `idle`: idle means nothing is stopping them,
 * blocked means something is. Only `blocked` obliges a `blockedReason`.
 */
/**
 * `satisfied` is separate from both `idle` and `complete`, and its absence was
 * a real defect: a child who cleared everything asked of them today fell into
 * `idle`, which the board renders as "Paused". Doing all your work and being
 * told you are paused is demotivating, not merely inaccurate. `satisfied`
 * means finished for today and welcome back tomorrow; `complete` means the
 * whole course is done; `idle` means they drifted away.
 */
export const PROGRAM_STATES = [
  'not-started', 'active', 'satisfied', 'idle', 'complete', 'blocked',
];

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

  // Whole-corpus progress is parent instrumentation however it was declared:
  // a 3% bar is anti-feedback on a child's surface (see the `progress` note).
  const declared = AUDIENCES.includes(raw.audience) ? raw.audience : DEFAULT_AUDIENCE[raw.kind];
  const audience = (raw.kind === 'progress' && payload.scope === 'total' && declared === 'both')
    ? 'parent'
    : declared;

  return {
    id: String(raw.id ?? raw.kind),
    kind: raw.kind,
    label: String(raw.label ?? raw.kind),
    audience,
    ...payload,
  };
}

/**
 * Metrics this audience may see.
 *
 * The filter is one-directional by design: a PARENT sees everything, because
 * every metric is legitimate diagnostic information to an adult. `learner` is
 * the restricted view, and the audience field names what is safe to put in
 * front of a child rather than who owns the number. `parent` therefore reads
 * as "not for a child", not "hidden from a parent" — an earlier version had
 * this symmetric and quietly withheld a child's own day counter from the
 * person supervising them.
 */
export function metricsFor(metrics, audience) {
  if (audience !== 'learner') return metrics;
  return metrics.filter((m) => m.audience === 'both' || m.audience === 'learner');
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
    // How much work this is. A child weighs the cost before starting, and
    // "12 sentences" lowers that far more than an unbounded "continue" does.
    // Structured rather than smuggled into `detail`, so a young-reader
    // renderer can show a count without parsing prose.
    const estimate = raw.next.estimate && Number.isFinite(Number(raw.next.estimate.count))
      ? { count: Number(raw.next.estimate.count), unit: String(raw.next.estimate.unit ?? 'items') }
      : null;

    next = {
      label: String(raw.next.label),
      detail: raw.next.detail ? String(raw.next.detail) : null,
      estimate,
      blocked,
      blockedReason: blocked ? String(raw.next.blockedReason ?? 'Blocked — reason not given') : null,
    };
  }

  const metrics = (Array.isArray(raw.metrics) ? raw.metrics : [])
    .map((m) => normalizeMetric(m, { logger, program }))
    .filter(Boolean);

  return {
    program,
    // Which COURSE/BANK/MATERIAL within that program this row is about. The
    // program id alone cannot identify it — a learner may study two languages
    // — and without it the home can say what is next but not open it. Opaque
    // to the domain: only the frontend registry knows how to route it.
    instanceId: raw.instanceId ? String(raw.instanceId) : null,
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
const STATE_ORDER = {
  blocked: 0, active: 1, satisfied: 2, idle: 3, 'not-started': 4, complete: 5,
};

export function compareReports(a, b) {
  const byState = (STATE_ORDER[a.state] ?? 9) - (STATE_ORDER[b.state] ?? 9);
  if (byState !== 0) return byState;
  // Within a state, most recently touched first — the stale ones sink.
  return String(b.lastActivity ?? '').localeCompare(String(a.lastActivity ?? ''));
}

/**
 * The learner's own ordering, which is NOT the parent's.
 *
 * A parent's board leads with what is stuck, because triage is the job. A
 * child's home must lead with something they can actually do — greeting a
 * seven-year-old with a wall they cannot pass is how avoidance gets taught.
 * Blocked work stays visible, with its remedy, but never leads.
 */
const LEARNER_ORDER = {
  active: 0, 'not-started': 1, blocked: 2, satisfied: 3, idle: 4, complete: 5,
};

export function compareForLearner(a, b) {
  const byState = (LEARNER_ORDER[a.state] ?? 9) - (LEARNER_ORDER[b.state] ?? 9);
  if (byState !== 0) return byState;
  return String(b.lastActivity ?? '').localeCompare(String(a.lastActivity ?? ''));
}
