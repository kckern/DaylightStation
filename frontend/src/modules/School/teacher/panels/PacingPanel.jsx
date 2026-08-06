/**
 * PacingPanel — the on-screen progress report (wave 4, spec C2/C5): paced
 * milestones where enrichment days EXCUSE lateness (never delinquency), the
 * period's enrichment entries as their own credit section, and the printable
 * PDF link rendering the same read model.
 */
import { schoolApi } from '../../schoolApi.js';
import { usePanelFetch } from '../usePanelFetch.js';
import PanelFrame from './PanelFrame.jsx';
import { labelize } from '../labelize.js';

export default function PacingPanel({ learnerId, periodId }) {
  const report = usePanelFetch(() => schoolApi.progressReport({ learnerId, periodId }), {
    deps: [learnerId, periodId],
    panel: 'progress-report',
    nullAs: 'unavailable',
  });
  const data = report.data;
  return (
    <PanelFrame
      title="Progress & pacing"
      state={report.state}
      retry={report.retry}
      emptyCopy="Nothing to pace yet."
      unavailableCopy="Progress reports aren't available on this install."
    >
      {data && (
        <div className="teacher-pacing">
          <a
            className="teacher-reportcard__pdf"
            href={`/api/v1/school/progress-report?learnerId=${encodeURIComponent(learnerId)}&periodId=${encodeURIComponent(periodId)}&format=pdf`}
            target="_blank"
            rel="noreferrer"
          >
            Progress report (PDF)
          </a>
          <ul className="teacher-milestones">
            {(data.milestones ?? []).map((m) => (
              <li key={m.id} className="teacher-milestones__row" data-status={m.effectiveStatus}>
                <span className="teacher-milestones__unit">{m.label ?? labelize(m.unitId)}</span>
                <span className="teacher-milestones__due">by {m.dueBy}</span>
                <span className="teacher-milestones__status">
                  {m.effectiveStatus === 'excused'
                    ? `excused — ${m.excusedDays} enrichment day${m.excusedDays === 1 ? '' : 's'}`
                    : m.effectiveStatus === 'behind'
                      ? `behind ${m.overdueDays}d${m.excusedDays ? ` (${m.excusedDays} excused)` : ''}`
                      : m.effectiveStatus}
                </span>
              </li>
            ))}
          </ul>
          {(data.milestones ?? []).length === 0 && (
            <p className="teacher-panel__empty">No milestones set for this learner.</p>
          )}
          <h3 className="teacher-pacing__credit-head">Enrichment credit</h3>
          {(data.enrichment?.entries ?? []).length ? (
            <ul className="teacher-enrichment">
              {data.enrichment.entries.map((e) => (
                <li key={e.id} className="teacher-enrichment__row">
                  <span className="teacher-enrichment__title">{e.title}</span>
                  <span className="teacher-enrichment__dates">{e.from}{e.to && e.to !== e.from ? ` → ${e.to}` : ''}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="teacher-panel__empty">No enrichment recorded this period.</p>
          )}
        </div>
      )}
    </PanelFrame>
  );
}
