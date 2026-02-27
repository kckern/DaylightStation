// tests/isolated/hooks/useMediaQueue.test.mjs
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';

// ── Mocks must be declared before any import that loads the module ─────────

vi.mock('#frontend/hooks/useWebSocket.js', () => ({
  useWebSocketSubscription: vi.fn(),
}));

vi.mock('@mantine/notifications', () => ({
  notifications: { show: vi.fn() },
}));

vi.mock('#frontend/lib/logging/Logger.js', () => ({
  default: () => ({
    child: () => ({
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    }),
  }),
}));

// ── Import mocked dependencies AFTER vi.mock declarations ─────────────────

import { useWebSocketSubscription } from '#frontend/hooks/useWebSocket.js';
import { useMediaQueue } from '#frontend/hooks/media/useMediaQueue.js';

// ── Helpers ────────────────────────────────────────────────────────────────

/** Build a standard resolved-queue API response */
const makeQueueResponse = (overrides = {}) => ({
  items: [],
  position: 0,
  shuffle: false,
  repeat: 'off',
  volume: 1.0,
  ...overrides,
});

/** Minimal resolved fetch response wrapping a queue payload */
const fetchOk = (payload) => Promise.resolve({
  ok: true,
  json: () => Promise.resolve(payload),
  text: () => Promise.resolve(''),
});

// ── Global test setup ──────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();
  useWebSocketSubscription.mockImplementation(() => {});
  global.fetch = vi.fn().mockImplementation(() => fetchOk(makeQueueResponse()));
});

afterEach(() => {
  // Always restore real timers so that a failing test that set up fake timers
  // does not bleed into subsequent tests.
  vi.useRealTimers();
});

// ── Test 1: Initial state loads from API on mount ─────────────────────────

describe('initial state: loads from API on mount', () => {
  it('starts in loading state and reflects full server response when fetch resolves', async () => {
    const serverQueue = makeQueueResponse({
      items: [
        { queueId: 'q1', contentId: 'video:1', title: 'Episode 1' },
        { queueId: 'q2', contentId: 'video:2', title: 'Episode 2' },
      ],
      position: 1,
      shuffle: true,
      repeat: 'all',
      volume: 0.7,
    });

    global.fetch = vi.fn().mockImplementation(() => fetchOk(serverQueue));

    const { result } = renderHook(() => useMediaQueue());

    // Before fetch resolves: loading is true
    expect(result.current.loading).toBe(true);

    // Wait for fetch + React state update
    await waitFor(() => expect(result.current.loading).toBe(false));

    // All fields should reflect the server response
    expect(result.current.items).toHaveLength(2);
    expect(result.current.items[0].queueId).toBe('q1');
    expect(result.current.items[1].title).toBe('Episode 2');
    expect(result.current.position).toBe(1);
    expect(result.current.shuffle).toBe(true);
    expect(result.current.repeat).toBe('all');
    expect(result.current.volume).toBeCloseTo(0.7);
  });

  it('fetches from the correct API endpoint with correct headers on mount', async () => {
    const { result } = renderHook(() => useMediaQueue());
    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(global.fetch).toHaveBeenCalledOnce();
    const [url, options] = global.fetch.mock.calls[0];
    expect(url).toBe('/api/v1/media/queue');
    expect(options.headers['Content-Type']).toBe('application/json');
  });

  it('sets loading to false after fetch completes even on error', async () => {
    global.fetch = vi.fn().mockRejectedValue(new Error('Network failure'));

    const { result } = renderHook(() => useMediaQueue());
    expect(result.current.loading).toBe(true);

    await waitFor(() => expect(result.current.loading).toBe(false));
    // State should remain at defaults
    expect(result.current.items).toHaveLength(0);
  });

  it('returns null for currentItem when the queue is empty', async () => {
    const { result } = renderHook(() => useMediaQueue());
    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.currentItem).toBeNull();
  });

  it('returns the item at the current position as currentItem', async () => {
    const serverQueue = makeQueueResponse({
      items: [
        { queueId: 'first', contentId: 'video:1', title: 'First' },
        { queueId: 'second', contentId: 'video:2', title: 'Second' },
      ],
      position: 1,
    });

    global.fetch = vi.fn().mockImplementation(() => fetchOk(serverQueue));
    const { result } = renderHook(() => useMediaQueue());
    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.currentItem).not.toBeNull();
    expect(result.current.currentItem.queueId).toBe('second');
  });
});

