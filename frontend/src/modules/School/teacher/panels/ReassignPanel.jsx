/**
 * ReassignPanel — attribution repair (wave 5, spec D1): pick a day, see the
 * mis-credited learner's assessments, move one to the right sibling. The
 * move is the storage design's own mechanism — evidence and statistics
 * travel together; provenance rides the moved events.
 */
import { useState } from 'react';
import { schoolApi } from '../../schoolApi.js';
import { useTeacherWrite } from '../useTeacherWrite.js';

export default function ReassignPanel({ learnerId, learnerName, kids = [] }) {
  const [day, setDay] = useState('');
  const [assessments, setAssessments] = useState(null); // null = not loaded
  const [loadError, setLoadError] = useState(null);
  const [target, setTarget] = useState('');
  const { run, busy, errors } = useTeacherWrite({ panel: 'reassign' });
  const siblings = kids.filter((k) => k.id !== learnerId);

  const load = async () => {
    setLoadError(null);
    const { ok, data } = await schoolApi.attemptsSummary(learnerId, day);
    if (!ok) { setLoadError('Couldn’t load that day’s work.'); return; }
    setAssessments(data?.assessments ?? []);
  };

  const move = (a) => run(a.assessmentId, ({ actorId, pin }) => schoolApi.reassign({
    fromLearnerId: learnerId, toLearnerId: target, day, assessmentId: a.assessmentId,
    reassignedBy: actorId, pin,
  }), { onSuccess: load });

  return (
    <section className="teacher-panel">
      <h2 className="teacher-panel__title">Attribution repair</h2>
      <p className="teacher-panel__empty">
        Work recorded against {learnerName ?? learnerId} that belongs to a sibling — pick the day it happened.
      </p>
      <div className="teacher-reassign__controls">
        <input aria-label="Day" type="date" value={day} onChange={(e) => setDay(e.target.value)} />
        <button type="button" disabled={!day} onClick={load}>Load that day</button>
        <select aria-label="Move to" value={target} onChange={(e) => setTarget(e.target.value)}>
          <option value="">Move to…</option>
          {siblings.map((k) => <option key={k.id} value={k.id}>{k.name}</option>)}
        </select>
      </div>
      {loadError && <p className="teacher-panel__error">{loadError}</p>}
      {assessments && assessments.length === 0 && (
        <p className="teacher-panel__empty">No recorded work that day.</p>
      )}
      {assessments && assessments.length > 0 && (
        <ul className="teacher-quizreq">
          {assessments.map((a) => (
            <li key={a.assessmentId} className="teacher-quizreq__row">
              <span>{a.bankId ?? a.assessmentId}</span>
              <span className="teacher-quizreq__meta">{a.count} answer{a.count === 1 ? '' : 's'}</span>
              <button type="button" disabled={!target || busy === a.assessmentId} onClick={() => move(a)}>Reassign</button>
              {errors[a.assessmentId] && <p className="teacher-panel__error">{errors[a.assessmentId]}</p>}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
