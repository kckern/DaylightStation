/**
 * StaleSessions — sessions that never came back (admin advocacy A5): the
 * roster-wide `GET /lifecycle/sessions/stale` read, with a gated one-tap
 * abandon per row. Reason REQUIRED (the no-silent-verbs contract): closing
 * out a child's stuck work has an author and a why.
 *
 * Household-scoped by design (not per-learner): a wedged session is an
 * operational leak whoever it belongs to, and the whole point is that
 * somebody finally NOTICES.
 *
 * `abandoned` is not legal from every state — a session wedged at
 * `submitted`, `graded`, or `outcome_recorded` settles through grading and
 * close, not abandonment, and `MarkSessionAbandoned.execute` refuses those
 * outright. The server stamps each row with `abandonable` (derived from the
 * same domain table `execute` consults), and THIS panel renders off that
 * flag rather than hand-writing its own copy of the state list — a second
 * copy in JSX is exactly the mistake `sessionEvents.mjs#statesAccepting` was
 * extracted to prevent. A non-abandonable row still gets a move: a link to
 * the session inspector to settle it by hand, plus — when the per-session
 * review read finds unmarked items — the honest reason it is still open.
 */
import { useEffect, useState } from 'react';
import { schoolApi } from '../../schoolApi.js';
import { usePanelFetch } from '../usePanelFetch.js';
import { useTeacherWrite } from '../useTeacherWrite.js';
import { teacherLog } from '../teacherLog.js';
import PanelFrame from './PanelFrame.jsx';
import { teacherDate } from '../teacherDates.js';
import { teacherSessionPath, teacherSectionPath } from '../teacherUrl.js';

/**
 * One lazy, per-row read of `GET /lifecycle/sessions/:id/review` — the list
 * is short, so a request per row is cheap, and a panel-wide `usePanelFetch`
 * does not fit "N independent counts". A failed read renders nothing: this
 * is decoration on top of a row that already has a valid affordance (the
 * settle link), never a second error state competing with the row's own.
 */
function PendingReviewCount({ sessionId }) {
  const [waiting, setWaiting] = useState(null);

  useEffect(() => {
    let alive = true;
    setWaiting(null);
    schoolApi.sessionReview(sessionId).then(({ ok, status, data }) => {
      if (!alive) return;
      if (!ok || !Array.isArray(data?.items)) {
        // Logged, never rendered: a failed count must not become a row error.
        teacherLog.fetch('session-review-failed', { sessionId, status });
        return;
      }
      const count = data.items.filter((item) => !item.verdict).length;
      if (count > 0) setWaiting(count);
    }).catch((err) => {
      if (!alive) return;
      teacherLog.fetchError('session-review-threw', { sessionId, error: err?.message });
    });
    return () => { alive = false; };
  }, [sessionId]);

  if (!waiting) return null;
  return (
    <a className="teacher-stale__pending" href={teacherSectionPath('queue')}>
      {waiting} answer{waiting === 1 ? '' : 's'} waiting
    </a>
  );
}

export default function StaleSessions({ kids = [] }) {
  const nameFor = (id) => kids.find((k) => k.id === id)?.name ?? id;
  const stale = usePanelFetch(() => schoolApi.staleSessions(), {
    panel: 'stale-sessions',
    notFoundAs: 'unavailable',
    isEmpty: (d) => !(d?.sessions ?? []).length,
  });
  const { run, busy, errors } = useTeacherWrite({ panel: 'stale-sessions' });
  const [asking, setAsking] = useState(null);
  const [reason, setReason] = useState('');

  const abandon = (row) => {
    run(row.sessionId, ({ actorId, pin }) => schoolApi.abandonSession(row.sessionId, {
      learnerId: row.learnerId, decidedBy: actorId, pin, reason: reason.trim(),
    }), { onSuccess: () => { setAsking(null); setReason(''); stale.retry(); } });
  };

  return (
    <PanelFrame
      title="Stuck sessions"
      state={stale.state}
      retry={stale.retry}
      emptyCopy="Nothing has been sitting for more than a week."
    >
      <ul className="teacher-stale" data-testid="stale-sessions">
        {(stale.data?.sessions ?? []).map((row) => (
          <li key={row.sessionId} className="teacher-stale__row">
            <span className="teacher-stale__who">{nameFor(row.learnerId)}</span>
            <span className="teacher-stale__what">{row.unitTitle ?? row.title ?? 'Session with no published lesson title'}</span>
            <span className="teacher-stale__meta">
              {/* Human copy (audit): 'created since 2026-07-30' was written by
                  string concatenation, not a person. */}
              waiting since {teacherDate(row.updatedAt)} ({row.state ?? 'open'})
            </span>
            {asking === row.sessionId ? (
              <span className="teacher-stale__reason">
                <input
                  type="text"
                  value={reason}
                  placeholder="Why is this being closed out?"
                  aria-label="Abandon reason"
                  onChange={(e) => setReason(e.target.value)}
                  maxLength={240}
                />
                <button type="button" disabled={busy === row.sessionId || !reason.trim()} onClick={() => abandon(row)}>
                  Close it out
                </button>
                <button type="button" onClick={() => { setAsking(null); setReason(''); }}>Cancel</button>
              </span>
            ) : row.abandonable ? (
              <button type="button" disabled={busy === row.sessionId} onClick={() => { setAsking(row.sessionId); setReason(''); }}>
                Abandon…
              </button>
            ) : (
              // Not abandonable: the state machine settles this through
              // grading or close, not abandonment (`MarkSessionAbandoned`
              // would refuse it). Offer the move that actually works.
              <span className="teacher-stale__settle">
                <a className="teacher-stale__settle-link" href={teacherSessionPath(null, row.sessionId)}>
                  Settle by hand →
                </a>
                <PendingReviewCount sessionId={row.sessionId} />
              </span>
            )}
            {errors[row.sessionId] && <p className="teacher-panel__error">{errors[row.sessionId]}</p>}
          </li>
        ))}
      </ul>
    </PanelFrame>
  );
}
