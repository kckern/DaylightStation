import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useQueueController } from './useQueueController.js';

vi.mock('../../../lib/api.mjs', () => ({
  DaylightAPI: vi.fn().mockResolvedValue({ items: [], audio: null }),
}));

describe('useQueueController on-deck slot', () => {
  it('pushOnDeck sets the slot', () => {
    const { result } = renderHook(() => useQueueController({ play: null, queue: null, clear: vi.fn() }));
    expect(result.current.onDeck).toBeNull();
    act(() => result.current.pushOnDeck({ id: 'plex:1', title: 'Pigs', thumbnail: '/t.jpg' }));
    expect(result.current.onDeck?.id).toBe('plex:1');
  });

  it('pushOnDeck replaces an existing on-deck item (newest wins)', () => {
    const { result } = renderHook(() => useQueueController({ play: null, queue: null, clear: vi.fn() }));
    act(() => result.current.pushOnDeck({ id: 'plex:1', title: 'A' }));
    act(() => result.current.pushOnDeck({ id: 'plex:2', title: 'B' }));
    expect(result.current.onDeck?.id).toBe('plex:2');
  });

  it('pushOnDeck with displaceToQueue=true prepends displaced item to queue head', () => {
    const { result } = renderHook(() => useQueueController({ play: null, queue: null, clear: vi.fn() }));
    act(() => result.current.pushOnDeck({ id: 'plex:1', title: 'A' }));
    act(() => result.current.pushOnDeck({ id: 'plex:2', title: 'B' }, { displaceToQueue: true }));
    expect(result.current.onDeck?.id).toBe('plex:2');
    expect(result.current.playQueue[0]?.id).toBe('plex:1');
  });

  it('clearOnDeck empties the slot', () => {
    const { result } = renderHook(() => useQueueController({ play: null, queue: null, clear: vi.fn() }));
    act(() => result.current.pushOnDeck({ id: 'plex:1', title: 'A' }));
    act(() => result.current.clearOnDeck());
    expect(result.current.onDeck).toBeNull();
  });

  it('flashOnDeck increments the flash key without changing the slot', () => {
    const { result } = renderHook(() => useQueueController({ play: null, queue: null, clear: vi.fn() }));
    act(() => result.current.pushOnDeck({ id: 'plex:1', title: 'A' }));
    const k0 = result.current.onDeckFlashKey;
    act(() => result.current.flashOnDeck());
    expect(result.current.onDeckFlashKey).toBe(k0 + 1);
    expect(result.current.onDeck?.id).toBe('plex:1');
  });

  it('playNow replaces playQueue head and preserves the tail', async () => {
    const items = [
      { id: 'a', contentId: 'a', title: 'A' },
      { id: 'b', contentId: 'b', title: 'B' },
    ];
    const { result } = renderHook(() => useQueueController({ play: items, queue: null, clear: vi.fn() }));
    await act(async () => {});
    expect(result.current.playQueue[0]?.id).toBe('a');
    act(() => result.current.playNow({ id: 'x', contentId: 'x', title: 'X' }));
    expect(result.current.playQueue[0]?.id).toBe('x');
    expect(result.current.playQueue[1]?.id).toBe('b');
  });

  it('playNow preserves on-deck slot (does not consume it)', () => {
    const { result } = renderHook(() => useQueueController({ play: null, queue: null, clear: vi.fn() }));
    act(() => result.current.pushOnDeck({ id: 'od', contentId: 'od', title: 'OD' }));
    act(() => result.current.playNow({ id: 'x', contentId: 'x', title: 'X' }));
    expect(result.current.playQueue[0]?.id).toBe('x');
    expect(result.current.onDeck?.id).toBe('od');
  });

  it('mints a queue entry ID for an external play-now item so capture never drops it', () => {
    const { result } = renderHook(() => useQueueController({ play: null, queue: null, clear: vi.fn() }));
    act(() => result.current.playNow({ id: 'x', contentId: 'plex:x', title: 'X' }));
    expect(result.current.queueSnapshot.items).toEqual([
      expect.objectContaining({ queueItemId: expect.any(String), contentId: 'plex:x' }),
    ]);
    expect(result.current.queueSnapshot.executionOrder).toEqual([
      result.current.queueSnapshot.items[0].queueItemId,
    ]);
  });

  it('playNow on empty queue seeds it with the new head', () => {
    const { result } = renderHook(() => useQueueController({ play: null, queue: null, clear: vi.fn() }));
    expect(result.current.playQueue.length).toBe(0);
    act(() => result.current.playNow({ id: 'x', contentId: 'x', title: 'X' }));
    expect(result.current.playQueue[0]?.id).toBe('x');
  });
});

