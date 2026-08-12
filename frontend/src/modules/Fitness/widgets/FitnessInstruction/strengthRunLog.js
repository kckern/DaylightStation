/**
 * Getting a finished strength run onto the fitness session record.
 *
 * WHY THIS IS A MODULE AND NOT A HANDLER IN THE CONTAINER
 * ------------------------------------------------------
 * Three separate things have to be true before a run can be filed, and each of
 * them can fail on its own: the plan has to exist on the shelf (the server derives
 * `setsPlanned` from the STORED workout and refuses an id it does not know), a
 * session has to exist to hang the run off, and the POST has to land. Folded into
 * a component they would be untestable without a DOM; pulled out here they are
 * plain functions with injected I/O, so the mutation tests can drop each one
 * individually and watch a test die.
 *
 * THE SESSION QUESTION
 * --------------------
 * A strength workout is frequently done with NO fitness session open. The Exercise
 * Library is reachable straight from the Fitness Apps menu, and a session normally
 * begins only when sensor traffic crosses `FitnessSession`'s pre-session buffer —
 * strength work is routinely strapless, so nothing crosses it. That is not an edge
 * case here, it is the ordinary case.
 *
 * The answer is ADOPT, ELSE ASK THE SERVER TO OPEN ONE:
 *
 *   1. If the fitness app already has a live session, the run joins it. A lift
 *      between intervals belongs to the ride, not to a second record.
 *   2. If it does not, we mint the id the run would have had and post it with
 *      `openSession: true`, which is the strength route's explicit "open this if it
 *      does not exist" request.
 *
 * WHY THE SERVER AND NOT `ensureStarted({ force: true })`. The browser cannot
 * produce this record, and that was measured rather than assumed:
 * `PersistenceManager.validateSessionPayload` refuses any session with an empty
 * roster, under 60 seconds, under 3 timeline ticks, or with no non-zero HR series,
 * and a strength-only session fails all four by construction. `POST /save_session`
 * is additionally gated on `session_write_whitelist` (Firefox, i.e. the garage
 * kiosk alone). Those gates are correct — they are what keeps sensor flap out of
 * history — but they mean a client-opened strength session would be silently
 * dropped on the floor every single time.
 *
 * The distinction the server draws is between a CLAIM and a REQUEST: posting an id
 * you believe exists still 404s, because that is a bug worth seeing. `openSession`
 * says "I know it does not exist; open it".
 *
 * WHAT HAPPENS WHEN IT STILL CANNOT BE FILED
 * ------------------------------------------
 * It is reported to the caller, which puts it on the completion screen. A run that
 * failed to log must never look like a run that logged — someone who did four sets
 * and reads "Nice work" will assume it counted. See WorkoutRunner's completion
 * panel.
 */

import { DaylightAPI } from '@/lib/api.mjs';
import { formatSessionId } from '@/hooks/fitness/types.js';

/** Where a finished run is filed. `fs_20260811…` sanitises to 14 digits server-side. */
export const strengthPath = (sessionId) =>
  `api/v1/fitness/sessions/${encodeURIComponent(String(sessionId))}/strength`;

/** The shelf. Same path WorkoutBuilder saves to. */
export const WORKOUTS_PATH = 'api/v1/fitness/workouts';

/**
 * Reduce the walked plan to the finished WORK steps.
 *
 * `makeStrengthRun` ignores rest steps anyway, so handing it the whole walked list
 * would be harmless — but it would also make the wire payload roughly twice the
 * size for no reason, and it would blur the meaning of the field. `completedSteps`
 * means sets performed.
 */
export function completedWorkSteps(steps = []) {
  return (Array.isArray(steps) ? steps : [])
    .filter((s) => s && typeof s === 'object' && s.kind !== 'rest')
    .map((s) => ({ groupIndex: s.groupIndex, slug: s.slug, kind: 'work' }));
}

