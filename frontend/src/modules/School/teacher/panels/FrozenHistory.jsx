/**
 * FrozenHistory — the learner's closed periods (FROZEN records with
 * closedBy/closedAt). Closing a period from here is the teacher.period.close
 * stub until its wave.
 */
import { schoolApi } from '../../schoolApi.js';
import { usePanelFetch } from '../usePanelFetch.js';
import PanelFrame from './PanelFrame.jsx';

export default function FrozenHistory({ learnerId }) {
  const frozen = usePanelFetch(() => schoolApi.reportCardFrozen({ learnerId }), {
    deps: [learnerId],
    panel: 'frozen-history',
    isEmpty: (d) => !(Array.isArray(d) ? d : []).length,
  });
  return (
    <PanelFrame title="Closed periods" state={frozen.state} retry={frozen.retry} emptyCopy="No periods closed yet.">
      <ul className="teacher-frozen">
        {(Array.isArray(frozen.data) ? frozen.data : []).map((rec) => (
          <li key={rec.periodId} className="teacher-frozen__row">
            <span className="teacher-frozen__period">{rec.periodId}</span>
            <span className="teacher-frozen__meta">
              FROZEN — Closed by {rec.closedBy ?? 'unknown'}{rec.closedAt ? ` on ${String(rec.closedAt).slice(0, 10)}` : ''}
            </span>
          </li>
        ))}
      </ul>
    </PanelFrame>
  );
}
