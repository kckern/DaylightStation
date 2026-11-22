// tests/isolated/application/weekly-review/LearnerWinsService.test.mjs
import { describe, it, expect, vi } from 'vitest';
import { LearnerWinsService } from '../../../../__app_modules/personal/weekly-review/server/application/LearnerWinsService.mjs';

const DATES = ['2026-11-15', '2026-11-16', '2026-11-17', '2026-11-18', '2026-11-19', '2026-11-20', '2026-11-21', '2026-11-22'];
// 04:00 PST on 2026-11-15 to 04:00 PST on 2026-11-23.
const START = Date.parse('2026-11-15T12:00:00Z');
const END = Date.parse('2026-11-23T12:00:00Z');
const DAY = 86_400_000;
const WINDOW = { windowStartMs: START, windowEndMs: END };
const ALL_TIME_FROM = Date.parse('2000-01-01T00:00:00Z');
const logger = () => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() });
const earn = (o) => ({ kind: 'earn', currency: 'silver', delta: 10, source: 'payout', action: 'payout:piano-daily', at: '2026-11-18T20:00:00Z', ...o });

/** A fake of the fitness provider's `standings`, over a fixed list of sessions. */
function standingsOver(sessions) {
  return vi.fn(async ({ learnerIds, fromMs, toMs }) => learnerIds.map((learnerId) => ({
    learnerId,
    rings: 0,
    sessions: sessions.filter(s => s.learnerId === learnerId && s.startMs >= fromMs && s.startMs < toMs).map(({ startMs, rings }) => ({ startMs, rings })),
  })));
}

function clockAt(ms) {
  let now = ms;
  return { clock: () => new Date(now), advance: (d) => { now += d; } };
}

describe('LearnerWinsService', () => {
  it('sums each learner\'s earned silver and gems and their rings for the week and all time', async () => {
    const ledger = vi.fn(async (id) => (id === 'kid1'
      ? [earn({}), earn({ currency: 'gems', delta: 1 }), earn({ delta: 5, at: '2026-01-01T20:00:00Z' }), earn({ kind: 'convert', delta: -140 })]
      : null));
    const ringStandings = standingsOver([
      { learnerId: 'kid1', startMs: Date.parse('2026-11-18T18:00:00Z'), rings: 3 },
      { learnerId: 'kid1', startMs: Date.parse('2025-03-01T18:00:00Z'), rings: 37 },
    ]);
    const log = logger();
    const service = new LearnerWinsService({ ledger, ringStandings, logger: log });

    const result = await service.execute({ learnerIds: ['kid2', 'kid1'], dates: DATES, ...WINDOW });

    expect(result).toEqual({
      kid1: { week: { silver: 10, gems: 1, rings: 3 }, allTime: { silver: 15, gems: 1, rings: 40 } },
      kid2: { week: { silver: 0, gems: 0, rings: 0 }, allTime: { silver: 0, gems: 0, rings: 0 } },
    });
    // One listing for the whole roster per span, each asked one day past the window.
    expect(ringStandings).toHaveBeenCalledTimes(2);
    expect(ringStandings).toHaveBeenCalledWith({ learnerIds: ['kid1', 'kid2'], fromMs: START, toMs: END + DAY });
    expect(ringStandings).toHaveBeenCalledWith({ learnerIds: ['kid1', 'kid2'], fromMs: ALL_TIME_FROM, toMs: END + DAY });
    expect(log.info).toHaveBeenCalledWith('weekly-review.wins.loaded', expect.objectContaining({ learners: 2, ms: expect.any(Number) }));
  });

  it('counts a workout started after midnight the morning after the last date, and nothing from 04:00 on', async () => {
    // 2026-11-23 01:30 PST is study day 2026-11-22 (the window's last date) but sits in the 23rd's folder.
    const ringStandings = standingsOver([
      { learnerId: 'kid1', startMs: Date.parse('2026-11-23T09:30:00Z'), rings: 4 },
      { learnerId: 'kid1', startMs: END, rings: 100 },
      { learnerId: 'kid1', startMs: START - 1, rings: 1000 },
    ]);
    const service = new LearnerWinsService({ ledger: async () => [], ringStandings, logger: logger() });
    const { kid1 } = await service.execute({ learnerIds: ['kid1'], dates: DATES, ...WINDOW });
    expect(kid1.week.rings).toBe(4);
    expect(kid1.allTime.rings).toBe(1004);
  });

  it('isolates a failing ledger to that learner, and a failing ring listing to rings', async () => {
    const ledger = vi.fn(async (id) => { if (id === 'kid1') throw new Error('ledger down'); return [earn({})]; });
    const ringStandings = vi.fn(async () => { throw new Error('rings down'); });
    const log = logger();
    const service = new LearnerWinsService({ ledger, ringStandings, logger: log });

    const result = await service.execute({ learnerIds: ['kid1', 'kid2'], dates: DATES, ...WINDOW });

    expect(result.kid1).toEqual({ week: { silver: null, gems: null, rings: null }, allTime: { silver: null, gems: null, rings: null } });
    expect(result.kid2).toEqual({ week: { silver: 10, gems: 0, rings: null }, allTime: { silver: 10, gems: 0, rings: null } });
    expect(log.warn).toHaveBeenCalledWith('weekly-review.wins.source-failed', { learnerId: 'kid1', source: 'ledger', error: 'ledger down' });
    expect(log.warn).toHaveBeenCalledWith('weekly-review.wins.source-failed', { learnerIds: ['kid1', 'kid2'], source: 'rings', error: 'rings down' });
  });

  it('reads null for a source that is not wired', async () => {
    const service = new LearnerWinsService({ ledger: null, ringStandings: null, logger: logger() });
    const result = await service.execute({ learnerIds: ['kid1'], dates: DATES, ...WINDOW });
    expect(result).toEqual({ kid1: { week: { silver: null, gems: null, rings: null }, allTime: { silver: null, gems: null, rings: null } } });
  });

  it('shares in-flight reads between requests at once', async () => {
    let release;
    const gate = new Promise(r => { release = r; });
    const ledger = vi.fn(async () => { await gate; return [earn({})]; });
    const ringStandings = vi.fn(async ({ learnerIds }) => { await gate; return learnerIds.map(learnerId => ({ learnerId, sessions: [] })); });
    const service = new LearnerWinsService({ ledger, ringStandings, logger: logger() });
    const args = { learnerIds: ['kid1'], dates: DATES, ...WINDOW };

    const both = Promise.all([service.execute(args), service.execute(args)]);
    release();
    const [a, b] = await both;
    expect(a).toEqual(b);
    expect(ledger).toHaveBeenCalledTimes(1);
    expect(ringStandings).toHaveBeenCalledTimes(2); // week + all time, once each
  });

  it('keeps the ledger and week rings for a minute and all-time rings for ten', async () => {
    const { clock, advance } = clockAt(Date.parse('2026-11-22T20:00:00Z'));
    const ledger = vi.fn(async () => []);
    const ringStandings = standingsOver([]);
    const service = new LearnerWinsService({ ledger, ringStandings, logger: logger(), clock });
    const args = { learnerIds: ['kid1'], dates: DATES, ...WINDOW };
    const allTimeCalls = () => ringStandings.mock.calls.filter(([a]) => a.fromMs === ALL_TIME_FROM).length;
    const weekCalls = () => ringStandings.mock.calls.filter(([a]) => a.fromMs === START).length;

    await service.execute(args);
    await service.execute(args);
    expect([ledger.mock.calls.length, weekCalls(), allTimeCalls()]).toEqual([1, 1, 1]);

    advance(61_000);
    await service.execute(args);
    expect([ledger.mock.calls.length, weekCalls(), allTimeCalls()]).toEqual([2, 2, 1]);

    advance(10 * 60_000);
    await service.execute(args);
    expect([ledger.mock.calls.length, weekCalls(), allTimeCalls()]).toEqual([3, 3, 2]);
  });

  it('forgets a failed read at once', async () => {
    let fail = true;
    const ledger = vi.fn(async () => { if (fail) throw new Error('x'); return [earn({})]; });
    const service = new LearnerWinsService({ ledger, ringStandings: null, logger: logger() });
    const args = { learnerIds: ['kid1'], dates: DATES, ...WINDOW };
    expect((await service.execute(args)).kid1.week.silver).toBeNull();
    fail = false;
    expect((await service.execute(args)).kid1.week.silver).toBe(10);
  });

  it('evicts the least recently used entry past the size cap', async () => {
    const ledger = vi.fn(async () => []);
    const service = new LearnerWinsService({ ledger, ringStandings: null, logger: logger(), maxEntries: 2 });
    const run = (id) => service.execute({ learnerIds: [id], dates: DATES, ...WINDOW });
    await run('a'); await run('b'); await run('a'); await run('c'); // b is evicted, a stays
    await run('a');
    expect(ledger.mock.calls.map(([id]) => id)).toEqual(['a', 'b', 'c']);
    await run('b');
    expect(ledger.mock.calls.map(([id]) => id)).toEqual(['a', 'b', 'c', 'b']);
  });

  it('is empty for no learners, no dates or no window', async () => {
    const service = new LearnerWinsService({ ledger: async () => [], ringStandings: standingsOver([]), logger: logger() });
    expect(await service.execute({ learnerIds: [], dates: DATES, ...WINDOW })).toEqual({});
    expect(await service.execute({ learnerIds: ['kid1'], dates: [], ...WINDOW })).toEqual({});
    expect(await service.execute({ learnerIds: ['kid1'], dates: DATES })).toEqual({});
  });
});

