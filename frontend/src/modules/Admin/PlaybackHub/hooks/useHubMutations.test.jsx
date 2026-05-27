import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';

const { showMock } = vi.hoisted(() => ({ showMock: vi.fn() }));
vi.mock('@mantine/notifications', () => ({
  notifications: { show: (...args) => showMock(...args) },
}));

import { useHubMutations } from './useHubMutations.js';

// Helper: build a fetch mock response.
function ok(body, status = 200) {
  return Promise.resolve({
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(body),
  });
}

describe('useHubMutations', () => {
  let revalidate;

  beforeEach(() => {
    revalidate = vi.fn();
    global.fetch = vi.fn();
    showMock.mockClear();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  // --------------------------------------------------------------------
  // sendCommand
  // --------------------------------------------------------------------

  describe('sendCommand', () => {
    it('POSTs to /command and returns the result', async () => {
      global.fetch.mockReturnValueOnce(
        ok({ ok: true, applied: ['red'], skipped: [] })
      );

      const { result } = renderHook(() => useHubMutations({ revalidate }));

      let response;
      await act(async () => {
        response = await result.current.sendCommand({
          target: 'red',
          action: 'play',
          contentId: 'plex:670208',
        });
      });

      expect(global.fetch).toHaveBeenCalledTimes(1);
      const [url, opts] = global.fetch.mock.calls[0];
      expect(url).toBe('/api/v1/playback-hub/command');
      expect(opts.method).toBe('POST');
      expect(opts.headers['Content-Type']).toBe('application/json');
      expect(JSON.parse(opts.body)).toEqual({
        target: 'red',
        action: 'play',
        contentId: 'plex:670208',
      });
      expect(response).toEqual({
        ok: true,
        result: { ok: true, applied: ['red'], skipped: [] },
      });
    });

    it('auto-retries ONCE after 500ms on contention with only the contention targets', async () => {
      vi.useFakeTimers();
      global.fetch
        .mockReturnValueOnce(ok({
          ok: true,
          applied: ['red'],
          skipped: [
            { color: 'yellow', reason: 'contention' },
            { color: 'green', reason: 'contention' },
            { color: 'blue', reason: 'unreachable' },
          ],
        }))
        .mockReturnValueOnce(ok({
          ok: true,
          applied: ['yellow', 'green'],
          skipped: [],
        }));

      const { result } = renderHook(() => useHubMutations({ revalidate }));

      let promise;
      act(() => {
        promise = result.current.sendCommand({
          target: 'red,yellow,green,blue',
          action: 'play',
        });
      });

      // First fetch fired immediately.
      expect(global.fetch).toHaveBeenCalledTimes(1);

      // Allow the first response promise chain to settle (multiple microtasks).
      await act(async () => {
        await vi.advanceTimersByTimeAsync(0);
      });

      // Second fetch should not fire until 500ms passes.
      expect(global.fetch).toHaveBeenCalledTimes(1);

      // Advance past the retry delay.
      await act(async () => {
        await vi.advanceTimersByTimeAsync(500);
      });

      expect(global.fetch).toHaveBeenCalledTimes(2);
      const [, retryOpts] = global.fetch.mock.calls[1];
      expect(JSON.parse(retryOpts.body)).toEqual({
        target: 'yellow,green',
        action: 'play',
      });

      let response;
      await act(async () => {
        response = await promise;
      });
      expect(response.result.applied).toEqual(['yellow', 'green']);
    });

    it('does NOT retry a second time if the retry also returns contention', async () => {
      vi.useFakeTimers();
      global.fetch
        .mockReturnValueOnce(ok({
          ok: true,
          applied: [],
          skipped: [{ color: 'red', reason: 'contention' }],
        }))
        .mockReturnValueOnce(ok({
          ok: true,
          applied: [],
          skipped: [{ color: 'red', reason: 'contention' }],
        }));

      const { result } = renderHook(() => useHubMutations({ revalidate }));

      let promise;
      act(() => {
        promise = result.current.sendCommand({ target: 'red', action: 'play' });
      });

      await act(async () => {
        await vi.advanceTimersByTimeAsync(500);
      });

      let response;
      await act(async () => {
        response = await promise;
      });

      expect(global.fetch).toHaveBeenCalledTimes(2);
      expect(response.result.skipped).toEqual([{ color: 'red', reason: 'contention' }]);
    });

    it('does NOT retry on non-contention skips', async () => {
      vi.useFakeTimers();
      global.fetch.mockReturnValueOnce(ok({
        ok: true,
        applied: [],
        skipped: [
          { color: 'red', reason: 'unreachable' },
          { color: 'blue', reason: 'not-found' },
        ],
      }));

      const { result } = renderHook(() => useHubMutations({ revalidate }));

      let response;
      await act(async () => {
        response = await result.current.sendCommand({
          target: 'red,blue',
          action: 'play',
        });
      });

      // Advance plenty of time — should still be 1 call.
      await act(async () => {
        await vi.advanceTimersByTimeAsync(5000);
      });

      expect(global.fetch).toHaveBeenCalledTimes(1);
      expect(response.result.applied).toEqual([]);
    });
  });

  // --------------------------------------------------------------------
  // updateDevice
  // --------------------------------------------------------------------

  describe('updateDevice', () => {
    it('PATCHes /devices/:color and calls revalidate on success', async () => {
      global.fetch.mockReturnValueOnce(ok({
        ok: true,
        device: { color: 'red', volume: { max: 30 } },
      }));

      const { result } = renderHook(() => useHubMutations({ revalidate }));

      let response;
      await act(async () => {
        response = await result.current.updateDevice('red', {
          volume: { max: 30 },
        });
      });

      const [url, opts] = global.fetch.mock.calls[0];
      expect(url).toBe('/api/v1/playback-hub/devices/red');
      expect(opts.method).toBe('PATCH');
      expect(JSON.parse(opts.body)).toEqual({ volume: { max: 30 } });
      expect(revalidate).toHaveBeenCalledTimes(1);
      expect(response.result.device.color).toBe('red');
    });

    it('encodes special characters in the color path', async () => {
      global.fetch.mockReturnValueOnce(ok({ ok: true }));

      const { result } = renderHook(() => useHubMutations({ revalidate }));
      await act(async () => {
        await result.current.updateDevice('weird color', {});
      });

      expect(global.fetch.mock.calls[0][0]).toBe(
        '/api/v1/playback-hub/devices/weird%20color'
      );
    });

    it('does NOT call revalidate when PATCH returns 422', async () => {
      global.fetch.mockReturnValueOnce(ok(
        { ok: false, error: 'invariant violated' },
        422
      ));

      const { result } = renderHook(() => useHubMutations({ revalidate }));

      await act(async () => {
        await result.current.updateDevice('red', { volume: { max: -5 } });
      });

      expect(revalidate).not.toHaveBeenCalled();
    });
  });

  // --------------------------------------------------------------------
  // saveFire
  // --------------------------------------------------------------------

  describe('saveFire', () => {
    it('POSTs to /scheduled when no id (create)', async () => {
      global.fetch.mockReturnValueOnce(ok({
        ok: true,
        fire: { id: 'fire-new', time: '07:00' },
      }, 201));

      const { result } = renderHook(() => useHubMutations({ revalidate }));

      await act(async () => {
        await result.current.saveFire({
          time: '07:00',
          target: 'red',
          queue: 'plex:670208',
          days: 'weekdays',
        });
      });

      const [url, opts] = global.fetch.mock.calls[0];
      expect(url).toBe('/api/v1/playback-hub/scheduled');
      expect(opts.method).toBe('POST');
      expect(revalidate).toHaveBeenCalledTimes(1);
    });

    it('PUTs to /scheduled/:id when id is present (update)', async () => {
      global.fetch.mockReturnValueOnce(ok({
        ok: true,
        fire: { id: 'foo', time: '08:00' },
      }));

      const { result } = renderHook(() => useHubMutations({ revalidate }));

      await act(async () => {
        await result.current.saveFire({
          id: 'foo',
          time: '08:00',
          target: 'red',
          queue: 'plex:670208',
          days: 'weekdays',
        });
      });

      const [url, opts] = global.fetch.mock.calls[0];
      expect(url).toBe('/api/v1/playback-hub/scheduled/foo');
      expect(opts.method).toBe('PUT');
      expect(revalidate).toHaveBeenCalledTimes(1);
    });

    it('URL-encodes the fire id', async () => {
      global.fetch.mockReturnValueOnce(ok({ ok: true, fire: {} }));

      const { result } = renderHook(() => useHubMutations({ revalidate }));
      await act(async () => {
        await result.current.saveFire({ id: 'a b/c', time: '07:00' });
      });

      expect(global.fetch.mock.calls[0][0]).toBe(
        '/api/v1/playback-hub/scheduled/a%20b%2Fc'
      );
    });

    it('does NOT call revalidate on a non-2xx response', async () => {
      global.fetch.mockReturnValueOnce(ok(
        { ok: false, error: 'bad' },
        400
      ));

      const { result } = renderHook(() => useHubMutations({ revalidate }));
      await act(async () => {
        await result.current.saveFire({ time: '07:00' });
      });

      expect(revalidate).not.toHaveBeenCalled();
    });
  });

  // --------------------------------------------------------------------
  // deleteFire
  // --------------------------------------------------------------------

  describe('deleteFire', () => {
    it('DELETEs /scheduled/:id and calls revalidate', async () => {
      global.fetch.mockReturnValueOnce(Promise.resolve({
        ok: true,
        status: 204,
        json: () => Promise.resolve({}),
      }));

      const { result } = renderHook(() => useHubMutations({ revalidate }));

      let response;
      await act(async () => {
        response = await result.current.deleteFire('foo');
      });

      const [url, opts] = global.fetch.mock.calls[0];
      expect(url).toBe('/api/v1/playback-hub/scheduled/foo');
      expect(opts.method).toBe('DELETE');
      expect(revalidate).toHaveBeenCalledTimes(1);
      expect(response).toEqual({ ok: true, result: { ok: true } });
    });

    it('does NOT call revalidate on a non-2xx response', async () => {
      global.fetch.mockReturnValueOnce(Promise.resolve({
        ok: false,
        status: 404,
        json: () => Promise.resolve({ ok: false }),
      }));

      const { result } = renderHook(() => useHubMutations({ revalidate }));

      let response;
      await act(async () => {
        response = await result.current.deleteFire('missing');
      });

      expect(revalidate).not.toHaveBeenCalled();
      expect(response.ok).toBe(false);
    });
  });

  // --------------------------------------------------------------------
  // Feedback shape (returns { ok, result, error })
  // --------------------------------------------------------------------

  describe('feedback wiring', () => {
    it('sendCommand returns { ok: true, result } on full success', async () => {
      global.fetch.mockReturnValueOnce(ok({
        ok: true, applied: ['red'], skipped: [],
      }));

      const { result } = renderHook(() => useHubMutations({ revalidate }));
      let response;
      await act(async () => {
        response = await result.current.sendCommand({
          target: 'red', action: 'play',
        });
      });

      expect(response).toEqual({
        ok: true,
        result: { ok: true, applied: ['red'], skipped: [] },
      });
    });

    it('sendCommand returns { ok: true, result } AND shows a partial toast when skipped is non-empty', async () => {
      global.fetch.mockReturnValueOnce(ok({
        ok: true,
        applied: [],
        skipped: [{ color: 'white', reason: 'unreachable' }],
      }, 502));

      const { result } = renderHook(() => useHubMutations({ revalidate }));
      let response;
      await act(async () => {
        response = await result.current.sendCommand({
          target: 'white', action: 'play',
        });
      });

      expect(response.ok).toBe(true);
      expect(response.result.skipped).toEqual([
        { color: 'white', reason: 'unreachable' },
      ]);
      const yellow = showMock.mock.calls.find((c) => c[0].color === 'yellow');
      expect(yellow).toBeTruthy();
      expect(yellow[0].message).toContain('white');
      expect(yellow[0].message).toContain('unreachable');
    });

    it('sendCommand returns { ok: false, error } when fetch rejects', async () => {
      global.fetch.mockRejectedValueOnce(new Error('network'));

      const { result } = renderHook(() => useHubMutations({ revalidate }));
      let response;
      await act(async () => {
        response = await result.current.sendCommand({
          target: 'red', action: 'play',
        });
      });

      expect(response.ok).toBe(false);
      expect(response.error.message).toBe('network');
      const red = showMock.mock.calls.find((c) => c[0].color === 'red');
      expect(red).toBeTruthy();
    });

    it('updateDevice returns { ok: false, error } when response is non-2xx', async () => {
      global.fetch.mockReturnValueOnce(ok(
        { ok: false, error: 'invariant violated: max < min' },
        422,
      ));

      const { result } = renderHook(() => useHubMutations({ revalidate }));
      let response;
      await act(async () => {
        response = await result.current.updateDevice('red', { volume: { min: 90, max: 10 } });
      });

      expect(response.ok).toBe(false);
      expect(response.error.message).toContain('invariant violated');
      expect(revalidate).not.toHaveBeenCalled();
      const red = showMock.mock.calls.find((c) => c[0].color === 'red');
      expect(red).toBeTruthy();
      expect(red[0].message).toContain('invariant violated');
    });
  });

  // --------------------------------------------------------------------
  // Without revalidate
  // --------------------------------------------------------------------

  it('works when no revalidate callback is provided', async () => {
    global.fetch.mockReturnValueOnce(ok({ ok: true, device: {} }));

    const { result } = renderHook(() => useHubMutations({}));

    await act(async () => {
      await result.current.updateDevice('red', {});
    });

    // Should not throw.
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });
});
