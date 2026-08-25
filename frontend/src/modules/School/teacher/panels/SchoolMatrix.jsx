/**
 * SchoolMatrix — the bird's-eye view (admin advocacy A4): every learner ×
 * every published course on ONE grid, composed client-side from three reads
 * that already existed and that nothing consumed together:
 *
 *   GET /lifecycle/assignments        — every learner's assignment record
 *   GET /lifecycle/curriculum/units   — the published catalog (course ids)
 *   GET /lifecycle/syllabi            — syllabus titles, for naming a cell's enrollment
 *
 * The grid flags what no per-learner view can: a course NOBODY is enrolled
 * in (zero-enrollment column), and an assignment naming a course the catalog
 * no longer publishes (dead reference — rendered loud, since the planner
 * silently omits that subject from the child's day). Each cell also carries
 * its enrollment (syllabus, profile, managed vs. hand-authored) for the
 * enrollment editor built on top of this model.
 */
import { useMemo, useState } from 'react';
import { schoolApi } from '../../schoolApi.js';
import { usePanelFetch } from '../usePanelFetch.js';
import PanelFrame from './PanelFrame.jsx';
import EnrollmentDrawer from './EnrollmentDrawer.jsx';
import { curriculumTitles } from '../curriculumTitles.js';
import { labelize } from '../labelize.js';

/** Pure model: rows per learner, columns per course, plus the flag sets. */
export function deriveMatrix({ assignments, units, kids, syllabi = [] }) {
  const courseIds = [...new Set((units ?? []).map((u) => u.courseId).filter(Boolean))].sort();
  const known = new Set(courseIds);
  const titleOf = new Map((syllabi ?? []).map((s) => [s.syllabusId, s.title]));
  const courseOf = (c) => (typeof c === 'string' ? c : c?.courseId);
  const byLearner = new Map((assignments ?? []).map((r) => [r.learnerId, r]));
  const rows = (kids ?? []).map((kid) => {
    const rec = byLearner.get(kid.id);
    const assigned = new Set((rec?.courses ?? []).map(courseOf).filter(Boolean));
    // One cell per assigned course. `managed` is false for an enrollment with
    // no syllabusId -- a hand-authored record, which renders first-class and
    // flagged, never as broken (felix.yml must keep working).
    const cells = {};
    (rec?.courses ?? []).forEach((entry) => {
      const id = courseOf(entry);
      if (!id) return;
      const obj = typeof entry === 'object' ? entry : {};
      cells[id] = {
        enrolled: true,
        syllabusId: obj.syllabusId ?? null,
        syllabusTitle: obj.syllabusId ? (titleOf.get(obj.syllabusId) ?? obj.syllabusId) : null,
        profile: obj.profile ?? null,
        passing: obj.passing ?? null,
        hasEnrollment: Boolean(obj.enrollment),
        managed: Boolean(obj.syllabusId),
      };
    });
    return {
      learnerId: kid.id,
      name: kid.name,
      assigned,
      cells,
      deadRefs: [...assigned].filter((id) => !known.has(id)).sort(),
    };
  });
  // Assignment records for ids that are NOT on the kids roster (a departed
  // or renamed learner still holding courses) — the orphan the admin can't
  // otherwise see.
  const kidIds = new Set((kids ?? []).map((k) => k.id));
  const orphanLearners = (assignments ?? [])
    .filter((r) => !kidIds.has(r.learnerId) && (r.courses ?? []).length)
    .map((r) => r.learnerId)
    .sort();
  const enrollment = new Map(courseIds.map((id) => [id, rows.filter((r) => r.assigned.has(id)).length]));
  const unenrolled = courseIds.filter((id) => enrollment.get(id) === 0);
  return { courseIds, rows, unenrolled, orphanLearners };
}

