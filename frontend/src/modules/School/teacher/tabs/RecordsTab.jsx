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
import PeriodSelect, { currentPeriodId } from '../panels/PeriodSelect.jsx';
import CurriculumHistoryOverview from '../../progress/CurriculumHistoryOverview.jsx';
import InstructionalInsightsOverview from '../../progress/InstructionalInsightsOverview.jsx';
import StubCard from '../panels/StubCard.jsx';
import { TODO } from '../todoRegistry.js';

export default function RecordsTab({ learnerId, kids = [] }) {
  const periods = usePanelFetch(() => schoolApi.periods(), { panel: 'periods' });
  const [periodId, setPeriodId] = useState(null);
  const periodList = Array.isArray(periods.data) ? periods.data : [];
  useEffect(() => {
    if (!periodId && periodList.length) setPeriodId(currentPeriodId(periodList));
  }, [periodId, periodList]);

  const history = usePanelFetch(
    () => schoolApi.progress({ learnerId, periodId: periodId ?? undefined }),
    { deps: [learnerId, periodId], panel: 'curriculum-history' },
  );
  const insights = usePanelFetch(
    () => schoolApi.instructionalInsights({ scopeType: 'learner', scopeId: learnerId }),
    { deps: [learnerId], panel: 'tutor-insights', nullAs: 'empty' },
  );

  if (!learnerId) {
    return (
      <div className="teacher-tab teacher-tab--records">
        <p className="teacher-panel__empty">Pick a learner above to see their records.</p>
        <StubCard todoId={TODO.PERIOD_CLOSE} />
        <StubCard todoId={TODO.PROGRESSREPORT_PRINT} />
        <StubCard todoId={TODO.CERTIFICATES_PRINT} />
        <StubCard todoId={TODO.ENRICHMENT_CREDIT} />
      </div>
    );
  }

  return (
    <div className="teacher-tab teacher-tab--records">
      <PeriodSelect periods={periodList} value={periodId} onChange={setPeriodId} />
      {periodId && <ReportCardView learnerId={learnerId} periodId={periodId} />}
      <StubCard todoId={TODO.PERIOD_CLOSE} />
      <FrozenHistory learnerId={learnerId} />
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
      <StubCard todoId={TODO.PROGRESSREPORT_PRINT} />
      <StubCard todoId={TODO.CERTIFICATES_PRINT} />
      <StubCard todoId={TODO.ENRICHMENT_CREDIT} />
    </div>
  );
}