describe('useQueueController.advance with on-deck', () => {
  it('advance() consumes on-deck before regular queue advance', async () => {
    const items = [
      { id: 'a', contentId: 'a', title: 'A' },
      { id: 'b', contentId: 'b', title: 'B' },
    ];
    const { result } = renderHook(() => useQueueController({ play: items, queue: null, clear: vi.fn() }));
    await act(async () => {});
    act(() => result.current.pushOnDeck({ id: 'x', contentId: 'x', title: 'X' }));
    expect(result.current.onDeck?.id).toBe('x');
    act(() => result.current.advance());
    expect(result.current.playQueue[0]?.id).toBe('x');
    expect(result.current.onDeck).toBeNull();
  });

  it('advance() falls through to normal queue advance when on-deck is empty', async () => {
    const items = [
      { id: 'a', contentId: 'a', title: 'A' },
      { id: 'b', contentId: 'b', title: 'B' },
    ];
    const { result } = renderHook(() => useQueueController({ play: items, queue: null, clear: vi.fn() }));
    await act(async () => {});
    expect(result.current.onDeck).toBeNull();
    act(() => result.current.advance());
    expect(result.current.playQueue[0]?.id).toBe('b');
  });

  it('captures the complete original duplicate queue and places pending on-deck at actual next priority', async () => {
    const items = [
      { id: 'a-1', contentId: 'plex:a', title: 'A', format: 'video' },
      { id: 'b-1', contentId: 'plex:b', title: 'B', format: 'video' },
      { id: 'a-2', contentId: 'plex:a', title: 'A again', format: 'video' },
    ];
    const { result } = renderHook(() => useQueueController({ play: items, queue: null, clear: vi.fn() }));
    await act(async () => {});
    act(() => result.current.advance(2));
    const currentId = result.current.playQueue[0].guid;
    act(() => result.current.pushOnDeck({ id: 'next', contentId: 'plex:next', title: 'Next', format: 'video' }));

    const snapshot = result.current.queueSnapshot;
    expect(snapshot.items.map((item) => item.contentId)).toEqual(['plex:a', 'plex:b', 'plex:a', 'plex:next']);
    expect(new Set(snapshot.items.map((item) => item.queueItemId)).size).toBe(4);
    expect(snapshot.currentIndex).toBe(2);
    expect(snapshot.items[snapshot.currentIndex].queueItemId).toBe(currentId);
    expect(snapshot.executionOrder).toEqual([currentId, snapshot.items[3].queueItemId]);
    expect(snapshot.items[3].priority).toBe('upNext');
  });

  it.each([
    ['on-deck', 3, (controller, existingGuid) => controller.pushOnDeck({ guid: existingGuid, contentId: 'plex:a', title: 'new A' })],
    ['play-now', 2, (controller, existingGuid) => controller.playNow({ guid: existingGuid, contentId: 'plex:a', title: 'new A' })],
  ])('mints a distinct owner entry ID when %s receives a colliding caller guid', async (_path, expectedLength, insert) => {
    const { result } = renderHook(() => useQueueController({
      play: [{ contentId: 'plex:a', title: 'A' }, { contentId: 'plex:b', title: 'B' }], queue: null, clear: vi.fn(),
    }));
    await act(async () => {});
    const originalId = result.current.playQueue[0].guid;
    act(() => insert(result.current, originalId));

    const snapshot = result.current.queueSnapshot;
    expect(snapshot.items).toHaveLength(expectedLength);
    expect(new Set(snapshot.items.map((item) => item.queueItemId)).size).toBe(expectedLength);
  });
});

describe('useQueueController error propagation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    // Defensive: always restore real timers even if a fake-timer test fails mid-flight.
    vi.useRealTimers();
  });

  it('calls onError with kind=fetch-failed when the queue API rejects', async () => {
    const { DaylightAPI } = await import('../../../lib/api.mjs');
    DaylightAPI.mockRejectedValueOnce(new Error('HTTP 502: Bad Gateway - {"error":"upstream"}'));
    const onError = vi.fn();
    renderHook(() =>
      useQueueController({
        play: null,
        queue: { plex: 12345, shuffle: true },
        contentRef: 'plex:12345',
        clear: vi.fn(),
        onError,
      })
    );
    await vi.waitFor(() => expect(onError).toHaveBeenCalled());
    const call = onError.mock.calls[0][0];
    expect(call.kind).toBe('fetch-failed');
    expect(call.httpStatus).toBe('502');
    expect(call.contentRef).toBe('plex:12345');
  });

  it('calls onError with kind=empty-queue when API returns items:[]', async () => {
    const { DaylightAPI } = await import('../../../lib/api.mjs');
    DaylightAPI.mockResolvedValueOnce({ items: [], audio: null });
    const onError = vi.fn();
    renderHook(() =>
      useQueueController({
        play: null,
        queue: { plex: 99, shuffle: true },
        contentRef: 'plex:99',
        clear: vi.fn(),
        onError,
      })
    );
    await vi.waitFor(() => expect(onError).toHaveBeenCalled());
    expect(onError.mock.calls[0][0]).toMatchObject({ kind: 'empty-queue', contentRef: 'plex:99' });
  });

  it('calls onError with kind=invalid-queue when items exist but all fail validation', async () => {
    const { DaylightAPI } = await import('../../../lib/api.mjs');
    DaylightAPI.mockResolvedValueOnce({ items: [{ junk: true }, { other: 1 }], audio: null });
    const onError = vi.fn();
    renderHook(() =>
      useQueueController({
        play: null,
        queue: { plex: 7, shuffle: true },
        contentRef: 'plex:7',
        clear: vi.fn(),
        onError,
      })
    );
    await vi.waitFor(() => expect(onError).toHaveBeenCalled());
    expect(onError.mock.calls[0][0]).toMatchObject({ kind: 'invalid-queue', contentRef: 'plex:7' });
  });

  it('calls onError with kind=fetch-timeout when queue API does not resolve within threshold', async () => {
    vi.useFakeTimers();
    const { DaylightAPI } = await import('../../../lib/api.mjs');
    DaylightAPI.mockReturnValueOnce(new Promise(() => {}));
    const onError = vi.fn();
    renderHook(() =>
      useQueueController({
        play: null,
        queue: { plex: 5, shuffle: true },
        contentRef: 'plex:5',
        clear: vi.fn(),
        onError,
        queueFetchTimeoutMs: 10_000,
      })
    );
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_001);
    });
    expect(onError).toHaveBeenCalled();
    expect(onError.mock.calls[0][0]).toMatchObject({ kind: 'fetch-timeout', contentRef: 'plex:5', timeoutMs: 10_000 });
    vi.useRealTimers();
  });
});

