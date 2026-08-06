/**
 * Planning — periods, enrollment, curriculum, pacing (spec §4.2). Assignments
 * follow the header's learner selector; periods and the curriculum catalog
 * are household-wide. Milestones and the enrichment log are future domains
 * (stubs).
 */
import AssignmentsView from '../panels/AssignmentsView.jsx';
import PeriodsTimeline from '../panels/PeriodsTimeline.jsx';
import CurriculumBrowser from '../panels/CurriculumBrowser.jsx';
import StubCard from '../panels/StubCard.jsx';
import { TODO } from '../todoRegistry.js';

export default function PlanningTab({ learnerId, kids = [] }) {
  const learnerName = kids.find((k) => k.id === learnerId)?.name ?? null;
  return (
    <div className="teacher-tab teacher-tab--planning">
      {learnerId ? (
        <AssignmentsView learnerId={learnerId} learnerName={learnerName} />
      ) : (
        <p className="teacher-panel__empty">Pick a learner above to see their assignments.</p>
      )}
      <StubCard todoId={TODO.ASSIGNMENTS_EDIT} />
      <PeriodsTimeline />
      <StubCard todoId={TODO.PERIODS_EDIT} />
      <StubCard todoId={TODO.PASSCRITERIA_EDIT} />
      <CurriculumBrowser />
      <StubCard todoId={TODO.MILESTONES} />
      <StubCard todoId={TODO.ENRICHMENT_LOG} />
    </div>
  );
}
