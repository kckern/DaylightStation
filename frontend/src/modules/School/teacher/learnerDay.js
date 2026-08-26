/**
 * The Learner Day join (UX audit IA2/IA3).
 *
 * Retracing a school day used to mean reading three surfaces: the agenda
 * planner (what was OFFERED), the day projection (what was DONE), and the
 * History tab (which has no date control at all). Neither read is complete
 * alone, so this joins them into one list — including the two cases both
 * surfaces used to drop on the floor: work that was planned and skipped, and
 * work that happened without ever being planned.
 *
 * Unit identity outranks subject. The two sides do not agree on subject: the
 * planner buckets any non-canonical subject into the literal string 'other'
 * while the day projection keeps the raw subject, so a piano lesson arrives as
 * an 'other' section and a 'piano' session. A subject-keyed join renders that
 * one activity as two rows ("Not started" plus "Extra") — exactly the
 * repetition this view exists to end. `section.next.unitId` and
 * `session.unitId` are one id space, so a unit match is authoritative and is
 * tried across every unclaimed session whatever bucket it landed in. Subject
 * matching is the fallback, for sessions carrying no unit. Mirroring the
 * planner's canonical-subject list here instead would rot the first time the
 * backend's list changed.
 *
 * Sections CLAIM sessions, and a session can be claimed once. The module
 * therefore does not depend on the planner emitting one section per subject
 * (agenda.mjs does today); two sections sharing a subject each take their own
 * units rather than the first swallowing both.
 *
 * Pure by design: no fetching, no React, no mutation of the caller's input.
 * The view owns the reads.
 */

const NO_SUBJECT = '__no-subject__';
const subjectKey = (subject) => subject ?? NO_SUBJECT;

/**
 * Status vocabulary, in the teacher's words — never an internal state name.
 *
 * EVERY VALUE HERE DESCRIBES PROGRESS, and nothing else. `extra` used to live
 * in this map, which made the field mean progress for five values and
 * provenance for one — so a row could not say both "unplanned" and "finished",
 * and every consumer had to special-case one value out of six. Provenance
 * rides beside the status as a flag now (`unplanned`, `carriedOver`), which is
 * the shape carry-over already used.
 */
export const DAY_STATUS_LABEL = {
  done: 'Done',
  'in-progress': 'In progress',
  planned: 'Not started',
  deferred: 'Deferred',
  blocked: 'Blocked',
};

/**
 * Session states that count as progress.
 *
 * Source of truth: `backend/src/2_domains/school/sessions/sessionEvents.mjs`
 * (`TRANSITIONS`). The digest passes that derived state through verbatim
 * (`GetTeacherToday.mjs`). These sets are a deliberate COPY, not an import —
 * the frontend has no path into `backend/src` — so a drift test pins them; if
 * the backend grows a state, that test names this file.
 */
const DONE_STATES = new Set([
  'graded', 'outcome_recorded', 'rewarded', 'media_completed', 'external_activity_assessed',
]);
/** The work is out in the world: paper printed, media playing, or awaiting a mark. */
const IN_FLIGHT_STATES = new Set([
  'issued', 'reprinted', 'media_dispatched', 'media_stalled',
  'launch_dispatched', 'program_dispatched', 'external_activity_dispatched', 'submitted',
]);
export const SESSION_PROGRESS_STATES = { DONE_STATES, IN_FLIGHT_STATES };

/**
 * How far along one session is — the ONLY thing that may produce 'done'.
 *
 * The old rule was "a section claimed a session, therefore the lesson is
 * done", which told a parent a lesson was finished when its session had been
 * minted at agenda-build time and never touched. `state` and the planner's own
 * `servedToday` both carry the truth; this reads them.
 *
 * `section` is null for the unplanned sweep, where there is no plan to consult.
 */
function statusForSession(session, section) {
  if (section?.servedToday) return 'done';            // the planner's own verdict wins
  // A RECORDED SCORE OUTRANKS THE STATE FIELD. Marks exist only for work that
  // was actually done and graded, so a scored session is finished even when
  // `state` is absent or lags. This cannot resurrect the bug this function
  // exists to kill: the untouched session that used to read "Done" has no
  // score at all.
  if (session?.effectiveScore?.totalCount != null) return 'done';
  if (DONE_STATES.has(session?.state)) return 'done';
  if (IN_FLIGHT_STATES.has(session?.state)) return 'in-progress';
  return 'planned';                                   // created / abandoned / failed / unknown
}

