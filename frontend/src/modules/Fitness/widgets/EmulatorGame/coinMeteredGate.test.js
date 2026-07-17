import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createCoinMeteredGate } from './coinMeteredGate.js';

/**
 * Build a fake economy api adapter. Fully controls balance / drainPerSecond /
 * depletion so metering assertions are exact. Records every call via vi.fn.
 */
function makeApi({ open, settleRes, closeRes, openError } = {}) {
  return {
    openSession: vi.fn(async () => {
      if (openError) throw openError;
      return open || { sessionId: 'ses_test', balance: 5, drainPerSecond: 1 };
    }),
    settle: vi.fn(async () => settleRes || { userId: 'u1', balance: 0, depleted: false }),
    close: vi.fn(async () => closeRes || { userId: 'u1', balance: 0 }),
  };
}

describe('createCoinMeteredGate', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('start() opens a session and becomes playable at the opening balance', async () => {
    const api = makeApi({ open: { sessionId: 'ses_test', balance: 5, drainPerSecond: 1 } });
    const gate = createCoinMeteredGate({ userId: 'u1', api });

    await gate.start();

    expect(api.openSession).toHaveBeenCalledTimes(1);
    expect(api.openSession).toHaveBeenCalledWith({ userId: 'u1', action: 'arcade-play', source: 'emulator' });
    expect(gate.getStatus().state).toBe('playing');
    expect(gate.getStatus().coins).toBe(5); // == balanceAtOpen, no ticks yet
    expect(gate.isPlayable()).toBe(true);
  });

  it('settles the CUMULATIVE running total, and a later settle sends a LARGER total', async () => {
    // balance 500 so it never depletes across two settle windows.
    const api = makeApi({ open: { sessionId: 'ses_test', balance: 500, drainPerSecond: 1 } });
    const gate = createCoinMeteredGate({ userId: 'u1', api, settleIntervalSec: 60, tickIntervalMs: 1000 });

    await gate.start();

    // 60s at drain 1 => cumulative 60 => exactly one settle.
    await vi.advanceTimersByTimeAsync(60_000);
    expect(api.settle).toHaveBeenCalledTimes(1);
    expect(api.settle).toHaveBeenLastCalledWith({ userId: 'u1', sessionId: 'ses_test', coins: 60 });

    // Another 60s => cumulative 120 (NOT reset to a per-interval delta).
    await vi.advanceTimersByTimeAsync(60_000);
    expect(api.settle).toHaveBeenCalledTimes(2);
    expect(api.settle).toHaveBeenLastCalledWith({ userId: 'u1', sessionId: 'ses_test', coins: 120 });
  });

  it('draining to zero transitions to depleted, clears the tick, and closes', async () => {
    const api = makeApi({ open: { sessionId: 'ses_test', balance: 5, drainPerSecond: 1 } });
    const gate = createCoinMeteredGate({ userId: 'u1', api, tickIntervalMs: 1000 });

    await gate.start();
    await vi.advanceTimersByTimeAsync(5_000); // 5 coins @ 1/s => depleted

    expect(gate.getStatus().state).toBe('depleted');
    expect(gate.isPlayable()).toBe(false);
    expect(api.close).toHaveBeenCalledTimes(1);
    expect(api.close).toHaveBeenCalledWith({ userId: 'u1', sessionId: 'ses_test', coins: 5 });

    // Tick interval is cleared: advancing further does nothing.
    const settleCallsBefore = api.settle.mock.calls.length;
    await vi.advanceTimersByTimeAsync(10_000);
    expect(api.settle.mock.calls.length).toBe(settleCallsBefore);
    expect(api.close).toHaveBeenCalledTimes(1);
  });

  it('start() rejection => depleted immediately, reason surfaced, no tick running', async () => {
    const api = makeApi({ openError: new Error('insufficient balance') });
    const gate = createCoinMeteredGate({ userId: 'u1', api });

    await gate.start();

    expect(gate.getStatus().state).toBe('depleted');
    expect(gate.isPlayable()).toBe(false);
    expect(gate.getStatus().reason).toBe('insufficient balance');

    // No interval was started: advancing time must not settle or close.
    await vi.advanceTimersByTimeAsync(120_000);
    expect(api.settle).not.toHaveBeenCalled();
    expect(api.close).not.toHaveBeenCalled();
  });

  it('stop() closes with the final cumulative and is idempotent', async () => {
    const api = makeApi({ open: { sessionId: 'ses_test', balance: 100, drainPerSecond: 1 } });
    // Large settle interval so no periodic settle fires before we stop.
    const gate = createCoinMeteredGate({ userId: 'u1', api, settleIntervalSec: 3600, tickIntervalMs: 1000 });

    await gate.start();
    await vi.advanceTimersByTimeAsync(3_000); // 3 coins consumed

    await gate.stop();
    await gate.stop(); // second call no-ops

    expect(api.close).toHaveBeenCalledTimes(1);
    expect(api.close).toHaveBeenCalledWith({ userId: 'u1', sessionId: 'ses_test', coins: 3 });
  });

  it('onChange fires on state changes and unsubscribe stops further callbacks', async () => {
    const api = makeApi({ open: { sessionId: 'ses_test', balance: 5, drainPerSecond: 1 } });
    const gate = createCoinMeteredGate({ userId: 'u1', api, tickIntervalMs: 1000 });

    const cb = vi.fn();
    const unsub = gate.onChange(cb);

    await gate.start(); // idle -> playing => one notify
    expect(cb).toHaveBeenCalledTimes(1);
    expect(cb).toHaveBeenLastCalledWith(expect.objectContaining({ state: 'playing' }));

    unsub();

    // Drain to depletion: transitions happen but the unsubscribed cb is not called.
    await vi.advanceTimersByTimeAsync(5_000);
    expect(cb).toHaveBeenCalledTimes(1);
    expect(gate.getStatus().state).toBe('depleted');
  });
});
