import { it, expect, vi } from 'vitest';
import { schoolApi } from './schoolApi.js';
it('passes the ACK AbortSignal to fetch and completes its status contract on cancellation', async () => {
  const controller = new AbortController();
  const fetchMock = vi.fn((url, options) => new Promise((resolve, reject) => options.signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')))));
  vi.stubGlobal('fetch', fetchMock);
  try {
    const result = schoolApi.selfServiceMountAck({ receipt: 'opaque', mounted: true }, { signal: controller.signal });
    expect(fetchMock.mock.calls[0][1].signal).toBe(controller.signal);
    controller.abort();
    expect(await result).toEqual({ ok: false, status: 0, data: null });
  } finally { vi.unstubAllGlobals(); }
});
