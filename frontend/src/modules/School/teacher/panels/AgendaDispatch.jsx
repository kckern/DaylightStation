/**
 * Dispatch today's agenda for one child — the one console path that drives a
 * physical printer.
 *
 * Lifted out of LearnerDayView so it can also sit in the learner header, where
 * it is reachable from any section in two taps. The lost-NFC-card case is the
 * reason: a child stuck at the Portal with no way to start their day should not
 * cost a teacher a six-step drill-down into a per-day panel to rescue.
 */
import { useState } from 'react';
import { teacherWorkspaceApi } from '../teacherWorkspaceApi.js';
import { useTeacherWrite } from '../useTeacherWrite.js';
import { useTeacherProfileOptional } from '../TeacherProfileContext.jsx';
import { teacherLog } from '../teacherLog.js';
import { localDay } from '../teacherDates.js';

// Client-minted, resource-scoped: a double-tap on print can never mint two
// agendas. Duplicated rather than imported for the cycle reason named in
// LearnerDayView.jsx, which imports this file.
const newIdempotencyKey = (prefix) => `${prefix}:${typeof globalThis.crypto?.randomUUID === 'function'
  ? globalThis.crypto.randomUUID() : `${Date.now()}:${Math.random().toString(36).slice(2)}`}`;

/**
 * The one console path that drives a physical printer — everything above
 * this is a read. `PrintedAgenda` is inert by construction; this is not, and
 * the two must never look equivalent. They share one named Printed agenda
 * block so the distinction can be stated once in plain language; dispatch is
 * still the filled primary action and requires its own preview/confirmation.
 *
 * Dispatch mints against the planner's OWN current day — it takes no
 * `studyDay` — so viewing a past or future day and pressing print would
 * either lie about which day it built, or silently redirect to today without
 * saying so. Neither is acceptable, so the affordance simply isn't here
 * unless the viewed day IS today (compared with `localDay()`, never a UTC
 * date, which flips to tomorrow every evening).
 *
 * Idempotency-Key identity is the whole point: `prepare` mints the key once
 * and shows the plan; `dispatch` reuses that exact key, so a double-tap on
 * "Print it now" cannot become two printed agendas. `cancel` discards the
 * key outright, so a cancelled dispatch can never be replayed later under a
 * key that already looks used — the next prepare mints a fresh one.
 */
function AgendaDispatchInner({ learnerId, learnerName, studyDay = null, label = 'Print the day\u2019s agenda\u2026' }) {
  const [preview, setPreview] = useState(null);
  const [idempotencyKey, setIdempotencyKey] = useState(null);
  const { run, busy, errors } = useTeacherWrite({ panel: 'agenda-dispatch' });
  const key = `agenda-dispatch:${learnerId}`;

  // Today only WHEN A DAY IS IN VIEW — see the block comment above. A null
  // `studyDay` means the caller is showing no day at all (the learner header),
  // where there is nothing for "today" to contradict and the label says which
  // day it prints. Hooks above this line still run every render; only the
  // render output is withheld.
  if (studyDay !== null && studyDay !== localDay()) return null;

  const cancel = () => { setPreview(null); setIdempotencyKey(null); };
  const prepare = () => {
    const requestKey = newIdempotencyKey(key);
    setIdempotencyKey(requestKey);
    run(key, () => teacherWorkspaceApi.agendaDispatchPreview(learnerId, learnerName), { onSuccess: setPreview });
  };
  const dispatch = () => run(key, ({ actorId, pin, stepUpToken }) => teacherWorkspaceApi.agendaDispatch(
    learnerId, { learnerName, dispatchedBy: actorId, pin }, idempotencyKey, stepUpToken,
  ), {
    // Already in STEP_UP_ACTIONS with its own teacherResource branch — this
    // is the pass-through, not a new grant.
    stepUp: { action: 'agenda.dispatch', resource: learnerId },
    onSuccess: () => { teacherLog.write('agenda-dispatched', { learnerId }); cancel(); },
  });

  // The planner already said it can't build this day — printing anyway would
  // hand a child paper the system itself flagged as broken.
  const blocked = preview && (!preview.ready || (preview.errors ?? []).length > 0);
  const subjectCount = preview?.sections?.length ?? 0;

  return (
    <section className="teacher-agenda-dispatch" aria-label="Dispatch today's agenda">
      {!preview && (
        <button type="button" className="teacher-btn teacher-btn--primary" disabled={busy === key} onClick={prepare}>
          {label}
        </button>
      )}
      {blocked && (
        <div className="teacher-agenda-dispatch__blocked">
          <p>The planner can&rsquo;t build this day yet</p>
          <ul>
            {preview.errors.map((error, index) => (
               
              <li key={index}>{typeof error === 'string' ? error : error?.message ?? 'The planner refused an item.'}</li>
            ))}
          </ul>
          <button type="button" className="teacher-btn teacher-btn--quiet" onClick={cancel}>Cancel</button>
        </div>
      )}
      {preview && !blocked && (
        <div className="teacher-agenda-dispatch__ready">
          <p>{subjectCount} subject{subjectCount === 1 ? '' : 's'} will print for {learnerName ?? 'this learner'}.</p>
          <div className="teacher-action-row">
            <button type="button" className="teacher-btn teacher-btn--primary" disabled={busy === key} onClick={dispatch}>
              Print it now
            </button>
            <button type="button" className="teacher-btn" onClick={cancel}>Cancel</button>
          </div>
        </div>
      )}
      {errors[key] && <p className="teacher-panel__error">{errors[key]}</p>}
    </section>
  );
}

/**
 * Renders the dispatch only where a teacher can actually authorize it.
 *
 * `useTeacherWrite` reaches for `useTeacherProfile`, which THROWS without a
 * provider — and this component now sits on the dashboard roster, where a throw
 * would blank every child's row over one button. The check cannot live inside
 * the inner component: its hooks run before any early return could be reached.
 * So the provider lookup happens out here, where returning null is legal, and
 * the hook-using half is simply never mounted without one.
 */
export function AgendaDispatch(props) {
  const profile = useTeacherProfileOptional();
  if (!profile) return null;
  return <AgendaDispatchInner {...props} />;
}

export default AgendaDispatch;
