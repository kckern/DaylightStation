import { describe, expect, it } from 'vitest';
import {
  readMakeupPolicy, makeupDeadline, makeupOpen, foldMakeup, openMakeupWork, DEFAULT_MAKEUP_POLICY,
  honouredMakeupClaim,
} from './makeup.mjs';

// Week: Mon 2026-11-16 … Sat 2026-11-21, Sun 2026-11-22.
const MON = '2026-11-16'; const TUE = '2026-11-17'; const WED = '2026-11-18';
const THU = '2026-11-19'; const FRI = '2026-11-20'; const SAT = '2026-11-21'; const SUN = '2026-11-22';
const ON = { enabled: true, deadlineWeekday: 6, subjects: null };

const lessonLedger = (lessons) => ({ lessons, programsDone: [], needsLesson: true, needsPrograms: [] });
const section = (subject, state, ledger) => ({ subject, state, reason: state === 'excused' ? 'not_a_school_day' : null, ledger });
const row = (sections) => {
  const served = sections.filter((s) => s.state === 'served').length;
  const asked = served + sections.filter((s) => s.state === 'obligated').length;
  const state = asked === 0 ? 'exempt' : served >= asked ? 'met' : served ? 'partial' : 'none';
  return { state, reason: null, served, asked, sections };
};

describe('readMakeupPolicy', () => {
  it('absent is off', () => {
    expect(readMakeupPolicy(undefined)).toEqual({ errors: [], policy: DEFAULT_MAKEUP_POLICY });
  });
  it('reads a weekday name and a subject list', () => {
    const { errors, policy } = readMakeupPolicy({ enabled: true, deadline: 'Saturday', subjects: ['math'] });
    expect(errors).toEqual([]);
    expect(policy).toEqual({ enabled: true, deadlineWeekday: 6, subjects: ['math'] });
  });
  it('a bad block is off and says why', () => {
    const { errors, policy } = readMakeupPolicy({ enabled: true, deadline: 'someday', extra: 1 });
    expect(policy.enabled).toBe(false);
    expect(errors).toHaveLength(2);
  });
});

describe('makeup window', () => {
  it('deadline is the configured weekday of the same week', () => {
    expect(makeupDeadline(WED, ON)).toBe(SAT);
    expect(makeupDeadline(WED, { ...ON, deadlineWeekday: 5 })).toBe(FRI);
  });
  it('open from the next day through the deadline, never across the week', () => {
    expect(makeupOpen({ day: WED, today: WED, policy: ON })).toBe(false);
    expect(makeupOpen({ day: WED, today: THU, policy: ON })).toBe(true);
    expect(makeupOpen({ day: WED, today: SAT, policy: ON })).toBe(true);
    expect(makeupOpen({ day: WED, today: SUN, policy: ON })).toBe(false);
    expect(makeupOpen({ day: WED, today: THU, policy: DEFAULT_MAKEUP_POLICY })).toBe(false);
  });
});

