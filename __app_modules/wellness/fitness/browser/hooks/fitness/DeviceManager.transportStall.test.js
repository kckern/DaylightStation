/**
 * Pipeline-stall regression tests.
 *
 * 2026-09-02: the backend event loop blocked 6-8 s at a time. No packets
 * reached the browser from ANY device, but the 3 s prune timer kept firing and
 * zeroed every cadence device past rpmZero (1200 ms) at once. The cycle
 * challenge read 0 RPM and paused the video seven times on a rider holding
 * 85 RPM. "No data" and "0 RPM" must be different states.
 *
 * See ops:docs/_wip/bugs/2026-09-02-fitness-rpm-false-zeros-pause-video-during-cycle-challenge.md
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock("../../../../../../frontend/src/lib/logging/Logger.js", () => {
  const noop = () => {};
  const logger = { child: () => logger, debug: noop, info: noop, warn: noop, error: noop, sampled: noop };
  return { default: () => logger, getLogger: () => logger };
});

import { DeviceManager } from "./DeviceManager.js";

const timeouts = { inactive: 60_000, remove: 1_800_000, rpmZero: 1_200, transportStallMs: 1_200 };
const t0 = 1_000_000;

describe('DeviceManager — a stalled pipeline holds cadence instead of zeroing it', () => {
  beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(t0); });
  afterEach(() => vi.useRealTimers());

  it('is never "stalled" before the first packet', () => {
    expect(new DeviceManager().isTransportStalled(1_800)).toBe(false);
  });

  it('zeros a silent bike while another device is still delivering (the rider stopped)', () => {
    const mgr = new DeviceManager();
    mgr.updateDevice('bike-1', 'CAD', { CalculatedCadence: 80 });
    mgr.updateDevice('strap-1', 'HR', { ComputedHeartRate: 120 });
    vi.setSystemTime(t0 + 2_000);
    mgr.updateDevice('strap-1', 'HR', { ComputedHeartRate: 121 }); // pipeline alive
    mgr.pruneStaleDevices(timeouts);
    expect(mgr.isTransportStalled(timeouts.transportStallMs)).toBe(false);
    expect(mgr.getDevice('bike-1').cadence).toBe(0);
  });

  it('holds every cadence value when NO device has delivered (the pipeline stalled)', () => {
    const mgr = new DeviceManager();
    mgr.updateDevice('bike-1', 'CAD', { CalculatedCadence: 80 });
    mgr.updateDevice('bike-2', 'CAD', { CalculatedCadence: 55 });
    vi.setSystemTime(t0 + 8_000); // the 2026-09-02 shape: 8 s of nothing at all
    mgr.pruneStaleDevices(timeouts);
    expect(mgr.isTransportStalled(timeouts.transportStallMs)).toBe(true);
    expect(mgr.getDevice('bike-1').cadence).toBe(80);
    expect(mgr.getDevice('bike-1').transportStalled).toBe(true);
    expect(mgr.getDevice('bike-2').cadence).toBe(55);
  });

  // transportStallMs MUST equal rpmZero. A prune tick landing between them saw
  // "stale cadence" before "stalled pipeline" and zeroed the meter — and the
  // hold branch then preserved that zero for the rest of the stall.
  it('holds the real value when the prune lands in the old 1200-1800ms gap', () => {
    const mgr = new DeviceManager();
    mgr.updateDevice('bike-1', 'CAD', { CalculatedCadence: 80 });
    vi.setSystemTime(t0 + 1_500);            // past rpmZero, inside the old margin
    mgr.pruneStaleDevices(timeouts);
    expect(mgr.getDevice('bike-1').cadence).toBe(80);
  });

  it('applies the same equal default when the caller omits transportStallMs', () => {
    const mgr = new DeviceManager();
    mgr.updateDevice('bike-1', 'CAD', { CalculatedCadence: 80 });
    vi.setSystemTime(t0 + 1_500);
    mgr.pruneStaleDevices({ inactive: 60_000, remove: 1_800_000, rpmZero: 1_200 });
    expect(mgr.getDevice('bike-1').cadence).toBe(80);
  });

  it('applies the same equal default on the legacy numeric signature', () => {
    const mgr = new DeviceManager();
    mgr.updateDevice('bike-1', 'CAD', { CalculatedCadence: 80 });
    vi.setSystemTime(t0 + 1_500);
    mgr.pruneStaleDevices(60_000);
    expect(mgr.getDevice('bike-1').cadence).toBe(80);
  });

  it('zeros normally again once packets resume and a bike stays silent', () => {
    const mgr = new DeviceManager();
    mgr.updateDevice('bike-1', 'CAD', { CalculatedCadence: 80 });
    mgr.updateDevice('bike-2', 'CAD', { CalculatedCadence: 55 });
    vi.setSystemTime(t0 + 8_000);
    mgr.pruneStaleDevices(timeouts);                                 // stalled: held
    mgr.updateDevice('bike-2', 'CAD', { CalculatedCadence: 57 });    // pipeline back
    vi.setSystemTime(t0 + 9_500);
    mgr.updateDevice('bike-2', 'CAD', { CalculatedCadence: 57 });
    mgr.pruneStaleDevices(timeouts);
    expect(mgr.getDevice('bike-1').cadence).toBe(0);   // genuinely silent now
    expect(mgr.getDevice('bike-1').transportStalled).toBe(false);
    expect(mgr.getDevice('bike-2').cadence).toBe(57);
  });
});

const pendingRecovery = vi.hoisted(() => new Set());

// The real provider subscription must keep diagnostics out of DeviceManager.
vi.mock('../../../../../../frontend/src/services/WebSocketService.js', () => ({
  wsService: {
    subscribe: vi.fn((_topics, callback) => { globalThis.fitnessTransportMessage = callback; return vi.fn(); }),
    onStatusChange: () => () => {},
    refreshSubscriptions: vi.fn(),
    requestRecovery: vi.fn(() => {
      const timer = setTimeout(() => pendingRecovery.delete(timer), 1000);
      pendingRecovery.add(timer);
      return () => { clearTimeout(timer); pendingRecovery.delete(timer); };
    }),
  },
}));

it('Stop cancels recovery and no diagnostic packet updates sensor time', async () => {
  const React = await import('react');
  const { render, act } = await import('@testing-library/react/pure');
  const { FitnessProvider, useFitnessContext } = await import('../../context/FitnessContext.jsx');
  const { wsService } = await import('../../../../../../frontend/src/services/WebSocketService.js');
  vi.useFakeTimers();
  vi.setSystemTime(t0);
  let context;
  function Probe() { context = useFitnessContext(); return null; }
  let mounted;
  try {
    await act(async () => { mounted = render(React.createElement(FitnessProvider, { fitnessConfiguration: { users: { primary: [] }, plex: {}, sensors: {} } }, React.createElement(Probe))); });
    expect(wsService.subscribe.mock.calls[0][0]).toContain('fitness.transport.health');
    const session = context.fitnessSessionInstance;
    session.sessionId = 'test-session';
    session._autosave = vi.fn();
    session._persistSession = vi.fn();
    await act(async () => { globalThis.fitnessTransportMessage({ topic: 'fitness', type: 'ant', deviceId: 'bike-1', profile: 'CAD', data: { CalculatedCadence: 80 }, bootId: 'a', sourceSeq: 1 }); });
    expect(session.deviceManager.getDevice('bike-1').cadence).toBe(80);
    const beforeHealthPacket = session.deviceManager.lastPacketAt;
    // The watchdog retains a healthy snapshot for five seconds. A timer tick
    // must not treat that old snapshot as a newly delivered sensor packet.
    const setTransport = vi.spyOn(session, 'setTransportState');
    setTransport.mockClear();
    await act(async () => { vi.advanceTimersByTime(2000); });
    expect(setTransport.mock.calls.some(([state]) => state.state === 'healthy')).toBe(false);
    await act(async () => {
      globalThis.fitnessTransportMessage({ topic: 'fitness.transport.health', protocol: 1, bootId: 'a', sourceSeq: 1, receivedCount: 1, sentCount: 1, lastSourceAgeMs: 0 });
    });
    const lastPacketAt = session.deviceManager.lastPacketAt;
    expect(lastPacketAt).toBe(beforeHealthPacket);
    await act(async () => { vi.advanceTimersByTime(28000); });
    expect(wsService.requestRecovery).toHaveBeenCalledTimes(1);
    expect(pendingRecovery.size).toBe(1);
    // Avoid persistence in this browser fixture; the Stop entry point is real.
    session.endSession = vi.fn(() => true);
    await act(async () => { context.requestEndSession(); });
    const pendingRecoveryTimers = pendingRecovery.size;
    expect(pendingRecoveryTimers).toBe(0);
    await act(async () => { mounted.unmount(); });
    const calls = wsService.requestRecovery.mock.calls.length;
    vi.advanceTimersByTime(120000);
    expect(wsService.requestRecovery).toHaveBeenCalledTimes(calls);
  } finally {
    mounted?.unmount();
    vi.useRealTimers();
    delete globalThis.fitnessTransportMessage;
  }
});
