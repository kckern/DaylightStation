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

  // Climbing episode -> season -> show.
  //
  // Plex does NOT propagate show labels down to seasons/episodes, and several real
  // playback paths hand this hook a bare episode id with no grandparentId:
  //   FitnessApp.jsx `/fitness/play/:id` metadata-fetch FALLBACK -> `{ id: episodeId }`
  //   FitnessApp.jsx DoNow `fitness.launch`                      -> same handler
  //   FitnessUpNextWidget.jsx                                    -> `{ id, type: 'episode' }`
  // Asking the API for an episode id returns `labels: []`. Accepting that empty array as
  // a resolved answer is precisely how a labelled lesson gets recorded, so it must climb.
  //
  // Shapes below are the VERBATIM live-API responses (show 696065 = `instructional`;
  // Insanity show 9956 = ordinary unlabelled workout).
  describe('label climb for episode/season ids', () => {
    const EPISODE_696067 = { info: { type: 'episode', labels: [], parentRatingKey: '696066' } };
    const SEASON_696066 = { info: { type: 'season', labels: [], parentRatingKey: '696065' } };
    const SHOW_696065 = { info: { type: 'show', labels: ['instructional'], parentRatingKey: null } };

    const EPISODE_9958 = { info: { type: 'episode', labels: [], parentRatingKey: '9957' } };
    const SEASON_9957 = { info: { type: 'season', labels: [], parentRatingKey: '9956' } };
    const SHOW_9956 = { info: { type: 'show', labels: [], parentRatingKey: null } };

    it('an episode id of the instructional show resolves to captureDisabled — THE WEBCAM MUST NOT RECORD', async () => {
      mockApi
        .mockResolvedValueOnce(EPISODE_696067)
        .mockResolvedValueOnce(SEASON_696066)
        .mockResolvedValueOnce(SHOW_696065);

      // Verbatim FitnessApp.jsx metadata-fetch fallback shape.
      const { result } = renderHook(() => useContentMode({ id: '696067' }, CFG));

      await waitFor(() => expect(result.current.resolved).toBe(true));
      expect(result.current).toEqual({ captureDisabled: true, studyUx: true, resolved: true });
      expect(mockApi).toHaveBeenNthCalledWith(1, 'api/v1/fitness/show/696067');
      expect(mockApi).toHaveBeenNthCalledWith(2, 'api/v1/fitness/show/696066');
      expect(mockApi).toHaveBeenNthCalledWith(3, 'api/v1/fitness/show/696065');
    });

    it('the FitnessUpNextWidget shape ({ id, type: "episode" }) climbs the same way', async () => {
      mockApi
        .mockResolvedValueOnce(EPISODE_696067)
        .mockResolvedValueOnce(SEASON_696066)
        .mockResolvedValueOnce(SHOW_696065);

      const { result } = renderHook(() => useContentMode({ id: '696067', type: 'episode' }, CFG));
      await waitFor(() => expect(result.current.resolved).toBe(true));
      expect(result.current.captureDisabled).toBe(true);
    });

    it('an ordinary unlabelled workout episode still resolves and STILL RECORDS', async () => {
      mockApi
        .mockResolvedValueOnce(EPISODE_9958)
        .mockResolvedValueOnce(SEASON_9957)
        .mockResolvedValueOnce(SHOW_9956);

      const { result } = renderHook(() => useContentMode({ id: '9958' }, CFG));
      await waitFor(() => expect(result.current.resolved).toBe(true));
      expect(result.current).toEqual({ captureDisabled: false, studyUx: false, resolved: true });
    });

    it('never caches an episode-scoped empty answer — the cache serves the SHOW answer for every visited id', async () => {
      mockApi
        .mockResolvedValueOnce(EPISODE_696067)
        .mockResolvedValueOnce(SEASON_696066)
        .mockResolvedValueOnce(SHOW_696065);

      const { result: r1 } = renderHook(() => useContentMode({ id: '696067' }, CFG));
      await waitFor(() => expect(r1.current.resolved).toBe(true));
      expect(mockApi).toHaveBeenCalledTimes(3);

      // Same episode again: fully cached, no refetch, and the cached answer is the SHOW's
      // labels — NOT the episode's empty array.
      const { result: r2 } = renderHook(() => useContentMode({ id: '696067' }, CFG));
      await waitFor(() => expect(r2.current.resolved).toBe(true));
      expect(r2.current.captureDisabled).toBe(true);
      expect(mockApi).toHaveBeenCalledTimes(3);

      // A different item that resolves against the SHOW id directly must also see the
      // show's labels, not an episode-scoped empty array.
      const { result: r3 } = renderHook(() => useContentMode({ grandparentId: '696065' }, CFG));
      await waitFor(() => expect(r3.current.resolved).toBe(true));
      expect(r3.current.captureDisabled).toBe(true);
      expect(mockApi).toHaveBeenCalledTimes(3);
    });

    it('a sibling episode of an already-resolved show short-circuits at the season', async () => {
      mockApi
        .mockResolvedValueOnce(EPISODE_696067)
        .mockResolvedValueOnce(SEASON_696066)
        .mockResolvedValueOnce(SHOW_696065);
      const { result: r1 } = renderHook(() => useContentMode({ id: '696067' }, CFG));
      await waitFor(() => expect(r1.current.resolved).toBe(true));

      // Sibling episode 696068 -> season 696066, which is already cached.
      mockApi.mockResolvedValueOnce({ info: { type: 'episode', labels: [], parentRatingKey: '696066' } });
      const { result: r2 } = renderHook(() => useContentMode({ id: '696068' }, CFG));
      await waitFor(() => expect(r2.current.resolved).toBe(true));
      expect(r2.current.captureDisabled).toBe(true);
      expect(mockApi).toHaveBeenCalledTimes(4); // 3 + the sibling episode only
    });

    it('keeps a NON-empty episode label set as a real answer without climbing', async () => {
      mockApi.mockResolvedValueOnce({
        info: { type: 'episode', labels: ['instructional'], parentRatingKey: '696066' }
      });
      const { result } = renderHook(() => useContentMode({ id: '696067' }, CFG));
      await waitFor(() => expect(result.current.resolved).toBe(true));
      expect(result.current.captureDisabled).toBe(true);
      expect(mockApi).toHaveBeenCalledTimes(1);
    });

    it('an unlabelled episode with no parent to climb to stays UNRESOLVED — capture stays off', async () => {
      mockApi.mockResolvedValue({ info: { type: 'episode', labels: [], parentRatingKey: null } });
      const { result, unmount } = renderHook(() => useContentMode({ id: '696067' }, CFG));
      await waitFor(() => expect(mockApi).toHaveBeenCalled());
      expect(result.current.resolved).toBe(false);
      expect(result.current.captureDisabled).toBe(false);
      unmount(); // clear the pending retry timer
    });

    it('a self-referential parent chain is bounded and stays unresolved rather than looping forever', async () => {
      // Every hop claims its own id as its parent. The hop budget must stop the walk.
      mockApi.mockResolvedValue({ info: { type: 'season', labels: [], parentRatingKey: '700001' } });
      const { result, unmount } = renderHook(() => useContentMode({ id: '700001' }, CFG));
      await waitFor(() => expect(result.current.resolved).toBe(false));
      // 3 lookups per attempt (hop 0,1,2) and never more, however long we wait.
      await waitFor(() => expect(mockApi).toHaveBeenCalledTimes(3));
      expect(result.current.captureDisabled).toBe(false);
      unmount();
    });

    it('a mid-climb failure is retried from the start and never cached', async () => {
      vi.useFakeTimers();
      try {
        mockApi
          .mockResolvedValueOnce(EPISODE_696067)
          .mockRejectedValueOnce(new Error('network')) // season lookup blows up
          .mockResolvedValueOnce(EPISODE_696067)
          .mockResolvedValueOnce(SEASON_696066)
          .mockResolvedValueOnce(SHOW_696065);

        const { result, unmount } = renderHook(() => useContentMode({ id: '696067' }, CFG));

        await act(async () => { await Promise.resolve(); await Promise.resolve(); });
        expect(result.current.resolved).toBe(false);

        await act(() => vi.advanceTimersByTimeAsync(RETRY_DELAY_1_MS));

        expect(result.current).toEqual({ captureDisabled: true, studyUx: true, resolved: true });
        unmount();
      } finally {
        vi.useRealTimers();
      }
    });
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
