import { afterEach, describe, expect, it, vi } from 'vitest';
import { createRewardsCache } from './rewardsCache.js';

const ok = data => ({ ok: true, data });
const week = '2026-11-09';
function fixture() {
  return {
    earningsRoster: vi.fn(async () => ok({ windows: { school: { from: week, to: '2026-11-15' } }, learners: [{ learnerId: 'one', totals: { silver: 24 }, lines: [] }] })),
    wallet: vi.fn(async () => ok({ balances: { gold: 3 } })),
    gems: vi.fn(async () => ok({ mode: 'live', week, groups: [{ id: 'school', label: 'School' }], learners: [{ learnerId: 'one' }], categories: [{ id: 'read', group: 'school', label: 'Reading', color: '#f2c94c' }], cells: { read: { one: { state: 'pending', week: 0, streak: { have: 3, need: 4, reach: 'on-track' } }, other: { state: 'earned', week: 99 } } } })),
    stateGates: vi.fn(async () => ok({ items: [{ evaluation: { gateId: 'fitness.weekly-rings', subject: { kind: 'learner', id: 'one' }, period: { kind: 'interval', startsAt: 0, endsAt: 4102444800000 }, progress: { current: 1260, target: 1 } } }] })),
  };
}
afterEach(() => vi.useRealTimers());

describe('preloaded rewards memory', () => {
  it('publishes a complete prepared personal snapshot only after its reads settle', async () => {
    const api = fixture(); let land;
    api.wallet.mockReturnValue(new Promise(resolve => { land = resolve; }));
    const cache = createRewardsCache(api);
    const loading = cache.refresh(['one']);
    expect(cache.getLearner('one')).toBeUndefined();
    await Promise.resolve(); land(ok({ balances: { gold: 3 } })); await loading;
    expect(cache.getLearner('one')).toMatchObject({ learnerId: 'one', silver: 24, gold: 3, rings: 1260, week });
    expect(cache.getLearner('one').gems).toHaveLength(1);
    expect(JSON.stringify(cache.getLearner('one'))).not.toContain('other');
    expect(api.earningsRoster).toHaveBeenCalledTimes(1);
  });

  it('keeps a captured opening immutable while refreshing memory and retains good data after failures', async () => {
    const api = fixture(); const cache = createRewardsCache(api); await cache.refresh(['one']);
    const opening = cache.getLearner('one');
    api.earningsRoster.mockResolvedValue(ok({ windows: { school: { from: week, to: '2026-11-15' } }, learners: [{ learnerId: 'one', totals: { silver: 30 }, lines: [] }] }));
    await cache.refresh(['one']);
    expect(opening.silver).toBe(24); expect(cache.getLearner('one').silver).toBe(30);
    api.gems.mockRejectedValue(new Error('offline')); api.wallet.mockResolvedValue({ ok: false });
    await cache.refresh(['one']);
    expect(cache.getLearner('one')).toMatchObject({ gold: 3, gems: opening.gems });
    api.gems.mockResolvedValue(ok({})); api.wallet.mockResolvedValue(ok({})); api.stateGates.mockResolvedValue(ok({}));
    await cache.refresh(['one']);
    expect(cache.getLearner('one')).toMatchObject({ gold: 3, rings: 1260, gems: opening.gems });
  });

  it('does not combine different school weeks and drops removed identities', async () => {
    const api = fixture(); const cache = createRewardsCache(api); await cache.refresh(['one']);
    const old = cache.getLearner('one');
    api.earningsRoster.mockResolvedValue(ok({ windows: { school: { from: '2026-11-16', to: '2026-11-22' } }, learners: [{ learnerId: 'one', totals: { silver: 1 }, lines: [] }] }));
    await cache.refresh(['one']);
    expect(cache.getLearner('one')).toBe(old);
    await cache.refresh(['two']); expect(cache.getLearner('one')).toBeUndefined();
    expect(cache.getLearner('two').learnerId).toBe('two');
  });

  it('deduplicates overlapping reads and bounds cold-start failures without false zeroes', async () => {
    vi.useFakeTimers(); const api = fixture();
    api.gems.mockReturnValue(new Promise(() => {}));
    api.wallet.mockResolvedValue({ ok: false });
    const cache = createRewardsCache(api);
    const a = cache.refresh(['one']); const b = cache.refresh(['one']);
    await vi.advanceTimersByTimeAsync(15_000); await Promise.all([a, b]);
    expect(api.gems).toHaveBeenCalledTimes(1);
    expect(cache.getLearner('one')).toMatchObject({ gold: null, silver: 24, gems: [] });
  });

  it('does not carry stale ring totals into a new week when its gate read fails', async () => {
    const api = fixture(); const cache = createRewardsCache(api); await cache.refresh(['one']);
    const nextWeek = '2026-11-16';
    api.earningsRoster.mockResolvedValue(ok({ windows: { school: { from: nextWeek, to: '2026-11-22' } }, learners: [{ learnerId: 'one', totals: { silver: 1 }, lines: [] }] }));
    api.gems.mockResolvedValue(ok({ mode: 'live', week: nextWeek, learners: [{ learnerId: 'one' }], categories: [], cells: {} }));
    api.stateGates.mockResolvedValue({ ok: false });
    await cache.refresh(['one']);
    expect(cache.getLearner('one')).toMatchObject({ week: nextWeek, silver: 1, rings: null });
  });
});
