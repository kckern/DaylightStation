/**
 * HTTP client for the parent-facing School admin surfaces.
 *
 * Deliberately THROWING, unlike `modules/School/schoolApi.js`. That client is
 * for the child runners, which must keep going when a call fails; these screens
 * are the opposite — a parent who cannot load the queue, or whose sign-off did
 * not land, must be told at the moment it happens. Every caller here wraps the
 * call and paints the failure. Nothing swallows.
 *
 * The thrown Error carries `.status` (HTTP) and, when the router sent one, the
 * use case's own child-facing `message`/`error` string, which is the thing worth
 * showing a person.
 *
 * @module Admin/School/schoolAdminApi
 */

const SCHOOL = '/api/v1/school';
const LIFECYCLE = `${SCHOOL}/lifecycle`;

const enc = encodeURIComponent;

/**
 * @param {string} url
 * @param {{method?: string, body?: object}} [options]
 * @returns {Promise<any>} parsed JSON body (null for 204)
 * @throws {Error & {status: number}} on any non-2xx or unparseable reply
 */
async function call(url, { method = 'GET', body } = {}) {
  let res;
  try {
    res = await fetch(url, {
      method,
      headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch (cause) {
    // Network-level failure: no status to report, but it is still not silent.
    const err = new Error(cause?.message || 'Could not reach the server');
    err.status = 0;
    throw err;
  }

  const text = await res.text().catch(() => '');
  let parsed = null;
  try { parsed = text ? JSON.parse(text) : null; } catch { parsed = null; }

  if (!res.ok) {
    // Two handler shapes exist: {error: string} (school router wrap) and
    // {error: {type, message}} (app-level object shape) — never let an
    // object reach Error's message ("[object Object]").
    const detail = typeof parsed?.error === 'string' ? parsed.error : parsed?.error?.message;
    const err = new Error(parsed?.message || detail || `HTTP ${res.status}`);
    err.status = res.status;
    throw err;
  }
  return parsed;
}

export const schoolAdminApi = {
  /** Household roster: `[{ id, name, group_label, birthyear }]`. */
  roster: () => call(`${SCHOOL}/roster`),

  /**
   * The config-declared teacher roster (`{configured, teachers: [{id, name}]}`).
   * The sign-off adults come from HERE, not the roster above — the school
   * roster is learners-only by server design (adults are filtered out), so
   * an age filter over it yields nobody.
   */
  teachers: () => call(`${SCHOOL}/teachers`),

  /** Everything still awaiting a grown-up, across every session. */
  pendingReview: () => call(`${LIFECYCLE}/review`),

  /** One session's queue, including items already marked (and machine marks). */
  sessionReview: (sessionId) => call(`${LIFECYCLE}/sessions/${enc(sessionId)}/review`),

  /**
   * Record one verdict. `gradedBy` is the adult's roster id, and the server
   * checks it against the household roster — a child's id, an unknown one, or
   * none comes back 403 with nothing written.
   *
   * `note` is optional and is what the parent wants the child to read: why it
   * was marked that way. It is stored with the verdict, and sending none leaves
   * any earlier note alone.
   */
  resolveReview: (sessionId, itemId, { verdict, gradedBy, note = null, pin = null }) => call(
    `${LIFECYCLE}/sessions/${enc(sessionId)}/review/${enc(itemId)}`,
    { method: 'POST', body: { verdict, gradedBy, note, pin } },
  ),

  /** Index rows: `{ sessionId, learnerId, unitId, state, terminal, outcome, day, updatedAt }`. */
  learnerSessions: (learnerId) => call(`${LIFECYCLE}/learners/${enc(learnerId)}/sessions`),

  /** The raw event log for one session — the only place lineage is recorded. */
  sessionEvents: (sessionId) => call(`${LIFECYCLE}/sessions/${enc(sessionId)}/events`),

  /**
   * The published curriculum, read-only: `{ units: [{ unitId, title, subject,
   * objectives, courseId, sequence, grades, passingPercent, has* }] }`.
   *
   * Summaries, deliberately — a unit's `review` block holds the answer key and
   * never crosses this wire.
   */
  curriculumUnits: () => call(`${LIFECYCLE}/curriculum/units`),

  /** Every learner with an assignment record. */
  assignments: () => call(`${LIFECYCLE}/assignments`),

  /**
   * Write planner config for one learner. This is the ONLY write the planning
   * screen makes, and it touches `apps/school/assignments/{learnerId}.yml` —
   * never the published curriculum catalog (spec §7.2).
   *
   * `assignedBy` must be a grown-up's roster id: the server checks it against
   * the household roster and answers 403 for a child, an unknown id, or none at
   * all. Sending it is what makes the write land, not a formality.
   */
  putAssignment: (learnerId, { courses, units, assignedBy, pin = null, baseUpdatedAt }) => call(
    `${LIFECYCLE}/assignments/${enc(learnerId)}`,
    // `baseUpdatedAt` arms the server's STALE_SAVE guard (admin advocacy
    // #19): without it this surface silently clobbered a co-teacher's edit
    // made on the teacher console between load and save.
    { method: 'PUT', body: { courses, units, assignedBy, pin, ...(baseUpdatedAt !== undefined ? { baseUpdatedAt } : {}) } },
  ),
};

export default schoolAdminApi;
