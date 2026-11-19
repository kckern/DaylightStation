import { describe, expect, it, vi } from 'vitest';
import { runPianoRepair } from './pianoConnection.js';
import { resetPianoBridge } from './pianoBridgeClient.js';

describe('resetPianoBridge', () => {
  it('completes normal Repair over the trusted bridge with legacy HTTP unavailable', async () => {
    const fetchImpl = vi.fn(() => { throw new Error('legacy stopped'); });
    const repairResult = vi.fn()
      .mockReturnValueOnce({ pending: true })
      .mockReturnValueOnce({ fixed: true, recoveredAt: 'L1', linkVerdict: 'VERIFIED' })
      .mockReturnValueOnce({ fixed: false, reason: 'write_port_closed', verdict: 'Port remained closed' });
    window.daylight = { piano: { startRepair: () => true, repairResult } };
    let generation = 0;
    const reassertSound = vi.fn();
    const deps = {
      bridgeAvailable: true, resetBridge: () => resetPianoBridge({ fetchImpl }),
      reacquireMidi: () => { generation++; return { ok: true }; },
      getSnapshot: () => ({ generation, health: 'ready' }), reassertSound, reassertLevel: vi.fn(),
    };
    try {
      await expect(runPianoRepair(deps)).resolves.toMatchObject({
        ok: true, phase: 'complete', bridgeResult: { recoveredAt: 'L1', verdict: 'VERIFIED' },
      });
      await expect(runPianoRepair(deps)).resolves.toMatchObject({
        ok: false, phase: 'bridge-reset', reason: 'write_port_closed', bridgeResult: { verdict: 'Port remained closed' },
      });
      expect(reassertSound).toHaveBeenCalledTimes(1);
      expect(fetchImpl).not.toHaveBeenCalled();
    } finally { delete window.daylight; }
  });

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
