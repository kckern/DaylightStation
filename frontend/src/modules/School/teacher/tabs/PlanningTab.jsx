/**
 * Planning — periods, enrollment, curriculum, pacing (spec §4.2), all live
 * as of wave 3: editable assignments and periods, pass-criteria overrides on
 * the curriculum, milestones with derived statuses, and the enrichment log.
 */
import AssignmentsView from '../panels/AssignmentsView.jsx';
import PeriodsTimeline from '../panels/PeriodsTimeline.jsx';
import CurriculumBrowser from '../panels/CurriculumBrowser.jsx';
import MilestonesPanel from '../panels/MilestonesPanel.jsx';
import EnrichmentPanel from '../panels/EnrichmentPanel.jsx';

export default function PlanningTab({ learnerId, kids = [] }) {
  const learnerName = kids.find((k) => k.id === learnerId)?.name ?? null;
  return (
    <div className="teacher-tab teacher-tab--planning">
      {learnerId ? (
        <>
          <AssignmentsView learnerId={learnerId} learnerName={learnerName} />
          <MilestonesPanel learnerId={learnerId} />
        </>
      ) : (
        <p className="teacher-panel__empty">Pick a learner above to see their assignments and milestones.</p>
      )}
      <PeriodsTimeline />
      <CurriculumBrowser />
      <EnrichmentPanel kids={kids} />
    </div>
  );
}
