// frontend/src/hooks/fitness/useContentMode.test.jsx
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';

const mockApi = vi.fn();
vi.mock('@/lib/api.mjs', () => ({ DaylightAPI: (...args) => mockApi(...args) }));
vi.mock('@/lib/logging/Logger.js', () => ({
  default: () => ({ child: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }) })
}));

const { useContentMode, __clearContentModeCache } = await import('./useContentMode.js');

const CFG = { no_capture_labels: ['Instructional'], study_ux_labels: ['Instructional'] };

// Matches the hook's own RETRY_DELAYS_MS / MAX_FETCH_ATTEMPTS (not exported — the hook
// module intentionally keeps these as private implementation constants).
const RETRY_DELAY_1_MS = 1000;
const RETRY_DELAY_2_MS = 3000;

beforeEach(() => {
  mockApi.mockReset();
  __clearContentModeCache();
});

afterEach(() => {
  // Belt-and-suspenders: any test that used fake timers restores real ones itself, but
  // guard here too so a thrown assertion mid-test can't leave fake timers active for
  // the next test file.
  vi.useRealTimers();
});

describe('useContentMode', () => {
  it('resolves synchronously when the item already carries labels', () => {
    const { result } = renderHook(() => useContentMode({ labels: ['instructional'] }, CFG));
    expect(result.current).toEqual({ captureDisabled: true, studyUx: true, resolved: true });
    expect(mockApi).not.toHaveBeenCalled();
  });

  it('reports unresolved before the backstop fetch settles', () => {
    mockApi.mockReturnValue(new Promise(() => {})); // never settles
    const { result } = renderHook(() => useContentMode({ grandparentId: '696065' }, CFG));
    expect(result.current.resolved).toBe(false);
    expect(result.current.captureDisabled).toBe(false);
  });

  it('resolves from fetched show labels when the item has none', async () => {
    mockApi.mockResolvedValue({ info: { labels: ['instructional'] } });
    const { result } = renderHook(() => useContentMode({ grandparentId: '696065' }, CFG));
    await waitFor(() => expect(result.current.resolved).toBe(true));
    expect(result.current).toEqual({ captureDisabled: true, studyUx: true, resolved: true });
    expect(mockApi).toHaveBeenCalledWith('api/v1/fitness/show/696065');
  });

  it('stays unresolved when the backstop fetch fails — capture must not start', async () => {
    mockApi.mockRejectedValue(new Error('network'));
    const { result, unmount } = renderHook(() => useContentMode({ grandparentId: '696065' }, CFG));
    await waitFor(() => expect(mockApi).toHaveBeenCalled());
    expect(result.current.resolved).toBe(false);
    // A failed attempt schedules a real-timer retry (see the dedicated retry tests
    // below) — unmount so it doesn't fire in the background during a later test.
    unmount();
  });

  it('caches by show id — a second item from the same show does not refetch', async () => {
    mockApi.mockResolvedValue({ info: { labels: ['instructional'] } });
    const { result: r1 } = renderHook(() => useContentMode({ grandparentId: '696065' }, CFG));
    await waitFor(() => expect(r1.current.resolved).toBe(true));
    const { result: r2 } = renderHook(() => useContentMode({ grandparentId: '696065' }, CFG));
    await waitFor(() => expect(r2.current.resolved).toBe(true));
    expect(mockApi).toHaveBeenCalledTimes(1);
  });

  it('resolves immediately when there is no item at all', () => {
    const { result } = renderHook(() => useContentMode(null, CFG));
    expect(result.current).toEqual({ captureDisabled: false, studyUx: false, resolved: true });
  });

  // Regression coverage for a 200-OK response that carries no actual answer.
  // PlexAdapter.getContainerInfo() swallows internal failures and returns `info: null`,
  // and the route still responds HTTP 200 with that — so a resolved promise does NOT
  // mean the labels are known. These must be treated exactly like a network failure.

  it('stays unresolved when the fetch resolves with info: null — must not be treated as no labels', async () => {
    mockApi.mockResolvedValue({ info: null });
    const { result, unmount } = renderHook(() => useContentMode({ grandparentId: '696065' }, CFG));
    await waitFor(() => expect(mockApi).toHaveBeenCalled());
    expect(result.current.resolved).toBe(false);
    expect(result.current.captureDisabled).toBe(false);
    unmount(); // prevent the scheduled retry timer from firing in the background
  });

  it('does not cache an info: null response — a later mount for the same show refetches and can still resolve', async () => {
    mockApi.mockResolvedValueOnce({ info: null });
    const { result: r1, unmount: unmount1 } = renderHook(() => useContentMode({ grandparentId: '696065' }, CFG));
    await waitFor(() => expect(mockApi).toHaveBeenCalledTimes(1));
    expect(r1.current.resolved).toBe(false);
    unmount1(); // clear r1's pending retry timer before it can interfere with r2's call count

    mockApi.mockResolvedValueOnce({ info: { labels: ['instructional'] } });
    const { result: r2, unmount: unmount2 } = renderHook(() => useContentMode({ grandparentId: '696065' }, CFG));
    await waitFor(() => expect(r2.current.resolved).toBe(true));
    expect(r2.current.captureDisabled).toBe(true);
    expect(mockApi).toHaveBeenCalledTimes(2);
    unmount2();
  });

  it('stays unresolved when the response has no info key at all', async () => {
    mockApi.mockResolvedValue({});
    const { result, unmount } = renderHook(() => useContentMode({ grandparentId: '696065' }, CFG));
    await waitFor(() => expect(mockApi).toHaveBeenCalled());
    expect(result.current.resolved).toBe(false);
    unmount();
  });

  it('resolves and caches a genuinely unlabelled show (info.labels: []) — must not regress into permanent unresolvedness', async () => {
    mockApi.mockResolvedValue({ info: { labels: [] } });
    const { result: r1 } = renderHook(() => useContentMode({ grandparentId: '696065' }, CFG));
    await waitFor(() => expect(r1.current.resolved).toBe(true));
    expect(r1.current).toEqual({ captureDisabled: false, studyUx: false, resolved: true });

    const { result: r2 } = renderHook(() => useContentMode({ grandparentId: '696065' }, CFG));
    await waitFor(() => expect(r2.current.resolved).toBe(true));
    expect(mockApi).toHaveBeenCalledTimes(1);
  });

  // Bounded retry with backoff. Plex lookups are known-flaky in this deployment, and
  // EVERY unlabelled show (the common case, since hasResolvableLabels requires a
  // non-empty array) depends on this fetch — so a single transient blip must not
  // permanently strand a session with capture off. These tests use fake timers to
  // control the backoff deterministically instead of waiting out real seconds.
  describe('bounded retry with backoff', () => {
    // Flush the microtask queue (promise .then/.catch callbacks already in flight)
    // without advancing any timers, wrapped in act() so React processes the resulting
    // state update synchronously before the next assertion.
    const flushMicrotasks = () => act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    it('retries after a transient rejection and succeeds — the recovered result is cached', async () => {
      vi.useFakeTimers();
      try {
        mockApi
          .mockRejectedValueOnce(new Error('network'))
          .mockResolvedValueOnce({ info: { labels: ['instructional'] } });

        const { result, unmount } = renderHook(() => useContentMode({ grandparentId: '696065' }, CFG));

        await flushMicrotasks(); // attempt 1 rejects
        expect(mockApi).toHaveBeenCalledTimes(1);
        expect(result.current.resolved).toBe(false);

        await act(() => vi.advanceTimersByTimeAsync(RETRY_DELAY_1_MS)); // attempt 2 succeeds

        expect(mockApi).toHaveBeenCalledTimes(2);
        expect(result.current).toEqual({ captureDisabled: true, studyUx: true, resolved: true });

        // Cached: a second mount for the same show does not refetch.
        const { result: r2, unmount: unmount2 } = renderHook(() => useContentMode({ grandparentId: '696065' }, CFG));
        expect(r2.current).toEqual({ captureDisabled: true, studyUx: true, resolved: true });
        expect(mockApi).toHaveBeenCalledTimes(2);

        unmount();
        unmount2();
      } finally {
        vi.useRealTimers();
      }
    });

    it('fails on every attempt — retries exactly up to the bound, then gives up permanently', async () => {
      vi.useFakeTimers();
      try {
        mockApi.mockRejectedValue(new Error('network'));
        const { result, unmount } = renderHook(() => useContentMode({ grandparentId: '696065' }, CFG));

        await flushMicrotasks(); // attempt 1
        expect(mockApi).toHaveBeenCalledTimes(1);

        await act(() => vi.advanceTimersByTimeAsync(RETRY_DELAY_1_MS)); // attempt 2
        expect(mockApi).toHaveBeenCalledTimes(2);

        await act(() => vi.advanceTimersByTimeAsync(RETRY_DELAY_2_MS)); // attempt 3 (final)
        expect(mockApi).toHaveBeenCalledTimes(3);
        expect(result.current.resolved).toBe(false);

        // No further retry was scheduled — advancing well past any backoff makes no
        // additional calls.
        await act(() => vi.advanceTimersByTimeAsync(60_000));
        expect(mockApi).toHaveBeenCalledTimes(3);
        expect(result.current.resolved).toBe(false);

        unmount();
      } finally {
        vi.useRealTimers();
      }
    });

    it('retries the malformed info: null case too, bounded the same way', async () => {
      vi.useFakeTimers();
      try {
        mockApi.mockResolvedValue({ info: null });
        const { result, unmount } = renderHook(() => useContentMode({ grandparentId: '696065' }, CFG));

        await flushMicrotasks(); // attempt 1
        expect(mockApi).toHaveBeenCalledTimes(1);

        await act(() => vi.advanceTimersByTimeAsync(RETRY_DELAY_1_MS)); // attempt 2
        expect(mockApi).toHaveBeenCalledTimes(2);

        await act(() => vi.advanceTimersByTimeAsync(RETRY_DELAY_2_MS)); // attempt 3 (final)
        expect(mockApi).toHaveBeenCalledTimes(3);
        expect(result.current.resolved).toBe(false);

        unmount();
      } finally {
        vi.useRealTimers();
      }
    });

    it('does not retry after unmount — a pending backoff timer never fires post-unmount', async () => {
      vi.useFakeTimers();
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      try {
        mockApi.mockRejectedValue(new Error('network'));
        const { result, unmount } = renderHook(() => useContentMode({ grandparentId: '696065' }, CFG));

        await flushMicrotasks(); // attempt 1 rejects, schedules a retry for +1000ms
        expect(mockApi).toHaveBeenCalledTimes(1);
        expect(result.current.resolved).toBe(false);

        unmount(); // unmount BEFORE the backoff elapses — must clear the pending timer

        await act(() => vi.advanceTimersByTimeAsync(RETRY_DELAY_1_MS + RETRY_DELAY_2_MS + 10_000));

        expect(mockApi).toHaveBeenCalledTimes(1); // no retry fired after unmount
        expect(errorSpy).not.toHaveBeenCalled(); // no "state update on unmounted component" warning
      } finally {
        errorSpy.mockRestore();
        vi.useRealTimers();
      }
    });
  });
});