describe('foldMakeup', () => {
  const missedWed = row([section('english', 'served', lessonLedger(1)), section('math', 'obligated', lessonLedger(0))]);

  it('a second lesson on Thursday turns Wednesday green, stamped makeup', () => {
    const rows = {
      [WED]: missedWed,
      [THU]: row([section('math', 'served', lessonLedger(2))]),
    };
    const { rows: folded, credits } = foldMakeup(rows, { policy: ON, today: THU });
    expect(folded[WED].state).toBe('met');
    expect(folded[WED].timeliness).toBe('makeup');
    expect(folded[WED].makeup).toEqual([{ subject: 'math', servedOn: THU }]);
    expect(folded[WED].sections[1]).toMatchObject({ state: 'served', makeup: { servedOn: THU } });
    expect(credits).toEqual([{ day: WED, subject: 'math', servedOn: THU }]);
    // Thursday's own row is untouched.
    expect(folded[THU]).toBe(rows[THU]);
  });

  it("Thursday's one lesson is Thursday's own: no credit", () => {
    const rows = { [WED]: missedWed, [THU]: row([section('math', 'served', lessonLedger(1))]) };
    expect(foldMakeup(rows, { policy: ON, today: THU }).rows[WED].state).toBe('partial');
  });

  const saturdayLesson = () => section('math', 'served', { ...lessonLedger(1), asked: false });

  it('a Saturday lesson is all spare: one lesson makes up one day', () => {
    const rows = {
      [WED]: missedWed,
      [SAT]: row([saturdayLesson()]),
    };
    expect(foldMakeup(rows, { policy: ON, today: SAT }).rows[WED].state).toBe('met');
  });

  it('oldest missed day first; spare work is spent once', () => {
    const missedMath = () => row([section('math', 'obligated', lessonLedger(0))]);
    const rows = {
      [MON]: missedMath(), [TUE]: missedMath(),
      [SAT]: row([saturdayLesson()]),
    };
    const { rows: folded } = foldMakeup(rows, { policy: ON, today: SAT });
    expect(folded[MON].state).toBe('met');
    expect(folded[TUE].state).toBe('none');
  });

  it('work after the deadline never counts', () => {
    const rows = { [WED]: missedWed, [SUN]: row([section('math', 'served', lessonLedger(3))]) };
    expect(foldMakeup(rows, { policy: ON, today: SUN }).rows[WED].state).toBe('partial');
  });

  it('a program made up only by a sitting on a day that did not owe it', () => {
    const cardsMissed = row([section('language', 'obligated', {
      lessons: 0, programsDone: [], needsLesson: false, needsPrograms: ['flashcards'],
    })]);
    const owedAndDone = row([section('language', 'served', {
      lessons: 0, programsDone: ['flashcards'], needsLesson: false, needsPrograms: ['flashcards'],
    })]);
    const saturdaySitting = row([section('language', 'served', {
      lessons: 0, programsDone: ['flashcards'], needsLesson: false, needsPrograms: [],
    })]);
    expect(foldMakeup({ [WED]: cardsMissed, [THU]: owedAndDone }, { policy: ON, today: THU }).rows[WED].state).toBe('none');
    expect(foldMakeup({ [WED]: cardsMissed, [SAT]: saturdaySitting }, { policy: ON, today: SAT }).rows[WED].state).toBe('met');
  });

  it('a section lacking two tracks needs both', () => {
    const englishMissed = row([section('english', 'obligated', {
      lessons: 0, programsDone: [], needsLesson: true, needsPrograms: ['book-log'],
    })]);
    const lessonOnly = row([section('english', 'served', {
      lessons: 1, programsDone: [], needsLesson: false, needsPrograms: [],
    })]);
    expect(foldMakeup({ [WED]: englishMissed, [SAT]: lessonOnly }, { policy: ON, today: SAT }).rows[WED].state).toBe('none');
  });

  it('rows without a ledger are left alone', () => {
    const rows = { [WED]: row([section('math', 'obligated', undefined)]), [THU]: row([section('math', 'served', lessonLedger(2))]) };
    expect(foldMakeup(rows, { policy: ON, today: THU }).rows[WED].state).toBe('none');
  });

  it('a subject outside the configured list is not made up', () => {
    const rows = { [WED]: missedWed, [THU]: row([section('math', 'served', lessonLedger(2))]) };
    expect(foldMakeup(rows, { policy: { ...ON, subjects: ['english'] }, today: THU }).rows[WED].state).toBe('partial');
  });

  it('off is the old behaviour', () => {
    const rows = { [WED]: missedWed, [THU]: row([section('math', 'served', lessonLedger(2))]) };
    expect(foldMakeup(rows, { policy: DEFAULT_MAKEUP_POLICY, today: THU }).rows[WED].state).toBe('partial');
  });
});

describe('openMakeupWork', () => {
  it('lists missed sections still recoverable, oldest first', () => {
    const rows = {
      [MON]: row([section('math', 'obligated', lessonLedger(0))]),
      [WED]: row([section('english', 'obligated', lessonLedger(0)), section('math', 'served', lessonLedger(1))]),
    };
    expect(openMakeupWork(rows, { policy: ON, today: THU })).toEqual([
      { day: MON, subject: 'math', deadline: SAT },
      { day: WED, subject: 'english', deadline: SAT },
    ]);
    expect(openMakeupWork(rows, { policy: ON, today: SUN })).toEqual([]);
  });
});

