// @vitest-environment node
import { describe, it, expect, vi } from 'vitest';
import { WorkoutEarningsService, workoutGain } from './WorkoutEarningsService.mjs';

const PRICED = { rate: { rings: 100, silver: 1 }, thresholds: [{ at: 250, reward: { silver: 2, gems: 0 } }, { at: 500, reward: { silver: 3, gems: 1 } }], multiplier: 1 };
const session = (sessionId, endMs, rings, final = true) => ({ sessionId, startMs: endMs - 1000, endMs, rings, final });
const ringLine = (learnerId, sessions, extra = {}) => ({
  ruleId: 'rings', kind: 'ring-threshold', status: 'earned', ref: `earn:${learnerId}:rings:2026-10-19:on-time`,
  priced: PRICED, count: sessions.reduce((s, x) => s + x.rings, 0), sessions,
  amount: { silver: 0, gems: 0 }, ...extra,
});
const contestLine = (learnerId, status, leader) => ({ ruleId: 'ring-contest', kind: 'ring-contest', status, leader, ref: `earn:${learnerId}:ring-contest:2026-10-19:on-time` });
const silent = { info() {}, warn() {}, error() {}, debug() {} };

function make({ rosters = null, learners, balances = {}, history = {}, mode = 'live', contestClosed = false, failWallet = null, gemBoard = null }) {
  return new WorkoutEarningsService({
    preview: { async roster({ week } = {}) { return rosters ? rosters(week) : { contestClosed, learners }; } },
    economy: {
      hasUser: (id) => id in balances,
      async peekBalance(id) { if (id === failWallet) throw new Error('boom'); return balances[id]; },
      async getHistory(id) { return history[id] ?? []; },
    },
    config: { catalog: () => ({ mode }) },
    gemBoard,
    logger: silent,
  });
}

describe('workoutGain', () => {
  it('prices the session at the running total, in end order, counting it even if not final', () => {
    // 180 rings before (1 silver), +120 crosses 250 (2 + threshold 2) → 300 total = 3 + 2 = 5; gained 5 − 1 = 4.
    const line = ringLine('learner-a', [session('s2', 2000, 120, false), session('s1', 1000, 180)]);
    expect(workoutGain(line, 's2')).toEqual({ rings: 120, gained: { silver: 4, gems: 0 }, nextCoinIn: null });
  });

  it('says how far the next coin is when the ride earned nothing', () => {
    const line = ringLine('learner-a', [session('s1', 1000, 140), session('s2', 2000, 30)]);
    expect(workoutGain(line, 's2')).toEqual({ rings: 30, gained: { silver: 0, gems: 0 }, nextCoinIn: 30 });
  });

  it('carries gems a threshold pays', () => {
    const line = ringLine('learner-a', [session('s1', 1000, 450), session('s2', 2000, 60)]);
    expect(workoutGain(line, 's2').gained).toEqual({ silver: 4, gems: 1 });
  });

  it('finds the ride by the live fs_-prefixed id or the bare saved id', () => {
    const line = ringLine('learner-a', [session('20261029193815', 1000, 180)]);
    expect(workoutGain(line, 'fs_20261029193815')).toEqual(workoutGain(line, '20261029193815'));
    expect(workoutGain(line, 'fs_20261029193815')?.rings).toBe(180);
    const prefixedLine = ringLine('learner-a', [session('fs_20261029193815', 1000, 180)]);
    expect(workoutGain(prefixedLine, '20261029193815')?.rings).toBe(180);
  });

  it('is null when the session is not on the line', () => {
    expect(workoutGain(ringLine('learner-a', [session('s1', 1000, 50)]), 'nope')).toBeNull();
    expect(workoutGain(null, 's1')).toBeNull();
  });
});

