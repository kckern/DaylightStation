/**
 * Regression tests for Bug 1 (RPM cadence freeze).
 *
 * Bug: Device.update() bumps `lastSignificantActivity` based on POST-MERGE
 * persisted state (`this.cadence > 0`) rather than the incoming payload's
 * significance. ANT+ sensors broadcast non-cadence pages (battery,
 * manufacturer, common pages) for 60-120s after pedaling stops. Each such
 * frame preserves the stale `device.cadence` AND refreshes
 * `lastSignificantActivity`, so the 3-second rpmZero reset in
 * `pruneStaleDevices` never trips. The displayed RPM stays frozen at the
 * last broadcast value.
 *
 * Fix: significance must be derived from the incoming `data` payload, not
 * from the device's persisted state.
 *
 * See: docs/_wip/bugs/2026-05-28-fitness-rpm-cadence-freeze-and-ghost-devices.md
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { Device, DeviceManager } from './DeviceManager.js';

describe('Device.update — lastSignificantActivity tracks payload, not persisted state', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('bumps lastSignificantActivity when payload carries cadence > 0', () => {
    const t0 = 1_000_000;
    vi.setSystemTime(t0);
    const device = new Device({ id: 'bike-1', type: 'cadence' });

    device.update({ cadence: 55, lastSeen: t0 });

    expect(device.cadence).toBe(55);
    expect(device.lastSignificantActivity).toBe(t0);
  });

  it('does NOT bump lastSignificantActivity when payload has no cadence, even if persisted cadence > 0', () => {
    const t0 = 1_000_000;
    vi.setSystemTime(t0);
    const device = new Device({ id: 'bike-1', type: 'cadence' });

    // Real pedaling packet bumps the timer.
    device.update({ cadence: 55, lastSeen: t0 });
    expect(device.lastSignificantActivity).toBe(t0);

    // 5 seconds later, a battery-only ANT+ page arrives. No cadence in payload.
    const t1 = t0 + 5_000;
    vi.setSystemTime(t1);
    device.update({ batteryLevel: 80, lastSeen: t1 });

    // Persisted cadence is unchanged.
    expect(device.cadence).toBe(55);
    // BUG GUARD: lastSignificantActivity must NOT advance — the battery page
    // carried no fresh cadence reading.
    expect(device.lastSignificantActivity).toBe(t0);
  });

  it('does NOT bump lastSignificantActivity for a 0-cadence payload', () => {
    const t0 = 1_000_000;
    vi.setSystemTime(t0);
    const device = new Device({ id: 'bike-1', type: 'cadence' });

    device.update({ cadence: 55, lastSeen: t0 });

    const t1 = t0 + 1_000;
    vi.setSystemTime(t1);
    device.update({ cadence: 0, lastSeen: t1 });

    // cadence: 0 is "no rotation since last frame" — not significant activity.
    expect(device.lastSignificantActivity).toBe(t0);
  });

  it('bumps lastSignificantActivity from heart rate or power, independently of cadence', () => {
    const t0 = 1_000_000;
    vi.setSystemTime(t0);
    const device = new Device({ id: 'hr-1', type: 'heart_rate' });

    device.update({ heartRate: 120, lastSeen: t0 });
    expect(device.lastSignificantActivity).toBe(t0);

    const t1 = t0 + 5_000;
    vi.setSystemTime(t1);
    device.update({ power: 200, lastSeen: t1 });
    expect(device.lastSignificantActivity).toBe(t1);
  });
});

describe('DeviceManager.pruneStaleDevices — zeros cadence after rpmZero window', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('resets cadence to 0 within rpmZero after pedaling stops, even if non-cadence frames keep arriving', () => {
    const t0 = 1_000_000;
    vi.setSystemTime(t0);
    const mgr = new DeviceManager();

    // Rider pedals: cadence frame arrives.
    mgr.registerDevice({ id: 'bike-1', type: 'cadence', cadence: 55, lastSeen: t0 });
    expect(mgr.getDevice('bike-1').cadence).toBe(55);

    // 1 second later: battery-only ANT+ page arrives (no cadence in payload).
    const t1 = t0 + 1_000;
    vi.setSystemTime(t1);
    mgr.registerDevice({ id: 'bike-1', batteryLevel: 80, lastSeen: t1 });

    // 4 seconds later: another non-cadence page. Past the 3s rpmZero threshold now.
    const t2 = t0 + 4_000;
    vi.setSystemTime(t2);
    mgr.registerDevice({ id: 'bike-1', batteryLevel: 80, lastSeen: t2 });

    // Prune should detect the stale cadence and zero it.
    mgr.pruneStaleDevices({ inactive: 60_000, remove: 1_800_000, rpmZero: 3_000 });

    expect(mgr.getDevice('bike-1').cadence).toBe(0);
  });
});
