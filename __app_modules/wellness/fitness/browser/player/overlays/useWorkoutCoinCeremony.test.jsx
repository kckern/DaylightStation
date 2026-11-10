import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';

const api = vi.fn();
vi.mock('@/lib/api.mjs', () => ({ DaylightAPI: (...a) => api(...a) }));
let wsHandler = null;
vi.mock('@/hooks/useWebSocket.js', () => ({ useWebSocketSubscription: (_f, cb) => { wsHandler = cb; } }));
const logSpy = { info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() };
vi.mock('@/lib/logging/Logger.js', () => ({ default: () => ({ child: () => logSpy }) }));

import { useWorkoutCoinCeremony, WORKOUT_FINISHED_EVENT, announceWorkoutFinished, __resetShownForTest } from './useWorkoutCoinCeremony.js';

const fire = (sessionId) => act(async () => { window.dispatchEvent(new CustomEvent(WORKOUT_FINISHED_EVENT, { detail: { sessionId } })); });
const iso = (msAgo = 60_000) => new Date(Date.now() - msAgo).toISOString();
const entry = (txnId, silver, msAgo) => ({ txnId, silver, at: iso(msAgo), rings: 120 });
const learner = (id, entries, wallet) => ({ learnerId: id, learnerName: id.toUpperCase(), entries, wallet: { silver: wallet } });

// Server stand-in: sessions list + per-session /paid bodies.
let sessions; let paid;
function serve() {
  api.mockImplementation(async (url) => {
    if (url.startsWith('/api/v1/fitness/sessions')) return { sessions: sessions.map((sessionId) => ({ sessionId })) };
    const m = url.match(/^\/api\/v1\/earnings\/workout\/([^/]+)\/paid$/);
    if (m) return { sessionId: m[1], mode: 'live', learners: paid[m[1]] || [] };
    throw new Error(`unexpected ${url}`);
  });
}
const mount = async () => {
  const hook = renderHook(() => useWorkoutCoinCeremony());
  await act(async () => { await Promise.resolve(); });
  return hook;
};

