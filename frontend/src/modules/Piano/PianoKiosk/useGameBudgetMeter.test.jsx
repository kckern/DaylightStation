import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

vi.mock('../../../lib/logging/Logger.js', () => ({
  default: () => ({ child: () => h.logger }),
}));

import { activitySignal } from './activitySignal.js';
import useGameBudgetMeter from './useGameBudgetMeter.js';

// Builds a fake game-budget api adapter. Records every call (by argument
// object) so tests assert on exactly what was sent, never on elapsed real
// time or network behaviour. `open`/`settle`/`close` responses may be a
// plain object (returned every call), an Error (thrown every call), or an
// array (consumed in order, holding the last entry once exhausted) so a
// test can script "first settle is fine, second is depleted".
function makeResponder(spec, calls) {
  let queue = Array.isArray(spec) ? spec.slice() : null;
  return vi.fn(async (args) => {
    calls.push(args);
    const next = queue ? (queue.length > 1 ? queue.shift() : queue[0]) : spec;
    if (next instanceof Error) throw next;
    return next;
  });
}

function fakeApi({ open, settle, close, balance } = {}) {
  const calls = { open: [], settle: [], close: [], balance: [] };
  return {
    calls,
    open: makeResponder(open ?? { enabled: false }, calls.open),
    settle: makeResponder(settle ?? { secondsLeft: 0, depleted: false, deviceDepleted: false }, calls.settle),
    close: makeResponder(close ?? { ok: true }, calls.close),
    balance: makeResponder(balance ?? { enabled: false }, calls.balance),
  };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(1_000_000);
  // Fresh activity baseline for every test — activitySignal is a module
  // singleton, so without this a prior test's timestamp (now stale against
  // this test's fake clock) could read as "already idle" on mount.
  activitySignal.bump();
  h.logger.debug.mockClear();
  h.logger.info.mockClear();
  h.logger.warn.mockClear();
  h.logger.error.mockClear();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('useGameBudgetMeter', () => {
  it('a remount mid-session seeds from the server cumulative — reload is not free time', async () => {
    const api = fakeApi({
      open: {
        enabled: true, sessionId: 's1', cumulativeSeconds: 300, secondsLeft: 600,
        warnAtSeconds: 300, settleIntervalSec: 60, idleAfterSeconds: 90,
      },
    });
    renderHook(() => useGameBudgetMeter({ learnerId: 'kid_a', deviceId: 'kiosk', active: true, api }));
    await act(async () => { await vi.advanceTimersByTimeAsync(0); }); // let open resolve
    act(() => { activitySignal.bump(); });
    await act(async () => { await vi.advanceTimersByTimeAsync(60_000); });
    // First settle carries 300 (seed) + 60 (ticked) = 360 — NOT 60.
    expect(api.calls.settle.at(-1).cumulativeSeconds).toBe(360);
  });

  it('idle pauses the drain and resumes on the next activity bump', async () => {
    const api = fakeApi({
      open: {
        enabled: true, sessionId: 's1', cumulativeSeconds: 0, secondsLeft: 600,
        warnAtSeconds: 60, settleIntervalSec: 600, idleAfterSeconds: 90,
      },
    });
    const { result } = renderHook(() => useGameBudgetMeter({ learnerId: 'kid_a', deviceId: 'kiosk', active: true, api }));
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    act(() => { activitySignal.bump(); });
    await act(async () => { await vi.advanceTimersByTimeAsync(89_000); });
    expect(result.current.state).toBe('playing');
    await act(async () => { await vi.advanceTimersByTimeAsync(2_000); }); // crosses 90s idle
    expect(result.current.state).toBe('idle-paused');
    const before = result.current.secondsLeft;
    await act(async () => { await vi.advanceTimersByTimeAsync(30_000); });
    expect(result.current.secondsLeft).toBe(before); // paused = no drain
    act(() => { activitySignal.bump(); });
    await act(async () => { await vi.advanceTimersByTimeAsync(1_000); });
    expect(result.current.state).toBe('playing');
  });

  it('an open() failure fails open to unavailable — games stay unmetered, never locked out', async () => {
    const api = fakeApi({ open: new Error('network down') });
    const { result } = renderHook(() => useGameBudgetMeter({ learnerId: 'kid_a', deviceId: 'kiosk', active: true, api }));
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    expect(result.current.state).toBe('unavailable');
    expect(h.logger.warn).toHaveBeenCalledWith('budget.open-failed', expect.objectContaining({
      learnerId: 'kid_a', deviceId: 'kiosk', error: 'network down',
    }));
    // No session was opened, so no settle/close traffic should ever occur.
    await act(async () => { await vi.advanceTimersByTimeAsync(120_000); });
    expect(api.calls.settle).toHaveLength(0);
    expect(api.calls.close).toHaveLength(0);
  });

  it('enabled:false fails open to off — the feature is off, not broken', async () => {
    const api = fakeApi({ open: { enabled: false } });
    const { result } = renderHook(() => useGameBudgetMeter({ learnerId: 'kid_a', deviceId: 'kiosk', active: true, api }));
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    expect(result.current.state).toBe('off');
    expect(h.logger.warn).toHaveBeenCalledWith('budget.open-failed', expect.objectContaining({
      learnerId: 'kid_a', deviceId: 'kiosk', enabled: false,
    }));
  });

  it('a settle answering depleted:true closes the session and stops metering', async () => {
    const api = fakeApi({
      open: {
        enabled: true, sessionId: 's1', cumulativeSeconds: 0, secondsLeft: 5,
        warnAtSeconds: 2, settleIntervalSec: 5, idleAfterSeconds: 90,
      },
      settle: { secondsLeft: 0, depleted: true, deviceDepleted: false },
    });
    const { result } = renderHook(() => useGameBudgetMeter({ learnerId: 'kid_a', deviceId: 'kiosk', active: true, api }));
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    act(() => { activitySignal.bump(); });
    await act(async () => { await vi.advanceTimersByTimeAsync(5_000); }); // one settle window
    expect(result.current.state).toBe('depleted');
    expect(api.calls.settle).toHaveLength(1);
    expect(api.calls.settle[0].cumulativeSeconds).toBe(5);
    expect(api.calls.close).toHaveLength(1);
    expect(api.calls.close[0].cumulativeSeconds).toBe(5);

    // Ticking is torn down: nothing further happens.
    await act(async () => { await vi.advanceTimersByTimeAsync(30_000); });
    expect(api.calls.settle).toHaveLength(1);
    expect(api.calls.close).toHaveLength(1);
  });

  it('a settle answering deviceDepleted:true moves to device-depleted', async () => {
    const api = fakeApi({
      open: {
        enabled: true, sessionId: 's1', cumulativeSeconds: 0, secondsLeft: 600,
        warnAtSeconds: 60, settleIntervalSec: 5, idleAfterSeconds: 90,
      },
      settle: { secondsLeft: 400, depleted: false, deviceDepleted: true },
    });
    const { result } = renderHook(() => useGameBudgetMeter({ learnerId: 'kid_a', deviceId: 'kiosk', active: true, api }));
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    act(() => { activitySignal.bump(); });
    await act(async () => { await vi.advanceTimersByTimeAsync(5_000); });
    expect(result.current.state).toBe('device-depleted');
    expect(api.calls.close).toHaveLength(1);
  });

  it('crosses into warning when secondsLeft drops to the server-provided threshold', async () => {
    const api = fakeApi({
      open: {
        enabled: true, sessionId: 's1', cumulativeSeconds: 0, secondsLeft: 61,
        warnAtSeconds: 60, settleIntervalSec: 3600, idleAfterSeconds: 3600,
      },
    });
    const { result } = renderHook(() => useGameBudgetMeter({ learnerId: 'kid_a', deviceId: 'kiosk', active: true, api }));
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    act(() => { activitySignal.bump(); });
    await act(async () => { await vi.advanceTimersByTimeAsync(1_000); }); // 61 -> 60
    expect(result.current.secondsLeft).toBe(60);
    expect(result.current.state).toBe('warning');
    expect(result.current.warn).toBe(true);
  });

  it('unmount closes with the final cumulative', async () => {
    const api = fakeApi({
      open: {
        enabled: true, sessionId: 's1', cumulativeSeconds: 10, secondsLeft: 600,
        warnAtSeconds: 60, settleIntervalSec: 3600, idleAfterSeconds: 3600,
      },
    });
    const { unmount } = renderHook(() => useGameBudgetMeter({ learnerId: 'kid_a', deviceId: 'kiosk', active: true, api }));
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    act(() => { activitySignal.bump(); });
    await act(async () => { await vi.advanceTimersByTimeAsync(7_000); }); // seed 10 + 7 ticked = 17
    unmount();
    expect(api.calls.close).toHaveLength(1);
    expect(api.calls.close[0]).toMatchObject({ learnerId: 'kid_a', sessionId: 's1', cumulativeSeconds: 17 });
  });

  it('inactive never opens a session', async () => {
    const api = fakeApi({ open: { enabled: true, sessionId: 's1', cumulativeSeconds: 0, secondsLeft: 600 } });
    const { result } = renderHook(() => useGameBudgetMeter({ learnerId: 'kid_a', deviceId: 'kiosk', active: false, api }));
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    expect(result.current.state).toBe('off');
    expect(api.calls.open).toHaveLength(0);
  });
});
