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
