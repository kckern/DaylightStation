import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { PianoScreenAuthorityService } from '#apps/devices/services/PianoScreenAuthorityService.mjs';

const POLL_MS = 3000;
const OFF_DEBOUNCE_MS = 15000;
const RECONCILE_MS = 45000;

function makeLogger() {
  return { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
}

/**
 * A stateful FKB-like device. `getStatus()` reflects an internal screenOn that
 * `setScreen()` mutates — models a healthy device that obeys commands. Tests can
 * force drift via `_setScreenOn` to simulate the browser turning the panel on.
 */
function makeStatefulDevice(initialScreenOn = false) {
  let screenOn = initialScreenOn;
  return {
    _setScreenOn: (v) => { screenOn = v; },
    _screenOn: () => screenOn,
    setScreen: vi.fn(async (on) => { screenOn = on; return { ok: true }; }),
    getStatus: vi.fn(async () => ({ ready: true, screenOn })),
    clearContent: vi.fn(async () => ({ ok: true })),
  };
}

/**
 * A device whose panel is stuck OFF: setScreen resolves ok but getStatus always
 * reports screenOn:false. Used to exercise verify-mismatch → retry → escalate.
 */
function makeStuckOffDevice() {
  return {
    setScreen: vi.fn(async () => ({ ok: true })),
    getStatus: vi.fn(async () => ({ ready: true, screenOn: false })),
    clearContent: vi.fn(async () => ({ ok: true })),
  };
}

function makeGateway(getStateImpl) {
  return {
    getState: vi.fn(getStateImpl),
    callService: vi.fn(async () => ({ ok: true })),
  };
}

function makeService({ gateway, device, overrides = {} } = {}) {
  const logger = makeLogger();
  const svc = new PianoScreenAuthorityService({
    haGateway: gateway,
    deviceService: { get: vi.fn().mockReturnValue(device) },
    logger,
    clock: { now: () => Date.now() },
    deviceId: 'yellow-room-tablet',
    pianoPowerEntity: 'binary_sensor.yellow_room_piano_power',
    pollIntervalMs: POLL_MS,
    offDebounceMs: OFF_DEBOUNCE_MS,
    reconcileIntervalMs: RECONCILE_MS,
    maxRetries: 3,
    notifyService: 'mobile_app_kc_phone',
    // Make retry backoff instant so fake timers don't need to chase it.
    sleep: () => Promise.resolve(),
    ...overrides,
  });
  return { svc, logger };
}

function offCalls(device) {
  return device.setScreen.mock.calls.filter(([on]) => on === false).length;
}
function onCalls(device) {
  return device.setScreen.mock.calls.filter(([on]) => on === true).length;
}

describe('PianoScreenAuthorityService', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('OFF→ON edge pulses setScreen(true) immediately (one poll, not debounced)', async () => {
    // Piano reads OFF, then flips ON. Establish a confirmed-off first, then flip.
    let power = 'off';
    const device = makeStatefulDevice(true); // screen currently on
    const gateway = makeGateway(async () => ({ state: power }));
    const { svc } = makeService({ gateway, device });
    svc.start();

    // Drive continuous-off past the debounce → confirmed off, screen forced off.
    await vi.advanceTimersByTimeAsync(OFF_DEBOUNCE_MS + POLL_MS * 2);
    expect(offCalls(device)).toBeGreaterThanOrEqual(1);

    // Now flip the piano ON — the wake edge.
    power = 'on';
    const onBefore = onCalls(device);
    await vi.advanceTimersByTimeAsync(POLL_MS); // a single poll
    expect(onCalls(device)).toBe(onBefore + 1); // immediate, single pulse
  });

  it('ON→OFF edge does NOT screenOff until offDebounceMs of continuous OFF', async () => {
    let power = 'on';
    const device = makeStatefulDevice(true);
    const gateway = makeGateway(async () => ({ state: power }));
    const { svc } = makeService({ gateway, device });
    svc.start();

    await vi.advanceTimersByTimeAsync(POLL_MS); // observe ON
    power = 'off';

    // Just under the debounce window → still no screenOff.
    await vi.advanceTimersByTimeAsync(OFF_DEBOUNCE_MS - POLL_MS);
    expect(offCalls(device)).toBe(0);
  });

  it('fires setScreen(false) after offDebounceMs of continuous OFF', async () => {
    let power = 'on';
    const device = makeStatefulDevice(true);
    const gateway = makeGateway(async () => ({ state: power }));
    const { svc } = makeService({ gateway, device });
    svc.start();

    await vi.advanceTimersByTimeAsync(POLL_MS);
    power = 'off';
    await vi.advanceTimersByTimeAsync(OFF_DEBOUNCE_MS + POLL_MS * 2);
    expect(offCalls(device)).toBeGreaterThanOrEqual(1);
  });

  it('transient dip (on→off→on within window) cancels the debounce — NO screenOff, NO wake pulse', async () => {
    // Scripted sequence per poll: on, off, on, on, on...
    const seq = ['on', 'off', 'on'];
    let i = 0;
    const device = makeStatefulDevice(true);
    const gateway = makeGateway(async () => ({ state: seq[Math.min(i++, seq.length - 1)] }));
    const { svc } = makeService({ gateway, device });
    svc.start();

    await vi.advanceTimersByTimeAsync(POLL_MS * 5); // well past the 3 scripted reads
    expect(offCalls(device)).toBe(0); // dip never applied off
    expect(onCalls(device)).toBe(0);  // no confirmed-off, so no wake pulse either
  });

  it('reconcile: piano OFF (past debounce) + real screen ON → setScreen(false)', async () => {
    const device = makeStatefulDevice(true);
    const gateway = makeGateway(async () => ({ state: 'off' }));
    const { svc } = makeService({ gateway, device });
    svc.start();

    // Commit off (screen forced off during poll).
    await vi.advanceTimersByTimeAsync(OFF_DEBOUNCE_MS + POLL_MS * 2);
    const offBefore = offCalls(device);

    // Browser drifts the panel back ON while piano stays off.
    device._setScreenOn(true);

    // Advance to a reconcile tick.
    await vi.advanceTimersByTimeAsync(RECONCILE_MS);
    expect(offCalls(device)).toBeGreaterThan(offBefore); // reconcile corrected it
    expect(device._screenOn()).toBe(false);
  });

  it('reconcile never calls setScreen while the piano is ON (browser owns on-state)', async () => {
    const device = makeStatefulDevice(true);
    const gateway = makeGateway(async () => ({ state: 'on' }));
    const { svc } = makeService({ gateway, device });
    svc.start();

    await vi.advanceTimersByTimeAsync(RECONCILE_MS + POLL_MS * 2);
    expect(device.setScreen).not.toHaveBeenCalled();
  });

  it('fail-safe: getState returns null → treated as ON, never screenOff', async () => {
    const device = makeStatefulDevice(true);
    const gateway = makeGateway(async () => null);
    const { svc } = makeService({ gateway, device });
    svc.start();

    await vi.advanceTimersByTimeAsync(OFF_DEBOUNCE_MS * 4);
    expect(device.setScreen).not.toHaveBeenCalled();
  });

  it('fail-safe: getState rejects → treated as ON, never screenOff', async () => {
    const device = makeStatefulDevice(true);
    const gateway = makeGateway(async () => { throw new Error('HA unreachable'); });
    const { svc } = makeService({ gateway, device });
    svc.start();

    await vi.advanceTimersByTimeAsync(OFF_DEBOUNCE_MS * 4);
    expect(device.setScreen).not.toHaveBeenCalled();
  });

  it('fail-safe: a prior armed-off does not fire once readings go unknown', async () => {
    // off (arm) → null (unknown, cancels) → null... → never fires screenOff.
    const seq = ['off', null, null, null, null, null, null, null, null, null];
    let i = 0;
    const device = makeStatefulDevice(true);
    const gateway = makeGateway(async () => {
      const v = seq[Math.min(i++, seq.length - 1)];
      return v === null ? null : { state: v };
    });
    const { svc } = makeService({ gateway, device });
    svc.start();

    await vi.advanceTimersByTimeAsync(OFF_DEBOUNCE_MS * 3);
    expect(offCalls(device)).toBe(0);
  });

  it('verify/retry/escalate: stuck panel → retries, loadStartUrl escalation, then notify', async () => {
    let power = 'off';
    const device = makeStuckOffDevice(); // screen reports off forever
    const gateway = makeGateway(async () => ({ state: power }));
    const { svc } = makeService({ gateway, device });
    svc.start();

    // Confirm-off first: setScreen(false) verifies fine (panel already off).
    await vi.advanceTimersByTimeAsync(OFF_DEBOUNCE_MS + POLL_MS * 2);

    // Flip ON → applyScreen(true). Panel never reports on → retries → escalate → notify.
    power = 'on';
    await vi.advanceTimersByTimeAsync(POLL_MS);

    expect(device.setScreen).toHaveBeenCalledWith(true);
    // Retried maxRetries times before escalating (>=2 setScreen(true) calls).
    expect(onCalls(device)).toBeGreaterThanOrEqual(2);
    expect(device.clearContent).toHaveBeenCalled(); // loadStartUrl revive
    expect(gateway.callService).toHaveBeenCalledWith(
      'notify',
      'mobile_app_kc_phone',
      expect.objectContaining({ title: expect.any(String) }),
    );
  });

  it('no-throw: a rejecting getState does not stop the poll interval', async () => {
    const device = makeStatefulDevice(true);
    const gateway = makeGateway(async () => { throw new Error('boom'); });
    const { svc } = makeService({ gateway, device });
    svc.start();

    await vi.advanceTimersByTimeAsync(POLL_MS);
    const after1 = gateway.getState.mock.calls.length;
    await vi.advanceTimersByTimeAsync(POLL_MS * 2);
    expect(gateway.getState.mock.calls.length).toBeGreaterThan(after1); // interval alive
  });

  it('no-throw: a rejecting setScreen on the wake edge does not stop the poll interval', async () => {
    let power = 'off';
    const device = makeStatefulDevice(true);
    // setScreen rejects only for the ON pulse; OFF still works so we can confirm off.
    device.setScreen = vi.fn(async (on) => {
      if (on === true) throw new Error('setScreen boom');
      return { ok: true };
    });
    device.getStatus = vi.fn(async () => ({ ready: true, screenOn: false }));
    const gateway = makeGateway(async () => ({ state: power }));
    const { svc } = makeService({ gateway, device });
    svc.start();

    await vi.advanceTimersByTimeAsync(OFF_DEBOUNCE_MS + POLL_MS * 2); // confirm off
    power = 'on';
    await vi.advanceTimersByTimeAsync(POLL_MS); // wake edge → setScreen(true) rejects

    const after = gateway.getState.mock.calls.length;
    await vi.advanceTimersByTimeAsync(POLL_MS * 2);
    expect(gateway.getState.mock.calls.length).toBeGreaterThan(after); // still ticking
  });

  it('stop() clears both intervals', async () => {
    const device = makeStatefulDevice(true);
    const gateway = makeGateway(async () => ({ state: 'on' }));
    const { svc } = makeService({ gateway, device });
    svc.start();

    await vi.advanceTimersByTimeAsync(POLL_MS * 2);
    const before = gateway.getState.mock.calls.length;
    svc.stop();
    await vi.advanceTimersByTimeAsync(POLL_MS * 10 + RECONCILE_MS);
    expect(gateway.getState.mock.calls.length).toBe(before);
  });

  it('constructor throws when required deps are missing', () => {
    expect(() => new PianoScreenAuthorityService({})).toThrow();
    expect(() => new PianoScreenAuthorityService({
      haGateway: makeGateway(async () => null),
      deviceService: { get: () => null },
      // no deviceId / pianoPowerEntity
    })).toThrow();
  });
});

