/**
 * Today — roster-scoped daily loop (spec §4.2): the digest strip, per-learner
 * drill-ins, the pending review queue, print approvals, and the quiz-request
 * backlog. Lifecycle-disabled posture (spec §4.3): each lifecycle-backed
 * panel derives `unavailable` from its own fetch; ONE banner renders only
 * when they all do. The digest's own unwired tell is `[]` beside a non-empty
 * kids roster — when wired it always answers one row per roster learner.
 */
import { useMemo, useState } from 'react';
import { schoolApi } from "../../schoolApi.js";
import { usePanelFetch, allUnavailable } from "../usePanelFetch.js";
import PanelFrame from "../panels/PanelFrame.jsx";
import RosterStrip from "../panels/RosterStrip.jsx";
import { labelize } from "../labelize.js";

/**
 * Compact backlog counts linking to the queue — the dashboard summarizes,
 * the Action queue owns the item-level lists (UX audit F26: the same three
 * full panels used to render on both). The counts are the shell's
 * `useBacklog`, the same numbers as the rail badge; a `null` count is a
 * feature this install does not have, so it is left out of the sentence.
 */
function BacklogStrip({ backlog, onOpenQueue }) {
  const parts = [
    backlog.review != null ? `${backlog.review} to review` : null,
    backlog.prints != null ? `${backlog.prints} print${backlog.prints === 1 ? '' : 's'}` : null,
    backlog.quizzes != null ? `${backlog.quizzes} request${backlog.quizzes === 1 ? '' : 's'}` : null,
  ].filter(Boolean);
  // An empty queue advertised twice (heading CTA + this strip) was the
  // emptiest possible state shouting for attention (UX audit IA5).
  if (!parts.length || backlog.total === 0) return null;
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
 *
 * `unknown` is the learners whose plan could not be read. Absence of a tally
 * for them is NOT zero, and this strip is the only place that difference is
 * visible on a collapsed roster — the "couldn't load the day's plan" notice is
 * inside the day grid, which nobody has opened. A silent strip over a down
 * planner would say the morning is fine when nothing was checked.
 *
 * `items` is one entry per affected subject, each with its own link to that
 * child's repair tools (or the failed lesson, or Courses) — the strip used to
 * carry a single href to the first learner's problem, so the second child's
 * broken subject was a tap and a hunt away. Open by default while the list
 * is short enough to read at a glance.
 */
function GrownUpStrip({ count, items = [], unknown = 0 }) {
  if (!count && !unknown) return null;
  return (
    <div className="teacher-grownup">
      {count > 0 && (
        <details className="teacher-grownup-strip" data-testid="grownup-strip" open={count <= 3}>
          <summary>{count} subject{count === 1 ? '' : 's'} need{count === 1 ? 's' : ''} a grown-up</summary>
          <ul>
            {items.map((item) => (
              <li key={`${item.learnerId}:${item.subject}:${item.reason}`}>
                <a href={item.href}>{item.name} · {labelize(item.subject ?? 'lesson')} — {item.headline} →</a>
              </li>
            ))}
          </ul>
        </details>
      )}
      {unknown > 0 && (
        <p className="teacher-grownup-strip teacher-grownup-strip--unknown" data-testid="grownup-strip-unknown">
          We couldn’t read the plan for {unknown} learner{unknown === 1 ? '' : 's'} — this count may be short.
        </p>
      )}
    </div>
  );
}

export default function TodayTab({ kids = [], onOpenQueue = null, backlog = null }) {
  // The v2 day projection is the board contract: it preserves the actual
  // session/taxonomy/artifact context rather than flattening rows into the
  // legacy digest's title-only compatibility shape.
  const today = usePanelFetch(() => schoolApi.teacherDay(), { panel: 'teacher-day' });

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
  const [needsGrownUp, setNeedsGrownUp] = useState({ count: 0, unknown: 0, items: [] });
  // The week in silver for every child in ONE read (the Coins roster, folded
  // into Home's rows). Optional: an install without the economy shows none.
  const coins = usePanelFetch(() => (typeof schoolApi.earningsRoster === 'function'
    ? schoolApi.earningsRoster() : Promise.resolve({ ok: false, status: 404, data: null })), {
    panel: 'home-coins', notFoundAs: 'unavailable', isEmpty: (d) => !(d?.learners ?? []).length,
  });
  const coinsByLearner = useMemo(() => {
    if (coins.state !== 'ok') return null;
    return Object.fromEntries((coins.data?.learners ?? []).map((learner) => {
      const today = coins.data?.today ?? null;
      // Days that are over, plus today once it is green; never a future day.
      const counted = (learner.work?.days ?? []).filter((day) => day.state !== 'exempt'
        && (!today || day.day < today || (day.day === today && day.state === 'met')));
      return [learner.learnerId, {
        silver: learner.totals?.silver ?? 0,
        green: counted.filter((day) => day.state === 'met').length,
        greenOf: counted.length,
      }];
    }));
  }, [coins.state, coins.data]);
  const showBacklog = Boolean(onOpenQueue && backlog && backlog.total > 0);
  // A queue that could not be read is not a clear queue.
  const backlogUnknown = Boolean(backlog?.failed);
  const needsYou = needsGrownUp.count > 0 || needsGrownUp.unknown > 0 || showBacklog || backlogUnknown;

  return (
    <div className="teacher-tab teacher-tab--today">
      {lifecycleDown && (
        <p className="teacher-banner">School lifecycle is not enabled on this install — the daily digest needs it.</p>
      )}
      {/* NEEDS YOU — everything waiting on a grown-up, in one place at the top
          (the action queue's counts and the roster's stuck subjects). Nothing
          waiting is one quiet line, not an empty panel. */}
      <section className={`teacher-needs${needsYou ? '' : ' is-clear'}`} aria-label="Needs you">
        <h2 className="teacher-needs__title">{needsYou ? 'Needs you' : 'Nothing needs you right now'}</h2>
        {backlogUnknown && <p className="teacher-grownup-strip teacher-grownup-strip--unknown">Couldn’t check the action queue — open it to see what is waiting.</p>}
        {showBacklog && <BacklogStrip backlog={backlog} onOpenQueue={onOpenQueue} />}
        <GrownUpStrip count={needsGrownUp.count} items={needsGrownUp.items ?? []} unknown={needsGrownUp.unknown ?? 0} />
      </section>
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
          onNeedsGrownUp={setNeedsGrownUp} coinsByLearner={coinsByLearner} />
      </PanelFrame>
    </div>
  );
}
