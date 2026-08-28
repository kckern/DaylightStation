/**
 * MilestonesPanel — expected-progress targets for the selected learner
 * (wave 3, teacher.milestones): status chips derived server-side (met /
 * behind / upcoming), edited as this learner's own list (the write is
 * learner-scoped; siblings' milestones are untouched).
 */
import { useState } from 'react';
import { schoolApi } from '../../schoolApi.js';
import { usePanelFetch } from '../usePanelFetch.js';
import PanelFrame from './PanelFrame.jsx';
import { useTeacherWrite } from '../useTeacherWrite.js';
import { curriculumTitles } from '../curriculumTitles.js';
import { teacherDate } from '../teacherDates.js';

export default function MilestonesPanel({ learnerId }) {
  const statuses = usePanelFetch(() => schoolApi.milestones(learnerId), {
    deps: [learnerId],
    panel: 'milestones',
    isEmpty: (d) => !(d?.milestones ?? []).length,
  });
  const catalog = usePanelFetch(() => schoolApi.curriculumUnits(), {
    panel: 'milestones-catalog',
    notFoundAs: 'unavailable',
    isEmpty: (d) => !(d?.units ?? []).length,
  });
  const { run, busy, errors } = useTeacherWrite({ panel: 'milestones' });
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState([]);

  const units = catalog.data?.units ?? [];
  const titles = curriculumTitles(units);

  const startEditing = () => {
    setDraft((statuses.data?.milestones ?? []).map(({ status: _status, ...m }) => m));
    setEditing(true);
  };

  const addRow = () => setDraft((d) => [...d, {
    id: `m_${Math.random().toString(36).slice(2, 8)}`, learnerId,
    courseId: units[0]?.courseId ?? '', unitId: units[0]?.unitId ?? '', dueBy: '',
  }]);

  const patch = (i, field, value) => setDraft((d) => d.map((row, idx) => {
    if (idx !== i) return row;
    if (field === 'unitId') {
      const unit = units.find((u) => u.unitId === value);
      return { ...row, unitId: value, courseId: unit?.courseId ?? row.courseId };
    }
    return { ...row, [field]: value };
  }));

  const save = () => run('save', ({ actorId, pin }) => schoolApi.putMilestones({
    learnerId, milestones: draft, editedBy: actorId, pin,
    // The concurrent-edit baseline (B14) from the read this editor started at.
    baseHistoryLength: statuses.data?.historyLength,
  }), { onSuccess: () => { setEditing(false); statuses.retry(); } });

  return (
    <PanelFrame title="Milestones" state={statuses.state} retry={statuses.retry} alwaysRender>
      {!editing && (statuses.state === 'ok' || statuses.state === 'empty') && (
        <>
          {statuses.state === 'empty' ? (
            <p className="teacher-panel__empty">No milestones set yet.</p>
          ) : (
            <ul className="teacher-milestones">
              {statuses.data.milestones.map((m) => (
                <li key={m.id} className="teacher-milestones__row" data-status={m.status}>
                  <span className="teacher-milestones__unit">{m.label ?? titles.lesson(m.unitId)}</span>
                  <span className="teacher-milestones__due">by {teacherDate(m.dueBy)}</span>
                  <span className="teacher-milestones__status">{m.status}</span>
                </li>
              ))}
            </ul>
          )}
          {catalog.state === 'ok' && (
            <button type="button" className="teacher-assignments__edit" onClick={startEditing}>Edit milestones</button>
          )}
        </>
      )}
      {editing && (
        <div className="teacher-milestones__editor">
          {draft.map((row, i) => (
            <div key={row.id} className="teacher-periods__editrow">
              <select aria-label={`Unit ${i}`} value={row.unitId} onChange={(e) => patch(i, 'unitId', e.target.value)}>
                {units.map((u) => <option key={u.unitId} value={u.unitId}>{titles.lesson(u.unitId)}</option>)}
              </select>
              <input aria-label={`Due ${i}`} type="date" value={row.dueBy} onChange={(e) => patch(i, 'dueBy', e.target.value)} />
              <button type="button" onClick={() => setDraft((d) => d.filter((_, idx) => idx !== i))}>Remove</button>
            </div>
          ))}
          <button type="button" onClick={addRow}>Add milestone</button>
          <div className="teacher-assignments__actions">
            <button type="button" disabled={busy === 'save'} onClick={save}>Save</button>
            <button type="button" onClick={() => setEditing(false)}>Cancel</button>
          </div>
          {errors.save && <p className="teacher-panel__error">{errors.save}</p>}
        </div>
      )}
    </PanelFrame>
  );
}
