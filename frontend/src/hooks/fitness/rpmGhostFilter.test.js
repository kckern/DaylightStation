/**
 * rpmGhostFilter — suppress stray (unregistered) cadence sensors (§2A/§2B).
 *
 * A 4th RPM meter appeared in a session reading 0 RPM: a stray ANT+ cadence
 * sensor (e.g. left in a drawer) that is not mapped to any configured
 * equipment. This is the cadence-side analog of the HR floor filter: an
 * UNREGISTERED cadence device showing no real signal (cadence ≤ 0) is a ghost
 * and must not render an RPM meter. Registered equipment is never filtered —
 * an idle configured bike legitimately reads 0 and must keep its meter.
 */
import { describe, it, expect } from 'vitest';

import {
  buildConfiguredDeviceIdSet,
  isGhostRpmDevice,
  filterGhostRpmDevices,
} from './rpmGhostFilter.js';

const equipmentConfig = [
  { id: 'cycle_ace', name: 'Cycle Ace', cadence: 49904 },
  { id: 'niceday', name: 'NiceDay', cadence: 7138 },
];

describe('rpmGhostFilter', () => {
  it('builds a set of configured device ids from equipment config', () => {
    const ids = buildConfiguredDeviceIdSet(equipmentConfig);
    expect(ids.has('49904')).toBe(true);
    expect(ids.has('7138')).toBe(true);
    expect(ids.has('29199')).toBe(false);
  });

  it('flags an unregistered cadence device reading 0 RPM as a ghost', () => {
    const ids = buildConfiguredDeviceIdSet(equipmentConfig);
    const ghost = { id: '29199', type: 'cadence', cadence: 0 };
    expect(isGhostRpmDevice(ghost, ids)).toBe(true);
  });

  it('keeps an unregistered cadence device that is actively pedaled (cadence > 0)', () => {
    const ids = buildConfiguredDeviceIdSet(equipmentConfig);
    const active = { id: '29199', type: 'cadence', cadence: 84 };
    expect(isGhostRpmDevice(active, ids)).toBe(false);
  });

  it('never flags a registered (configured) device, even when idle at 0 RPM', () => {
    const ids = buildConfiguredDeviceIdSet(equipmentConfig);
    const idleBike = { id: '49904', type: 'cadence', cadence: 0 };
    expect(isGhostRpmDevice(idleBike, ids)).toBe(false);
  });

  it('only ghosts cadence-type devices (leaves other rpm types alone)', () => {
    const ids = buildConfiguredDeviceIdSet(equipmentConfig);
    const jumprope = { id: '55555', type: 'jumprope', cadence: 0 };
    expect(isGhostRpmDevice(jumprope, ids)).toBe(false);
  });

  it('filters a device list, dropping only the ghost', () => {
    const ids = buildConfiguredDeviceIdSet(equipmentConfig);
    const devices = [
      { id: '49904', type: 'cadence', cadence: 0 },   // registered idle — keep
      { id: '29199', type: 'cadence', cadence: 0 },   // ghost — drop
      { id: '7138', type: 'cadence', cadence: 90 },   // registered active — keep
    ];
    const kept = filterGhostRpmDevices(devices, ids).map(d => d.id);
    expect(kept).toEqual(['49904', '7138']);
  });
});