/**
 * Pull the server's own words out of whatever `DaylightAPI` threw.
 *
 * It throws `HTTP 404: Not Found - {"ok":false,"error":"…","reason":"unknown_workout"}`
 * — the JSON stringified onto the end of a message. `reason` is the field that
 * decides both whether a retry could ever help and what the screen tells the
 * person, so it has to be recovered rather than shown as "HTTP 404: Not Found".
 */
export function parseApiFailure(err) {
  const message = err?.message ?? String(err ?? 'request failed');
  const status = Number(message.match(/^HTTP (\d{3})/)?.[1] ?? NaN);
  const start = message.indexOf('{');
  if (start !== -1) {
    try {
      const body = JSON.parse(message.slice(start));
      return {
        status: Number.isFinite(status) ? status : null,
        reason: typeof body?.reason === 'string' ? body.reason : null,
        message: typeof body?.error === 'string' && body.error ? body.error : message
      };
    } catch (_) { /* no JSON tail — a network drop or an HTML error page */ }
  }
  return { status: Number.isFinite(status) ? status : null, reason: null, message };
}

/**
 * Is another attempt worth making?
 *
 * `unknown_session` IS retryable: a session opened moments ago may not have
 * finished being written when the run posts, and the second attempt lands after it
 * has. `unknown_workout` and `nothing_completed` are settled answers — retrying
 * either just burns the battery and delays the message the person needs to read.
 * Anything with no HTTP status at all is a network fault, which is the case retry
 * was invented for.
 */
export function isRetryable({ status, reason }) {
  if (reason === 'unknown_workout' || reason === 'nothing_completed') return false;
  if (reason === 'unknown_session') return true;
  if (status == null) return true;          // network throw
  return status >= 500;
}

/**
 * Plain-language failure text for the completion screen.
 *
 * The person reading this is standing up, mid-workout, and needs to know one
 * thing: whether the sets they just did are on the record. So every branch names
 * the concrete obstacle instead of a status code.
 */
export function failureNotice({ reason, message }) {
  switch (reason) {
    case 'no_session':
    case 'unknown_session':
      return 'No workout session could be opened, so these sets have nothing to attach to.';
    case 'unknown_workout':
      return 'This workout is not on the shelf, so the sets you did could not be measured against a plan.';
    case 'nothing_completed':
      return 'No completed sets were reported, so nothing was recorded.';
    case 'save_failed':
      return 'This workout could not be saved to the shelf, so the sets you did have nowhere to attach.';
    default:
      return message || 'The sets you did could not be recorded.';
  }
}

/**
 * Make sure the plan has an id on the shelf, saving it if it does not.
 *
 * The server reads `setsPlanned` from the STORED workout and never from the
 * client, which is what stops a plan being filed as performance — the cost of that
 * rule is that an unsaved plan is unloggable. Someone who built a workout, ran it
 * and never tapped Save has still done the work, so the plan is saved here rather
 * than losing the run. Returns the existing id untouched when there is one, so a
 * saved workout is never duplicated.
 */
export async function ensureWorkoutOnShelf(workout, { api = DaylightAPI } = {}) {
  const existing = typeof workout?.id === 'string' && workout.id.trim() ? workout.id.trim() : null;
  if (existing) return { ok: true, workoutId: existing, saved: false };

  const groups = Array.isArray(workout?.groups) ? workout.groups : [];
  if (groups.length === 0) {
    return { ok: false, workoutId: null, saved: false, reason: 'unknown_workout' };
  }

  try {
    const res = await api(WORKOUTS_PATH, { title: workout?.title ?? null, groups }, 'POST');
    const id = typeof res?.id === 'string' && res.id.trim() ? res.id.trim() : null;
    if (!id) return { ok: false, workoutId: null, saved: false, reason: 'save_failed' };
    return { ok: true, workoutId: id, saved: true };
  } catch (err) {
    const parsed = parseApiFailure(err);
    return { ok: false, workoutId: null, saved: false, reason: 'save_failed', message: parsed.message };
  }
}

/**
 * The id a session started at `date` would carry — `YYYYMMDDHHmmss`, local time.
 *
 * `formatSessionId` is `FitnessSession`'s own generator, imported rather than
 * re-implemented: the id is what the server derives the history DATE FOLDER from,
 * so a second implementation drifting by a timezone would file workouts under the
 * wrong day.
 */