describe('useQueueController prewarm transport preservation', () => {
  it.each([
    ['HLS URL with query', '/transcode/stream.m3u8?token=abc', 'hls_video', 'hls_video'],
    ['DASH MPD URL', '/transcode/stream.mpd', 'video', 'dash_video'],
    ['native MP4 URL', '/library/part.mp4', 'video', 'video'],
    ['extensionless URL', '/transcode/stream', 'video', 'video'],
  ])('uses the redeemed %s transport without changing the owner queue entry', async (_label, redeemedUrl, originalFormat, expectedFormat) => {
    const { DaylightAPI } = await import('../../../lib/api.mjs');
    DaylightAPI.mockImplementation((path) => {
      if (path === 'api/v1/queue/plex:prewarm') {
        return Promise.resolve({ items: [{ id: 'plex:movie', contentId: 'plex:movie', title: 'Movie', format: originalFormat }], audio: null });
      }
      if (path === 'api/v1/prewarm/token-1') return Promise.resolve({ url: redeemedUrl });
      return Promise.resolve({ items: [], audio: null });
    });
    const { result } = renderHook(() => useQueueController({
      play: { contentId: 'plex:prewarm', prewarmToken: 'token-1', prewarmContentId: 'plex:movie' },
      queue: null,
      clear: vi.fn(),
    }));

    await vi.waitFor(() => expect(result.current.playQueue[0]?.mediaUrl).toBe(redeemedUrl));
    expect(result.current.playQueue[0]).toMatchObject({ format: expectedFormat, mediaType: expectedFormat });
    expect(result.current.queueSnapshot.items).toHaveLength(1);
    expect(result.current.queueSnapshot.items[0].queueItemId).toBe(result.current.playQueue[0].guid);
  });
});

describe('useQueueController re-fetches after remount (signature cache carryover)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // Repro of the music-player "Music unavailable" bug: a playlist loads
  // successfully (its signature is written to the module-level cache), the
  // music sidebar unmounts on a view navigation, then remounts with the SAME
  // playlist. The remounted instance starts with an empty playQueue. The cache
  // must not suppress the re-fetch — otherwise playQueue stays [] forever and
  // the player strands at "Music unavailable" with no recovery.
  it('repopulates the queue when remounted with the same contentRef', async () => {
    const { DaylightAPI } = await import('../../../lib/api.mjs');
    const items = [{ id: 'plex:140619', contentId: 'plex:140619', title: 'Gangnam Style' }];
    DaylightAPI.mockResolvedValue({ items, audio: null });

    const props = {
      play: null,
      queue: { contentId: 'plex:672596', plex: 672596, shuffle: true },
      contentRef: 'plex:672596',
      clear: vi.fn(),
    };

    // First mount: fetch succeeds, queue populated, signature cached.
    const first = renderHook(() => useQueueController(props));
    await vi.waitFor(() => expect(first.result.current.playQueue.length).toBe(1));

    // Navigation tears down the music sidebar. The fetch completed, so the
    // cleanup preserves the cached signature (matches production).
    first.unmount();

    // Returning / starting a video remounts the player with the same playlist.
    // A fresh instance => playQueue resets to []; it must re-fetch.
    const second = renderHook(() => useQueueController(props));
    await vi.waitFor(() => expect(second.result.current.playQueue.length).toBe(1));
    expect(second.result.current.playQueue[0]?.contentId).toBe('plex:140619');
  });
});