// ── Test 2: Optimistic update applied immediately before API resolves ──────

describe('optimistic update: state reflects new items before API responds', () => {
  it('addItems at end shows new item optimistically mid-flight', async () => {
    const initialQueue = makeQueueResponse({
      items: [{ queueId: 'existing', contentId: 'video:0', title: 'Existing' }],
    });

    // The POST is slow — controlled by a deferred promise
    let resolvePost;
    const postPromise = new Promise((resolve) => { resolvePost = resolve; });

    global.fetch = vi.fn()
      .mockImplementationOnce(() => fetchOk(initialQueue))  // mount fetch
      .mockImplementationOnce(() => postPromise);            // addItems POST

    const { result } = renderHook(() => useMediaQueue());
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.items).toHaveLength(1);

    const newItems = [{ queueId: 'new1', contentId: 'video:100', title: 'New Item' }];

    // Start addItems without awaiting it — we want to inspect mid-flight state
    act(() => {
      result.current.addItems(newItems, 'end');
    });

    // Optimistic update must be visible immediately (before API resolves)
    await waitFor(() => expect(result.current.items).toHaveLength(2));
    expect(result.current.items[1].queueId).toBe('new1');
    expect(result.current.items[1].title).toBe('New Item');

    // Resolve the deferred POST
    const confirmedQueue = makeQueueResponse({
      items: [...initialQueue.items, ...newItems],
    });
    await act(async () => {
      resolvePost(await fetchOk({ queue: confirmedQueue, added: newItems }));
    });

    expect(result.current.items).toHaveLength(2);
  });

  it('addItems with placement=next inserts after current position', async () => {
    const initialQueue = makeQueueResponse({
      items: [
        { queueId: 'a', contentId: 'v:1', title: 'A' },
        { queueId: 'b', contentId: 'v:2', title: 'B' },
        { queueId: 'c', contentId: 'v:3', title: 'C' },
      ],
      position: 0,
    });

    // The confirmed response must contain the full 4-item list so the API
    // response doesn't overwrite the optimistic state with fewer items.
    const inserted = [{ queueId: 'new', contentId: 'v:99', title: 'Next Up' }];
    const confirmedQueue = makeQueueResponse({
      items: [
        { queueId: 'a', contentId: 'v:1', title: 'A' },
        { queueId: 'new', contentId: 'v:99', title: 'Next Up' },
        { queueId: 'b', contentId: 'v:2', title: 'B' },
        { queueId: 'c', contentId: 'v:3', title: 'C' },
      ],
    });
    global.fetch = vi.fn()
      .mockImplementationOnce(() => fetchOk(initialQueue))
      .mockImplementationOnce(() => fetchOk({ queue: confirmedQueue, added: inserted }));

    const { result } = renderHook(() => useMediaQueue());
    await waitFor(() => expect(result.current.loading).toBe(false));

    act(() => { result.current.addItems(inserted, 'next'); });

    // Optimistically: [a, new, b, c] — new is inserted at index 1 (after position=0)
    // This must be visible before the API responds AND be stable after it responds.
    await waitFor(() => expect(result.current.items).toHaveLength(4));
    expect(result.current.items[0].queueId).toBe('a');
    expect(result.current.items[1].queueId).toBe('new');
    expect(result.current.items[2].queueId).toBe('b');
    expect(result.current.items[3].queueId).toBe('c');
  });
});

// ── Test 3: Rollback occurs on API failure ────────────────────────────────

