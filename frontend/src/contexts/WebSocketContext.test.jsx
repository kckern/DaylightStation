import { renderHook } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { WebSocketProvider, useWebSocket } from './WebSocketContext.jsx';

vi.mock('../services/WebSocketService', () => ({
  wsService: {
    onStatusChange: () => () => {},
    subscribe: () => () => {},
  },
}));

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it('reports success, HTTP refusal and a lost connection for manual localhost restarts', async () => {
  const fetch = vi.fn()
    .mockResolvedValueOnce({ ok: true, json: async () => ({ restarted: true }) })
    .mockResolvedValueOnce({ ok: false, status: 503 })
    .mockRejectedValueOnce(new TypeError('Offline'));
  vi.stubGlobal('fetch', fetch);
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});

  expect(window.location.hostname).toBe('localhost');
  const { result } = renderHook(useWebSocket, { wrapper: WebSocketProvider });
  expect(fetch).not.toHaveBeenCalled();
  await expect(result.current.restartWebSocketServer()).resolves.toBe(true);
  await expect(result.current.restartWebSocketServer()).resolves.toBe(false);
  await expect(result.current.restartWebSocketServer()).resolves.toBe(false);
  expect(fetch).toHaveBeenCalledTimes(3);
  for (const [url, init] of fetch.mock.calls) {
    expect(url).toBe('/api/v1/admin/ws/restart');
    expect(init.method).toBe('POST');
  }
});
