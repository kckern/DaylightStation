/**
 * Records — grades, mastery, printouts (spec §4.2), learner + period scoped.
 * The evidence tree and tutor-insight views reuse the module's existing
 * presentational components (CurriculumHistoryOverview /
 * InstructionalInsightsOverview) — same read models, teacher-side chrome.
 */
import { useEffect, useState } from 'react';
import { schoolApi } from '../../schoolApi.js';
import { usePanelFetch } from '../usePanelFetch.js';
import PanelFrame from '../panels/PanelFrame.jsx';
import ReportCardView from '../panels/ReportCardView.jsx';
import FrozenHistory from '../panels/FrozenHistory.jsx';
import ClosePeriodPanel from '../panels/ClosePeriodPanel.jsx';
import PacingPanel from '../panels/PacingPanel.jsx';
import PeriodSelect, { currentPeriodId } from '../panels/PeriodSelect.jsx';
import CurriculumHistoryOverview from '../../progress/CurriculumHistoryOverview.jsx';
import InstructionalInsightsOverview from '../../progress/InstructionalInsightsOverview.jsx';
export default function RecordsTab({ learnerId, kids = [] }) {
  const periods = usePanelFetch(() => schoolApi.periods(), { panel: 'periods' });
  const [periodId, setPeriodId] = useState(null);
  const [frozenRefresh, setFrozenRefresh] = useState(0);
  const periodList = Array.isArray(periods.data) ? periods.data : [];
  useEffect(() => {
    if (!periodId && periodList.length) setPeriodId(currentPeriodId(periodList));
  }, [periodId, periodList]);

  const history = usePanelFetch(
    () => schoolApi.progress({ learnerId, periodId: periodId ?? undefined }),
    {
      deps: [learnerId, periodId],
      panel: 'curriculum-history',
      // Tree-aware (advocacy B17): an ok payload whose tree has no roots and
      // no unscoped evidence is EMPTY — the quiet copy, never a blank card.
      isEmpty: (d) => !(d?.curriculumHistory?.roots ?? []).length
        && !(d?.curriculumHistory?.unscoped?.evidenceCount ?? 0),
    },
  );
  const insights = usePanelFetch(
    () => schoolApi.instructionalInsights({ scopeType: 'learner', scopeId: learnerId }),
    {
      deps: [learnerId],
      panel: 'tutor-insights',
      nullAs: 'empty',
      isEmpty: (d) => !d || (!(d.highlights ?? []).length && !(d.insights ?? []).length && !Object.keys(d).length),
    },
  );

  if (!learnerId) {
    return (
      <div className="teacher-tab teacher-tab--records">
        <p className="teacher-panel__empty">Pick a learner above to see their records.</p>
      </div>
    );
  }

  return (
    <div className="teacher-tab teacher-tab--records">
      {/* The periods read is the tab's spine — a failure must surface as a
          named error with a retry, never a silently missing selector, and
          an empty config gets its own explicit copy (spec §4.3). */}
      {periods.state === 'error' && (
        <p className="teacher-panel__error">
          Couldn&rsquo;t load the academic periods.
          <button type="button" className="teacher-panel__retry" onClick={periods.retry}>Retry</button>
        </p>
      )}
      {periods.state === 'empty' && (
        <p className="teacher-panel__empty">No academic periods configured — records are period-scoped.</p>
      )}
      <PeriodSelect periods={periodList} value={periodId} onChange={setPeriodId} />
      {periodId && <ReportCardView learnerId={learnerId} periodId={periodId} />}
      {periodId && (
        <ClosePeriodPanel
          key={`${learnerId}:${periodId}`}
          learnerId={learnerId}
          periodId={periodId}
          periodLabel={periodList.find((p) => p.periodId === periodId)?.label ?? null}
          onClosed={() => setFrozenRefresh((n) => n + 1)}
        />
      )}
      {periodId && <PacingPanel learnerId={learnerId} periodId={periodId} />}
      <FrozenHistory learnerId={learnerId} refreshKey={frozenRefresh} />
      <a
        className="teacher-reportcard__pdf"
        href={`/api/v1/school/transcript?learnerId=${encodeURIComponent(learnerId)}&format=pdf`}
        target="_blank"
        rel="noreferrer"
      >
        Transcript — every closed period (PDF)
      </a>
      <PanelFrame
        title="Curriculum history"
        state={history.state}
        retry={history.retry}
        emptyCopy="No recorded evidence yet."
      >
        {history.data?.curriculumHistory && <CurriculumHistoryOverview history={history.data.curriculumHistory} />}
      </PanelFrame>
      <PanelFrame
        title="Tutor insights"
        state={insights.state}
        retry={insights.retry}
        emptyCopy="No tutor insights yet."
      >
        {insights.data && <InstructionalInsightsOverview insights={insights.data} />}
      </PanelFrame>
    </div>
  );
}
