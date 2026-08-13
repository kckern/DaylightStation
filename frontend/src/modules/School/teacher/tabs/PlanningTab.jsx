/**
 * Planning — periods, enrollment, curriculum, pacing (spec §4.2), all live
 * as of wave 3: editable assignments and periods, pass-criteria overrides on
 * the curriculum, milestones with derived statuses, and the enrichment log.
 */
import AssignmentsView from '../panels/AssignmentsView.jsx';
import SchoolMatrix from '../panels/SchoolMatrix.jsx';
import ActiveOverrides from '../panels/ActiveOverrides.jsx';
import PeriodsTimeline from '../panels/PeriodsTimeline.jsx';
import CurriculumBrowser from '../panels/CurriculumBrowser.jsx';
import MilestonesPanel from '../panels/MilestonesPanel.jsx';
import EnrichmentPanel from '../panels/EnrichmentPanel.jsx';
import PianoProgramsPanel from '../panels/PianoProgramsPanel.jsx';
import { schoolApi } from '../../schoolApi.js';
import { usePanelFetch } from '../usePanelFetch.js';
import PanelFrame from '../panels/PanelFrame.jsx';
import { labelize } from '../labelize.js';

/**
 * Work belonging to no course — program units (daily language study) and
 * course-less curriculum units. These have no syllabus by construction, so
 * they are deliberately absent from the course × learner grid and listed here.
 */
function StandaloneUnits({ learnerId }) {
  const record = usePanelFetch(() => schoolApi.assignments(learnerId), {
    deps: [learnerId],
    panel: 'standalone-units',
    notFoundAs: 'empty',
    isEmpty: (d) => !(d?.units ?? []).length,
  });
  const idOf = (e) => (typeof e === 'string' ? e : e?.unitId);
  return (
    <PanelFrame
      title="Standalone work"
      state={record.state}
      retry={record.retry}
      emptyCopy="Nothing assigned outside a course."
    >
      <ul className="teacher-standalone">
        {(record.data?.units ?? []).map(idOf).filter(Boolean).map((id) => (
          <li key={id}>{labelize(id)}</li>
        ))}
      </ul>
    </PanelFrame>
  );
}

export default function PlanningTab({ learnerId, kids = [] }) {
  const learnerName = kids.find((k) => k.id === learnerId)?.name ?? null;
  return (
    <div className="teacher-tab teacher-tab--planning">
      {learnerId ? (
        <>
          <AssignmentsView learnerId={learnerId} learnerName={learnerName} />
          <PianoProgramsPanel learnerId={learnerId} />
          <MilestonesPanel learnerId={learnerId} />
          <StandaloneUnits learnerId={learnerId} />
        </>
      ) : (
        <p className="teacher-panel__empty">Pick a learner above to see their assignments and milestones.</p>
      )}
      <SchoolMatrix kids={kids} />
      <ActiveOverrides kids={kids} />
      <PeriodsTimeline />
      <CurriculumBrowser />
      <EnrichmentPanel kids={kids} />
    </div>
  );
}