// ── override coordination ────────────────────────────────────────────────────
function makeOverride(entry = null) {
  return { get: vi.fn(() => entry) };
}

describe('PianoScreenAuthorityService — screen override', () => {
  it('poll: a live override window suppresses all screen action (no edge, no debounce)', async () => {
    const device = makeStatefulDevice(false);
    const gateway = makeGateway(async () => ({ state: 'on' })); // piano ON reading
    const override = makeOverride({ state: 'off', until: Number.MAX_SAFE_INTEGER });
    const { svc } = makeService({ gateway, device, overrides: { screenOverrideService: override } });
    await svc._tickPollForTest(); // early-returns under the live override
    expect(device.setScreen).not.toHaveBeenCalled();
  });

  it('reconcile: a live override enforces the override state, not piano power', async () => {
    const device = makeStatefulDevice(true); // panel currently ON
    const gateway = makeGateway(async () => ({ state: 'on' })); // piano ON
    const override = makeOverride({ state: 'off', until: Number.MAX_SAFE_INTEGER });
    const { svc } = makeService({ gateway, device, overrides: { screenOverrideService: override } });
    await svc._tickReconcileForTest();
    expect(device.setScreen).toHaveBeenCalledWith(false);
  });

  it('reconcile: an absent override falls back to piano-power control (no-op when not committed off)', async () => {
    const device = makeStatefulDevice(true);
    const gateway = makeGateway(async () => ({ state: 'on' }));
    const override = makeOverride(null);
    const { svc } = makeService({ gateway, device, overrides: { screenOverrideService: override } });
    await svc._tickReconcileForTest(); // committedPower null → no-op
    expect(device.setScreen).not.toHaveBeenCalled();
  });
});
