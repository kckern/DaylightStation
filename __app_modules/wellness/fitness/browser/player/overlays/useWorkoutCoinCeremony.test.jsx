import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';

const api = vi.fn();
vi.mock('@/lib/api.mjs', () => ({ DaylightAPI: (...a) => api(...a) }));
let wsHandler = null;
vi.mock('@/hooks/useWebSocket.js', () => ({ useWebSocketSubscription: (_f, cb) => { wsHandler = cb; } }));
const logSpy = { info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() };
vi.mock('@/lib/logging/Logger.js', () => ({ default: () => ({ child: () => logSpy }) }));

import { useWorkoutCoinCeremony, WORKOUT_FINISHED_EVENT, announceWorkoutFinished, isRunOnScreen, __resetShownForTest } from './useWorkoutCoinCeremony.js';

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
const mount = async (opts) => {
  const hook = renderHook((props) => useWorkoutCoinCeremony(props), { initialProps: opts });
  await act(async () => { await Promise.resolve(); });
  return hook;
};

describe('useWorkoutCoinCeremony', () => {
  beforeEach(() => { api.mockReset(); localStorage.clear(); localStorage.setItem('fitness.coinCeremony.seen', '{}'); __resetShownForTest(); logSpy.debug.mockClear(); logSpy.info.mockClear(); wsHandler = null; sessions = ['s1']; paid = {}; serve(); });
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
    const denied = () => { throw new Error('denied'); };
    vi.stubGlobal('localStorage', { getItem: denied, setItem: denied, removeItem: denied, clear: denied });
    try {
      const { result } = await mount();
      // Unreadable storage is a first run: the mount look baselines, shows nothing.
      expect(result.current.ceremony).toBeNull();
      paid.s1 = [learner('learner-a', [entry('t1', 2, 5000), entry('t2', 1, 1000)], 9)];
      await fire('s1');
      await waitFor(() => expect(result.current.ceremony?.txnIds).toEqual(['t2']));
      act(() => result.current.dismiss());
      await fire('s1');
      await fire('s1');
      expect(result.current.ceremony).toBeNull();
    } finally { vi.unstubAllGlobals(); }
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

describe('first run baseline', () => {
  beforeEach(() => { api.mockReset(); localStorage.clear(); __resetShownForTest(); logSpy.info.mockClear(); wsHandler = null; sessions = ['s1']; paid = {}; serve(); });

  it('empty storage: the mount look shows nothing and stamps every recent payout', async () => {
    paid.s1 = [learner('learner-a', [entry('t1', 2, 5000), entry('t2', 1, 3000)], 9)];
    const { result } = await mount();
    expect(result.current.ceremony).toBeNull();
    expect(logSpy.info).toHaveBeenCalledWith('fitness.coin_ceremony.baselined', { txnIds: ['t1', 't2'] });
    expect(Object.keys(JSON.parse(localStorage.getItem('fitness.coinCeremony.seen')))).toEqual(['t1', 't2']);
  });

  it('a second load with a newly minted entry plays only that one', async () => {
    paid.s1 = [learner('learner-a', [entry('t1', 2, 5000)], 9)];
    const first = await mount();
    first.unmount();
    paid.s1 = [learner('learner-a', [entry('t1', 2, 5000), entry('t2', 1, 1000)], 10)];
    const second = await mount();
    await waitFor(() => expect(second.result.current.ceremony?.txnIds).toEqual(['t2']));
  });

  it('a baseline that finds nothing still records the key, so the next load plays a payout minted in the gap', async () => {
    paid.s1 = [];
    const first = await mount();
    expect(localStorage.getItem('fitness.coinCeremony.seen')).toBe('{}');
    first.unmount();
    paid.s1 = [learner('learner-a', [entry('t1', 2, 1000)], 4)];
    const second = await mount();
    await waitFor(() => expect(second.result.current.ceremony?.txnIds).toEqual(['t1']));
  });

  it('the mount look asks for 2 days, 5 sessions', async () => {
    await mount();
    expect(api).toHaveBeenCalledWith('/api/v1/fitness/sessions?since=2d&limit=5');
  });
});

describe('hold (a live run on screen)', () => {
  beforeEach(() => { api.mockReset(); localStorage.clear(); localStorage.setItem('fitness.coinCeremony.seen', '{}'); __resetShownForTest(); logSpy.info.mockClear(); wsHandler = null; sessions = ['s1']; paid = {}; serve(); });
  afterEach(() => vi.useRealTimers());

  it('a payout during hold waits, is not stamped, and plays once when the hold drops', async () => {
    paid.s1 = [learner('learner-a', [entry('t1', 2, 5000)], 9)];
    const { result, rerender, unmount } = await mount({ hold: true });
    await fire('s1');
    expect(result.current.ceremony).toBeNull();
    expect(JSON.parse(localStorage.getItem('fitness.coinCeremony.seen'))).toEqual({});
    // A second look while parked cannot double-queue.
    await fire('s1');
    rerender({ hold: false });
    await waitFor(() => expect(result.current.ceremony?.txnIds).toEqual(['t1']));
    expect(Object.keys(JSON.parse(localStorage.getItem('fitness.coinCeremony.seen')))).toEqual(['t1']);
    act(() => result.current.dismiss());
    expect(result.current.ceremony).toBeNull();
    unmount();
  });

  it('a reload during hold leaves the payout unseen', async () => {
    paid.s1 = [learner('learner-a', [entry('t1', 2, 5000)], 9)];
    const first = await mount({ hold: true });
    expect(first.result.current.ceremony).toBeNull();
    first.unmount();
    __resetShownForTest(); // a reload loses the page's memory, keeps storage
    const second = await mount({ hold: false });
    await waitFor(() => expect(second.result.current.ceremony?.txnIds).toEqual(['t1']));
  });

  it('coins-changed during hold shows nothing until the hold drops, then one ceremony', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const { result, rerender } = await mount({ hold: true });
    paid.s1 = [learner('learner-a', [entry('t7', 1, 100)], 3)];
    await act(async () => { wsHandler({ event: 'coins-changed', userId: 'learner-a' }); await vi.advanceTimersByTimeAsync(2000); });
    expect(result.current.ceremony).toBeNull();
    rerender({ hold: false });
    await waitFor(() => expect(result.current.ceremony?.txnIds).toEqual(['t7']));
  });
});

describe('module hold', () => {
  it('any active module, a video queue or a live route holds; the menu does not', () => {
    expect(isRunOnScreen({ moduleLive: true })).toBe(true);
    expect(isRunOnScreen({ queueLength: 1 })).toBe(true);
    expect(isRunOnScreen({ pathname: '/fitness/module/skyline' })).toBe(true);
    expect(isRunOnScreen({ pathname: '/fitness/menu/all' })).toBe(false);
    expect(isRunOnScreen({})).toBe(false);
  });

  it('with a module active, coins-changed shows nothing; leaving it plays one ceremony', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    localStorage.setItem('fitness.coinCeremony.seen', '{}');
    __resetShownForTest(); sessions = ['s1']; paid = {}; serve();
    const { result, rerender } = await mount({ hold: isRunOnScreen({ moduleLive: true }) });
    paid.s1 = [learner('learner-a', [entry('t8', 1, 100)], 3)];
    await act(async () => { wsHandler({ event: 'coins-changed', userId: 'learner-a' }); await vi.advanceTimersByTimeAsync(2000); });
    expect(result.current.ceremony).toBeNull();
    rerender({ hold: isRunOnScreen({ moduleLive: false }) });
    await waitFor(() => expect(result.current.ceremony?.txnIds).toEqual(['t8']));
    vi.useRealTimers();
  });
});

describe('skipped logging', () => {
  beforeEach(() => { api.mockReset(); localStorage.clear(); localStorage.setItem('fitness.coinCeremony.seen', '{}'); __resetShownForTest(); logSpy.info.mockClear(); logSpy.debug.mockClear(); wsHandler = null; sessions = ['s1', 's2']; paid = {}; });

  it('the first /paid failure per page is info, later ones debug', async () => {
    api.mockImplementation(async (url) => {
      if (url.startsWith('/api/v1/fitness/sessions')) return { sessions: sessions.map((sessionId) => ({ sessionId })) };
      throw new Error('503');
    });
    await mount();
    const info = logSpy.info.mock.calls.filter((c) => c[0] === 'fitness.coin_ceremony.skipped');
    const debug = logSpy.debug.mock.calls.filter((c) => c[0] === 'fitness.coin_ceremony.skipped');
    expect(info).toHaveLength(1);
    expect(debug).toHaveLength(1);
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