export default function SchoolMatrix({ kids }) {
  const assignments = usePanelFetch(() => schoolApi.allAssignments(), { panel: 'matrix-assignments' });
  const units = usePanelFetch(() => schoolApi.curriculumUnits(), { panel: 'matrix-units', notFoundAs: 'unavailable' });
  const syllabi = usePanelFetch(() => schoolApi.syllabi(), { panel: 'matrix-syllabi', nullAs: 'empty' });
  const [open, setOpen] = useState(null); // { learnerId, courseId }

  const model = useMemo(() => deriveMatrix({
    assignments: assignments.data?.assignments ?? [],
    units: units.data?.units ?? (Array.isArray(units.data) ? units.data : []),
    syllabi: syllabi.data?.syllabi ?? [],
    kids,
  }), [assignments.data, units.data, syllabi.data, kids]);

  const state = assignments.state === 'ok' && units.state === 'ok' ? 'ok'
    : assignments.state === 'loading' || units.state === 'loading' ? 'loading'
      : assignments.state === 'ok' || units.state === 'ok' ? 'ok' : units.state;
  const titles = curriculumTitles(units.data?.units ?? (Array.isArray(units.data) ? units.data : []));

  // Courses are the axis that grows; students are fixed at a handful.
  // Transposed, full course titles read left-aligned and the student columns
  // stay narrow at any catalog size (UX audit C11).
  return (
    <PanelFrame title="The whole school" state={state} retry={() => { assignments.retry(); units.retry(); }} emptyCopy="No courses published yet.">
      <div className="teacher-matrix" data-testid="school-matrix">
        <table className="teacher-matrix__grid teacher-matrix__grid--courses-as-rows">
          <thead>
            <tr>
              <th className="teacher-matrix__course-head">Course</th>
              {model.rows.map((row) => <th key={row.learnerId}>{row.name}</th>)}
            </tr>
          </thead>
          <tbody>
            {model.courseIds.map((id) => (
              <tr key={id} className={model.unenrolled.includes(id) ? 'is-unenrolled' : ''}>
                <th scope="row" className="teacher-matrix__course-title">{titles.course(id)}</th>
                {model.rows.map((row) => {
                  const cell = row.cells[id];
                  return (
                    <td key={row.learnerId} className={cell ? 'is-assigned' : ''}>
                      <button
                        type="button"
                        className="teacher-matrix__cell"
                        onClick={() => setOpen({ learnerId: row.learnerId, courseId: id })}
                        aria-label={`${row.name}, ${titles.course(id)}`}
                      >
                        {cell
                          ? `${cell.syllabusTitle ?? 'Enrolled'}${cell.profile ? ` · ${cell.profile}` : ''}${(cell.hasEnrollment && !cell.managed) ? ' ⚑' : ''}`
                          : '—'}
                      </button>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
        <p className="teacher-matrix__legend">⚑ hand-authored enrollment · — not enrolled</p>
        {open && (
          <EnrollmentDrawer
            key={`${open.learnerId}:${open.courseId}`}
            learner={kids.find((k) => k.id === open.learnerId) ?? { id: open.learnerId, name: open.learnerId }}
            courseId={open.courseId}
            courseTitle={titles.course(open.courseId)}
            cell={model.rows.find((r) => r.learnerId === open.learnerId)?.cells[open.courseId] ?? null}
            syllabi={syllabi.data?.syllabi ?? []}
            baseUpdatedAt={(assignments.data?.assignments ?? []).find((a) => a.learnerId === open.learnerId)?.updatedAt ?? null}
            onClose={() => setOpen(null)}
            onChanged={() => { assignments.retry(); }}
          />
        )}
        {model.rows.some((r) => r.deadRefs.length > 0) && (
          <div className="teacher-matrix__dead" data-testid="matrix-dead-refs">
            <p>Assignments naming courses the catalog no longer publishes — these subjects are silently missing from the child&rsquo;s day:</p>
            <ul>
              {model.rows.filter((r) => r.deadRefs.length).map((r) => (
                <li key={r.learnerId}><strong>{r.name}</strong>: {r.deadRefs.map(labelize).join(', ')}</li>
              ))}
            </ul>
          </div>
        )}
        {model.unenrolled.length > 0 && (
          <p className="teacher-matrix__note" data-testid="matrix-unenrolled">
            Unassigned courses ({model.unenrolled.length}) — tap a — cell above to enroll someone.
          </p>
        )}
        {model.orphanLearners.length > 0 && (
          <p className="teacher-matrix__note teacher-matrix__note--orphan" data-testid="matrix-orphans">
            Assignment records exist for ids not on the roster: {model.orphanLearners.join(', ')}
          </p>
        )}
      </div>
    </PanelFrame>
  );
}
