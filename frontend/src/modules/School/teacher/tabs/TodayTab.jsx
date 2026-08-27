/**
 * Today — roster-scoped daily loop (spec §4.2): the digest strip, per-learner
 * drill-ins, the pending review queue, print approvals, and the quiz-request
 * backlog. Lifecycle-disabled posture (spec §4.3): each lifecycle-backed
 * panel derives `unavailable` from its own fetch; ONE banner renders only
 * when they all do. The digest's own unwired tell is `[]` beside a non-empty
 * kids roster — when wired it always answers one row per roster learner.
 */
import { useMemo, useState } from 'react';
import { schoolApi } from '../../schoolApi.js';
import { usePanelFetch, allUnavailable } from '../usePanelFetch.js';
import PanelFrame from '../panels/PanelFrame.jsx';
import RosterStrip from '../panels/RosterStrip.jsx';

/**
 * Compact backlog counts linking to the queue — the dashboard summarizes,
 * the Action queue owns the item-level lists (UX audit F26: the same three
 * full panels used to render on both).
 */
function BacklogStrip({ onOpenQueue }) {
  const review = usePanelFetch(() => schoolApi.lifecycleReview(), { panel: 'backlog-review', notFoundAs: 'unavailable' });
  const prints = usePanelFetch(() => schoolApi.printPending(), { panel: 'backlog-prints', notFoundAs: 'unavailable' });
  const quizzes = usePanelFetch(() => schoolApi.quizRequests(), { panel: 'backlog-quizzes', notFoundAs: 'unavailable' });
  const count = (panel, pick) => (panel.state === 'ok' || panel.state === 'empty' ? pick(panel.data ?? null) : null);
  const reviews = count(review, (d) => (d?.items ?? []).length);
  const printJobs = count(prints, (d) => (Array.isArray(d) ? d.length : 0));
  const quizAsks = count(quizzes, (d) => (Array.isArray(d) ? d.length : (d?.requests ?? []).length));
  const parts = [
    reviews != null ? `${reviews} to review` : null,
    printJobs != null ? `${printJobs} print${printJobs === 1 ? '' : 's'}` : null,
    quizAsks != null ? `${quizAsks} quiz request${quizAsks === 1 ? '' : 's'}` : null,
  ].filter(Boolean);
  // An empty queue advertised twice (heading CTA + this strip) was the
  // emptiest possible state shouting for attention (UX audit IA5).
  const waiting = (reviews ?? 0) + (printJobs ?? 0) + (quizAsks ?? 0);
  if (!parts.length || waiting === 0) return null;
  return (
    <button type="button" className="teacher-backlog-strip" data-testid="backlog-strip" onClick={onOpenQueue}>
      {parts.join(' · ')} →
    </button>
  );
}

/**
 * "N subjects need a grown-up" (plan 3.4) — the roster's own faults
 * (`program_unavailable`, `blocked_unreachable`) and its two actionable
 * excuses (`caught_up`, `awaiting_grown_up`), counted across every learner
 * and named ONCE above the roster instead of found lesson by lesson. The
 * count comes from `RosterStrip` itself (`onNeedsGrownUp`) — it already
 * fetched every learner's agenda preview to draw the day-dots, so this adds
 * no second read. Renders nothing at zero, same reasoning as `BacklogStrip`
 * below: an empty state shouting for attention is its own defect (UX audit
 * IA5).
 */
function GrownUpStrip({ count, href }) {
  if (!count) return null;
  return (
    <a className="teacher-grownup-strip" data-testid="grownup-strip" href={href}>
      {count} subject{count === 1 ? '' : 's'} need{count === 1 ? 's' : ''} a grown-up →
    </a>
  );
}

export default function TodayTab({ kids = [], onOpenQueue = null }) {
  // The v2 day projection is the board contract: it preserves the actual
  // session/taxonomy/artifact context rather than flattening rows into the
  // legacy digest's title-only compatibility shape.
  const today = usePanelFetch(() => (schoolApi.teacherDay ? schoolApi.teacherDay() : schoolApi.teacherToday()), { panel: 'teacher-day' });

  // GetTeacherToday answers one row per roster learner when wired, so an
  // empty array next to a non-empty roster means "unwired", not "quiet day".
  const rosterState = today.state === 'empty' && kids.length > 0 ? 'unavailable' : today.state;
  const lifecycleDown = allUnavailable([rosterState]);
  // A STABLE reference for RosterStrip's `rows` prop: an inline `?? []`
  // fallback is a fresh array every render, which would make the roster's
  // own needs-a-grown-up report effect think the roster reshuffled on every
  // unrelated re-render.
  const rows = useMemo(
    () => (Array.isArray(today.data) ? today.data : (today.data?.learners ?? [])),
    [today.data],
  );
  const [needsGrownUp, setNeedsGrownUp] = useState({ count: 0, href: null });

  return (
    <div className="teacher-tab teacher-tab--today">
      {lifecycleDown && (
        <p className="teacher-banner">School lifecycle is not enabled on this install — the daily digest needs it.</p>
      )}
      <GrownUpStrip count={needsGrownUp.count} href={needsGrownUp.href} />
      <PanelFrame
        title="Today"
        state={rosterState}
        retry={today.retry}
        emptyCopy="No learners on the roster."
        unavailableCopy="The daily digest isn't available on this install."
        suppressUnavailable={lifecycleDown}
      >
        <RosterStrip rows={rows} kids={kids}
          studyDay={Array.isArray(today.data) ? null : (today.data?.studyDay ?? null)}
          onNeedsGrownUp={setNeedsGrownUp} />
      </PanelFrame>
      {onOpenQueue && <BacklogStrip onOpenQueue={onOpenQueue} />}
    </div>
  );
}
