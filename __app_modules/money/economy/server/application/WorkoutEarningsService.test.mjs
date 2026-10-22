// @vitest-environment node
import { describe, it, expect } from 'vitest';
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

function make({ learners, balances = {}, history = {}, mode = 'live', contestClosed = false, failWallet = null }) {
  return new WorkoutEarningsService({
    preview: { async roster() { return { contestClosed, learners }; } },
    economy: {
      hasUser: (id) => id in balances,
      async peekBalance(id) { if (id === failWallet) throw new Error('boom'); return balances[id]; },
      async getHistory(id) { return history[id] ?? []; },
    },
    config: { catalog: () => ({ mode }) },
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
      { learnerId: 'learner-a', learnerName: 'Learner A', silver: 9, weekRings: 400, gem: 'leading' },
      { learnerId: 'learner-b', learnerName: 'Learner B', silver: 2, weekRings: 100, gem: null },
    ] });
  });

  it('marks the gem won once the contest line is earned', async () => {
    const learners = [{ learnerId: 'learner-a', learnerName: 'Learner A', lines: [ringLine('learner-a', []), contestLine('learner-a', 'earned', true)] }];
    const res = await make({ learners, balances: { 'learner-a': { silver: 0, gold: 0, gems: 0 } }, contestClosed: true }).standings();
    expect(res.learners[0].gem).toBe('won');
  });
});
