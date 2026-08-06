/**
 * LearnerDay — the drill-in under a roster card: this learner's sessions
 * filtered to the study day server-side (?window=today — the 4am boundary
 * lives in the backend, spec §4.7.3) plus their recent scores.
 */
import { schoolApi } from '../../schoolApi.js';
import { usePanelFetch } from '../usePanelFetch.js';
import { useTeacherWrite } from '../useTeacherWrite.js';
import { labelize } from '../labelize.js';

/**
 * The teacher's most common mercy (advocacy B16): re-open a failed unit as a
 * remediation session through the SAME route the console's own arcs use.
 */
function RetakeButton({ sessionId, onDone }) {
  const { run, busy, errors } = useTeacherWrite({ panel: 'retake' });
  const offer = () => run(sessionId, () => schoolApi.offerRetake(sessionId), { onSuccess: onDone });
  return (
    <>
      <button type="button" disabled={busy === sessionId} onClick={offer}>Offer retake</button>
      {errors[sessionId] && <span className="teacher-panel__error">{errors[sessionId]}</span>}
    </>
  );
}

export default function LearnerDay({ learnerId }) {
  // "What SHOULD they do today" (advocacy A3) — the dry-run agenda plan, so
  // the morning check-in reads as a plan, not an autopsy.
  const planned = usePanelFetch(
    () => schoolApi.agendaPreview(learnerId),
    {
      deps: [learnerId],
      panel: 'learner-plan',
      notFoundAs: 'unavailable',
      isEmpty: (d) => !(d?.sections ?? []).length,
    },
  );
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
      {planned.state === 'ok' && (
        <ul className="teacher-learner-day__plan">
          {planned.data.sections.map((section) => (
            <li key={section.subject}>
              <span className="teacher-learner-day__subject">{section.subject}</span>
              <span>
                {section.servedToday
                  ? 'done today'
                  : (section.next?.title ?? section.next?.label ?? section.next?.unitId ?? section.lockedRemedy ?? 'nothing offered')}
              </span>
            </li>
          ))}
        </ul>
      )}
      {planned.state === 'empty' && <p className="teacher-panel__empty">Nothing assigned for today.</p>}
      {sessions.state === 'ok' && (
        <ul className="teacher-learner-day__sessions">
          {sessions.data.sessions.map((s, i) => (
            <li key={s.sessionId ?? s.id ?? i}>
              <span>{labelize(s.unitId) || s.sessionId || 'session'}</span>
              <span className="teacher-learner-day__state">{s.state ?? ''}</span>
              {(s.result === 'needs_remediation' || s.outcome?.result === 'needs_remediation') && s.sessionId && (
                <RetakeButton sessionId={s.sessionId} onDone={sessions.retry} />
              )}
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
