/**
 * The Learner Day join (UX audit IA2/IA3).
 *
 * Retracing a school day used to mean reading three surfaces: the agenda
 * planner (what was OFFERED), the day projection (what was DONE), and the
 * History tab (which has no date control at all). Neither read is complete
 * alone, so this joins them into one list keyed by subject — including the
 * two cases both surfaces used to drop on the floor: work that was planned
 * and skipped, and work that happened without ever being planned.
 *
 * Pure by design: no fetching, no React. The view owns the reads.
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

function groupSessionsBySubject(sessions) {
  const grouped = new Map();
  for (const session of sessions) {
    const key = subjectKey(session?.subject ?? null);
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key).push(session);
  }
  return grouped;
}

/**
 * Order a subject's sessions so the one the planner actually offered leads.
 * Both sides carry `unitId`, so the match can be exact; the old subject-only
 * join could not tell "did the planned lesson" from "did some other lesson
 * in the same subject".
 */
function orderByPlannedUnit(sessions, plannedUnitId) {
  if (!plannedUnitId) return { ordered: sessions, matchedOn: sessions.length ? 'subject' : null };
  const index = sessions.findIndex((session) => session.unitId === plannedUnitId);
  if (index < 0) return { ordered: sessions, matchedOn: sessions.length ? 'subject' : null };
  return { ordered: [sessions[index], ...sessions.filter((_, i) => i !== index)], matchedOn: 'unit' };
}

/**
 * @param {object}   input
 * @param {Array}    input.sections  agenda preview `sections[]` — the plan
 * @param {Array}    input.sessions  day projection `sessions[]` — the record
 * @param {string?}  input.studyDay  the day these describe (echoed back)
 * @returns {{ studyDay: string|null, rows: Array, counts: object }}
 */
export function joinLearnerDay({ sections = [], sessions = [], studyDay = null } = {}) {
  const unmatched = groupSessionsBySubject(Array.isArray(sessions) ? sessions : []);
  const rows = [];

  for (const section of Array.isArray(sections) ? sections : []) {
    const subject = section?.subject ?? null;
    const key = subjectKey(subject);
    const found = unmatched.get(key) ?? [];
    unmatched.delete(key);
    const planned = section?.next?.title ?? null;
    const { ordered: matched, matchedOn } = orderByPlannedUnit(found, section?.next?.unitId ?? null);

    if (matched.length) {
      // The plan is stated once for the subject, not repeated per session —
      // repeating it is the duplication the teachers objected to (IA1).
      matched.forEach((session, index) => rows.push({
        key: session.sessionId ?? `${key}:done:${index}`,
        subject, status: 'done', planned: index === 0 ? planned : null, session, detail: null,
        matchedOn: index === 0 ? matchedOn : null,
      }));
      continue;
    }
    if (section?.suppressed) {
      rows.push({
        key: `${key}:deferred`, subject, status: 'deferred', planned, session: null,
        detail: section.suppressed.bySubject ? `Deferred for ${section.suppressed.bySubject} focus` : 'Deferred',
      });
      continue;
    }
    if (section?.lockedRemedy) {
      rows.push({ key: `${key}:blocked`, subject, status: 'blocked', planned, session: null, detail: section.lockedRemedy });
      continue;
    }
    if (section?.servedToday) {
      rows.push({
        key: `${key}:served`, subject, status: 'done', planned, session: null,
        detail: 'Completed — no session record',
      });
      continue;
    }
    rows.push({
      key: `${key}:planned`, subject, status: 'planned', planned, session: null,
      detail: section?.timingNotice ?? null,
    });
  }

  // Anything recorded that the plan never offered. Silently dropping these
  // made the day record lie about what the child actually did.
  for (const [key, matched] of unmatched) {
    matched.forEach((session, index) => rows.push({
      key: session.sessionId ?? `${key}:extra:${index}`,
      subject: key === NO_SUBJECT ? null : key,
      status: 'extra', planned: null, session,
      detail: 'Not on the day’s plan',
    }));
  }

  const counts = rows.reduce(
    (acc, row) => ({ ...acc, [row.status]: (acc[row.status] ?? 0) + 1, total: acc.total + 1 }),
    { total: 0 },
  );
  return { studyDay, rows, counts };
}

export default joinLearnerDay;
