import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createAckRouter } from './ackRouter.js';

vi.mock('../logging/mediaLog.js', () => {
  const stub = new Proxy({}, { get: (t, k) => (t[k] ??= vi.fn()) });
  return { default: stub, mediaLog: stub };
});

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('ackRouter', () => {
  it('resolves a registered command on ok ack', async () => {
    const router = createAckRouter();
    const p = router.register('cmd-1', { action: 'play', deviceId: 'tv' });
    expect(router.resolve({ commandId: 'cmd-1', ok: true })).toBe(true);
    await expect(p).resolves.toEqual({ ok: true });
    expect(router.pendingCount()).toBe(0);
  });

  it('rejects on not-ok ack with the error message', async () => {
    const router = createAckRouter();
    const p = router.register('cmd-2', {});
    router.resolve({ commandId: 'cmd-2', ok: false, error: 'DEVICE_REFUSED' });
    await expect(p).rejects.toThrow('DEVICE_REFUSED');
  });

  it('rejects on timeout', async () => {
    const router = createAckRouter();
    const p = router.register('cmd-3', {});
    const assertion = expect(p).rejects.toThrow('ack-timeout:cmd-3');
    vi.advanceTimersByTime(6000);
    await assertion;
    expect(router.pendingCount()).toBe(0);
  });

  it('ignores acks for unknown commandIds', () => {
    const router = createAckRouter();
    expect(router.resolve({ commandId: 'ghost', ok: true })).toBe(false);
  });

  it('an ack that beats slow HTTP still resolves (registration precedes the call)', async () => {
    const router = createAckRouter();
    const p = router.register('cmd-4', {});
    // ack arrives "before" the HTTP promise would settle
    router.resolve({ commandId: 'cmd-4', ok: true });
    await expect(p).resolves.toEqual({ ok: true });
  });
});
