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
    // enabled:false is the normal "feature is off" state, not a failure —
    // it must NOT land on budget.open-failed (level:warn), or turning the
    // feature off in household config would read as a broken feature.
    expect(h.logger.debug).toHaveBeenCalledWith('budget.disabled', expect.objectContaining({
      learnerId: 'kid_a', deviceId: 'kiosk',
    }));
    expect(h.logger.warn).not.toHaveBeenCalledWith('budget.open-failed', expect.anything());
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

  // Important #1 (coordinator review): `open` carries the LIVE balance (the
  // server holds this session's history across matches within the same
  // study day). A learner who already exhausted today's allowance and then
  // starts a NEW match must land in `depleted` immediately — not re-arm a
  // fresh warning-then-playing window every time `active` flips true again.
  it('a re-open after depletion enters depleted directly, without re-arming a window', async () => {
    const api = fakeApi({
      open: {
        enabled: true, sessionId: 's1', cumulativeSeconds: 900, secondsLeft: 0,
        learnerSecondsLeft: 0, deviceSecondsLeft: 500,
        warnAtSeconds: 60, settleIntervalSec: 60, idleAfterSeconds: 90,
      },
    });
    const { result } = renderHook(() => useGameBudgetMeter({ learnerId: 'kid_a', deviceId: 'kiosk', active: true, api }));
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    expect(result.current.state).toBe('depleted');
    // No tick was armed: nothing to settle, ever, for this mount.
    await act(async () => { await vi.advanceTimersByTimeAsync(120_000); });
    expect(api.calls.settle).toHaveLength(0);
  });

  it('a re-open with the device (not the learner) depleted enters device-depleted directly', async () => {
    const api = fakeApi({
      open: {
        enabled: true, sessionId: 's1', cumulativeSeconds: 100, secondsLeft: 200,
        learnerSecondsLeft: 200, deviceSecondsLeft: 0,
        warnAtSeconds: 60, settleIntervalSec: 60, idleAfterSeconds: 90,
      },
    });
    const { result } = renderHook(() => useGameBudgetMeter({ learnerId: 'kid_a', deviceId: 'kiosk', active: true, api }));
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    expect(result.current.state).toBe('device-depleted');
    await act(async () => { await vi.advanceTimersByTimeAsync(120_000); });
    expect(api.calls.settle).toHaveLength(0);
  });

  // Final whole-branch review: the ONE place the assembled system used to fail
  // CLOSED on infrastructure. A malformed `enabled:true` open — a truncated
  // proxy reply, a partial 200 during a restart — seeded the learner balance
  // from `secondsLeftLocal`, which is 0 whenever `secondsLeft` was itself
  // non-finite, and locked a child with a full allowance out of games behind
  // "Games are done for today", logged as `budget.depleted` and so
  // indistinguishable from a real one. Only an affirmative finite balance
  // closes the gate now.
  it('a malformed open with no balance fields plays on instead of locking the child out', async () => {
    const api = fakeApi({
      open: {
        enabled: true, sessionId: 's1', cumulativeSeconds: 0,
        // secondsLeft / learnerSecondsLeft / deviceSecondsLeft all absent.
        warnAtSeconds: 60, settleIntervalSec: 60, idleAfterSeconds: 90,
      },
    });
    const { result } = renderHook(() => useGameBudgetMeter({ learnerId: 'kid_a', deviceId: 'kiosk', active: true, api }));
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    expect(result.current.state).not.toBe('depleted');
    expect(result.current.state).not.toBe('device-depleted');
  });

  // Important #2 (coordinator review): a 409 means the sessionId's recorded
  // learnerId doesn't match the caller — permanent, never fixed by retrying.
  it('a 409 from settle is permanent — stops the tick, fails open, and never calls close for a session that is not ours', async () => {
    const mismatch = Object.assign(
      new Error('HTTP 409: Conflict - session belongs to a different learner'),
      { status: 409 },
    );
    const api = fakeApi({
      open: {
        enabled: true, sessionId: 's1', cumulativeSeconds: 0, secondsLeft: 600,
        warnAtSeconds: 60, settleIntervalSec: 5, idleAfterSeconds: 90,
      },
      settle: mismatch,
    });
    const { result } = renderHook(() => useGameBudgetMeter({ learnerId: 'kid_a', deviceId: 'kiosk', active: true, api }));
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    act(() => { activitySignal.bump(); });
    await act(async () => { await vi.advanceTimersByTimeAsync(5_000); }); // first settle window -> 409
    expect(result.current.state).toBe('unavailable');
    expect(api.calls.settle).toHaveLength(1);
    expect(api.calls.close).toHaveLength(0);
    expect(h.logger.warn).toHaveBeenCalledWith('budget.learner-mismatch', expect.objectContaining({
      learnerId: 'kid_a', sessionId: 's1',
    }));

    // Ticking is torn down: advancing further sends no further settles.
    await act(async () => { await vi.advanceTimersByTimeAsync(60_000); });
    expect(api.calls.settle).toHaveLength(1);
  });

  // Important #3 (coordinator review): a settle that never resolves (a
  // dropped kiosk network) must not wedge `settling` shut for the rest of
  // the session — the next window has to actually try again.
  it('a settle that never resolves times out and un-wedges the loop for the next window', async () => {
    const calls = { open: [], settle: [], close: [] };
    let settleAttempts = 0;
    let hungResolve;
    const hungForever = new Promise((resolve) => { hungResolve = resolve; }); // never resolved in this test
    const api = {
      calls,
      open: vi.fn(async (args) => {
        calls.open.push(args);
        return {
          enabled: true, sessionId: 's1', cumulativeSeconds: 0, secondsLeft: 600,
          warnAtSeconds: 60, settleIntervalSec: 10, idleAfterSeconds: 90,
        };
      }),
      settle: vi.fn(async (args) => {
        calls.settle.push(args);
        settleAttempts += 1;
        if (settleAttempts === 1) return hungForever;
        return { secondsLeft: 500, depleted: false, deviceDepleted: false };
      }),
      close: vi.fn(async (args) => { calls.close.push(args); return { ok: true }; }),
      balance: vi.fn(async () => ({ enabled: false })),
    };

    renderHook(() => useGameBudgetMeter({ learnerId: 'kid_a', deviceId: 'kiosk', active: true, api }));
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    act(() => { activitySignal.bump(); });
    await act(async () => { await vi.advanceTimersByTimeAsync(10_000); }); // first window: hangs
    expect(calls.settle).toHaveLength(1);

    // Advance past SETTLE_TIMEOUT_MS (15s from the hung call) without ever
    // resolving it — `settling` must clear via the timeout race, not the hang.
    await act(async () => { await vi.advanceTimersByTimeAsync(15_000); }); // t=25s: timeout fires
    await act(async () => { await vi.advanceTimersByTimeAsync(5_000); }); // t=30s: next window
    expect(calls.settle.length).toBeGreaterThanOrEqual(2);
    expect(h.logger.warn).toHaveBeenCalledWith('budget.settle-failed', expect.objectContaining({ timedOut: true }));

    hungResolve({ secondsLeft: 600, depleted: false, deviceDepleted: false }); // avoid an unhandled-rejection style dangler
  });

  // Minor (coordinator review): a malformed cumulativeSeconds still fails
  // open (0 is safe), but must not fail SILENTLY — it is a server-contract
  // violation this hook's whole design exists to be loud about.
  it('an invalid cumulativeSeconds seed falls back to 0 but warns loudly', async () => {
    const api = fakeApi({
      open: {
        enabled: true, sessionId: 's1', cumulativeSeconds: null, secondsLeft: 600,
        warnAtSeconds: 60, settleIntervalSec: 3600, idleAfterSeconds: 3600,
      },
    });
    renderHook(() => useGameBudgetMeter({ learnerId: 'kid_a', deviceId: 'kiosk', active: true, api }));
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    expect(h.logger.warn).toHaveBeenCalledWith('budget.seed-invalid', expect.objectContaining({
      learnerId: 'kid_a', sessionId: 's1', cumulativeSeconds: null,
    }));
  });
});