describe('WorkoutEarningsService.workout', () => {
  const learners = [
    { learnerId: 'learner-a', learnerName: 'Learner A', lines: [ringLine('learner-a', [session('s1', 1000, 180), session('s2', 2000, 120, false)], { amount: { silver: 5, gems: 0 } })] },
    { learnerId: 'learner-b', learnerName: 'Learner B', lines: [ringLine('learner-b', [session('s9', 1000, 300)], { amount: { silver: 5, gems: 0 } })] },
    { learnerId: 'learner-c', learnerName: 'Learner C', lines: [] },
  ];

  it('lists only learners in the session, with the projected total', async () => {
    const svc = make({
      learners,
      balances: { 'learner-a': { silver: 20, gold: 0, gems: 0 }, 'learner-b': { silver: 3, gold: 0, gems: 0 }, 'learner-c': { silver: 0, gold: 0, gems: 0 } },
      // 1 silver already paid under the ring ref (s1); 4 still to land.
      history: { 'learner-a': [{ kind: 'earn', currency: 'silver', ref: 'earn:learner-a:rings:2026-10-19:on-time', delta: 1 }] },
    });
    const res = await svc.workout('s2');
    expect(res.mode).toBe('live');
    expect(res.learners).toEqual([{ learnerId: 'learner-a', learnerName: 'Learner A', rings: 120, gained: { silver: 4, gems: 0 }, total: { silver: 24 }, nextCoinIn: null }]);
  });

  it('accepts the fs_-prefixed id the coin ceremony sends (audit 2026-10-29)', async () => {
    const svc = make({
      learners,
      balances: { 'learner-a': { silver: 20, gold: 0, gems: 0 } },
      history: { 'learner-a': [{ kind: 'earn', currency: 'silver', ref: 'earn:learner-a:rings:2026-10-19:on-time', delta: 1 }] },
    });
    const bare = await svc.workout('s2');
    const prefixed = await svc.workout('fs_s2');
    expect(prefixed.learners).toEqual(bare.learners);
    expect(prefixed.learners).toHaveLength(1);
  });

  it('total is just the wallet once the payout has minted', async () => {
    const svc = make({
      learners,
      balances: { 'learner-a': { silver: 25, gold: 0, gems: 0 } },
      history: { 'learner-a': [{ kind: 'earn', currency: 'silver', ref: 'earn:learner-a:rings:2026-10-19:on-time', delta: 5 }] },
    });
    expect((await svc.workout('s2')).learners[0].total).toEqual({ silver: 25 });
  });

  it('omits a learner with no wallet or a failing wallet, and returns nothing when off', async () => {
    expect((await make({ learners, balances: {} }).workout('s2')).learners).toEqual([]);
    expect((await make({ learners, balances: { 'learner-a': {} }, failWallet: 'learner-a' }).workout('s2')).learners).toEqual([]);
    expect(await make({ learners, mode: 'off' }).workout('s2')).toEqual({ sessionId: 's2', mode: 'off', learners: [] });
  });
});

