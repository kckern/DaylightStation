import { it, expect, vi } from 'vitest';
import { schoolApi } from './schoolApi.js';
it('propagates ACK cancellation to fetch and completes its status contract', async () => {
  const controller = new AbortController();
  const fetchMock = vi.fn((url, options) => new Promise((resolve, reject) => options.signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')))));
  vi.stubGlobal('fetch', fetchMock);
  try {
    const result = schoolApi.selfServiceMountAck({ receipt: 'opaque', mounted: true }, { signal: controller.signal });
    const fetchSignal = fetchMock.mock.calls[0][1].signal;
    expect(fetchSignal).toBeInstanceOf(AbortSignal);
    expect(fetchSignal.aborted).toBe(false);
    controller.abort();
    expect(fetchSignal.aborted).toBe(true);
    expect(await result).toEqual({ ok: false, status: 0, data: null });
  } finally { vi.unstubAllGlobals(); }
});
