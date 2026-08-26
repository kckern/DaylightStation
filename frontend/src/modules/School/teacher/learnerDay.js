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

/** Status vocabulary, in the teacher's words — never an internal state name. */
export const DAY_STATUS_LABEL = {
  done: 'Done',
  planned: 'Not started',
  deferred: 'Deferred',
  blocked: 'Blocked',
  extra: 'Extra',
};

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
    const { matched, matchedOn } = claimFor(section, pool);

    if (matched.length) {
      // The plan is stated once for the subject, not repeated per session —
      // repeating it is the duplication the teachers objected to (IA1).
      matched.forEach((session, index) => rows.push({
        key: session.sessionId ?? `${rowKey('done')}:${index}`,
        subject, status: 'done', planned: index === 0 ? planned : null, session, detail: null,
        matchedOn: index === 0 ? matchedOn : null,
      }));
      return;
    }
    if (section?.suppressed) {
      rows.push({
        key: rowKey('deferred'), subject, status: 'deferred', planned, session: null,
        detail: section.suppressed.bySubject ? `Deferred for ${section.suppressed.bySubject} focus` : 'Deferred',
      });
      return;
    }
    if (section?.lockedRemedy) {
      rows.push({ key: rowKey('blocked'), subject, status: 'blocked', planned, session: null, detail: section.lockedRemedy });
      return;
    }
    if (section?.servedToday) {
      // `servedToday` is computed from work GRADED today, while `sessions` is
      // filtered by studyDay — so a sheet issued earlier and scanned today
      // sets the flag from the carry-over lane. Claiming it here is what stops
      // the view answering "no session record" about a session it was holding.
      const { matched: carried, matchedOn: carriedOn } = claimFor(section, carriedPool);
      if (carried.length) {
        carried.forEach((session, index) => rows.push({
          key: session.sessionId ?? `${rowKey('carried')}:${index}`,
          subject, status: 'done', planned: index === 0 ? planned : null, session,
          detail: null, carriedOver: true,
          matchedOn: index === 0 ? carriedOn : null,
        }));
        return;
      }
      // Still reachable, and still honest: a subject served by a program that
      // owns its completion outside a work session has no session to show.
      rows.push({
        key: rowKey('served'), subject, status: 'done', planned, session: null,
        detail: 'Completed — no session record',
      });
      return;
    }
    rows.push({
      key: rowKey('planned'), subject, status: 'planned', planned, session: null,
      detail: section?.timingNotice ?? null,
    });
  });

  // Anything recorded that the plan never offered. Silently dropping these
  // made the day record lie about what the child actually did.
  pool.forEach(({ session, claimed }, index) => {
    if (claimed) return;
    const key = subjectKey(session?.subject ?? null);
    rows.push({
      key: session?.sessionId ?? `${key}:extra:${index}`,
      subject: session?.subject ?? null,
      status: 'extra', planned: null, session,
      detail: 'Not on the day’s plan',
    });
  });

  const counts = rows.reduce(
    (acc, row) => ({ ...acc, [row.status]: (acc[row.status] ?? 0) + 1, total: acc.total + 1 }),
    { total: 0 },
  );
  return { studyDay, rows, counts };
}

export default joinLearnerDay;