/**
 * The footer's answer to "is this a broken link?" when a finished lesson shows
 * no worksheet and no receipt.
 *
 * Only finished work earns it: an issued session HAS paper, and nothing is
 * expected of work that has not started. The join authors this sentence rather
 * than the card, so the state slot stays the single explanatory voice.
 */
function paperNote(session, status) {
  if (status !== 'done' || !session) return null;
  // A MISSING `artifacts` FIELD IS NOT AN EMPTY ONE. The digest reports the
  // field as an object with null members when a session archived nothing; a
  // payload that omits it entirely has told us nothing about paper, and
  // announcing "no worksheet" there would be inventing a fact from silence.
  const artifacts = session.artifacts ?? null;
  if (!artifacts || typeof artifacts !== 'object') return null;
  const worksheet = artifacts.worksheet?.originalPdfUrl ?? null;
  const receipt = artifacts.receipt?.originalUrl ?? null;
  return worksheet || receipt ? null : 'No worksheet for this one';
}

/** Wrap each session so claims are tracked without touching the caller's array. */
const claimPool = (sessions) => sessions.map((session) => ({ session, claimed: false }));

/**
 * The sessions one section accounts for, unit matches first.
 *
 * A unit match is exact — it distinguishes "did the planned lesson" from "did
 * some other lesson in the same subject" — and ignores the subject bucket
 * entirely. Units only compare when BOTH sides carry one: a session on some
 * other unit belongs to another section (or to none), so subject is the
 * fallback only where a unit comparison is unavailable.
 */
function claimFor(section, pool) {
  const plannedUnitId = section?.next?.unitId ?? null;
  const key = subjectKey(section?.subject ?? null);
  const byUnit = [];
  const bySubject = [];

  for (const claim of pool) {
    if (claim.claimed) continue;
    const unitId = claim.session?.unitId ?? null;
    if (plannedUnitId && unitId) {
      if (unitId === plannedUnitId) byUnit.push(claim);
      continue;
    }
    if (subjectKey(claim.session?.subject ?? null) === key) bySubject.push(claim);
  }

  const claimed = [...byUnit, ...bySubject];
  claimed.forEach((claim) => { claim.claimed = true; });
  let matchedOn = null;
  if (byUnit.length) matchedOn = 'unit';
  else if (bySubject.length) matchedOn = 'subject';
  return { matched: claimed.map((claim) => claim.session), matchedOn };
}

/**
 * @param {object}   input
 * @param {Array}    input.sections     agenda preview `sections[]` — the plan
 * @param {Array}    input.sessions     day projection `sessions[]` — the record
 * @param {Array}    input.carriedOver  `processedToday[]` from an earlier study day
 * @param {string?}  input.studyDay     the day these describe (echoed back)
 * @returns {{ studyDay: string|null, rows: Array, counts: object }}
 */
