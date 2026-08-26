import { describe, expect, it, vi } from 'vitest';
import { planDailyAgenda } from './agenda.mjs';
import { resolveDayCompletion } from './completion.mjs';

const reel = { unitId: 'language-reel-10', subject: 'language', program: 'language-reels', programInstance: '10', cadence: 'once', status: 'available', timingPriority: 3, timingRank: 0 };

describe('planDailyAgenda once-only programs', () => {
  it('does not re-offer a terminal reel on a later day', () => {
    const agenda = planDailyAgenda({ plan: { entries: [reel] }, now: '2026-08-25T18:00:00.000Z', programStatuses: { 'language-reels::10': { doneToday: false, terminal: true, progressLabel: 'Reel complete', score: null } } });
    expect(agenda.sections[0].next).toBeNull();
  });

  it('offers an unfinished reel', () => {
    const agenda = planDailyAgenda({ plan: { entries: [reel] }, now: '2026-08-25T18:00:00.000Z', programStatuses: { 'language-reels::10': { doneToday: false, terminal: false, progressLabel: 'Not started', score: null } } });
    expect(agenda.sections[0].next.unitId).toBe('language-reel-10');
  });
});

<<<<<<< HEAD
// --- blocked-but-reachable vs blocked-by-nothing-reachable -------------------
// 2026-08-25 incident: a learner's only remaining subject was scripture, its
// enrollment had materialised without anything that could open, and the whole
// subject read `excused: blocked_no_offer`. With no obligated section left the
// day resolved `complete` and his piano games unlocked — he was excused for the
// system being broken, and rewarded for it.
//
// `blocked_no_offer` is two situations wearing one name. Blocked by a sibling
// the child can still get to is legitimate and must stay excused; blocked by
// something nothing and no date can reach is a fault.

const NOW = '2026-08-25T18:00:00.000Z';

const unit = (over = {}) => ({
  unitId: 'u1', title: 'Unit One', subject: 'scripture', courseId: 'c', sequence: 1,
  elective: false, status: 'available', sessionId: null, state: null,
  lockReason: null, remedy: null, unlocks: null, program: null, programInstance: null,
  cadence: null, timing: null, timingState: 'available', timingPriority: 3, timingRank: 0,
  timingReasons: ['default_priority'], ...over,
});

/** Mirrors what `planLearnerWork` writes on a locked entry: status, the human
 * lock line, and the `remedy` naming the NEAREST unpassed predecessor. */
const lockedBehind = (unitId, blockerId, over = {}) => unit({
  unitId,
  status: 'locked',
  lockReason: `Finish “${blockerId}” first`,
  remedy: { unitId: blockerId, title: blockerId, action: 'start' },
  ...over,
});

const sectionsFor = (entries, logger) => planDailyAgenda({
  plan: { entries, errors: [] }, now: NOW, logger,
}).sections;
const scriptureIn = (entries, logger) => sectionsFor(entries, logger)
  .find((section) => section.subject === 'scripture');

describe('planDailyAgenda blocked-work provenance', () => {
  it('stays excused when the blocker is work the child can start right now', () => {
    const section = scriptureIn([
      lockedBehind('u2', 'u1'),
      unit({ unitId: 'u1', elective: true }),
    ]);
    expect(section.obligation).toEqual({ state: 'excused', reason: 'blocked_no_offer' });
  });

  it('stays excused when the blocker is work already in the child\'s hands', () => {
    const section = scriptureIn([
      lockedBehind('u2', 'u1'),
      unit({ unitId: 'u1', elective: true, status: 'in_progress', sessionId: 'ses_1' }),
    ]);
    expect(section.obligation).toEqual({ state: 'excused', reason: 'blocked_no_offer' });
  });

  it('faults when the blocker is not in the plan at all', () => {
    const section = scriptureIn([lockedBehind('u2', 'u1')]);
    expect(section.obligation).toEqual({ state: 'faulted', reason: 'blocked_unreachable' });
  });

  it('faults when a locked entry names no blocker to go and do', () => {
    const section = scriptureIn([unit({ unitId: 'u2', status: 'locked', lockReason: 'Locked' })]);
    expect(section.obligation).toEqual({ state: 'faulted', reason: 'blocked_unreachable' });
  });

  it('follows the blocker chain to a fixpoint: a -> b -> c -> nothing faults', () => {
    // The planner reports only the NEAREST unpassed predecessor, so a one-level
    // check would call this chain "reachable" and reinstate the bug.
    const section = scriptureIn([
      lockedBehind('a', 'b'),
      lockedBehind('b', 'c'),
      lockedBehind('c', 'nowhere'),
    ]);
    expect(section.obligation).toEqual({ state: 'faulted', reason: 'blocked_unreachable' });
  });

  it('follows the blocker chain to a fixpoint: a -> b -> c, c doable, stays excused', () => {
    const section = scriptureIn([
      lockedBehind('a', 'b'),
      lockedBehind('b', 'c'),
      unit({ unitId: 'c', elective: true }),
    ]);
    expect(section.obligation).toEqual({ state: 'excused', reason: 'blocked_no_offer' });
  });

  it('does not hang on a malformed curriculum whose blockers cycle', () => {
    const logger = { warn: vi.fn(), error: vi.fn(), info: vi.fn() };
    const section = scriptureIn([lockedBehind('a', 'b'), lockedBehind('b', 'a')], logger);
    expect(section.obligation).toEqual({ state: 'faulted', reason: 'blocked_unreachable' });
    expect(logger.warn).toHaveBeenCalledWith('school.agenda.blocker-cycle', expect.objectContaining({
      unitId: 'a',
    }));
  });

  it('faults when the blocker is a dated entry whose module has no window at all', () => {
    // `timingReasons: ['not_scheduled']` is the planner's marker for a dated
    // module with no schedule — no date will ever open it.
    const section = scriptureIn([
      lockedBehind('d2', 'd1'),
      unit({
        unitId: 'd1', status: 'upcoming', timingState: 'upcoming', timingReasons: ['not_scheduled'],
      }),
    ]);
    expect(section.obligation).toEqual({ state: 'faulted', reason: 'blocked_unreachable' });
  });

  it('stays excused when the blocker simply opens on a later date', () => {
    // The ordinary household case: a learner finished this week's dated module
    // early, so next week's first lesson is `upcoming` and the rest sit locked
    // behind it. The calendar reaches it. Faulting here would lock the games
    // of a child who is AHEAD, which is worse than the bug being fixed.
    const section = scriptureIn([
      lockedBehind('w36-d2', 'w36-d1'),
      unit({
        unitId: 'w36-d1', status: 'upcoming', timingState: 'upcoming', timingReasons: ['upcoming'],
        timing: { mode: 'dated' },
      }),
    ]);
    expect(section.obligation).toEqual({ state: 'excused', reason: 'blocked_no_offer' });
  });

  it('never looks at locks while the subject still holds work to do', () => {
    const section = scriptureIn([lockedBehind('u2', 'u1'), unit({ unitId: 'u1' })]);
    expect(section.obligation).toEqual({ state: 'obligated', reason: null });
  });
});