export const mintSessionId = (date = new Date()) => formatSessionId(date);

/**
 * Adopt the live session, else name the one to open. See the docblock at the top.
 *
 * Synchronous and total: there is always an id, and `openSession` is what tells the
 * server which of the two cases it is looking at. Adopting a live session never
 * carries the flag — an id the fitness app is holding really should exist, and a
 * 404 on it is a bug that must stay visible.
 */
export function resolveRunSession(session, startedAt = new Date()) {
  const live = typeof session?.sessionId === 'string' && session.sessionId ? session.sessionId : null;
  if (live) return { sessionId: live, openSession: false };
  return { sessionId: mintSessionId(startedAt), openSession: true };
}

/**
 * POST the run, retrying only the failures a retry could fix.
 *
 * Modelled on `saveRaceRecord` (the cycle game's equivalent): a kiosk on flaky
 * garage WiFi must not lose a workout to one dropped packet, and only exhaustion
 * counts as failure. Backoff also covers the `unknown_session` race above — the
 * second attempt lands after the session's first write.
 */
export async function postStrengthRun({
  sessionId,
  workoutId,
  completedSteps,
  completedAt = null,
  startedAt = null,
  openSession = false,
  api = DaylightAPI,
  attempts = 3,
  backoffMs = [800, 2500],
  sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  onAttempt = null
} = {}) {
  let last = { reason: null, message: 'no attempt was made' };

  for (let i = 0; i < attempts; i += 1) {
    try {
      const res = await api(strengthPath(sessionId), {
        workoutId,
        completedSteps,
        ...(completedAt ? { completedAt } : {}),
        ...(startedAt ? { startedAt } : {}),
        ...(openSession ? { openSession: true } : {})
      }, 'POST');
      return {
        ok: true,
        attempt: i + 1,
        sessionId,
        openedSession: res?.openedSession === true,
        strength: res?.strength ?? null
      };
    } catch (err) {
      last = parseApiFailure(err);
    }
    onAttempt?.({ attempt: i + 1, ...last });
    if (!isRetryable(last)) break;
    if (i < attempts - 1) await sleep(backoffMs[Math.min(i, backoffMs.length - 1)]);
  }

  return { ok: false, sessionId, reason: last.reason, message: last.message, status: last.status ?? null };
}

/**
 * The whole job: shelf the plan, resolve a session, file the run.
 *
 * Returns a settled verdict rather than throwing, because the caller's only job
 * with the answer is to render it.
 */
export async function logStrengthRun({
  workout,
  completedSteps,
  session,
  startedAt = null,
  api = DaylightAPI,
  now = () => new Date(),
  ...postOptions
} = {}) {
  const steps = completedWorkSteps(completedSteps);
  if (steps.length === 0) {
    return { ok: false, reason: 'nothing_completed', message: failureNotice({ reason: 'nothing_completed' }) };
  }

  const shelf = await ensureWorkoutOnShelf(workout, { api });
  if (!shelf.ok) {
    return { ok: false, reason: shelf.reason, message: failureNotice(shelf), workoutId: null };
  }

  const began = startedAt instanceof Date ? startedAt : new Date(startedAt ?? now());
  const start = Number.isFinite(began.getTime()) ? began : now();
  const { sessionId, openSession } = resolveRunSession(session, start);

  const posted = await postStrengthRun({
    sessionId,
    workoutId: shelf.workoutId,
    completedSteps: steps,
    completedAt: now().toISOString(),
    startedAt: start.toISOString(),
    openSession,
    api,
    ...postOptions
  });

  if (posted.ok) {
    return {
      ok: true,
      sessionId,
      workoutId: shelf.workoutId,
      openedSession: posted.openedSession,
      savedWorkout: shelf.saved,
      sets: steps.length
    };
  }

  return {
    ok: false,
    sessionId,
    workoutId: shelf.workoutId,
    reason: posted.reason,
    message: failureNotice(posted)
  };
}

export default logStrengthRun;
