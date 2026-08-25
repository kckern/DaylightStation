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
import { curriculumTitles } from '../curriculumTitles.js';

/** Stored entries can be strings or {courseId|unitId, elective} objects
 * (CurriculumPlanner.toStored always writes the object form). Everything in
 * this panel normalizes to the bare id — rendering the object raw printed
 * `[object Object]` (admin advocacy #6). */
const idOf = (entry, key) => (typeof entry === 'string' ? entry : entry?.[key] ?? null);
const idsOf = (list, key) => (list ?? []).map((e) => idOf(e, key)).filter(Boolean);

/**
 * A save must round-trip whatever the record already held. An entry may carry
 * `profile` and a `school.course-enrollment/v1` block (module order, optional
 * modules, a frozen lessonOrder) which this panel neither renders nor
 * understands — flattening it to a bare id silently destroys the enrollment.
 * Checked ids that already had an object entry keep that entire object.
 */
export function mergeEntries(originalEntries, checkedIds, key) {
  const byId = new Map();
  (originalEntries ?? []).forEach((entry) => {
    const id = idOf(entry, key);
    if (id) byId.set(id, entry);
  });
  return checkedIds.map((id) => byId.get(id) ?? id);
}

export default function AssignmentsView({ learnerId, learnerName }) {
  const record = usePanelFetch(() => schoolApi.assignments(learnerId), {
    deps: [learnerId],
    panel: 'assignments',
    notFoundAs: 'empty',
    isEmpty: (d) => !(d?.courses ?? []).length && !(d?.units ?? []).length && !(d?.programs ?? []).length,
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
  const titles = curriculumTitles(units);

  const startEditing = () => {
    setDraft({
      courses: idsOf(record.data?.courses, 'courseId'),
      units: idsOf(record.data?.units, 'unitId'),
    });
    setEditing(true);
  };

  const toggle = (kind, id) => setDraft((d) => ({
    ...d,
    [kind]: d[kind].includes(id) ? d[kind].filter((x) => x !== id) : [...d[kind], id],
  }));

  const save = () => run('save', ({ actorId, pin }) => schoolApi.putAssignments(learnerId, {
    courses: mergeEntries(record.data?.courses, draft.courses, 'courseId'),
    units: mergeEntries(record.data?.units, draft.units, 'unitId'),
    ...(record.data?.programs?.length ? { programs: record.data.programs } : {}),
    assignedBy: actorId,
    pin,
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
                  <ul>{idsOf(record.data.courses, 'courseId').map((c) => <li key={c}>{titles.course(c)}</li>)}</ul>
                </div>
              )}
              {(record.data.units ?? []).length > 0 && (
                <div className="teacher-assignments__group">
                  <h3>Standalone units</h3>
                  <ul>{idsOf(record.data.units, 'unitId').map((u) => <li key={u}>{titles.lesson(u)}</li>)}</ul>
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
            {/* Catalog ids first, then any STALE assigned ids the catalog no
                longer publishes (advocacy #6): stale entries used to have no
                checkbox at all — un-untickable, re-saved verbatim forever. */}
            {[...courseIds, ...draft.courses.filter((id) => !courseIds.includes(id))].map((id) => (
              <label key={id} className={`teacher-assignments__pick${courseIds.includes(id) ? '' : ' is-stale'}`}>
                <input type="checkbox" checked={draft.courses.includes(id)} onChange={() => toggle('courses', id)} />
                {titles.course(id)}
                {!courseIds.includes(id) && <span className="teacher-assignments__stale-tag">not in catalog</span>}
              </label>
            ))}
            {idsOf(record.data?.courses, 'courseId')
              .filter((id) => (record.data.courses ?? []).some(
                (e) => typeof e === 'object' && e?.courseId === id && e.enrollment,
              ))
              .map((id) => (
                <p key={`enr-${id}`} className="teacher-assignments__enrolled-note">
                  {titles.course(id)} has an enrollment — order and profile are edited from The whole school.
                </p>
              ))}
          </div>
          <div className="teacher-assignments__group">
            <h3>Standalone units</h3>
            {[...standaloneIds, ...draft.units.filter((id) => !standaloneIds.includes(id))].map((id) => (
              <label key={id} className={`teacher-assignments__pick${standaloneIds.includes(id) ? '' : ' is-stale'}`}>
                <input type="checkbox" checked={draft.units.includes(id)} onChange={() => toggle('units', id)} />
                {titles.lesson(id)}
                {!standaloneIds.includes(id) && <span className="teacher-assignments__stale-tag">not in catalog</span>}
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