describe('rollback: state reverts to pre-mutation when API fails', () => {
  it('addItems optimistically updates state then rolls back when POST rejects', async () => {
    const initialQueue = makeQueueResponse({
      items: [{ queueId: 'original', contentId: 'video:1', title: 'Original Item' }],
    });

    // A deferred POST that we can manually reject
    let rejectPost;
    const postPromise = new Promise((_, reject) => { rejectPost = reject; });

    global.fetch = vi.fn()
      .mockImplementationOnce(() => fetchOk(initialQueue))    // mount fetch
      .mockImplementationOnce(() => postPromise)              // addItems POST (slow)
      .mockRejectedValue(new Error('Network error'));         // retry call

    const { result } = renderHook(() => useMediaQueue());
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.items).toHaveLength(1);
    expect(result.current.items[0].queueId).toBe('original');

    // Trigger addItems — optimistic update should apply immediately
    act(() => {
      result.current.addItems(
        [{ queueId: 'will-fail', contentId: 'video:999', title: 'Will Fail' }],
        'end'
      );
    });

    // Optimistic update must be visible before the API responds
    await waitFor(() => expect(result.current.items).toHaveLength(2));
    expect(result.current.items[1].queueId).toBe('will-fail');

    // Now reject the POST — rollback should fire
    await act(async () => {
      rejectPost(new Error('Network error'));
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    // State rolls back to the pre-mutation snapshot
    await waitFor(() => expect(result.current.items).toHaveLength(1));
    expect(result.current.items[0].queueId).toBe('original');
  });

  it('rollback preserves ALL pre-mutation fields (position, shuffle, repeat, volume)', async () => {
    // Verify that rollback restores the COMPLETE queue state, not just items.
    // The rollbackState ref captures a snapshot of the entire queue object.
    const preState = makeQueueResponse({
      items: [
        { queueId: 'a', contentId: 'video:1', title: 'A' },
        { queueId: 'b', contentId: 'video:2', title: 'B' },
      ],
      position: 1,
      shuffle: true,
      repeat: 'all',
      volume: 0.6,
    });

    let rejectPost;
    const postPromise = new Promise((_, reject) => { rejectPost = reject; });

    global.fetch = vi.fn()
      .mockImplementationOnce(() => fetchOk(preState))
      .mockImplementationOnce(() => postPromise)
      .mockRejectedValue(new Error('Network error')); // retry

    const { result } = renderHook(() => useMediaQueue());
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.position).toBe(1);
    expect(result.current.shuffle).toBe(true);
    expect(result.current.repeat).toBe('all');
    expect(result.current.volume).toBeCloseTo(0.6);

    // Add an item — this will fail
    act(() => {
      result.current.addItems([{ queueId: 'c', contentId: 'v:3', title: 'C' }], 'end');
    });
    await waitFor(() => expect(result.current.items).toHaveLength(3));

    // Reject the POST → rollback
    await act(async () => {
      rejectPost(new Error('Network error'));
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    // All fields must be restored to pre-mutation values
    await waitFor(() => expect(result.current.items).toHaveLength(2));
    expect(result.current.position).toBe(1);      // position restored
    expect(result.current.shuffle).toBe(true);    // shuffle restored
    expect(result.current.repeat).toBe('all');    // repeat restored
    expect(result.current.volume).toBeCloseTo(0.6); // volume restored
  });
});

// ── Test 4: Self-echo suppression ─────────────────────────────────────────

describe('self-echo suppression: WebSocket broadcast with matching mutationId is ignored', () => {
  it('does not update state when a WS message carries the same mutationId as the last mutation', async () => {
    // Capture the WS subscription callback at render time
    let capturedWsCallback;
    useWebSocketSubscription.mockImplementation((_topic, cb) => {
      capturedWsCallback = cb;
    });

    const initialQueue = makeQueueResponse({
      items: [{ queueId: 'item1', contentId: 'video:1', title: 'Item One' }],
    });

    let sentMutationId;
    const postQueue = makeQueueResponse({
      items: [
        { queueId: 'item1', contentId: 'video:1', title: 'Item One' },
        { queueId: 'item2', contentId: 'video:2', title: 'Item Two' },
      ],
    });

    global.fetch = vi.fn().mockImplementation((url, options) => {
      if (options?.method === 'POST') {
        // Capture the mutationId from the request body
        const body = JSON.parse(options.body);
        sentMutationId = body.mutationId;
        return fetchOk({ queue: postQueue, added: [] });
      }
      return fetchOk(initialQueue);
    });

    const { result } = renderHook(() => useMediaQueue());

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(capturedWsCallback).toBeDefined();

    // Perform a mutation to generate lastMutationId
    await act(async () => {
      await result.current.addItems(
        [{ queueId: 'item2', contentId: 'video:2', title: 'Item Two' }],
        'end'
      );
    });

    await waitFor(() => expect(result.current.items).toHaveLength(2));
    expect(sentMutationId).toBeDefined();

    // Take a snapshot of the current state
    const itemCountBeforeEcho = result.current.items.length;
    const positionBeforeEcho = result.current.position;
    const shuffleBeforeEcho = result.current.shuffle;

    // Simulate a WebSocket broadcast echoing back the same mutationId.
    // The hook should IGNORE this message because it was caused by our own mutation.
    act(() => {
      capturedWsCallback({
        items: [
          { queueId: 'x1', contentId: 'v:99', title: 'Overridden 1' },
          { queueId: 'x2', contentId: 'v:98', title: 'Overridden 2' },
          { queueId: 'x3', contentId: 'v:97', title: 'Extra Item from Echo' },
        ],
        position: 99,
        shuffle: true,
        repeat: 'one',
        volume: 0.1,
        mutationId: sentMutationId, // Same ID — self-echo, must be suppressed
      });
    });

    // State must NOT have changed — self-echo was suppressed
    expect(result.current.items).toHaveLength(itemCountBeforeEcho);
    expect(result.current.items).toHaveLength(2); // Still 2, not 3
    expect(result.current.position).toBe(positionBeforeEcho);
    expect(result.current.shuffle).toBe(shuffleBeforeEcho);
    // Volume and position must not jump to the echo values
    expect(result.current.volume).not.toBeCloseTo(0.1);
    expect(result.current.position).not.toBe(99);
  });

  it('DOES apply a WS update when the mutationId differs (external peer change)', async () => {
    let capturedWsCallback;
    useWebSocketSubscription.mockImplementation((_topic, cb) => {
      capturedWsCallback = cb;
    });

    const { result } = renderHook(() => useMediaQueue());
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(capturedWsCallback).toBeDefined();

    // No mutations made: lastMutationId is null.
    // A broadcast from another client (different mutationId) should be applied.
    const externalPayload = {
      items: [{ queueId: 'ext1', contentId: 'video:5', title: 'Added by TV' }],
      position: 0,
      shuffle: false,
      repeat: 'off',
      volume: 0.8,
      mutationId: 'deadbeef', // A mutationId we did NOT generate
    };

    act(() => {
      capturedWsCallback(externalPayload);
    });

    // State SHOULD update — this is from another client
    await waitFor(() => expect(result.current.items).toHaveLength(1));
    expect(result.current.items[0].queueId).toBe('ext1');
    expect(result.current.volume).toBeCloseTo(0.8);
  });

  it('applies WS update when it carries no mutationId (legacy broadcast)', async () => {
    let capturedWsCallback;
    useWebSocketSubscription.mockImplementation((_topic, cb) => {
      capturedWsCallback = cb;
    });

    const { result } = renderHook(() => useMediaQueue());
    await waitFor(() => expect(result.current.loading).toBe(false));

    act(() => {
      capturedWsCallback({
        items: [{ queueId: 'noMid', contentId: 'v:1', title: 'No MutationId' }],
        position: 0, shuffle: false, repeat: 'off', volume: 1.0,
        // No mutationId field
      });
    });

    await waitFor(() => expect(result.current.items).toHaveLength(1));
    expect(result.current.items[0].queueId).toBe('noMid');
  });
});

// ── Test 5: removeItem mutation ───────────────────────────────────────────

describe('removeItem: optimistic removal with API confirmation', () => {
  it('removes item from items optimistically and confirms via API', async () => {
    const initialQueue = makeQueueResponse({
      items: [
        { queueId: 'qa', contentId: 'video:1', title: 'A' },
        { queueId: 'qb', contentId: 'video:2', title: 'B' },
      ],
    });
    const afterDeleteQueue = makeQueueResponse({
      items: [{ queueId: 'qa', contentId: 'video:1', title: 'A' }],
    });

    global.fetch = vi.fn()
      .mockImplementationOnce(() => fetchOk(initialQueue))
      .mockImplementationOnce(() => fetchOk(afterDeleteQueue));

    const { result } = renderHook(() => useMediaQueue());
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.items).toHaveLength(2);

    await act(async () => {
      await result.current.removeItem('qb');
    });

    await waitFor(() => expect(result.current.items).toHaveLength(1));
    expect(result.current.items[0].queueId).toBe('qa');

    // Verify the DELETE went to the correct URL
    const deleteCalls = global.fetch.mock.calls.filter(([, opts]) => opts?.method === 'DELETE');
    expect(deleteCalls).toHaveLength(1);
    expect(deleteCalls[0][0]).toContain('/api/v1/media/queue/items/qb');
  });
});

// ── Test 6: advance mutation ──────────────────────────────────────────────

describe('advance: optimistic position increment', () => {
  it('increments position optimistically before API responds', async () => {
    const initialQueue = makeQueueResponse({
      items: [
        { queueId: 'q1', contentId: 'video:1', title: 'One' },
        { queueId: 'q2', contentId: 'video:2', title: 'Two' },
        { queueId: 'q3', contentId: 'video:3', title: 'Three' },
      ],
      position: 0,
    });

    let resolveAdvance;
    const advancePromise = new Promise((resolve) => { resolveAdvance = resolve; });

    global.fetch = vi.fn()
      .mockImplementationOnce(() => fetchOk(initialQueue))
      .mockImplementationOnce(() => advancePromise);

    const { result } = renderHook(() => useMediaQueue());
    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.position).toBe(0);
    expect(result.current.currentItem?.queueId).toBe('q1');

    // Start advance without awaiting — check optimistic state mid-flight
    act(() => { result.current.advance(1); });

    // Optimistic: position bumped to 1 immediately
    await waitFor(() => expect(result.current.position).toBe(1));
    expect(result.current.currentItem?.queueId).toBe('q2');

    // Now resolve the API call with confirmed state
    await act(async () => {
      resolveAdvance(await fetchOk(makeQueueResponse({ items: initialQueue.items, position: 1 })));
    });

    // Position stays at 1 after confirmation
    expect(result.current.position).toBe(1);
  });
});

