/**
 * FrozenHistory — the learner's closed periods (FROZEN records with
 * closedBy/closedAt). Tapping a row fetches and expands that one frozen
 * record (the same wrapper, with periodId). Closing a period from here is
 * the teacher.period.close stub until its wave.
 */
import { useState } from 'react';
import { schoolApi } from '../../schoolApi.js';
import { usePanelFetch } from '../usePanelFetch.js';
import PanelFrame from './PanelFrame.jsx';
import { curriculumTitles } from '../curriculumTitles.js';
import { teacherDate } from '../teacherDates.js';

function FrozenRecord({ learnerId, periodId, titles }) {
  const record = usePanelFetch(() => schoolApi.reportCardFrozen({ learnerId, periodId }), {
    deps: [learnerId, periodId],
    panel: 'frozen-record',
  });
  if (record.state === 'loading') return <div className="teacher-panel__skeleton" aria-hidden />;
  if (record.state !== 'ok') {
    return (
      <p className="teacher-panel__error">
        Couldn&rsquo;t load the frozen record.
        <button type="button" className="teacher-panel__retry" onClick={record.retry}>Retry</button>
      </p>
    );
  }
  const data = record.data;
  return (
    <div className="teacher-frozen__detail">
      <span className="teacher-reportcard__mode">FROZEN</span>
      <ul className="teacher-reportcard__courses">
        {(data.courses ?? []).map((c) => (
          <li key={c.courseId}>
            <span>{titles.course(c.courseId)}</span>
            <span>{typeof c.coursePercent === 'number' ? `${Math.round(c.coursePercent)}%` : '—'}</span>
          </li>
        ))}
      </ul>
      <p className="teacher-reportcard__meta">
        {data.activeDays?.total ?? 0} active days · {data.pendingReview ?? 0} were awaiting review at close
      </p>
    </div>
  );
}

export default function FrozenHistory({ learnerId, refreshKey = 0 }) {
  const [openPeriodId, setOpenPeriodId] = useState(null);
  const frozen = usePanelFetch(() => schoolApi.reportCardFrozen({ learnerId }), {
    deps: [learnerId, refreshKey],
    panel: 'frozen-history',
    isEmpty: (d) => !(Array.isArray(d) ? d : []).length,
  });
  const catalog = usePanelFetch(() => schoolApi.curriculumUnits(), { panel: 'frozen-history-catalog', notFoundAs: 'unavailable' });
  const titles = curriculumTitles(catalog.data?.units ?? []);
  return (
    <PanelFrame title="Closed periods" state={frozen.state} retry={frozen.retry} emptyCopy="No periods closed yet.">
      <ul className="teacher-frozen">
        {(Array.isArray(frozen.data) ? frozen.data : []).map((rec) => (
          <li key={rec.periodId} className="teacher-frozen__row">
            <button
              type="button"
              className="teacher-frozen__toggle"
              onClick={() => setOpenPeriodId((cur) => (cur === rec.periodId ? null : rec.periodId))}
            >
              <span className="teacher-frozen__period">{rec.period?.label ?? 'Academic period'}</span>
              <span className="teacher-frozen__meta">
                FROZEN — Closed by {rec.closedBy ?? 'unknown'}{rec.closedAt ? ` on ${teacherDate(rec.closedAt)}` : ''}
              </span>
            </button>
            {openPeriodId === rec.periodId && <FrozenRecord learnerId={learnerId} periodId={rec.periodId} titles={titles} />}
          </li>
        ))}
      </ul>
    </PanelFrame>
  );
}