describe('WorkoutEarningsService.standings', () => {
  it('reports wallet silver, week rings, and the gem state', async () => {
    const learners = [
      { learnerId: 'learner-a', learnerName: 'Learner A', lines: [ringLine('learner-a', [session('s1', 1, 400)]), contestLine('learner-a', 'pending', true)] },
      { learnerId: 'learner-b', learnerName: 'Learner B', lines: [ringLine('learner-b', [session('s2', 1, 100)]), contestLine('learner-b', 'pending', false)] },
      { learnerId: 'learner-c', learnerName: 'Learner C', lines: [] },
    ];
    const svc = make({ learners, balances: { 'learner-a': { silver: 9, gold: 0, gems: 1 }, 'learner-b': { silver: 2, gold: 0, gems: 0 } } });
    const res = await svc.standings();
    expect(res).toEqual({ mode: 'live', contestClosed: false, learners: [
      { learnerId: 'learner-a', learnerName: 'Learner A', silver: 9, weekRings: 400, gem: 'leading', gems: [] },
      { learnerId: 'learner-b', learnerName: 'Learner B', silver: 2, weekRings: 100, gem: null, gems: [] },
    ] });
  });

  it('marks the gem won once the contest line is earned', async () => {
    const learners = [{ learnerId: 'learner-a', learnerName: 'Learner A', lines: [ringLine('learner-a', []), contestLine('learner-a', 'earned', true)] }];
    const res = await make({ learners, balances: { 'learner-a': { silver: 0, gold: 0, gems: 0 } }, contestClosed: true }).standings();
    expect(res.learners[0].gem).toBe('won');
  });

  it('purse.gems rolls up held gems (earned + leads) by area', async () => {
    const learners = [{ learnerId: 'learner-a', learnerName: 'Learner A', lines: [] }, { learnerId: 'learner-b', learnerName: 'Learner B', lines: [] }];
    const gemBoard = { async board() { return {
      categories: [
        { id: 'games-row', label: 'Games', group: 'games', area: 'games', color: '#ff7a2f' },
        { id: 'school-row', label: 'Worksheets', group: 'school', area: 'school', color: '#2e9e5b' },
        { id: 'move-won', label: 'Ring contests', group: 'move', area: 'move', color: '#8e5bd0' },
        { id: 'move-days', label: 'Moved 5 days', group: 'move', area: 'move', color: '#8e5bd0' },
      ],
      cells: {
        'move-won': { 'learner-a': { state: 'won', week: 2, held: 2, streak: null, parts: [] } },
        'move-days': {
          'learner-a': { state: 'pending', week: 0, held: 0, streak: { have: 3, need: 5, left: 2, reach: 'on-track', ruleId: 'moved-days' }, parts: [] },
          'learner-b': { state: 'pending', week: 0, held: 0, streak: { have: 1, need: 5, left: 4, reach: 'on-track', ruleId: 'moved-days' }, parts: [] },
        },
        'school-row': { 'learner-a': { state: 'earned', week: 1, held: 1, streak: null, parts: [] } },
        // A lead holds a contest gem: held 1 though nothing is paid yet.
        'games-row': { 'learner-a': { state: 'leading', week: 0, held: 1, streak: null, parts: [] }, 'learner-b': { state: 'none', week: 0, held: 0, streak: null, parts: [] } },
      },
    }; } };
    const res = await make({ learners, balances: { 'learner-a': { silver: 1, gold: 0, gems: 0 }, 'learner-b': { silver: 0, gold: 0, gems: 0 } }, gemBoard }).standings();
    expect(res.learners[0].gems).toEqual([{ area: 'move', held: 2, color: '#8e5bd0' }, { area: 'school', held: 1, color: '#2e9e5b' }, { area: 'games', held: 1, color: '#ff7a2f' }]);
    expect(res.learners[0]).not.toHaveProperty('move');
    // In progress and zero hold no gem: a child with none gets an empty list.
    expect(res.learners[1].gems).toEqual([]);
  });

  it('still reports silver when the Gem Board cannot be read', async () => {
    const learners = [{ learnerId: 'learner-a', learnerName: 'Learner A', lines: [] }];
    const gemBoard = { async board() { throw new Error('boom'); } };
    const res = await make({ learners, balances: { 'learner-a': { silver: 4, gold: 0, gems: 0 } }, gemBoard }).standings();
    expect(res.learners).toEqual([{ learnerId: 'learner-a', learnerName: 'Learner A', silver: 4, weekRings: 0, gem: null, gems: [] }]);
  });
});

