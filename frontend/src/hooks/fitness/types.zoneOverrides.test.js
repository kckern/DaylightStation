import { describe, it, expect } from 'vitest';
import { buildZoneConfig } from './types.js';

/**
 * Task 9 review — Defect 1 (CRITICAL).
 *
 * The guest-assignment pipeline (GuestAssignmentService / UserManager /
 * DeviceAssignmentLedger) REQUIRES metadata.zones to be the ARRAY shape
 * [{ id, min }, ...] — Array.isArray gates strip anything else. But
 * buildZoneConfig's normalizeZoneOverrides only understood the MAP shape
 * ({ active: 95 }), so array overrides were silently dropped: Number({id,min})
 * is NaN, every entry filtered out, and a kid guest got ADULT thresholds even
 * while ZONE_OVERRIDE_APPLIED was logged.
 *
 * These tests lock in that buildZoneConfig accepts BOTH shapes.
 */

const GLOBAL_ZONES = [
  { id: 'cool', name: 'Cool', min: 60, color: 'blue' },
  { id: 'active', name: 'Active', min: 100, color: 'green' },
  { id: 'warm', name: 'Warm', min: 120, color: 'yellow' },
  { id: 'hot', name: 'Hot', min: 140, color: 'orange' },
  { id: 'fire', name: 'On Fire', min: 160, color: 'red' }
];

const minOf = (zones, id) => zones.find((z) => z.id === id)?.min;

describe('buildZoneConfig — zone overrides', () => {
  it('applies map-shape overrides (existing behavior, unchanged)', () => {
    const zones = buildZoneConfig(GLOBAL_ZONES, { active: 95, warm: 130 });
    expect(minOf(zones, 'active')).toBe(95);
    expect(minOf(zones, 'warm')).toBe(130);
    expect(minOf(zones, 'hot')).toBe(140);
    expect(minOf(zones, 'fire')).toBe(160);
  });

  it('applies array-shape overrides ([{id, min}, ...] — ledger metadata.zones shape)', () => {
    const zones = buildZoneConfig(GLOBAL_ZONES, [
      { id: 'active', min: 95 },
      { id: 'warm', min: 130 }
    ]);
    expect(minOf(zones, 'active')).toBe(95);
    expect(minOf(zones, 'warm')).toBe(130);
    expect(minOf(zones, 'hot')).toBe(140);
    expect(minOf(zones, 'fire')).toBe(160);
  });

  it('accepts `name` in array entries when `id` is absent', () => {
    const zones = buildZoneConfig(GLOBAL_ZONES, [{ name: 'Active', min: 95 }]);
    expect(minOf(zones, 'active')).toBe(95);
  });

  it('skips junk array entries (missing id, non-finite min) but keeps valid ones', () => {
    const zones = buildZoneConfig(GLOBAL_ZONES, [
      { min: 90 },                    // no id/name
      { id: 'warm', min: 'fast' },    // non-numeric min
      { id: 'hot', min: Infinity },   // non-finite min
      null,                           // not an object
      { id: 'active', min: 95 }       // valid
    ]);
    expect(minOf(zones, 'active')).toBe(95);
    expect(minOf(zones, 'warm')).toBe(120);
    expect(minOf(zones, 'hot')).toBe(140);
  });

  it('an empty array behaves like no overrides at all (byte-identical zones)', () => {
    expect(buildZoneConfig(GLOBAL_ZONES, [])).toEqual(buildZoneConfig(GLOBAL_ZONES, null));
  });
});
