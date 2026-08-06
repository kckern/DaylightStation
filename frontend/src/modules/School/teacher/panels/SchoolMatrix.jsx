/**
 * SchoolMatrix — the bird's-eye view (admin advocacy A4): every learner ×
 * every published course on ONE grid, composed client-side from three reads
 * that already existed and that nothing consumed together:
 *
 *   GET /lifecycle/assignments        — every learner's assignment record
 *   GET /lifecycle/curriculum/units   — the published catalog (course ids)
 *   GET /pass-overrides               — the active override surface
 *
 * The grid flags what no per-learner view can: a course NOBODY is enrolled
 * in (zero-enrollment column), an assignment naming a course the catalog no
 * longer publishes (dead reference — rendered loud, since the planner
 * silently omits that subject from the child's day), and units carrying an
 * active pass-override (the course cell notes it).
 */
import { useMemo } from 'react';
import { schoolApi } from '../../schoolApi.js';
import { usePanelFetch } from '../usePanelFetch.js';
import PanelFrame from './PanelFrame.jsx';
import { labelize } from '../labelize.js';

/** Pure model: rows per learner, columns per course, plus the flag sets. */
export function deriveMatrix({ assignments, units, overrides, kids }) {
  const courseIds = [...new Set((units ?? []).map((u) => u.courseId).filter(Boolean))].sort();
  const known = new Set(courseIds);
  const overriddenCourses = new Set(
    (overrides ?? []).map((o) => (units ?? []).find((u) => u.unitId === o.unitId)?.courseId).filter(Boolean),
  );
  const courseOf = (c) => (typeof c === 'string' ? c : c?.courseId);
  const byLearner = new Map((assignments ?? []).map((r) => [r.learnerId, r]));
  const rows = (kids ?? []).map((kid) => {
    const rec = byLearner.get(kid.id);
    const assigned = new Set((rec?.courses ?? []).map(courseOf).filter(Boolean));
    return {
      learnerId: kid.id,
      name: kid.name,
      assigned,
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
  return { courseIds, rows, unenrolled, orphanLearners, overriddenCourses };
}

export default function SchoolMatrix({ kids }) {
  const assignments = usePanelFetch(() => schoolApi.allAssignments(), { panel: 'matrix-assignments' });
  const units = usePanelFetch(() => schoolApi.curriculumUnits(), { panel: 'matrix-units', notFoundAs: 'unavailable' });
  const overrides = usePanelFetch(() => schoolApi.passOverrides(), { panel: 'matrix-overrides', nullAs: 'empty' });

  const model = useMemo(() => deriveMatrix({
    assignments: assignments.data?.assignments ?? [],
    units: units.data?.units ?? (Array.isArray(units.data) ? units.data : []),
    overrides: Array.isArray(overrides.data) ? overrides.data : [],
    kids,
  }), [assignments.data, units.data, overrides.data, kids]);

  const state = assignments.state === 'ok' && units.state === 'ok' ? 'ok'
    : assignments.state === 'loading' || units.state === 'loading' ? 'loading'
      : assignments.state === 'ok' || units.state === 'ok' ? 'ok' : units.state;

  return (
    <PanelFrame title="The whole school" state={state} retry={() => { assignments.retry(); units.retry(); }} emptyCopy="No courses published yet.">
      <div className="teacher-matrix" data-testid="school-matrix">
        <table className="teacher-matrix__grid">
          <thead>
            <tr>
              <th aria-label="Learner" />
              {model.courseIds.map((id) => (
                <th key={id} className={model.unenrolled.includes(id) ? 'is-unenrolled' : ''}>
                  {labelize(id)}
                  {model.overriddenCourses.has(id) && <span className="teacher-matrix__flag" title="Has an active pass-override"> ⚑</span>}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {model.rows.map((row) => (
              <tr key={row.learnerId}>
                <th scope="row">{row.name}</th>
                {model.courseIds.map((id) => (
                  <td key={id} className={row.assigned.has(id) ? 'is-assigned' : ''}>
                    {row.assigned.has(id) ? '●' : ''}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
        {model.rows.some((r) => r.deadRefs.length > 0) && (
          <div className="teacher-matrix__dead" data-testid="matrix-dead-refs">
            <p>Assignments naming courses the catalog no longer publishes — these subjects are silently missing from the child&rsquo;s day:</p>
            <ul>
              {model.rows.filter((r) => r.deadRefs.length).map((r) => (
                <li key={r.learnerId}><strong>{r.name}</strong>: {r.deadRefs.join(', ')}</li>
              ))}
            </ul>
          </div>
        )}
        {model.unenrolled.length > 0 && (
          <p className="teacher-matrix__note" data-testid="matrix-unenrolled">
            Nobody is enrolled in: {model.unenrolled.map(labelize).join(', ')}
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