describe('honouredMakeupClaim', () => {
  const claimed = { makeupFor: WED, makeupDeadline: SAT };
  it('names the claimed day when the pass falls after it, by the deadline, same week', () => {
    expect(honouredMakeupClaim(claimed, THU)).toBe(WED);
    expect(honouredMakeupClaim(claimed, SAT)).toBe(WED);
  });
  it('is null on the claimed day itself, past the deadline, or for an unclaimed session', () => {
    expect(honouredMakeupClaim(claimed, WED)).toBeNull();
    expect(honouredMakeupClaim(claimed, SUN)).toBeNull();
    expect(honouredMakeupClaim({ makeupFor: null }, THU)).toBeNull();
    expect(honouredMakeupClaim(null, THU)).toBeNull();
  });
  it('is null across a week boundary even with a lax deadline', () => {
    expect(honouredMakeupClaim({ makeupFor: WED, makeupDeadline: '2026-11-24' }, '2026-11-23')).toBeNull();
  });
});

describe('foldMakeup with claims', () => {
  const claimLedger = (lessons, claims) => ({ ...lessonLedger(lessons), makeupClaims: claims });

  it('a Thursday claim for Wednesday credits Wednesday and leaves Thursday owed', () => {
    const rows = {
      [WED]: row([section('math', 'obligated', lessonLedger(0))]),
      [THU]: row([section('math', 'obligated', claimLedger(0, [WED]))]),
    };
    const { rows: out, credits } = foldMakeup(rows, { policy: ON, today: THU });
    expect(credits).toEqual([{ day: WED, subject: 'math', servedOn: THU }]);
    expect(out[WED].state).toBe('met');
    expect(out[THU].sections[0].state).toBe('obligated');
  });

  it('a claim goes to the day it names, not the oldest missed day', () => {
    const rows = {
      [MON]: row([section('math', 'obligated', lessonLedger(0))]),
      [WED]: row([section('math', 'obligated', lessonLedger(0))]),
      [THU]: row([section('math', 'served', claimLedger(1, [WED]))]),
    };
    const { rows: out } = foldMakeup(rows, { policy: ON, today: THU });
    expect(out[MON].sections[0].state).toBe('obligated');
    expect(out[WED].sections[0]).toMatchObject({ state: 'served', makeup: { servedOn: THU } });
  });

  it('a claim whose day was already served becomes ordinary spare', () => {
    const rows = {
      [MON]: row([section('math', 'obligated', lessonLedger(0))]),
      [WED]: row([section('math', 'served', lessonLedger(1))]),
      [THU]: row([section('math', 'served', claimLedger(1, [WED]))]),
    };
    const { rows: out } = foldMakeup(rows, { policy: ON, today: THU });
    expect(out[MON].sections[0]).toMatchObject({ state: 'served', makeup: { servedOn: THU } });
  });

  it('a row credited in both passes keeps both credits', () => {
    const rows = {
      [MON]: row([section('math', 'obligated', lessonLedger(0)), section('science', 'obligated', lessonLedger(0))]),
      [TUE]: row([section('math', 'served', claimLedger(1, [WED])), section('science', 'served', lessonLedger(2))]),
      [WED]: row([section('math', 'served', lessonLedger(1))]),
    };
    const { rows: out } = foldMakeup(rows, { policy: ON, today: WED });
    expect(out[MON].makeup.map((m) => m.subject).sort()).toEqual(['math', 'science']);
  });
});