describe('LearnerWinsService over the real fitness rings provider', () => {
  it('finds a 01:30 workout filed under the next day\'s folder, which the provider alone would miss', async () => {
    const { createFitnessRingsProvider } = await import('../../../../__app_modules/wellness/fitness/server/application/measures/fitnessRingsProvider.mjs');
    const { studyDayFor, isInWindow } = await import('../../../../__app_modules/learning/school/server/study-calendar.mjs');
    const tz = 'America/Los_Angeles';
    // The store lists by the folder a session was filed under: its local calendar date.
    const filed = [
      { date: '2026-11-23', sessionId: 's1', startTime: Date.parse('2026-11-23T09:30:00Z'), finalized: true, participants: { kid1: { rings: 4 } } },
      { date: '2026-11-18', sessionId: 's2', startTime: Date.parse('2026-11-18T18:00:00Z'), finalized: true, participants: { kid1: { rings: 2 } } },
    ];
    const listSessions = vi.fn(async ({ from, to }) => filed.filter(s => s.date >= from && s.date <= to));
    const provider = createFitnessRingsProvider({ sessions: { listSessions }, timezone: tz, studyDayFor, isInWindow });

    // The provider asked for the window as-is stops at the 22nd's folder.
    const bare = await provider.standings({ learnerIds: ['kid1'], fromMs: START, toMs: END });
    expect(bare[0].rings).toBe(2);

    const service = new LearnerWinsService({ ledger: null, ringStandings: (a) => provider.standings(a), logger: logger() });
    const { kid1 } = await service.execute({ learnerIds: ['kid1'], dates: DATES, ...WINDOW });
    expect(kid1.week.rings).toBe(6);
    expect(kid1.allTime.rings).toBe(6);
  });
});
