/**
 * Planning — periods, enrollment, curriculum, pacing (spec §4.2). Live
 * panels land in Task 11; the tab carries its five stubs from day one.
 */
import StubCard from '../panels/StubCard.jsx';
import { TODO } from '../todoRegistry.js';

export default function PlanningTab({ learnerId }) {
  return (
    <div className="teacher-tab teacher-tab--planning">
      <StubCard todoId={TODO.ASSIGNMENTS_EDIT} />
      <StubCard todoId={TODO.PERIODS_EDIT} />
      <StubCard todoId={TODO.PASSCRITERIA_EDIT} />
      <StubCard todoId={TODO.MILESTONES} />
      <StubCard todoId={TODO.ENRICHMENT_LOG} />
    </div>
  );
}
