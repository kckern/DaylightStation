import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('@/lib/api.mjs', () => ({ DaylightAPI: vi.fn() }));
import { DaylightAPI } from '@/lib/api.mjs';
import { makeCheckpointer, createSession, finishSession, fetchBoot } from './sessionClient.js';

describe('sessionClient', () => {
  beforeEach(() => { vi.useFakeTimers(); DaylightAPI.mockReset(); });
  afterEach(() => { vi.useRealTimers(); });

  it('fetchBoot fetches config, sets, and active session in parallel', async () => {
    DaylightAPI
      .mockResolvedValueOnce({ defaults: {} })            // config
      .mockResolvedValueOnce({ sets: [{ id: 's1' }] })    // sets
      .mockResolvedValueOnce({ session: null });          // active
    const boot = await fetchBoot();
    expect(boot.sets).toEqual([{ id: 's1' }]);
    expect(boot.activeSession).toBe(null);
    expect(DaylightAPI).toHaveBeenCalledWith('api/v1/gameshow/config');
    expect(DaylightAPI).toHaveBeenCalledWith('api/v1/gameshow/games/jeopardy/sets');
    expect(DaylightAPI).toHaveBeenCalledWith('api/v1/gameshow/sessions/active');
  });

  it('createSession posts and returns the session', async () => {
    DaylightAPI.mockResolvedValueOnce({ id: 'gs_1' });
    const s = await createSession({ game: 'jeopardy', setId: 's1', teams: [] });
    expect(s.id).toBe('gs_1');
    expect(DaylightAPI).toHaveBeenCalledWith('api/v1/gameshow/sessions', { game: 'jeopardy', setId: 's1', teams: [] }, 'POST');
  });

  it('debounces checkpoints — only the latest snapshot is sent', async () => {
    DaylightAPI.mockResolvedValue({ ok: true });
    const cp = makeCheckpointer({ debounceMs: 800 });
    cp.push('gs_1', { n: 1 });
    cp.push('gs_1', { n: 2 });
    cp.push('gs_1', { n: 3 });
    await vi.advanceTimersByTimeAsync(900);
    expect(DaylightAPI).toHaveBeenCalledTimes(1);
    expect(DaylightAPI).toHaveBeenCalledWith('api/v1/gameshow/sessions/gs_1/checkpoint', { state: { n: 3 } }, 'POST');
  });

  it('retries failed checkpoints with backoff and never throws', async () => {
    DaylightAPI.mockRejectedValueOnce(new Error('net')).mockResolvedValueOnce({ ok: true });
    const cp = makeCheckpointer({ debounceMs: 100 });
    cp.push('gs_1', { n: 1 });
    await vi.advanceTimersByTimeAsync(150);   // first attempt fails
    await vi.advanceTimersByTimeAsync(1100);  // 1s backoff retry succeeds
    expect(DaylightAPI).toHaveBeenCalledTimes(2);
    expect(cp.pendingCount()).toBe(0);
  });

  it('finishSession posts finish', async () => {
    DaylightAPI.mockResolvedValueOnce({ status: 'complete' });
    await finishSession('gs_1');
    expect(DaylightAPI).toHaveBeenCalledWith('api/v1/gameshow/sessions/gs_1/finish', {}, 'POST');
  });
});
