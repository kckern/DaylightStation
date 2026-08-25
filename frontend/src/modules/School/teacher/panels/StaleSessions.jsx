/**
 * StaleSessions — sessions that never came back (admin advocacy A5): the
 * roster-wide `GET /lifecycle/sessions/stale` read, with a gated one-tap
 * abandon per row. Reason REQUIRED (the no-silent-verbs contract): closing
 * out a child's stuck work has an author and a why.
 *
 * Household-scoped by design (not per-learner): a wedged session is an
 * operational leak whoever it belongs to, and the whole point is that
 * somebody finally NOTICES.
 */
import { useState } from 'react';
import { schoolApi } from '../../schoolApi.js';
import { usePanelFetch } from '../usePanelFetch.js';
import { useTeacherWrite } from '../useTeacherWrite.js';
import PanelFrame from './PanelFrame.jsx';
import { teacherDate } from '../teacherDates.js';

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
            ) : (
              <button type="button" disabled={busy === row.sessionId} onClick={() => { setAsking(row.sessionId); setReason(''); }}>
                Abandon…
              </button>
            )}
            {errors[row.sessionId] && <p className="teacher-panel__error">{errors[row.sessionId]}</p>}
          </li>
        ))}
      </ul>
    </PanelFrame>
  );
}
