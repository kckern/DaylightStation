import { describe, expect, it, vi } from 'vitest';
import { resetPianoBridge } from './pianoBridgeClient.js';

describe('resetPianoBridge', () => {
  it('accepts only an HTTP-successful verified reset', async () => {
    const fetchImpl = vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ fixed: true, verdict: 'echo' }) }));
    await expect(resetPianoBridge({ fetchImpl })).resolves.toMatchObject({ ok: true, reason: 'fixed', verdict: 'echo' });
    expect(fetchImpl).toHaveBeenCalledWith('http://localhost:8770/reset', expect.objectContaining({ method: 'POST' }));
  });

  it.each([
    [{ ok: false, status: 503, json: async () => ({}) }, 'http-error'],
    [{ ok: true, status: 200, json: async () => ({ fixed: false }) }, 'not-fixed'],
    [{ ok: true, status: 200, json: async () => { throw new Error('bad json'); } }, 'invalid-response'],
  ])('returns structured failures', async (response, reason) => {
    await expect(resetPianoBridge({ fetchImpl: async () => response })).resolves.toMatchObject({ ok: false, reason });
  });

  it('aborts at the configured timeout', async () => {
    vi.useFakeTimers();
    const fetchImpl = vi.fn((_url, { signal }) => new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })))));
    const result = resetPianoBridge({ fetchImpl, timeoutMs: 50 });
    await vi.advanceTimersByTimeAsync(50);
    await expect(result).resolves.toMatchObject({ ok: false, reason: 'timeout' });
    vi.useRealTimers();
  });
});