describe('useWorkoutCoinCeremony', () => {
  beforeEach(() => { api.mockReset(); localStorage.clear(); __resetShownForTest(); logSpy.info.mockClear(); wsHandler = null; sessions = ['s1']; paid = {}; serve(); });
  afterEach(() => vi.useRealTimers());

  it('plays an unseen minted payout on load, from the ledger entries and wallet', async () => {
    paid.s1 = [learner('learner-a', [entry('t1', 2, 5000), entry('t2', 1, 3000)], 27)];
    const { result } = await mount();
    await waitFor(() => expect(result.current.ceremony).not.toBeNull());
    expect(result.current.ceremony.sessionId).toBe('s1');
    expect(result.current.ceremony.txnIds).toEqual(['t1', 't2']);
    expect(result.current.ceremony.learners[0]).toMatchObject({ learnerId: 'learner-a', gained: { silver: 3 }, total: { silver: 27 } });
  });

  it('never calls the projection endpoint', async () => {
    paid.s1 = [learner('learner-a', [entry('t1', 2, 5000)], 9)];
    const { result } = await mount();
    await fire('s1');
    await waitFor(() => expect(result.current.ceremony).not.toBeNull());
    const urls = api.mock.calls.map((c) => c[0]);
    expect(urls.filter((u) => /\/earnings\/workout\/[^/]+$/.test(u))).toEqual([]);
  });

  it('shows no +N card when a closed workout minted nothing', async () => {
    paid.s1 = [learner('learner-a', [], 5)];
    const { result } = await mount();
    await fire('s1');
    expect(result.current.ceremony).toBeNull();
    expect(api).toHaveBeenCalledWith('/api/v1/earnings/workout/s1/paid');
  });

  it('a reload does not replay what was already shown', async () => {
    paid.s1 = [learner('learner-a', [entry('t1', 2, 5000)], 9)];
    const first = await mount();
    await waitFor(() => expect(first.result.current.ceremony).not.toBeNull());
    first.unmount();
    const second = await mount();
    await fire('s1');
    expect(second.result.current.ceremony).toBeNull();
  });

  it('ignores entries older than 7 days and survives unusable storage', async () => {
    paid.s1 = [learner('learner-a', [entry('old', 2, 8 * 86_400_000)], 9)];
    const { result } = await mount();
    expect(result.current.ceremony).toBeNull();
    paid.s1 = [learner('learner-a', [entry('t9', 2, 1000)], 9)];
    const spy = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('denied'); });
    try {
      await fire('s1');
      await waitFor(() => expect(result.current.ceremony?.txnIds).toEqual(['t9']));
    } finally { spy.mockRestore(); }
  });

  it('with unusable storage, two triggers still make a single ceremony', async () => {
    paid.s1 = [learner('learner-a', [entry('t1', 2, 5000)], 9)];
    const get = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('denied'); });
    const set = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('denied'); });
    try {
      const { result } = await mount();
      await waitFor(() => expect(result.current.ceremony).not.toBeNull());
      act(() => result.current.dismiss());
      await fire('s1');
      await fire('s1');
      expect(result.current.ceremony).toBeNull();
    } finally { get.mockRestore(); set.mockRestore(); }
  });

  it('coins-changed for a learner fetches their recent sessions and shows only unseen entries', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    paid.s1 = [learner('learner-a', [entry('t1', 2, 5000)], 9), learner('learner-b', [entry('t5', 1, 5000)], 4)];
    const { result } = await mount();
    await waitFor(() => expect(result.current.ceremony).not.toBeNull());
    act(() => result.current.dismiss());
    paid.s1 = [learner('learner-a', [entry('t1', 2, 5000), entry('t3', 1, 100)], 10), learner('learner-b', [entry('t5', 1, 5000)], 4)];
    await act(async () => { wsHandler({ event: 'coins-changed', userId: 'learner-a' }); await vi.advanceTimersByTimeAsync(2000); });
    await waitFor(() => expect(result.current.ceremony).not.toBeNull());
    expect(result.current.ceremony.txnIds).toEqual(['t3']);
    expect(result.current.ceremony.learners).toHaveLength(1);
    expect(result.current.ceremony.learners[0]).toMatchObject({ gained: { silver: 1 }, total: { silver: 10 } });
  });

  it('two learners paid for one workout share one ceremony, a card each', async () => {
    paid.s1 = [learner('learner-a', [entry('t1', 2, 5000)], 9), learner('learner-b', [entry('t2', 3, 4000)], 14)];
    const { result } = await mount();
    await waitFor(() => expect(result.current.ceremony).not.toBeNull());
    expect(result.current.ceremony.learners.map((l) => [l.learnerId, l.gained.silver, l.total.silver])).toEqual([['learner-a', 2, 9], ['learner-b', 3, 14]]);
  });
});

describe('announceWorkoutFinished', () => {
  it('fires once the session settles, only when the close lands on the finished session', async () => {
    const seen = [];
    const on = (e) => seen.push(e.detail.sessionId);
    window.addEventListener(WORKOUT_FINISHED_EVENT, on);
    try {
      const session = { whenFinalPersistSettled: () => Promise.resolve() };
      await announceWorkoutFinished({ sessionId: 's1', redirect: { view: 'screen' }, session });
      await announceWorkoutFinished({ sessionId: 's2', redirect: { returnToShow: true }, session });
      await announceWorkoutFinished({ sessionId: null, redirect: { view: 'screen' }, session });
      await announceWorkoutFinished({ sessionId: 's3', redirect: null, session });
      // Still fires when the save rejects or there is no session object.
      await announceWorkoutFinished({ sessionId: 's4', redirect: {}, session: { whenFinalPersistSettled: () => Promise.reject(new Error('x')) } });
      await announceWorkoutFinished({ sessionId: 's5', redirect: {}, session: null });
      expect(seen).toEqual(['s1', 's4', 's5']);
    } finally { window.removeEventListener(WORKOUT_FINISHED_EVENT, on); }
  });
});
