import { useState } from 'react';
import { pianoLearningApi } from '../../../Piano/PianoKiosk/modes/Exercises/pianoLearningApi.js';
import { usePanelFetch } from '../usePanelFetch.js';
import { useTeacherWrite } from '../useTeacherWrite.js';

async function load(learnerId) {
  const [programs, assignment] = await Promise.all([
    pianoLearningApi.programs(), pianoLearningApi.assignments(learnerId),
  ]);
  if (!programs.ok) return programs;
  if (!assignment.ok) return assignment;
  return { ok: true, status: 200, data: { programs: programs.data?.programs ?? [], assignment: assignment.data ?? {} } };
}

export default function PianoProgramsPanel({ learnerId }) {
  const record = usePanelFetch(() => load(learnerId), {
    deps: [learnerId], panel: 'piano-programs', notFoundAs: 'unavailable',
    isEmpty: (data) => !(data?.programs ?? []).length,
  });
  const { run, busy, errors } = useTeacherWrite({ panel: 'piano-programs' });
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState([]);
  const assignment = record.data?.assignment ?? { programs: [], updatedAt: null };

  const edit = () => { setDraft(assignment.programs ?? []); setEditing(true); };
  const toggle = (id) => setDraft((current) => current.includes(id) ? current.filter((entry) => entry !== id) : [...current, id]);
  const save = () => run('save', ({ actorId, pin }) => pianoLearningApi.putAssignments(learnerId, {
    programs: draft, assignedBy: actorId, pin, baseUpdatedAt: assignment.updatedAt ?? null,
  }), { onSuccess: () => { setEditing(false); record.retry(); } });

  return (
    <section className="teacher-panel" data-state={record.state}>
      <h2 className="teacher-panel__title">Piano programs</h2>
      {record.state === 'loading' && <div className="teacher-panel__skeleton" aria-hidden />}
      {record.state === 'unavailable' && <p className="teacher-panel__empty">Piano learning is not installed on this station.</p>}
      {record.state === 'error' && <p className="teacher-panel__error">Couldn&rsquo;t load piano programs. <button type="button" onClick={record.retry}>Retry</button></p>}
      {record.state === 'empty' && <p className="teacher-panel__empty">No piano programs are published yet.</p>}
      {record.state === 'ok' && !editing && (
        <>
          {(assignment.programs ?? []).length ? (
            <div className="teacher-assignments">
              <div className="teacher-assignments__group"><h3>Required, in order</h3><ol>{assignment.programs.map((id) => <li key={id}>{record.data.programs.find((program) => program.id === id)?.title ?? id}</li>)}</ol></div>
              {assignment.assignedBy && <p className="teacher-assignments__meta">Assigned by {assignment.assignedBy}</p>}
            </div>
          ) : <p className="teacher-panel__empty">No required piano program. The learner may still start optional programs.</p>}
          <button type="button" className="teacher-assignments__edit" onClick={edit}>Edit piano programs</button>
        </>
      )}
      {record.state === 'ok' && editing && (
        <div className="teacher-assignments teacher-assignments--editing">
          <div className="teacher-assignments__group">
            <h3>Required programs</h3>
            {record.data.programs.map((program) => (
              <label key={program.id} className="teacher-assignments__pick">
                <input type="checkbox" checked={draft.includes(program.id)} onChange={() => toggle(program.id)} />
                <span><strong>{program.title}</strong><small>{program.steps.length} steps · {program.subtitle}</small></span>
              </label>
            ))}
          </div>
          <p className="teacher-assignments__meta">Checked programs appear as required work in this order.</p>
          <div className="teacher-assignments__actions">
            <button type="button" disabled={busy === 'save'} onClick={save}>Save</button>
            <button type="button" onClick={() => setEditing(false)}>Cancel</button>
          </div>
          {errors.save && <p className="teacher-panel__error">{errors.save}</p>}
        </div>
      )}
    </section>
  );
}