export function joinLearnerDay({
  sections = [], sessions = [], carriedOver = [], studyDay = null,
} = {}) {
  const pool = claimPool(Array.isArray(sessions) ? sessions : []);
  // A SEPARATE pool, never swept into the "extra" sweep below: an unclaimed
  // carry-over is not unplanned work done today, it is another day's work
  // that the "Also marked on this date" block owns.
  const carriedPool = claimPool(Array.isArray(carriedOver) ? carriedOver : []);
  const rows = [];

  (Array.isArray(sections) ? sections : []).forEach((section, position) => {
    const subject = section?.subject ?? null;
    const key = subjectKey(subject);
    // Sections sharing a subject would otherwise collide on the row key.
    const rowKey = (status) => `${key}:${position}:${status}`;
    const planned = section?.next?.title ?? null;
    // THE OFFER ITSELF, not just its title. `next` carries the resolved
    // taxonomy (Subject › Course › Unit › Lesson) and the lesson's poster —
    // everything a view needs to render a planned lesson as richly as a
    // recorded one. Dropping all but `title` here is why an unstarted card
    // used to show a bare line where the course, unit, and art belonged.
    const offer = section?.next ?? null;
    // WHAT A SERVED SECTION STILL KNOWS. `next` is null by construction once a
    // subject is served (agenda.mjs), so a card built only from `offer` had
    // nothing to name and fell through to the literal "No work offered" — on a
    // card that in the same breath said DONE. The section was holding the
    // answer the whole time: the curriculum work it credited, or, for a
    // subject a program completes on its own, the program's own progress copy.
    const served = section?.servedToday ? {
      work: Array.isArray(section.servedWork) ? section.servedWork : [],
      progressLabel: section.progressLabel ?? null,
      moduleLabel: (section.progressRows ?? []).find((row) => row?.scope === 'module')?.label ?? null,
    } : null;
    const { matched, matchedOn } = claimFor(section, pool);

    if (matched.length) {
      // The plan is stated once for the subject, not repeated per session —
      // repeating it is the duplication the teachers objected to (IA1).
      matched.forEach((session, index) => {
        const status = statusForSession(session, section);
        rows.push({
          key: session.sessionId ?? `${rowKey('done')}:${index}`,
          subject, status, planned: index === 0 ? planned : null, offer, served, session,
          detail: paperNote(session, status),
          matchedOn: index === 0 ? matchedOn : null,
        });
      });
      return;
    }
    if (section?.suppressed) {
      rows.push({
        key: rowKey('deferred'), subject, status: 'deferred', planned, offer, served, session: null,
        detail: section.suppressed.bySubject ? `Deferred for ${section.suppressed.bySubject} focus` : 'Deferred',
      });
      return;
    }
    if (section?.lockedRemedy) {
      rows.push({
        key: rowKey('blocked'), subject, status: 'blocked', planned, offer, served, session: null,
        detail: section.lockedRemedy,
      });
      return;
    }
    if (section?.servedToday) {
      // `servedToday` is computed from work GRADED today, while `sessions` is
      // filtered by studyDay — so a sheet issued earlier and scanned today
      // sets the flag from the carry-over lane. Claiming it here is what stops
      // the view answering "no session record" about a session it was holding.
      const { matched: carried, matchedOn: carriedOn } = claimFor(section, carriedPool);
      if (carried.length) {
        // `done` is guaranteed here by the section's own servedToday, and
        // carriedOver already flags the provenance.
        carried.forEach((session, index) => rows.push({
          key: session.sessionId ?? `${rowKey('carried')}:${index}`,
          subject, status: 'done', planned: index === 0 ? planned : null, offer, served, session,
          detail: paperNote(session, 'done'), carriedOver: true,
          matchedOn: index === 0 ? carriedOn : null,
        }));
        return;
      }
      // Still reachable, and still honest: a subject served by a program that
      // owns its completion outside a work session has no session to show.
      // "Completed — no session record" read as an error report about our own
      // bookkeeping; the meaning is that the program owns the completion.
      rows.push({
        key: rowKey('served'), subject, status: 'done', planned, offer, served, session: null,
        detail: 'Completed in its own program',
      });
      return;
    }
    rows.push({
      key: rowKey('planned'), subject, status: 'planned', planned, offer, served, session: null,
      detail: section?.timingNotice ?? null,
    });
  });

  // Anything recorded that the plan never offered. Silently dropping these
  // made the day record lie about what the child actually did.
  pool.forEach(({ session, claimed }, index) => {
    if (claimed) return;
    const key = subjectKey(session?.subject ?? null);
    const status = statusForSession(session, null);
    rows.push({
      key: session?.sessionId ?? `${key}:extra:${index}`,
      subject: session?.subject ?? null,
      // Provenance is the FLAG, not the status, and not the detail line
      // either: freeing `detail` is what lets an unplanned lesson also say it
      // has no paper, with neither sentence having to win.
      status, unplanned: true, planned: null, offer: null, session,
      detail: paperNote(session, status),
    });
  });

  const counts = rows.reduce(
    (acc, row) => ({ ...acc, [row.status]: (acc[row.status] ?? 0) + 1, total: acc.total + 1 }),
    { total: 0 },
  );
  return { studyDay, rows, counts };
}

export default joinLearnerDay;
