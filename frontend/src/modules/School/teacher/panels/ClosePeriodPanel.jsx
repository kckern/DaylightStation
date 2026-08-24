/**
 * ClosePeriodPanel — freeze the selected period's report card (wave 4,
 * teacher.period.close). Two-tap confirm; an already-frozen period offers
 * supersede (the prior freeze is archived server-side, never destroyed).
 * The write carries the teacher stamp + pin; refresh is server-authoritative.
 */
import { useState } from 'react';
import { schoolApi } from '../../schoolApi.js';
import { usePanelFetch } from '../usePanelFetch.js';
import { useTeacherWrite } from '../useTeacherWrite.js';

export default function ClosePeriodPanel({ learnerId, periodId, periodLabel = null, onClosed }) {
  // A 404 here simply means "not closed yet" — the empty state, never an error.
  const frozen = usePanelFetch(() => schoolApi.reportCardFrozen({ learnerId, periodId }), {
    deps: [learnerId, periodId],
    panel: 'close-period',
    notFoundAs: 'empty',
  });
  // The live card, for an honest confirm (advocacy A5): what period, and how
  // many marks are still waiting — BEFORE the freeze, not after.
  const live = usePanelFetch(() => schoolApi.reportCard({ learnerId, periodId }), {
    deps: [learnerId, periodId],
    panel: 'close-period-card',
    nullAs: 'unavailable',
  });
  const { run, busy, errors } = useTeacherWrite({ panel: 'close-period' });
  const [armed, setArmed] = useState(false);

  const alreadyClosed = frozen.state === 'ok';
  const close = () => run('close', ({ actorId, pin, stepUpToken }) => schoolApi.closePeriod({
    learnerId, periodId, closedBy: actorId, pin, supersede: alreadyClosed,
  }, stepUpToken), {
    onSuccess: () => { setArmed(false); frozen.retry(); onClosed?.(); },
    stepUp: alreadyClosed ? { action: 'report-card.close', resource: `${learnerId}/${periodId}` } : null,
  });

  if (frozen.state === 'loading') return null;
  return (
    <div className="teacher-close-period">
      {!armed ? (
        // Consequence wears a costume (design audit): the records-freezing
        // verb must not dress like 'Edit milestones'.
        <button type="button" className="teacher-danger-btn" onClick={() => setArmed(true)}>
          {alreadyClosed ? 'Supersede & re-close this period' : 'Close this period'}
        </button>
      ) : (
        <span className="teacher-close-period__confirm">
          <span>
            {alreadyClosed
              ? `Archive the current freeze of ${periodLabel ?? periodId} and re-close with today’s snapshot?`
              : `Freeze ${periodLabel ?? periodId} as the period record?`}
            {(live.data?.pendingReview ?? 0) > 0 && (
              ` ${live.data.pendingReview} item${live.data.pendingReview === 1 ? '' : 's'} still await a mark.`
            )}
          </span>
          <button type="button" disabled={busy === 'close'} onClick={close}>Confirm</button>
          <button type="button" onClick={() => setArmed(false)}>Cancel</button>
        </span>
      )}
      {errors.close && <p className="teacher-panel__error">{errors.close}</p>}
    </div>
  );
}
