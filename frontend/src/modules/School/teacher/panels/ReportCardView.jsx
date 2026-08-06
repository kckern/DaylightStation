/**
 * ReportCardView — the live (DRAFT) period snapshot for one learner. An
 * ok-but-null body is the backend's "report cards not wired" tell and maps to
 * `unavailable`, never to a quiet nothing-graded-yet zero-state (spec §4.3).
 * The PDF link renders the same snapshot server-side.
 */
import { schoolApi } from '../../schoolApi.js';
import { usePanelFetch } from '../usePanelFetch.js';
import PanelFrame from './PanelFrame.jsx';
import { labelize } from '../labelize.js';

export default function ReportCardView({ learnerId, periodId }) {
  const card = usePanelFetch(() => schoolApi.reportCard({ learnerId, periodId }), {
    deps: [learnerId, periodId],
    panel: 'report-card',
    nullAs: 'unavailable',
  });
  // Material display names live in the materials catalog (advocacy B6): the
  // card's own label is deliberately the honest raw id, so the join to a
  // human name happens here, presentation-side.
  const catalog = usePanelFetch(() => schoolApi.materials(), { panel: 'materials-labels' });
  const materialLabel = (id) => {
    const hit = (catalog.data?.materials ?? []).find((m) => m.id === id);
    return hit?.label ?? hit?.title ?? id;
  };
  const data = card.data;
  return (
    <PanelFrame
      title="Report card"
      state={card.state}
      retry={card.retry}
      emptyCopy="Nothing graded this period yet."
      unavailableCopy="The report card isn't available on this install."
    >
      {data && (
        <div className="teacher-reportcard">
          <div className="teacher-reportcard__head">
            <span className="teacher-reportcard__mode">DRAFT</span>
            <a
              className="teacher-reportcard__pdf"
              href={`/api/v1/school/report-card?learnerId=${encodeURIComponent(learnerId)}&periodId=${encodeURIComponent(periodId)}&format=pdf`}
              target="_blank"
              rel="noreferrer"
            >
              PDF
            </a>
          </div>
          <ul className="teacher-reportcard__courses">
            {(data.courses ?? []).map((c) => (
              <li key={c.courseId}>
                <span>{labelize(c.courseId)}</span>
                <span>
                  {typeof c.coursePercent === 'number' ? `${Math.round(c.coursePercent)}%` : '—'}
                  {typeof c.coursePercent === 'number' && (
                    <a
                      className="teacher-reportcard__cert"
                      href={`/api/v1/school/certificate?learnerId=${encodeURIComponent(learnerId)}&periodId=${encodeURIComponent(periodId)}&courseId=${encodeURIComponent(c.courseId)}&format=pdf`}
                      target="_blank"
                      rel="noreferrer"
                    >
                      Certificate
                    </a>
                  )}
                </span>
              </li>
            ))}
          </ul>
          {(data.materials ?? []).length > 0 && (
            <ul className="teacher-reportcard__materials">
              {data.materials.map((m) => (
                <li key={m.materialId}>
                  <span>{materialLabel(m.materialId)}</span>
                  <span>{m.unitsDone} / {m.unitTotal} units</span>
                </li>
              ))}
            </ul>
          )}
          {(data.remediationArcs ?? []).length > 0 && (
            <ul className="teacher-reportcard__arcs">
              {data.remediationArcs.map((arc) => (
                <li key={`${arc.originalSessionId}:${arc.remediationSessionId}`}>
                  <span>{arc.unitId}</span>
                  <span>remediation {arc.result ?? 'open'}</span>
                </li>
              ))}
            </ul>
          )}
          <p className="teacher-reportcard__meta">
            {data.activeDays?.total ?? 0} active days · {data.pendingReview ?? 0} awaiting review
            {data.courses?.[0]?.policy ? ` · scored by ${data.courses[0].policy}` : ''}
          </p>
          {data.concepts && (data.concepts.mastered?.length || data.concepts.developing?.length) ? (
            <div className="teacher-reportcard__concepts">
              {data.concepts.mastered?.length > 0 && (
                <p>Mastered: {data.concepts.mastered.map((c) => c.label ?? c.conceptId).join(', ')}</p>
              )}
              {data.concepts.developing?.length > 0 && (
                <p>Developing: {data.concepts.developing.map((c) => c.label ?? c.conceptId).join(', ')}</p>
              )}
            </div>
          ) : null}
        </div>
      )}
    </PanelFrame>
  );
}
