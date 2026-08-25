/**
 * Today — roster-scoped daily loop (spec §4.2): the digest strip, per-learner
 * drill-ins, the pending review queue, print approvals, and the quiz-request
 * backlog. Lifecycle-disabled posture (spec §4.3): each lifecycle-backed
 * panel derives `unavailable` from its own fetch; ONE banner renders only
 * when they all do. The digest's own unwired tell is `[]` beside a non-empty
 * kids roster — when wired it always answers one row per roster learner.
 */
import { schoolApi } from '../../schoolApi.js';
import { usePanelFetch, allUnavailable } from '../usePanelFetch.js';
import PanelFrame from '../panels/PanelFrame.jsx';
import RosterStrip from '../panels/RosterStrip.jsx';
import ReviewQueueView from '../panels/ReviewQueueView.jsx';
import PrintPendingView from '../panels/PrintPendingView.jsx';
import QuizRequestBacklog from '../panels/QuizRequestBacklog.jsx';

export default function TodayTab({ kids = [] }) {
  // The v2 day projection is the board contract: it preserves the actual
  // session/taxonomy/artifact context rather than flattening rows into the
  // legacy digest's title-only compatibility shape.
  const today = usePanelFetch(() => (schoolApi.teacherDay ? schoolApi.teacherDay() : schoolApi.teacherToday()), { panel: 'teacher-day' });
  const review = usePanelFetch(() => schoolApi.lifecycleReview(), {
    panel: 'review-queue',
    notFoundAs: 'unavailable',
    isEmpty: (d) => !(d?.items ?? []).length,
  });

  // GetTeacherToday answers one row per roster learner when wired, so an
  // empty array next to a non-empty roster means "unwired", not "quiet day".
  const rosterState = today.state === 'empty' && kids.length > 0 ? 'unavailable' : today.state;
  const lifecycleDown = allUnavailable([rosterState, review.state]);

  return (
    <div className="teacher-tab teacher-tab--today">
      {lifecycleDown && (
        <p className="teacher-banner">School lifecycle is not enabled on this install — the daily digest and review queue need it.</p>
      )}
      <PanelFrame
        title="Today"
        state={rosterState}
        retry={today.retry}
        emptyCopy="No learners on the roster."
        unavailableCopy="The daily digest isn't available on this install."
        suppressUnavailable={lifecycleDown}
      >
        <RosterStrip rows={Array.isArray(today.data) ? today.data : (today.data?.learners ?? [])} kids={kids} />
      </PanelFrame>
      <PanelFrame
        title="Needs review"
        state={review.state}
        retry={review.retry}
        emptyCopy="Nothing waiting on a mark."
        unavailableCopy="The review queue isn't available on this install."
        suppressUnavailable={lifecycleDown}
      >
        <ReviewQueueView items={review.data?.items ?? []} kids={kids} onResolved={review.retry} />
      </PanelFrame>
      <PrintPendingView kids={kids} />
      <QuizRequestBacklog kids={kids} />
    </div>
  );
}