describe('the 2026-08-25 unlock incident, end to end', () => {
  const servedCivilization = unit({ unitId: 'civ1', subject: 'civilization', courseId: 'civ', status: 'completed' });
  const civilizationPass = {
    sessionId: 'ses_civ', unitId: 'civ1', state: 'closed', terminal: true,
    updatedAt: NOW, outcome: { result: 'passed', at: NOW },
  };

  it('a day whose only remaining subject is blocked by nothing reachable is indeterminate, not complete', () => {
    const { sections } = planDailyAgenda({
      plan: { entries: [servedCivilization, lockedBehind('u2', 'u1')], errors: [] },
      sessions: [civilizationPass],
      now: NOW,
    });
    const completion = resolveDayCompletion({ sections, planErrors: [] });
    expect(completion.state).toBe('indeterminate');
    expect(completion.faults).toContainEqual({ subject: 'scripture', reason: 'blocked_unreachable' });
  });

  it('the same day with a reachable blocker still completes', () => {
    const { sections } = planDailyAgenda({
      plan: {
        entries: [servedCivilization, lockedBehind('u2', 'u1'), unit({ unitId: 'u1', elective: true })],
        errors: [],
      },
      sessions: [civilizationPass],
      now: NOW,
    });
    const completion = resolveDayCompletion({ sections, planErrors: [] });
    expect(completion.state).toBe('complete');
    expect(completion.faults).toEqual([]);
    expect(completion.excused).toContainEqual({ subject: 'scripture', reason: 'blocked_no_offer' });
=======
describe('planDailyAgenda catch-up marking', () => {
  // A sequential weekly curriculum keeps advancing when a day is missed rather
  // than waiting, so the thing offered today is often a lesson from a day that
  // has already passed. That is correct scheduling — but unlabelled it is
  // indistinguishable on paper from today's own work, so the section has to say
  // which it is rather than leaving a presenter to infer it from `timing`.
  const entry = (extra) => ({
    unitId: 'cfm-mon', subject: 'scripture', status: 'available',
    timingPriority: 3, timingRank: 0, ...extra,
  });
  const plan = (e) => planDailyAgenda({ plan: { entries: [e] }, now: '2026-08-25T18:00:00.000Z' });

  it('flags an offer whose timing mode is catch_up', () => {
    expect(plan(entry({ timing: { mode: 'catch_up' } })).sections[0].catchUp).toBe(true);
  });

  it('flags an offer whose timingState is catch_up', () => {
    // Both spellings are live in the data; the obligation rules already accept
    // either, and the paper must agree with the obligation rules.
    expect(plan(entry({ timingState: 'catch_up' })).sections[0].catchUp).toBe(true);
  });

  it('leaves on-schedule work unflagged', () => {
    expect(plan(entry({ timingState: 'available' })).sections[0].catchUp).toBe(false);
  });

  it('is false when there is nothing on offer', () => {
    // No offer means no card, so nothing to label — and `catchUp` must never be
    // true with a null `next`, or a presenter could rail an empty section.
    const agenda = plan(entry({ status: 'locked', timing: { mode: 'catch_up' } }));
    expect(agenda.sections[0].next).toBeNull();
    expect(agenda.sections[0].catchUp).toBe(false);
>>>>>>> origin/main
  });
});
