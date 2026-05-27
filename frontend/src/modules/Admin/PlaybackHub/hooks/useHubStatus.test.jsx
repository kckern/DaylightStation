import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';

// ---------------------------------------------------------------------------
// Module-mock the WebSocketService BEFORE importing the hook.
// We capture the (filter, callback) pair that the hook subscribes with so
// tests can synthesize WS deliveries directly.
// ---------------------------------------------------------------------------
let lastSubscribeFilter = null;
let lastSubscribeCallback = null;
const unsubscribeFn = vi.fn();

vi.mock('../../../../services/WebSocketService.js', () => ({
  wsService: {
    subscribe: vi.fn((filter, callback) => {
      lastSubscribeFilter = filter;
      lastSubscribeCallback = callback;
      return unsubscribeFn;
    }),
  },
}));

import { useHubStatus } from './useHubStatus.js';
import { wsService } from '../../../../services/WebSocketService.js';

// Helpers --------------------------------------------------------------------

function makeDevice(color, overrides = {}) {
  return {
    position: 1,
    color,
    bt_connected: true,
    paused: false,
    now_playing: null,
    volume: 45,
    playlist_pos: 0,
    playlist_count: 0,
    armed_source: null,
    ...overrides,
  };
}

function deferred() {
  let resolve, reject;
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

// ---------------------------------------------------------------------------

describe('useHubStatus', () => {
  beforeEach(() => {
    lastSubscribeFilter = null;
    lastSubscribeCallback = null;
    unsubscribeFn.mockClear();
    wsService.subscribe.mockClear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('subscribes to the playback-hub:status topic', () => {
    global.fetch = vi.fn(() =>
      new Promise(() => {/* never resolves */})
    );

    renderHook(() => useHubStatus());

    expect(wsService.subscribe).toHaveBeenCalledTimes(1);
    expect(lastSubscribeFilter).toBe('playback-hub:status');
    expect(typeof lastSubscribeCallback).toBe('function');
  });

  it('renders an empty Map until the first payload arrives', () => {
    global.fetch = vi.fn(() =>
      new Promise(() => {/* never resolves */})
    );

    const { result } = renderHook(() => useHubStatus());
    expect(result.current).toBeInstanceOf(Map);
    expect(result.current.size).toBe(0);
  });

  it('on initial GET success → state has all devices keyed by color', async () => {
    const fetchedAt = '2026-05-27T17:32:01.234Z';
    const slots = ['red', 'yellow', 'green', 'blue', 'white'].map(makeDevice);
    global.fetch = vi.fn(() =>
      Promise.resolve({
        json: () => Promise.resolve({ ok: true, slots, fetchedAt }),
      })
    );

    const { result } = renderHook(() => useHubStatus());

    await waitFor(() => {
      expect(result.current.size).toBe(5);
    });

    for (const c of ['red', 'yellow', 'green', 'blue', 'white']) {
      expect(result.current.get(c)).toBeDefined();
      expect(result.current.get(c).color).toBe(c);
    }
  });

  it('race guard: WS message with NEWER fetchedAt before GET resolves; GET with OLDER fetchedAt is ignored', async () => {
    const oldAt = '2026-05-27T17:32:00.000Z';
    const newAt = '2026-05-27T17:32:05.000Z';
    const oldSlots = [makeDevice('red', { volume: 10 })];
    const newDevices = [makeDevice('red', { volume: 99 })];

    const getDeferred = deferred();
    global.fetch = vi.fn(() => getDeferred.promise);

    const { result } = renderHook(() => useHubStatus());

    // 1. WS delivers NEWER snapshot first.
    act(() => {
      lastSubscribeCallback({
        type: 'playback-hub.status.snapshot',
        data: { devices: newDevices, fetchedAt: newAt },
      });
    });

    await waitFor(() => {
      expect(result.current.get('red')?.volume).toBe(99);
    });

    // 2. Now the GET response (OLDER) lands. Race guard should reject it.
    await act(async () => {
      getDeferred.resolve({
        json: () => Promise.resolve({ ok: true, slots: oldSlots, fetchedAt: oldAt }),
      });
      await getDeferred.promise;
    });

    // Allow a microtask flush.
    await waitFor(() => {
      expect(result.current.get('red')?.volume).toBe(99); // unchanged
    });
  });

  it('GET resolves first, then WS overlays with NEWER fetchedAt → state updates to WS', async () => {
    const oldAt = '2026-05-27T17:32:00.000Z';
    const newAt = '2026-05-27T17:32:05.000Z';
    global.fetch = vi.fn(() =>
      Promise.resolve({
        json: () => Promise.resolve({
          ok: true,
          slots: [makeDevice('red', { volume: 10 })],
          fetchedAt: oldAt,
        }),
      })
    );

    const { result } = renderHook(() => useHubStatus());

    await waitFor(() => {
      expect(result.current.get('red')?.volume).toBe(10);
    });

    act(() => {
      lastSubscribeCallback({
        type: 'playback-hub.status.snapshot',
        data: {
          devices: [makeDevice('red', { volume: 99 })],
          fetchedAt: newAt,
        },
      });
    });

    await waitFor(() => {
      expect(result.current.get('red')?.volume).toBe(99);
    });
  });

  it('WS message with OLDER fetchedAt than current snapshot is rejected', async () => {
    const newAt = '2026-05-27T17:32:05.000Z';
    const olderAt = '2026-05-27T17:32:00.000Z';
    global.fetch = vi.fn(() =>
      Promise.resolve({
        json: () => Promise.resolve({
          ok: true,
          slots: [makeDevice('red', { volume: 99 })],
          fetchedAt: newAt,
        }),
      })
    );

    const { result } = renderHook(() => useHubStatus());

    await waitFor(() => {
      expect(result.current.get('red')?.volume).toBe(99);
    });

    act(() => {
      lastSubscribeCallback({
        type: 'playback-hub.status.snapshot',
        data: {
          devices: [makeDevice('red', { volume: 10 })],
          fetchedAt: olderAt,
        },
      });
    });

    expect(result.current.get('red')?.volume).toBe(99);
  });

  it('GET responses without ok=true are not accepted', async () => {
    global.fetch = vi.fn(() =>
      Promise.resolve({
        json: () => Promise.resolve({ ok: false, error: 'oops' }),
      })
    );

    const { result } = renderHook(() => useHubStatus());

    // Give time for the promise chain to settle.
    await new Promise((res) => setTimeout(res, 10));

    expect(result.current.size).toBe(0);
  });

  it('GET network errors are swallowed (WS will deliver)', async () => {
    global.fetch = vi.fn(() => Promise.reject(new Error('network')));

    const { result } = renderHook(() => useHubStatus());

    await new Promise((res) => setTimeout(res, 10));
    expect(result.current.size).toBe(0);

    // WS still works.
    act(() => {
      lastSubscribeCallback({
        type: 'playback-hub.status.snapshot',
        data: {
          devices: [makeDevice('red')],
          fetchedAt: '2026-05-27T17:32:00.000Z',
        },
      });
    });
    expect(result.current.get('red')).toBeDefined();
  });

  it('ignores WS messages with the wrong type', async () => {
    global.fetch = vi.fn(() =>
      new Promise(() => {/* never resolves */})
    );

    const { result } = renderHook(() => useHubStatus());

    act(() => {
      lastSubscribeCallback({
        type: 'something-else',
        data: {
          devices: [makeDevice('red')],
          fetchedAt: '2026-05-27T17:32:00.000Z',
        },
      });
    });

    expect(result.current.size).toBe(0);
  });

  it('unmount during in-flight fetch does not raise setState-on-unmounted warnings', async () => {
    const getDeferred = deferred();
    global.fetch = vi.fn(() => getDeferred.promise);

    const warnSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const { unmount } = renderHook(() => useHubStatus());
    unmount();

    // Resolve AFTER unmount — the cancel guard inside the hook should
    // prevent the setState call.
    await act(async () => {
      getDeferred.resolve({
        json: () => Promise.resolve({
          ok: true,
          slots: [makeDevice('red')],
          fetchedAt: '2026-05-27T17:32:00.000Z',
        }),
      });
      await getDeferred.promise;
    });

    // Any React "can't perform a React state update on an unmounted component"
    // warning would land via console.error.
    const sawUnmountWarning = warnSpy.mock.calls.some((args) =>
      args.some((a) => typeof a === 'string' && /unmounted/i.test(a))
    );
    expect(sawUnmountWarning).toBe(false);

    warnSpy.mockRestore();
  });

  it('calls the WS unsubscribe function on unmount', () => {
    global.fetch = vi.fn(() =>
      new Promise(() => {/* never resolves */})
    );

    const { unmount } = renderHook(() => useHubStatus());
    expect(unsubscribeFn).not.toHaveBeenCalled();
    unmount();
    expect(unsubscribeFn).toHaveBeenCalledTimes(1);
  });
});
