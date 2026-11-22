// tests/isolated/application/weekly-review/LearnerWinsService.test.mjs
import { describe, it, expect, vi } from 'vitest';
import { LearnerWinsService } from '../../../../__app_modules/personal/weekly-review/server/application/LearnerWinsService.mjs';

const DATES = ['2026-11-15', '2026-11-16', '2026-11-17', '2026-11-18', '2026-11-19', '2026-11-20', '2026-11-21', '2026-11-22'];
const WINDOW = { windowStartMs: Date.parse('2026-11-15T12:00:00Z'), windowEndMs: Date.parse('2026-11-23T12:00:00Z') };
const logger = () => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() });
const earn = (o) => ({ kind: 'earn', currency: 'silver', delta: 10, at: '2026-11-18T20:00:00Z', ...o });

function clockAt(ms) {
  let now = ms;
  return { clock: () => new Date(now), advance: (d) => { now += d; } };
}

describe('LearnerWinsService', () => {
  it('sums each learner\'s earned silver and gems and asks rings for the week and all time', async () => {
    const ledger = vi.fn(async (id) => (id === 'kid1'
      ? [earn({}), earn({ currency: 'gems', delta: 1 }), earn({ delta: 5, at: '2026-01-01T20:00:00Z' }), earn({ kind: 'convert', delta: -140 })]
      : null));
    const rings = vi.fn(async ({ learnerId, from }) => (learnerId === 'kid1' ? (from === '2026-11-15' ? 3 : 40) : 0));
    const log = logger();
    const service = new LearnerWinsService({ ledger, rings, logger: log });

    const result = await service.execute({ learnerIds: ['kid1', 'kid2'], dates: DATES, ...WINDOW });

    expect(result).toEqual({
      kid1: { week: { silver: 10, gems: 1, rings: 3 }, allTime: { silver: 15, gems: 1, rings: 40 } },
      kid2: { week: { silver: 0, gems: 0, rings: 0 }, allTime: { silver: 0, gems: 0, rings: 0 } },
    });
    expect(rings).toHaveBeenCalledWith({ learnerId: 'kid1', from: '2026-11-15', to: '2026-11-22' });
    expect(rings).toHaveBeenCalledWith({ learnerId: 'kid1', from: '2000-01-01', to: '2026-11-22' });
    expect(log.info).toHaveBeenCalledWith('weekly-review.wins.loaded', expect.objectContaining({ learners: 2, ms: expect.any(Number) }));
  });

  it('isolates a failing source to that learner and that source, as null', async () => {
    const ledger = vi.fn(async (id) => { if (id === 'kid1') throw new Error('ledger down'); return [earn({})]; });
    const rings = vi.fn(async ({ learnerId }) => { if (learnerId === 'kid2') throw new Error('rings down'); return 2; });
    const log = logger();
    const service = new LearnerWinsService({ ledger, rings, logger: log });

    const result = await service.execute({ learnerIds: ['kid1', 'kid2'], dates: DATES, ...WINDOW });

    expect(result.kid1).toEqual({ week: { silver: null, gems: null, rings: 2 }, allTime: { silver: null, gems: null, rings: 2 } });
    expect(result.kid2).toEqual({ week: { silver: 10, gems: 0, rings: null }, allTime: { silver: 10, gems: 0, rings: null } });
    expect(log.warn).toHaveBeenCalledWith('weekly-review.wins.source-failed', { learnerId: 'kid1', source: 'ledger', error: 'ledger down' });
    expect(log.warn).toHaveBeenCalledWith('weekly-review.wins.source-failed', { learnerId: 'kid2', source: 'rings', error: 'rings down' });
  });

  it('reads null for a source that is not wired', async () => {
    const service = new LearnerWinsService({ ledger: null, rings: null, logger: logger() });
    const result = await service.execute({ learnerIds: ['kid1'], dates: DATES, ...WINDOW });
    expect(result).toEqual({ kid1: { week: { silver: null, gems: null, rings: null }, allTime: { silver: null, gems: null, rings: null } } });
  });

  it('remembers all-time rings per learner and last date for a while, then asks again', async () => {
    const { clock, advance } = clockAt(Date.parse('2026-11-22T20:00:00Z'));
    const rings = vi.fn(async ({ from }) => (from === '2000-01-01' ? 40 : 3));
    const service = new LearnerWinsService({ ledger: async () => [], rings, logger: logger(), clock, allTimeTtlMs: 60_000 });
    const args = { learnerIds: ['kid1'], dates: DATES, ...WINDOW };

    await service.execute(args);
    await service.execute(args);
    const allTimeCalls = () => rings.mock.calls.filter(([a]) => a.from === '2000-01-01').length;
    expect(allTimeCalls()).toBe(1);
    expect(rings.mock.calls.filter(([a]) => a.from === '2026-11-15')).toHaveLength(2);

    advance(61_000);
    await service.execute(args);
    expect(allTimeCalls()).toBe(2);
  });

  it('does not remember a failed all-time rings read', async () => {
    let fail = true;
    const rings = vi.fn(async ({ from }) => { if (from === '2000-01-01' && fail) throw new Error('x'); return 4; });
    const service = new LearnerWinsService({ ledger: async () => [], rings, logger: logger() });
    const args = { learnerIds: ['kid1'], dates: DATES, ...WINDOW };
    expect((await service.execute(args)).kid1.allTime.rings).toBeNull();
    fail = false;
    expect((await service.execute(args)).kid1.allTime.rings).toBe(4);
  });

  it('is empty for no learners or no dates', async () => {
    const service = new LearnerWinsService({ ledger: async () => [], rings: async () => 0, logger: logger() });
    expect(await service.execute({ learnerIds: [], dates: DATES, ...WINDOW })).toEqual({});
    expect(await service.execute({ learnerIds: ['kid1'], dates: [], ...WINDOW })).toEqual({});
  });
});
