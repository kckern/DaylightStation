/**
 * The enrollment editor for one learner × one course. Enrolling materializes a
 * syllabus through `createCourseEnrollment`; the resulting order is a SNAPSHOT,
 * so editing the syllabus afterwards does not reach this learner —
 * re-materializing is the explicit act, and it is refused server-side while any
 * session on this course is open.
 */
import { useState } from 'react';
import { schoolApi } from '../../schoolApi.js';
import { useTeacherWrite } from '../useTeacherWrite.js';
import { labelize } from '../labelize.js';
import { teacherLog } from '../teacherLog.js';

export default function EnrollmentDrawer({ learner, courseId, cell, syllabi = [], baseUpdatedAt = null, onClose, onChanged }) {
  const { run, busy, errors } = useTeacherWrite({ panel: 'enrollment' });
  const offered = syllabi.filter((s) => s.courseId === courseId);
  const [choice, setChoice] = useState(cell?.syllabusId ?? offered[0]?.syllabusId ?? '');

  const after = (event) => () => {
    teacherLog.fetch(event, { learnerId: learner.id, courseId });
    onChanged?.();
    onClose?.();
  };

  const enroll = (rematerialize) => run(rematerialize ? 'rematerialize' : 'enroll', ({ actorId, pin }) => schoolApi.enroll(learner.id, {
    syllabusId: choice, rematerialize, enrolledBy: actorId, pin, baseUpdatedAt,
  }), { onSuccess: after(rematerialize ? 'enrollment-rematerialized' : 'enrollment-created') });

  const unenroll = () => run('unenroll', ({ actorId, pin }) => schoolApi.unenroll(learner.id, courseId, {
    removedBy: actorId, pin, baseUpdatedAt,
  }), { onSuccess: after('enrollment-removed') });

  return (
    <aside className="teacher-drawer" data-testid="enrollment-drawer" role="dialog" aria-label={`${learner.name} — ${labelize(courseId)}`}>
      <header className="teacher-drawer__head">
        <h3>{learner.name} · {labelize(courseId)}</h3>
        <button type="button" onClick={onClose} aria-label="Close">✕</button>
      </header>

      {cell?.enrolled && (
        <dl className="teacher-drawer__facts">
          <dt>Syllabus</dt>
          <dd>{cell.syllabusTitle ?? <em>not managed by a syllabus</em>}</dd>
          <dt>Profile</dt>
          <dd>{cell.profile ?? <em>none</em>}</dd>
          <dt>Pass bar</dt>
          <dd>{cell.passing != null ? `${cell.passing}%` : <em>course default</em>}</dd>
        </dl>
      )}

      {cell?.hasEnrollment && !cell?.managed && (
        <p className="teacher-drawer__note">
          This enrollment was written by hand. Enrolling from a syllabus below will replace its order.
        </p>
      )}

      {offered.length === 0 ? (
        <p className="teacher-panel__empty">No syllabus published for this course yet.</p>
      ) : (
        <label className="teacher-drawer__pick">
          Syllabus
          <select value={choice} onChange={(e) => setChoice(e.target.value)}>
            {offered.map((s) => <option key={s.syllabusId} value={s.syllabusId}>{s.title}</option>)}
          </select>
        </label>
      )}

      <div className="teacher-drawer__actions">
        {!cell?.enrolled && (
          <button type="button" disabled={!choice || busy === 'enroll'} onClick={() => enroll(false)}>Enroll</button>
        )}
        {cell?.enrolled && (
          <button type="button" disabled={!choice || busy === 'rematerialize'} onClick={() => enroll(true)}>Re-materialize</button>
        )}
        {cell?.enrolled && (
          <button type="button" disabled={busy === 'unenroll'} onClick={unenroll}>Unenroll</button>
        )}
      </div>

      {['enroll', 'rematerialize', 'unenroll'].map((key) => errors[key] && (
        <p key={key} className="teacher-panel__error">{errors[key]}</p>
      ))}
    </aside>
  );
}
