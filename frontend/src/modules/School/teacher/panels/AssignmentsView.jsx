/**
 * AssignmentsView — what this learner is enrolled in (read-only; editing is
 * the teacher.assignments.edit stub). A 404 from the assignments read means
 * "nothing assigned yet" — an empty state, never an error (spec §4.3).
 */
import { schoolApi } from '../../schoolApi.js';
import { usePanelFetch } from '../usePanelFetch.js';
import PanelFrame from './PanelFrame.jsx';

export default function AssignmentsView({ learnerId, learnerName }) {
  const record = usePanelFetch(() => schoolApi.assignments(learnerId), {
    deps: [learnerId],
    panel: 'assignments',
    notFoundAs: 'empty',
    isEmpty: (d) => !(d?.courses ?? []).length && !(d?.units ?? []).length,
  });
  return (
    <PanelFrame
      title="Assignments"
      state={record.state}
      retry={record.retry}
      emptyCopy={`Nothing assigned to ${learnerName ?? learnerId} yet.`}
    >
      {record.data && (
        <div className="teacher-assignments">
          {(record.data.courses ?? []).length > 0 && (
            <div className="teacher-assignments__group">
              <h3>Courses</h3>
              <ul>{record.data.courses.map((c) => <li key={c}>{c}</li>)}</ul>
            </div>
          )}
          {(record.data.units ?? []).length > 0 && (
            <div className="teacher-assignments__group">
              <h3>Standalone units</h3>
              <ul>{record.data.units.map((u) => <li key={u}>{u}</li>)}</ul>
            </div>
          )}
          {record.data.assignedBy && (
            <p className="teacher-assignments__meta">Assigned by {record.data.assignedBy}</p>
          )}
        </div>
      )}
    </PanelFrame>
  );
}
