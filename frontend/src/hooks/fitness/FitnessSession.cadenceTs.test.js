/**
 * Cadence-ts producer regression: getEquipmentCadence must emit a `ts`
 * that advances on every packet (including 0 RPM), so 0 readings reach
 * the downstream CadenceFilter EMA via GovernanceEngine's freshness check
 * (`entryTs > lastSeen`).
 *
 * Bug we are guarding: previously `ts` was set from
 *   device.lastSignificantActivity || device.lastSeen
 * and `lastSignificantActivity` only advances on non-zero readings. So
 * when a real ANT+ cadence sensor reports 0 RPM between rotations, the
 * `ts` did NOT advance, the engine's `entryTs > lastSeen` rejected the
 * 0 reading as stale, and 0 never reached CadenceFilter. The EMA held
 * at the last fresh value (~55 RPM) instead of decaying through the
 * noise band, causing the locked↔maintain strobe.
 *
 * Fix: emit `ts: device.lastSeen` (which DeviceManager.update advances
 * on every packet, line ~64) so 0 RPM readings flow through.
 */
import { describe, it, expect, vi } from 'vitest';

import { FitnessSession } from './FitnessSession.js';

describe('FitnessSession.getEquipmentCadence — ts advances on every packet', () => {
  it('emits a ts that advances when a 0-RPM packet follows a non-zero packet', () => {
    const session = new FitnessSession();
    // Register an equipment with a cadence device pointer.
    const equipmentId = 'cycle_ace';
    const cadenceDeviceId = 'cad-1';
    session._equipmentById.set(equipmentId, {
      id: equipmentId,
      cadence: cadenceDeviceId,
    });
    // Register the device.
    const device = session.deviceManager.registerDevice({
      id: cadenceDeviceId,
      type: 'cadence',
    });

    // Simulate a non-zero cadence packet at t=1000.
    const t1 = 1_000_000;
    vi.useFakeTimers();
    vi.setSystemTime(t1);
    device.update({ cadence: 55, lastSeen: t1 });
    const cad1 = session.getEquipmentCadence(equipmentId);
    expect(cad1.connected).toBe(true);
    expect(cad1.rpm).toBe(55);
    expect(cad1.ts).toBe(t1);

    // Now simulate a 0-RPM packet at t=1500 (between rotations).
    // DeviceManager.update advances lastSeen but NOT lastSignificantActivity.
    const t2 = t1 + 500;
    vi.setSystemTime(t2);
    device.update({ cadence: 0, lastSeen: t2 });
    const cad2 = session.getEquipmentCadence(equipmentId);
    expect(cad2.connected).toBe(true);
    expect(cad2.rpm).toBe(0);
    // CRITICAL: ts must advance to t2 so the engine's freshness check
    // (entryTs > lastSeen) accepts the 0 reading.
    expect(cad2.ts).toBe(t2);
    expect(cad2.ts).toBeGreaterThan(cad1.ts);

    vi.useRealTimers();
  });

  it('emits a ts that advances across consecutive 0-RPM packets', () => {
    const session = new FitnessSession();
    const equipmentId = 'cycle_ace';
    const cadenceDeviceId = 'cad-1';
    session._equipmentById.set(equipmentId, {
      id: equipmentId,
      cadence: cadenceDeviceId,
    });
    const device = session.deviceManager.registerDevice({
      id: cadenceDeviceId,
      type: 'cadence',
    });

    vi.useFakeTimers();
    // Seed a non-zero so we don't hit the rpmZero disconnected path.
    vi.setSystemTime(1_000_000);
    device.update({ cadence: 80, lastSeen: 1_000_000 });
    session.getEquipmentCadence(equipmentId);

    // Three back-to-back 0 packets within rpmZero window.
    const samples = [];
    for (let i = 1; i <= 3; i += 1) {
      const ts = 1_000_000 + (i * 200);
      vi.setSystemTime(ts);
      device.update({ cadence: 0, lastSeen: ts });
      samples.push(session.getEquipmentCadence(equipmentId));
    }

    // Each sample's ts must be strictly increasing.
    expect(samples[0].ts).toBe(1_000_200);
    expect(samples[1].ts).toBe(1_000_400);
    expect(samples[2].ts).toBe(1_000_600);
    expect(samples.every((s) => s.connected && s.rpm === 0)).toBe(true);

    vi.useRealTimers();
  });
});