// Review, 2026-11-19: the agenda always takes a claimed pass away from the day
// it was done on, so a claim the fold cannot spend must pay that day back.
// Otherwise a real lesson counts for no day at all.
describe('foldMakeup restitution: no claimed lesson is lost', () => {
  const claimLedger = (lessons, claims, over = {}) => ({ ...lessonLedger(lessons), makeupClaims: claims, ...over });
  const claimedWeek = () => ({
    [WED]: row([section('math', 'obligated', lessonLedger(0))]),
    [THU]: row([section('math', 'obligated', claimLedger(0, [WED]))]),
  });
  const restituted = (out, day) => {
    expect(out[day].sections[0]).toMatchObject({ state: 'served', makeup: { servedOn: day, restituted: true } });
    expect(out[day].state).toBe('met');
    expect(out[day].timeliness).toBeUndefined();
  };

  it('policy off: the claim counts for the day it was done', () => {
    const { rows: out, credits } = foldMakeup(claimedWeek(), { policy: { ...ON, enabled: false }, today: THU });
    restituted(out, THU);
    expect(out[WED].sections[0].state).toBe('obligated');
    expect(credits).toEqual([]);
  });

  it('a subject the policy leaves out: the claim counts for the day it was done', () => {
    const { rows: out, credits } = foldMakeup(claimedWeek(), { policy: { ...ON, subjects: ['english'] }, today: THU });
    restituted(out, THU);
    expect(credits).toEqual([]);
  });

  it('a deadline moved before the pass day: the claim counts for the day it was done', () => {
    const { rows: out } = foldMakeup(claimedWeek(), { policy: { ...ON, deadlineWeekday: 3 }, today: THU });
    restituted(out, THU);
    expect(out[WED].sections[0].state).toBe('obligated');
  });

  it('the missed day still lacks a program: the claim counts for the day it was done', () => {
    const rows = {
      [WED]: row([section('math', 'obligated', { ...lessonLedger(0), needsPrograms: ['flashcards::'] })]),
      [THU]: row([section('math', 'obligated', claimLedger(0, [WED]))]),
    };
    const { rows: out, credits } = foldMakeup(rows, { policy: ON, today: THU });
    restituted(out, THU);
    expect(out[WED].sections[0].state).toBe('obligated');
    expect(credits).toEqual([]);
  });

  it('a claim no pass looked at still pays its own day back (pools built before pass 2)', () => {
    // Monday's search stops at Tuesday's claim, so Thursday's pool is never
    // opened in pass 1; Wednesday was served, so nothing else opens it.
    const rows = {
      [MON]: row([section('math', 'obligated', { ...lessonLedger(0), needsPrograms: ['flashcards::'] })]),
      [TUE]: row([section('math', 'obligated', claimLedger(0, [MON]))]),
      [WED]: row([section('math', 'served', lessonLedger(1))]),
      [THU]: row([section('math', 'obligated', claimLedger(0, [WED]))]),
    };
    const { rows: out } = foldMakeup(rows, { policy: ON, today: THU });
    expect(out[MON].sections[0].state).toBe('obligated');
    restituted(out, TUE);
    restituted(out, THU);
  });

  it('a claim spent on its day is not also paid back', () => {
    const { rows: out } = foldMakeup(claimedWeek(), { policy: ON, today: THU });
    expect(out[THU].sections[0].state).toBe('obligated');
    expect(out[THU].sections[0].makeup).toBeUndefined();
  });

  it('a claim spent as ordinary spare on another missed day is not also paid back', () => {
    const rows = {
      [MON]: row([section('math', 'obligated', lessonLedger(0))]),
      [WED]: row([section('math', 'served', lessonLedger(1))]),
      [THU]: row([section('math', 'obligated', claimLedger(0, [WED]))]),
    };
    const { rows: out } = foldMakeup(rows, { policy: ON, today: THU });
    expect(out[MON].sections[0]).toMatchObject({ state: 'served', makeup: { servedOn: THU } });
    expect(out[THU].sections[0].state).toBe('obligated');
  });

  it('a pass day still lacking a program of its own is not restituted', () => {
    const rows = {
      [WED]: row([section('math', 'served', lessonLedger(1))]),
      [THU]: row([section('math', 'obligated', claimLedger(0, [WED], { needsPrograms: ['flashcards::'] }))]),
    };
    const { rows: out } = foldMakeup(rows, { policy: ON, today: THU });
    expect(out[THU].sections[0].state).toBe('obligated');
  });
});