// ── Test 7: setShuffle / setRepeat state mutations ────────────────────────

describe('setShuffle and setRepeat: state mutations via API', () => {
  it('setShuffle sends PATCH with shuffle flag and updates state from response', async () => {
    const { result } = renderHook(() => useMediaQueue());
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.shuffle).toBe(false);

    const updatedQueue = makeQueueResponse({ shuffle: true });
    global.fetch = vi.fn().mockImplementation(() => fetchOk(updatedQueue));

    await act(async () => {
      await result.current.setShuffle(true);
    });

    await waitFor(() => expect(result.current.shuffle).toBe(true));

    const patchCalls = global.fetch.mock.calls.filter(([, opts]) => opts?.method === 'PATCH');
    expect(patchCalls).toHaveLength(1);
    const body = JSON.parse(patchCalls[0][1].body);
    expect(body.shuffle).toBe(true);
  });

  it('setRepeat sends PATCH with repeat mode and updates state from response', async () => {
    const { result } = renderHook(() => useMediaQueue());
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.repeat).toBe('off');

    const updatedQueue = makeQueueResponse({ repeat: 'all' });
    global.fetch = vi.fn().mockImplementation(() => fetchOk(updatedQueue));

    await act(async () => {
      await result.current.setRepeat('all');
    });

    await waitFor(() => expect(result.current.repeat).toBe('all'));

    const patchCalls = global.fetch.mock.calls.filter(([, opts]) => opts?.method === 'PATCH');
    expect(patchCalls).toHaveLength(1);
    const body = JSON.parse(patchCalls[0][1].body);
    expect(body.repeat).toBe('all');
  });
});

// ── Test 8: module export ─────────────────────────────────────────────────

describe('module exports', () => {
  it('exports useMediaQueue as a named function', async () => {
    const mod = await import('#frontend/hooks/media/useMediaQueue.js');
    expect(typeof mod.useMediaQueue).toBe('function');
  });
});
