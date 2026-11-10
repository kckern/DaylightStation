/**
 * Obligation copy (plan 3.2/3.3). `row.obligation = { state, reason,
 * needsGrownUp }` is task 7's pass-through of `agenda.mjs`'s own verdict —
 * this file adds no classification of its own, only the words and the link
 * target for reasons that already carry `needsGrownUp: true`, plus a muted
 * fallback for the ones that don't. NEVER a raw reason slug on screen.
 *
 * Lifted out of `panels/RosterStrip.jsx` so the roster card and the
 * dashboard's "needs a grown-up" strip read one set of words. `linkTo` names
 * a destination, not a URL: `RosterStrip`'s `grownUpHref` turns it into one,
 * carrying the row it came from.
 */
import { teacherLog } from "./teacherLog.js";
import { labelize } from "./labelize.js";

/**
 * The obligation reasons that dead-end without an adult (task 7's
 * `needsGrownUp` — read from the join, never re-derived here). The two FAULT
 * reasons (`program_unavailable`, `blocked_unreachable`) are OUR fault, not
 * the child's: the 2026-08-25 unlock incident is why that pair gets its own
 * card treatment (`faulted` styling, 3.2) instead of reading as a quiet
 * unstarted lesson. `caught_up` and `awaiting_grown_up` are excuses — the day
 * still completes — but still need a person, so they get the same link
 * without the fault styling (3.3). `teacher_hold` is the same kind of excuse:
 * a remediation hold (retries that did not land, or a failure left unretried
 * for days) stopped the unit being owed, and nothing moves it until a person
 * sits down with the child.
 */
export const GROWN_UP_ACTION = {
  program_unavailable: { headline: 'This program can’t start', linkTo: 'learner-operations', linkLabel: 'Open repair tools' },
  blocked_unreachable: { headline: 'Locked behind work nothing can reach', linkTo: 'learner-operations', linkLabel: 'Open repair tools' },
  caught_up: { headline: 'This course has no more lessons', linkTo: 'courses', linkLabel: 'Open Courses' },
  awaiting_grown_up: { headline: 'Ask a grown-up to continue or reschedule this work.', linkTo: 'learner-operations', linkLabel: 'Open repair tools' },
  // A remediation hold: retries that did not land, or a failure left
  // unretried for days. The failed session's own page is where "Offer
  // another try" lives; History is the fallback when the row carries none.
  teacher_hold: { headline: 'Stuck on a failed lesson — this one needs you.', linkTo: 'history', linkLabel: 'Open the lesson' },
};

/**
 * `GROWN_UP_ACTION` keyed on a reason it does not carry — a mirror gone
 * stale (see `needsAdult` in `panels/RosterStrip.jsx`) — used to render
 * nothing at all: `state` painted the red band, `needsGrownUp` turned the
 * dot, the dashboard tally counted the subject, and the card alone had no
 * words for why. This is the card's own copy-gap safety net: a labelized,
 * generic sentence instead of a blank slot, plus a warn so the drift gets
 * fixed rather than quietly tolerated forever.
 */
export function grownUpActionFor(reason) {
  const action = GROWN_UP_ACTION[reason];
  if (action) return action;
  teacherLog.copyGap('grown-up-reason-unmapped', { reason });
  return {
    headline: reason ? `This needs a grown-up (${labelize(reason)}).` : 'This needs a grown-up.',
    linkTo: 'learner-operations',
    linkLabel: 'Open repair tools',
  };
}

/**
 * The other seven excuse reasons resolve on their own — no grown-up, no
 * button (3.3, "do not give every excuse a button"). Most already read as a
 * sentence from the row's own `detail` (a lock reason, "Deferred for X
 * focus", "Starts <date>" — see `agenda.mjs`'s `lockedRemedy`/`suppressed`/
 * `timingNotice`); this is the FALLBACK for whenever that branch left
 * `detail` null, so an excused row is never blank and never prints its own
 * schema name.
 */
export const MUTED_EXCUSE_FALLBACK = {
  elective_only: 'Only elective work is offered today.',
  blocked_no_offer: 'Locked behind other work.',
  opens_later: 'Opens later.',
  optional_backlog: 'Optional catch-up work — nothing owed today.',
  not_due_yet: 'Offered, but not due yet.',
  not_a_school_day: 'Not a school day.',
  household_calendar: 'The house is off today.',
  weekly_satisfied: 'Done for the week.',
  no_history: 'This program keeps no record of past days.',
  suppressed_by_focus: 'Deferred for another subject today.',
};

/** Same copy-gap safety net as `grownUpActionFor`, for the seven quiet excuses. */
export function mutedExcuseFor(reason) {
  const sentence = MUTED_EXCUSE_FALLBACK[reason];
  if (sentence) return sentence;
  teacherLog.copyGap('excuse-reason-unmapped', { reason });
  return reason ? labelize(reason) : 'Excused today.';
}
