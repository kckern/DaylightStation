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
    const err = new Error(parsed?.message || parsed?.error || `HTTP ${res.status}`);
    err.status = res.status;
    throw err;
  }
  return parsed;
}

export const schoolAdminApi = {
  /** Household roster: `[{ id, name, group_label, birthyear }]`. */
  roster: () => call(`${SCHOOL}/roster`),

  /** Everything still awaiting a grown-up, across every session. */
  pendingReview: () => call(`${LIFECYCLE}/review`),

  /** One session's queue, including items already marked (and machine marks). */
  sessionReview: (sessionId) => call(`${LIFECYCLE}/sessions/${enc(sessionId)}/review`),

  /**
   * Record one verdict. `gradedBy` is the adult's roster id — the caller is
   * responsible for having established that, and does not send anything else:
   * the route accepts only `{ verdict, gradedBy }` and drops the rest.
   */
  resolveReview: (sessionId, itemId, { verdict, gradedBy }) => call(
    `${LIFECYCLE}/sessions/${enc(sessionId)}/review/${enc(itemId)}`,
    { method: 'POST', body: { verdict, gradedBy } },
  ),

  /** Index rows: `{ sessionId, learnerId, unitId, state, terminal, outcome, day, updatedAt }`. */
  learnerSessions: (learnerId) => call(`${LIFECYCLE}/learners/${enc(learnerId)}/sessions`),

  /** The raw event log for one session — the only place lineage is recorded. */
  sessionEvents: (sessionId) => call(`${LIFECYCLE}/sessions/${enc(sessionId)}/events`),

  /** Every learner with an assignment record. */
  assignments: () => call(`${LIFECYCLE}/assignments`),

  /**
   * Write planner config for one learner. This is the ONLY write the planning
   * screen makes, and it touches `apps/school/assignments/{learnerId}.yml` —
   * never the published curriculum catalog (spec §7.2).
   */
  putAssignment: (learnerId, { courses, units }) => call(
    `${LIFECYCLE}/assignments/${enc(learnerId)}`,
    { method: 'PUT', body: { courses, units } },
  ),
};

export default schoolAdminApi;
