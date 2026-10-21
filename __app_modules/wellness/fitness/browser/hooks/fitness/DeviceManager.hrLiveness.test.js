/**
 * HR "no reading" is a real state, not "keep the last value".
 *
 * 2026-10-20: a strap sent ComputedHeartRate:null for seven minutes. Every
 * packet refreshed lastSeen, Device.update ignored the null, and the browser
 * held 144 bpm the whole time — rings, warm zone and a celebration on a strap
 * that was reading nothing.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock("../../../../../../frontend/src/lib/logging/Logger.js", () => {
  const noop = () => {};
  const logger = { child: () => logger, debug: noop, info: noop, warn: noop, error: noop, sampled: noop };
  return { default: () => logger };
});

import { DeviceManager } from "./DeviceManager.js";

const timeouts = { inactive: 60_000, remove: 1_800_000, rpmZero: 1_200, transportStallMs: 1_200, hrStaleMs: 5_000 };
const t0 = 1_000_000;

describe('DeviceManager — an HR packet without a reading clears the reading', () => {
  beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(t0); });
  afterEach(() => vi.useRealTimers());

  it('a null ComputedHeartRate clears a held value', () => {
    const mgr = new DeviceManager();
    mgr.updateDevice('strap-1', 'HR', { ComputedHeartRate: 144 });
    expect(mgr.getDevice('strap-1').heartRate).toBe(144);
    mgr.updateDevice('strap-1', 'HR', { ComputedHeartRate: null });
    expect(mgr.getDevice('strap-1').heartRate).toBeNull();
  });

  it('an HR-profile packet with no ComputedHeartRate field clears it too', () => {
    const mgr = new DeviceManager();
    mgr.updateDevice('strap-1', 'HR', { ComputedHeartRate: 144 });
    mgr.updateDevice('strap-1', 'HR', { BatteryLevel: 80 });
    expect(mgr.getDevice('strap-1').heartRate).toBeNull();
  });

  it('a real reading after nulls is taken again', () => {
    const mgr = new DeviceManager();
    mgr.updateDevice('strap-1', 'HR', { ComputedHeartRate: 144 });
    mgr.updateDevice('strap-1', 'HR', { ComputedHeartRate: null });
    mgr.updateDevice('strap-1', 'HR', { ComputedHeartRate: 98 });
    expect(mgr.getDevice('strap-1').heartRate).toBe(98);
  });

  it('a cadence packet never touches heartRate semantics', () => {
    const mgr = new DeviceManager();
    mgr.updateDevice('bike-1', 'CAD', { CalculatedCadence: 80 });
    mgr.updateDevice('bike-1', 'CAD', { CalculatedCadence: 81 });
    expect(mgr.getDevice('bike-1').cadence).toBe(81);
    expect(mgr.getDevice('bike-1').heartRate).toBeNull();
  });

  it('re-registering the Device object itself keeps its own reading', () => {
    // FitnessSession.recordDeviceActivity hands the routed Device back to
    // registerDevice; that echo must not clear or invent anything.
    const mgr = new DeviceManager();
    const dev = mgr.updateDevice('strap-1', 'HR', { ComputedHeartRate: 120 });
    mgr.registerDevice(dev);
    expect(mgr.getDevice('strap-1').heartRate).toBe(120);
  });
});

describe('DeviceManager — HR liveness is the reading, not the packet', () => {
  beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(t0); });
  afterEach(() => vi.useRealTimers());

  it('stamps lastHeartRateAt only on a real reading', () => {
    const mgr = new DeviceManager();
    mgr.updateDevice('strap-1', 'HR', { ComputedHeartRate: 130 });
    expect(mgr.getDevice('strap-1').lastHeartRateAt).toBe(t0);
    vi.setSystemTime(t0 + 1_000);
    mgr.updateDevice('strap-1', 'HR', { ComputedHeartRate: null });
    expect(mgr.getDevice('strap-1').lastHeartRateAt).toBe(t0);
  });

  it('nulls a reading older than hrStaleMs while the pipeline is alive', () => {
    const mgr = new DeviceManager();
    mgr.updateDevice('strap-1', 'HR', { ComputedHeartRate: 144 });
    vi.setSystemTime(t0 + 6_000);
    mgr.updateDevice('bike-1', 'CAD', { CalculatedCadence: 70 }); // pipeline alive
    mgr.pruneStaleDevices(timeouts);
    expect(mgr.getDevice('strap-1').heartRate).toBeNull();
    // Still connected — the device is present, it just has no reading.
    expect(mgr.getDevice('strap-1').isActive).toBe(true);
  });

  it('keeps a fresh reading', () => {
    const mgr = new DeviceManager();
    mgr.updateDevice('strap-1', 'HR', { ComputedHeartRate: 144 });
    vi.setSystemTime(t0 + 3_000);
    mgr.updateDevice('bike-1', 'CAD', { CalculatedCadence: 70 });
    mgr.pruneStaleDevices(timeouts);
    expect(mgr.getDevice('strap-1').heartRate).toBe(144);
  });

  it('holds the reading while the whole pipeline is stalled (no device is delivering)', () => {
    const mgr = new DeviceManager();
    mgr.updateDevice('strap-1', 'HR', { ComputedHeartRate: 144 });
    vi.setSystemTime(t0 + 8_000);
    mgr.pruneStaleDevices(timeouts);
    expect(mgr.isTransportStalled(timeouts.transportStallMs)).toBe(true);
    expect(mgr.getDevice('strap-1').heartRate).toBe(144);
  });

  it('defaults hrStaleMs when the caller omits it', () => {
    const mgr = new DeviceManager();
    mgr.updateDevice('strap-1', 'HR', { ComputedHeartRate: 144 });
    vi.setSystemTime(t0 + 6_000);
    mgr.updateDevice('bike-1', 'CAD', { CalculatedCadence: 70 });
    mgr.pruneStaleDevices({ inactive: 60_000, remove: 1_800_000, rpmZero: 1_200 });
    expect(mgr.getDevice('strap-1').heartRate).toBeNull();
  });

  it('clears the reading when the device goes inactive', () => {
    const mgr = new DeviceManager();
    mgr.updateDevice('strap-1', 'HR', { ComputedHeartRate: 144 });
    vi.setSystemTime(t0 + 61_000); // past inactive, pipeline also silent
    mgr.pruneStaleDevices(timeouts);
    const dev = mgr.getDevice('strap-1');
    expect(dev.isActive).toBe(false);
    expect(dev.heartRate).toBeNull();
  });
});
