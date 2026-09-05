/**
 * AssignmentsView — what this learner is enrolled in, now EDITABLE (wave 3,
 * teacher.assignments.edit): courses and standalone units picked from the
 * published curriculum, saved through the gate (PUT assignments carries the
 * teacher stamp + pin), server-authoritative refresh. A 404 read is "nothing
 * assigned yet" — an empty state that still offers Edit, never an error —
 * hence PanelFrame's `alwaysRender`: the editable body survives empty/error.
 */
import { useState } from 'react';
import { schoolApi } from '../../schoolApi.js';
import { usePanelFetch } from '../usePanelFetch.js';
import PanelFrame from './PanelFrame.jsx';
import { useTeacherWrite } from '../useTeacherWrite.js';
import { useTeacherProfile } from '../TeacherProfileContext.jsx';
import { curriculumTitles } from '../curriculumTitles.js';
import { labelize } from '../labelize.js';
import { teacherSectionPath } from '../teacherUrl.js';
import { idsOf, mergeEntries } from './assignmentEntries.js';
import {
  chooseReadingProgram,
  describeReadingEnrollment,
  READING_PROGRAM_OPTIONS,
  readingEnrollments,
} from '../../readingPrograms.js';

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
  const profile = useTeacherProfile();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState({ courses: [], units: [], programs: [] });
  // assignedBy is a user id, never display copy — resolve to a name.
  const teacherName = (id) => (profile.teachers ?? []).find((t) => t.id === id)?.name
    ?? (profile.currentTeacher?.id === id ? profile.currentTeacher.name : null)
    ?? labelize(id);

  const units = catalog.data?.units ?? [];
  const courseIds = [...new Set(units.filter((u) => u.courseId).map((u) => u.courseId))];
  const standaloneIds = units.filter((u) => !u.courseId).map((u) => u.unitId);
  const titles = curriculumTitles(units);

  const startEditing = () => {
    setDraft({
      courses: idsOf(record.data?.courses, 'courseId'),
      units: idsOf(record.data?.units, 'unitId'),
      programs: Array.isArray(record.data?.programs) ? record.data.programs : [],
    });
    setEditing(true);
  };

  const toggle = (kind, id) => setDraft((d) => ({
    ...d,
    [kind]: d[kind].includes(id) ? d[kind].filter((x) => x !== id) : [...d[kind], id],
  }));

  const chooseReading = (programId) => setDraft((d) => ({
    ...d,
    programs: chooseReadingProgram(d.programs, programId === 'none' ? null : programId),
  }));

  const currentReading = readingEnrollments(record.data?.programs);
  const draftReading = readingEnrollments(draft.programs);
  const readingConflict = draftReading.length > 1;
  const readingSelection = readingConflict ? 'conflict' : draftReading[0]?.programId ?? 'none';
  const otherPrograms = (record.data?.programs ?? [])
    .filter((entry) => !['story-time', 'book-log'].includes(entry?.programId));

  const save = () => run('save', ({ actorId, pin }) => schoolApi.putAssignments(learnerId, {
    courses: mergeEntries(record.data?.courses, draft.courses, 'courseId'),
    units: mergeEntries(record.data?.units, draft.units, 'unitId'),
    programs: draft.programs,
    assignedBy: actorId,
    pin,
    // Concurrent-edit guard (B14): what we LOADED; a stale save is refused
    // with a friendly reload message instead of silently clobbering.
    baseUpdatedAt: record.data?.updatedAt ?? null,
  }), { onSuccess: () => { setEditing(false); record.retry(); } });

  return (
    <PanelFrame title="Assignments" state={record.state} retry={record.retry} alwaysRender>
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
              {currentReading.length === 1 && (
                <div className="teacher-assignments__group">
                  <h3>Reading</h3>
                  <p>
                    {READING_PROGRAM_OPTIONS.find((option) => option.id === currentReading[0].programId)?.label}
                    {' — '}{describeReadingEnrollment(currentReading[0])}
                  </p>
                </div>
              )}
              {currentReading.length > 1 && (
                <p className="teacher-panel__error">
                  Conflicting reading assignments: both preschool story time and book logging are saved.
                </p>
              )}
              {otherPrograms.length > 0 && (
                <div className="teacher-assignments__group">
                  <h3>Other programs</h3>
                  <ul>{otherPrograms.map((entry, index) => (
                    <li key={`${entry.programId ?? 'program'}-${entry.corpusId ?? index}`}>
                      {labelize(entry.title ?? entry.programId ?? 'program')}
                    </li>
                  ))}</ul>
                </div>
              )}
              {record.data.assignedBy && (
                <p className="teacher-assignments__meta">Assigned by {teacherName(record.data.assignedBy)}</p>
              )}
            </div>
          )}
          {/* Reading-program repair must not depend on the curriculum catalog.
              Existing course/unit ids remain visible as stale entries if that
              separate read is unavailable, and are preserved unless unchecked. */}
          <button type="button" className="teacher-assignments__edit" onClick={startEditing}>Edit assignments</button>
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
            {/* An entry with an `enrollment` block is materialized from a syllabus
                (school.course-enrollment/v1) — order, profile, and pass bar live
                there, not here, so the note points a teacher at the actual editor
                instead of naming a read-only page that dead-ends (task-5 remediation).
                A hand-authored enrollment (no syllabusId) has no syllabus to send
                anyone to, so it gets its own true sentence instead. */}
            {(record.data?.courses ?? [])
              .filter((entry) => typeof entry === 'object' && entry?.enrollment)
              .map((entry) => (
                <p key={`enr-${entry.courseId}`} className="teacher-assignments__enrolled-note">
                  {entry.syllabusId ? (
                    <>
                      {titles.course(entry.courseId)} has an enrollment — order, profile, and pass bar come from its syllabus. Edit it under{' '}
                      <a href={teacherSectionPath('curriculum')}>Curriculum → Syllabi</a>.
                    </>
                  ) : (
                    <>{titles.course(entry.courseId)} has a hand-authored enrollment — order, profile, and pass bar were set directly on the record, not by a syllabus.</>
                  )}
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
          <fieldset className="teacher-assignments__group teacher-assignments__reading">
            <legend>Reading experience</legend>
            <p className="teacher-assignments__meta">
              Choose by how {learnerName ?? learnerId} reads. Story time is a shared-screen
              preschool activity; book logging is for an independent reader with a physical book.
            </p>
            {readingConflict && (
              <p className="teacher-panel__error">
                Both reading experiences are currently assigned. Choose one before saving.
              </p>
            )}
            <label className="teacher-assignments__pick">
              <input
                type="radio" name="reading-program" value="none"
                checked={readingSelection === 'none'} onChange={() => chooseReading('none')}
              />
              No reading experience
            </label>
            {READING_PROGRAM_OPTIONS.map((option) => (
              <label key={option.id} className="teacher-assignments__pick">
                <input
                  type="radio" name="reading-program" value={option.id}
                  checked={readingSelection === option.id} onChange={() => chooseReading(option.id)}
                />
                <span><strong>{option.label}</strong><br />{option.audience}. {option.description}</span>
              </label>
            ))}
            {draftReading.length === 1 && (
              <p className="teacher-assignments__meta">
                Current target: {describeReadingEnrollment(draftReading[0])}.
              </p>
            )}
          </fieldset>
          <div className="teacher-assignments__actions">
            <button type="button" disabled={busy === 'save' || readingConflict} onClick={save}>Save</button>
            <button type="button" onClick={() => setEditing(false)}>Cancel</button>
          </div>
          {errors.save && <p className="teacher-panel__error">{errors.save}</p>}
        </div>
      )}
    </PanelFrame>
  );
}
