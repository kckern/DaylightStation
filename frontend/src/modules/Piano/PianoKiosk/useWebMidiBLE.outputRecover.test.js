import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useWebMidiBLE, isPortDelivering } from './useWebMidiBLE.js';

// Regression cover for the 2026-08-22 one-way-MIDI outage: the kiosk showed
// incoming notes while every outbound message vanished for hours. The JamCorder's
// `ble.in` counter sat at 0 and Android's `dumpsys midi` read
// `mInputPortOpen=[false]`, yet the output watchdog judged the link HEALTHY and
// re-bound the same dead port every 2s forever. Only a full page reload (which
// re-runs requestMIDIAccess) restored it.
//
// Two gaps produced that: (1) health was judged on `port.state` alone, which can
// read 'connected' while our native handle is stuck at connection:'pending', and
// (2) the watchdog only ever re-bound WITHIN the existing access object — it had
// no rung that re-acquires access, even though `resetLink()` already does exactly
// that behind a manual OperatorDrawer button.

const TICK = 2000;          // watchdog interval
const COOLDOWN_MS = 5 * 60 * 1000;

function mockAccess({ outState = 'connected', connection = 'open' } = {}) {
  const calls = { requests: 0 };
  const output = { id: 'o', name: 'jam-7e6', state: outState, connection, send: () => {} };
  const access = {
    inputs: new Map(),
    outputs: new Map([['o', output]]),
    onstatechange: null,
  };
  global.navigator.requestMIDIAccess = async () => { calls.requests += 1; return access; };
  return { access, output, calls };
}

beforeEach(() => { vi.useFakeTimers({ shouldAdvanceTime: true }); });
afterEach(() => { vi.useRealTimers(); });

describe('isPortDelivering', () => {
  it('is true only when the port is connected AND our handle is not stuck pending', () => {
    expect(isPortDelivering({ state: 'connected', connection: 'open' })).toBe(true);
    // 'closed' is the normal pre-send state — Web MIDI opens implicitly on send().
    expect(isPortDelivering({ state: 'connected', connection: 'closed' })).toBe(true);
    // The outage signature: device present, our handle never finished opening.
    expect(isPortDelivering({ state: 'connected', connection: 'pending' })).toBe(false);
    expect(isPortDelivering({ state: 'disconnected', connection: 'open' })).toBe(false);
    expect(isPortDelivering(null)).toBe(false);
  });
});

describe('useWebMidiBLE OUT auto-recover', () => {
  it('escalates to a re-acquire after the OUT port stays non-delivering', async () => {
    const { calls } = mockAccess({ outState: 'disconnected' });
    const { result } = renderHook(() => useWebMidiBLE({ acquireInput: false }));
    await act(async () => { await result.current.connect(); });
    const afterConnect = calls.requests;

    // Three consecutive failing watchdog ticks — re-binding within the dead
    // access is not enough, so the hook must re-request MIDI access.
    await act(async () => { await vi.advanceTimersByTimeAsync(TICK * 3 + 100); });
    expect(calls.requests).toBeGreaterThan(afterConnect);
  });

  it('does NOT escalate while the OUT port is delivering', async () => {
    const { calls } = mockAccess({ outState: 'connected', connection: 'open' });
    const { result } = renderHook(() => useWebMidiBLE({ acquireInput: false }));
    await act(async () => { await result.current.connect(); });
    const afterConnect = calls.requests;

    await act(async () => { await vi.advanceTimersByTimeAsync(TICK * 10); });
    expect(calls.requests).toBe(afterConnect);
  });

  it('rate-limits the escalation so a dead link cannot thrash the BLE stack', async () => {
    // A permanently dead port (e.g. the JamCorder powered off) must not trigger a
    // re-acquire every couple of seconds — that is the churn that got an earlier
    // auto-recovery attempt reverted for flapping the APK's BLE link.
    const { calls } = mockAccess({ outState: 'disconnected' });
    const { result } = renderHook(() => useWebMidiBLE({ acquireInput: false }));
    await act(async () => { await result.current.connect(); });
    const afterConnect = calls.requests;

    await act(async () => { await vi.advanceTimersByTimeAsync(TICK * 3 + 100); });
    const afterFirstReset = calls.requests;
    expect(afterFirstReset).toBeGreaterThan(afterConnect);

    // Well past many more failing ticks, but still inside the cooldown.
    await act(async () => { await vi.advanceTimersByTimeAsync(COOLDOWN_MS / 2); });
    expect(calls.requests).toBe(afterFirstReset);

    // Past the cooldown, one more attempt is allowed.
    await act(async () => { await vi.advanceTimersByTimeAsync(COOLDOWN_MS); });
    expect(calls.requests).toBeGreaterThan(afterFirstReset);
  });
});
