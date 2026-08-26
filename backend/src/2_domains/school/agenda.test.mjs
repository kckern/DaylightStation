import { describe, expect, it } from 'vitest';
import { planDailyAgenda } from './agenda.mjs';

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
  });
});
