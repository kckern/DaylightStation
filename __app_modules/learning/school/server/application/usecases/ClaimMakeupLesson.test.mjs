// @vitest-environment node
import { describe, it, expect, vi } from 'vitest';
import { ClaimMakeupLesson } from './ClaimMakeupLesson.mjs';

const WED = '2026-11-18'; const MON = '2026-11-16'; const SAT = '2026-11-21';
const created = (sessionId, over = {}) => ({
  type: 'created', at: '2026-11-18T15:49:18.696Z', sessionId, learnerId: 'kid', unitId: 'u1', seq: 1, ...over,
});

function build({ events = [created('ses_a')], items = [{ day: WED, subject: 'math' }], facts = [] } = {}) {
  const appended = [];
  const sessions = {
    readEvents: vi.fn(async () => events),
    listForLearner: vi.fn(async () => facts),
    appendEvent: vi.fn(async (id, e) => appended.push({ id, e })),
  };
  const logger = { info: vi.fn(), warn: vi.fn() };
  const useCase = new ClaimMakeupLesson({
    sessions, getMakeupWork: { execute: vi.fn(async () => ({ deadline: SAT, items })) },
    clock: () => new Date('2026-11-19T17:37:35.000Z'), logger,
  });
  return { useCase, appended, logger };
}

describe('ClaimMakeupLesson', () => {
  it('claims the oldest owed day the ticket names', async () => {
    const { useCase, appended } = build({ items: [{ day: MON, subject: 'math' }, { day: WED, subject: 'math' }] });
    const out = await useCase.execute({ sessionId: 'ses_a', learnerId: 'kid', subject: 'math', forDays: [WED, MON] });
    expect(out).toEqual({ claimed: MON, reason: null });
    expect(appended[0]).toMatchObject({ id: 'ses_a', e: { type: 'makeup_claimed', forDay: MON, subject: 'math', deadline: SAT } });
  });

  it('skips a day another open session already claimed', async () => {
    const { useCase } = build({
      items: [{ day: MON, subject: 'math' }, { day: WED, subject: 'math' }],
      facts: [{ sessionId: 'ses_b', terminal: false, makeupFor: MON, makeupSubject: 'math' }],
    });
    expect((await useCase.execute({ sessionId: 'ses_a', learnerId: 'kid', subject: 'math', forDays: [MON, WED] })).claimed).toBe(WED);
  });

  it('claims nothing when nothing named is still owed', async () => {
    const { useCase, appended } = build({ items: [{ day: WED, subject: 'civilization' }] });
    expect(await useCase.execute({ sessionId: 'ses_a', learnerId: 'kid', subject: 'math', forDays: [WED] }))
      .toEqual({ claimed: null, reason: 'nothing_owed' });
    expect(appended).toEqual([]);
  });

  it('is idempotent on a session already claimed', async () => {
    const { useCase, appended } = build({ events: [created('ses_a'), {
      type: 'makeup_claimed', at: '2026-11-19T17:00:00.000Z', sessionId: 'ses_a', forDay: WED, subject: 'math', deadline: SAT, seq: 2,
    }] });
    expect(await useCase.execute({ sessionId: 'ses_a', learnerId: 'kid', subject: 'math', forDays: [WED] }))
      .toEqual({ claimed: WED, reason: 'already_claimed' });
    expect(appended).toEqual([]);
  });

  it('a ticket without makeupFor claims nothing and reads nothing', async () => {
    const { useCase, appended } = build();
    expect((await useCase.execute({ sessionId: 'ses_a', learnerId: 'kid', subject: 'math' })).reason).toBe('not_makeup');
    expect(appended).toEqual([]);
  });

  it('never throws', async () => {
    const logger = { info: vi.fn(), warn: vi.fn() };
    const broken = new ClaimMakeupLesson({
      sessions: { readEvents: async () => { throw new Error('disk'); } },
      getMakeupWork: { execute: async () => ({ deadline: SAT, items: [] }) }, logger,
    });
    expect(await broken.execute({ sessionId: 'ses_a', learnerId: 'kid', subject: 'math', forDays: [WED] }))
      .toEqual({ claimed: null, reason: 'failed' });
    expect(logger.warn).toHaveBeenCalledWith('school.makeup.claim-failed', expect.objectContaining({ sessionId: 'ses_a' }));
  });
});
