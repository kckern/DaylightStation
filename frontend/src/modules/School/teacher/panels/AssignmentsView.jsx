/**
 * AssignmentsView — what this learner is enrolled in, now EDITABLE (wave 3,
 * teacher.assignments.edit): courses and standalone units picked from the
 * published curriculum, saved through the gate (PUT assignments carries the
 * teacher stamp + pin), server-authoritative refresh. A 404 read is "nothing
 * assigned yet" — an empty state that still offers Edit, never an error —
 * which is why this panel wears its own frame instead of PanelFrame (whose
 * children render only on ok).
 */
import { useState } from 'react';
import { schoolApi } from '../../schoolApi.js';
import { usePanelFetch } from '../usePanelFetch.js';
import { useTeacherWrite } from '../useTeacherWrite.js';
import { labelize } from '../labelize.js';

export default function AssignmentsView({ learnerId, learnerName }) {
  const record = usePanelFetch(() => schoolApi.assignments(learnerId), {
    deps: [learnerId],
    panel: 'assignments',
    notFoundAs: 'empty',
    isEmpty: (d) => !(d?.courses ?? []).length && !(d?.units ?? []).length,
  });
  const catalog = usePanelFetch(() => schoolApi.curriculumUnits(), {
    panel: 'assignments-catalog',
    notFoundAs: 'unavailable',
    isEmpty: (d) => !(d?.units ?? []).length,
  });
  const { run, busy, errors } = useTeacherWrite({ panel: 'assignments' });
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState({ courses: [], units: [] });

  const units = catalog.data?.units ?? [];
  const courseIds = [...new Set(units.filter((u) => u.courseId).map((u) => u.courseId))];
  const standaloneIds = units.filter((u) => !u.courseId).map((u) => u.unitId);

  const startEditing = () => {
    setDraft({
      courses: [...(record.data?.courses ?? [])],
      units: [...(record.data?.units ?? [])],
    });
    setEditing(true);
  };

  const toggle = (kind, id) => setDraft((d) => ({
    ...d,
    [kind]: d[kind].includes(id) ? d[kind].filter((x) => x !== id) : [...d[kind], id],
  }));

  const save = () => run('save', ({ actorId, pin }) => schoolApi.putAssignments(learnerId, {
    courses: draft.courses, units: draft.units, assignedBy: actorId, pin,
    // Concurrent-edit guard (B14): what we LOADED; a stale save is refused
    // with a friendly reload message instead of silently clobbering.
    baseUpdatedAt: record.data?.updatedAt ?? null,
  }), { onSuccess: () => { setEditing(false); record.retry(); } });

  return (
    <section className="teacher-panel" data-state={record.state}>
      <h2 className="teacher-panel__title">Assignments</h2>
      {record.state === 'loading' && <div className="teacher-panel__skeleton" aria-hidden />}
      {record.state === 'error' && (
        <p className="teacher-panel__error">
          Couldn&rsquo;t load Assignments.
          <button type="button" className="teacher-panel__retry" onClick={record.retry}>Retry</button>
        </p>
      )}
      {(record.state === 'ok' || record.state === 'empty') && !editing && (
        <>
          {record.state === 'empty' ? (
            <p className="teacher-panel__empty">Nothing assigned to {learnerName ?? learnerId} yet.</p>
          ) : (
            <div className="teacher-assignments">
              {(record.data.courses ?? []).length > 0 && (
                <div className="teacher-assignments__group">
                  <h3>Courses</h3>
                  <ul>{record.data.courses.map((c) => <li key={c}>{labelize(c)}</li>)}</ul>
                </div>
              )}
              {(record.data.units ?? []).length > 0 && (
                <div className="teacher-assignments__group">
                  <h3>Standalone units</h3>
                  <ul>{record.data.units.map((u) => <li key={u}>{labelize(u)}</li>)}</ul>
                </div>
              )}
              {record.data.assignedBy && (
                <p className="teacher-assignments__meta">Assigned by {record.data.assignedBy}</p>
              )}
            </div>
          )}
          {(catalog.state === 'ok') && (
            <button type="button" className="teacher-assignments__edit" onClick={startEditing}>Edit assignments</button>
          )}
        </>
      )}
      {editing && (
        <div className="teacher-assignments teacher-assignments--editing">
          <div className="teacher-assignments__group">
            <h3>Courses</h3>
            {courseIds.map((id) => (
              <label key={id} className="teacher-assignments__pick">
                <input type="checkbox" checked={draft.courses.includes(id)} onChange={() => toggle('courses', id)} />
                {labelize(id)}
              </label>
            ))}
          </div>
          <div className="teacher-assignments__group">
            <h3>Standalone units</h3>
            {standaloneIds.map((id) => (
              <label key={id} className="teacher-assignments__pick">
                <input type="checkbox" checked={draft.units.includes(id)} onChange={() => toggle('units', id)} />
                {labelize(id)}
              </label>
            ))}
          </div>
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
