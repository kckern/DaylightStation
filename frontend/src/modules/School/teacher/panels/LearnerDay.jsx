/**
 * LearnerDay — the drill-in under a roster card: this learner's sessions
 * filtered to the study day server-side (?window=today — the 4am boundary
 * lives in the backend, spec §4.7.3) plus their recent scores.
 */
import { schoolApi } from '../../schoolApi.js';
import { usePanelFetch } from '../usePanelFetch.js';

export default function LearnerDay({ learnerId }) {
  const sessions = usePanelFetch(
    () => schoolApi.learnerSessions(learnerId, { window: 'today' }),
    {
      deps: [learnerId],
      panel: 'learner-day',
      notFoundAs: 'unavailable',
      isEmpty: (d) => !(d?.sessions ?? []).length,
    },
  );
  const scores = usePanelFetch(
    () => schoolApi.progress({ learnerId, recentLimit: 5 }),
    {
      deps: [learnerId],
      panel: 'learner-scores',
      isEmpty: (d) => !(d?.recentScores ?? []).length,
    },
  );

  return (
    <div className="teacher-learner-day">
      {sessions.state === 'ok' && (
        <ul className="teacher-learner-day__sessions">
          {sessions.data.sessions.map((s, i) => (
            <li key={s.sessionId ?? s.id ?? i}>
              <span>{s.unitId ?? s.sessionId ?? 'session'}</span>
              <span className="teacher-learner-day__state">{s.state ?? ''}</span>
            </li>
          ))}
        </ul>
      )}
      {sessions.state === 'empty' && <p className="teacher-panel__empty">No sessions today.</p>}
      {sessions.state === 'unavailable' && <p className="teacher-panel__empty">Session detail isn&rsquo;t available on this install.</p>}
      {sessions.state === 'error' && (
        <p className="teacher-panel__error">
          Couldn&rsquo;t load today&rsquo;s sessions.
          <button type="button" className="teacher-panel__retry" onClick={sessions.retry}>Retry</button>
        </p>
      )}
      {scores.state === 'ok' && (
        <ul className="teacher-learner-day__scores">
          {scores.data.recentScores.map((r, i) => (
            <li key={i}>
              <span>{r.label ?? r.scopeId ?? r.bankId ?? 'assessment'}</span>
              <span>{typeof r.percent === 'number' ? `${Math.round(r.percent)}%` : ''}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
