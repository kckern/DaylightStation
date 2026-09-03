/**
 * Pipeline-stall regression tests.
 *
 * 2026-09-02: the backend event loop blocked 6-8 s at a time. No packets
 * reached the browser from ANY device, but the 3 s prune timer kept firing and
 * zeroed every cadence device past rpmZero (1200 ms) at once. The cycle
 * challenge read 0 RPM and paused the video seven times on a rider holding
 * 85 RPM. "No data" and "0 RPM" must be different states.
 *
 * See docs/_wip/bugs/2026-09-02-fitness-rpm-false-zeros-pause-video-during-cycle-challenge.md
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../../lib/logging/Logger.js', () => {
  const noop = () => {};
  const logger = { child: () => logger, debug: noop, info: noop, warn: noop, error: noop, sampled: noop };
  return { default: () => logger };
});

import { DeviceManager } from './DeviceManager.js';

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
    expect(mgr.getDevice('bike-2').cadence).toBe(57);
  });
});