describe('WorkoutEarningsService.paid', () => {
  const payout = (id, delta, sessionId, rings, over = {}) => ({ id, kind: 'earn', currency: 'silver', delta, source: 'payout', at: '2026-10-20T10:00:00.000Z', ref: 'r', meta: { kind: 'ring-threshold', count: rings, session: { id: sessionId, rings } }, ...over });
  const learners = [
    { learnerId: 'learner-a', learnerName: 'Learner A', lines: [ringLine('learner-a', [session('20261020100000', 1000, 180), session('20261020090000', 500, 50)])] },
    { learnerId: 'learner-b', learnerName: 'Learner B', lines: [ringLine('learner-b', [session('20261020100000', 1000, 90)])] },
    { learnerId: 'learner-c', learnerName: 'Learner C', lines: [ringLine('learner-c', [session('other', 1000, 90)])] },
  ];
  const balances = { 'learner-a': { silver: 7 }, 'learner-b': { silver: 0 }, 'learner-c': { silver: 1 } };
  const history = {
    'learner-a': [
      payout('t2', 2, 'fs_20261020100000', 180),
      payout('t1', 1, '20261020090000', 50),
      payout('tg', 1, '20261020100000', 180, { currency: 'gems' }),
      payout('tw', 5, '20261020100000', 180, { source: 'admin' }),
      payout('tc', 3, '20261020100000', 180, { meta: { kind: 'ring-contest', session: { id: '20261020100000' } } }),
    ],
    'learner-b': [],
  };

  it('lists the ring payout entries of this workout only, per learner in it, with the wallet', async () => {
    const res = await make({ learners, balances, history }).paid('20261020100000');
    expect(res).toEqual({
      sessionId: '20261020100000', mode: 'live',
      learners: [
        { learnerId: 'learner-a', learnerName: 'Learner A', entries: [{ txnId: 't2', silver: 2, gems: 1, at: '2026-10-20T10:00:00.000Z', rings: 180 }], wallet: { silver: 7 } },
        { learnerId: 'learner-b', learnerName: 'Learner B', entries: [], wallet: { silver: 0 } },
      ],
    });
  });

  it('a step that paid only gems is an entry of its own, silver 0', async () => {
    const res = await make({ learners, balances, history: { 'learner-a': [payout('tg9', 2, '20261020100000', 180, { currency: 'gems' })] } }).paid('20261020100000');
    expect(res.learners[0].entries).toEqual([{ txnId: 'tg9', silver: 0, gems: 2, at: '2026-10-20T10:00:00.000Z', rings: 180 }]);
  });

  it('resolves riders from the session record and prices only them', async () => {
    const preview = vi.fn(async ({ learnerId }) => learners.find((l) => l.learnerId === learnerId));
    const roster = vi.fn(async () => ({ learners }));
    const svc = new WorkoutEarningsService({
      preview: { roster, preview, currentStudyDay: () => '2026-10-20' },
      economy: { hasUser: () => true, peekBalance: async (id) => balances[id], getHistory: async (id) => history[id] ?? [] },
      config: { catalog: () => ({ mode: 'live' }) },
      participants: async () => ['learner-a'],
      logger: silent,
    });
    const res = await svc.paid('20261020100000');
    expect(roster).not.toHaveBeenCalled();
    expect(preview).toHaveBeenCalledTimes(1);
    expect(res.learners.map((l) => l.learnerId)).toEqual(['learner-a']);
    expect(res.learners[0].entries.map((e) => e.txnId)).toEqual(['t2']);
  });

  it('falls back to the roster when the session record cannot say', async () => {
    const roster = vi.fn(async () => ({ learners }));
    const svc = new WorkoutEarningsService({
      preview: { roster },
      economy: { hasUser: () => true, peekBalance: async (id) => balances[id], getHistory: async (id) => history[id] ?? [] },
      config: { catalog: () => ({ mode: 'live' }) },
      participants: async () => { throw new Error('gone'); },
      logger: silent,
    });
    const res = await svc.paid('20261020100000');
    expect(roster).toHaveBeenCalledTimes(1);
    expect(res.learners.map((l) => l.learnerId)).toEqual(['learner-a', 'learner-b']);
  });

  it('catalog off: mode off, no learners', async () => {
    expect(await make({ learners, balances, history, mode: 'off' }).paid('20261020100000')).toEqual({ sessionId: '20261020100000', mode: 'off', learners: [] });
  });

  it('a ride from last award week (final after the Monday rollover) is found there', async () => {
    const lastWeek = [{ learnerId: 'learner-a', learnerName: 'Learner A', lines: [ringLine('learner-a', [session('20260927200000', 1000, 120)])] }];
    const seen = [];
    const svc = make({
      balances, history: { 'learner-a': [payout('t1', 1, '20260927200000', 120)] },
      rosters: (week) => { seen.push(week); return week ? { today: '2026-09-28', learners: lastWeek } : { today: '2026-09-28', learners: [] }; },
    });
    const res = await svc.paid('20260927200000');
    expect(seen).toEqual([null, '2026-09-21']);
    expect(res.learners.map((l) => [l.learnerId, l.entries.map((e) => e.txnId)])).toEqual([['learner-a', ['t1']]]);
  });
});
