// tests/unit/domains/automotive/odometer.test.mjs
//
// OBD PID 0x31 ("distance since codes cleared") is the automotive domain's
// mileage source, and it is a DELTA source with two ways of going backwards:
// it wraps at 65,536 km, and a shop clearing DTCs after a repair zeroes it.
// Both present identically as "the counter went down", and guessing wrong in
// either direction corrupts the odometer — a reset misread as a rollover
// silently adds ~65,000 km, and a rollover misread as a reset throws away real
// distance. This suite pins that discrimination, and pins the refusal to
// produce an absolute mileage figure with no dash reading to anchor it.

import { describe, it, expect } from 'vitest';
import {
  accumulateCounter,
  integrateSpeedKm,
  estimateOdometer,
  COUNTER_MODULUS_KM,
} from '#domains/automotive/services/OdometerService.mjs';
import { OdometerReading } from '#domains/automotive/value-objects/OdometerReading.mjs';

const at = (iso) => new Date(iso);
const dash = (km, iso) => new OdometerReading({ km, source: 'dash', observedAt: at(iso) });

describe('accumulateCounter', () => {
  it('sums plain forward movement', () => {
    const { distanceKm, unmeasuredSpans, rollovers } = accumulateCounter([
      { km: 100, at: at('2026-08-01T00:00:00Z') },
      { km: 130, at: at('2026-08-02T00:00:00Z') },
      { km: 175, at: at('2026-08-03T00:00:00Z') },
    ]);
    expect(distanceKm).toBe(75);
    expect(rollovers).toBe(0);
    expect(unmeasuredSpans).toEqual([]);
  });

  it('treats a near-modulus wrap as a rollover and keeps the distance', () => {
    const { distanceKm, rollovers, unmeasuredSpans } = accumulateCounter([
      { km: COUNTER_MODULUS_KM - 30, at: at('2026-08-01T00:00:00Z') },
      { km: 20, at: at('2026-08-02T00:00:00Z') },
    ]);
    // 30 km to the wrap, then 20 more past it.
    expect(distanceKm).toBe(50);
    expect(rollovers).toBe(1);
    expect(unmeasuredSpans).toEqual([]);
  });

  it('treats a mid-range drop to zero as a DTC-clear reset, not a rollover', () => {
    const { distanceKm, rollovers, unmeasuredSpans } = accumulateCounter([
      { km: 41000, at: at('2026-08-01T00:00:00Z') },
      { km: 0, at: at('2026-08-02T00:00:00Z') },
      { km: 60, at: at('2026-08-03T00:00:00Z') },
    ]);
    // The reset span contributes nothing; only the 0 -> 60 leg is measured.
    expect(distanceKm).toBe(60);
    expect(rollovers).toBe(0);
    expect(unmeasuredSpans).toHaveLength(1);
    expect(unmeasuredSpans[0].reason).toBe('counter-reset');
  });

  it('does not silently absorb a reset into the distance total', () => {
    const { distanceKm } = accumulateCounter([
      { km: 41000, at: at('2026-08-01T00:00:00Z') },
      { km: 0, at: at('2026-08-02T00:00:00Z') },
    ]);
    // The catastrophic bug would be +24,536 here (reset read as a rollover).
    expect(distanceKm).toBe(0);
  });

  it('ignores malformed rows rather than throwing', () => {
    const { distanceKm } = accumulateCounter([
      { km: 10, at: at('2026-08-01T00:00:00Z') },
      { km: null, at: at('2026-08-02T00:00:00Z') },
      { km: 40, at: at('2026-08-03T00:00:00Z') },
    ]);
    expect(distanceKm).toBe(30);
  });

  it('returns zero for an empty or single-reading series', () => {
    expect(accumulateCounter([]).distanceKm).toBe(0);
    expect(accumulateCounter([{ km: 5, at: at('2026-08-01T00:00:00Z') }]).distanceKm).toBe(0);
  });
});

describe('integrateSpeedKm', () => {
  it('integrates a constant speed over time', () => {
    // 60 kph held for 60 seconds = 1 km.
    const samples = Array.from({ length: 61 }, (_, i) => ({ t: i, speed_kph: 60 }));
    expect(integrateSpeedKm(samples)).toBeCloseTo(1, 5);
  });

  it('skips intervals where the ECU session dropped out', () => {
    // A 40-second hole with no speed reading must contribute nothing, rather
    // than assuming the car held its last known speed across the gap.
    const samples = [
      { t: 0, speed_kph: 60 },
      { t: 10, speed_kph: 60 },
      { t: 50 },
      { t: 60, speed_kph: 60 },
    ];
    // Only the 0->10 leg is measurable: 60 kph for 10 s.
    expect(integrateSpeedKm(samples)).toBeCloseTo(60 * (10 / 3600), 5);
  });

  it('returns zero when no sample carries a speed', () => {
    expect(integrateSpeedKm([{ t: 0 }, { t: 5 }])).toBe(0);
  });
});

describe('estimateOdometer', () => {
  it('refuses to produce a number with no dash anchor', () => {
    const result = estimateOdometer({
      anchors: [],
      counterReadings: [
        { km: 100, at: at('2026-08-01T00:00:00Z') },
        { km: 300, at: at('2026-08-05T00:00:00Z') },
      ],
    });
    expect(result.km).toBeNull();
    expect(result.confidence).toBe('unknown');
    expect(result.source).toBeNull();
  });

  it('reports the anchor itself as exact when nothing has accumulated', () => {
    const result = estimateOdometer({ anchors: [dash(41200, '2026-08-01T00:00:00Z')] });
    expect(result.km).toBe(41200);
    expect(result.source).toBe('dash');
    expect(result.confidence).toBe('exact');
  });

  it('adds counter distance to the most recent anchor', () => {
    const result = estimateOdometer({
      anchors: [dash(41000, '2026-07-01T00:00:00Z'), dash(41200, '2026-08-01T00:00:00Z')],
      counterReadings: [
        { km: 500, at: at('2026-08-02T00:00:00Z') },
        { km: 640, at: at('2026-08-09T00:00:00Z') },
      ],
    });
    expect(result.anchor.km).toBe(41200);
    expect(result.accumulatedKm).toBe(140);
    expect(result.km).toBe(41340);
    expect(result.source).toBe('pid_31');
    expect(result.confidence).toBe('estimated');
  });

  it('ignores counter readings that predate the anchor', () => {
    // Distance before the dash reading is already baked into the dash number;
    // counting it again would double-count the same kilometres.
    const result = estimateOdometer({
      anchors: [dash(41200, '2026-08-05T00:00:00Z')],
      counterReadings: [
        { km: 100, at: at('2026-08-01T00:00:00Z') },
        { km: 900, at: at('2026-08-04T00:00:00Z') },
      ],
    });
    expect(result.km).toBe(41200);
    expect(result.accumulatedKm).toBe(0);
  });

  it('degrades confidence when a counter reset leaves an unmeasured span', () => {
    const result = estimateOdometer({
      anchors: [dash(41200, '2026-08-01T00:00:00Z')],
      counterReadings: [
        { km: 40000, at: at('2026-08-02T00:00:00Z') },
        { km: 0, at: at('2026-08-03T00:00:00Z') },
        { km: 80, at: at('2026-08-04T00:00:00Z') },
      ],
    });
    expect(result.confidence).toBe('degraded');
    expect(result.unmeasuredSpans).toHaveLength(1);
    expect(result.km).toBe(41280);
  });

  it('falls back to an integrated/GPS distance when the counter is unavailable', () => {
    const result = estimateOdometer({
      anchors: [dash(41200, '2026-08-01T00:00:00Z')],
      counterReadings: [],
      fallbackDistanceKm: 12.5,
      fallbackSource: 'speed_integration',
    });
    expect(result.km).toBe(41212.5);
    expect(result.source).toBe('speed_integration');
    expect(result.confidence).toBe('estimated');
  });

  it('honours an as-of time when picking the anchor', () => {
    const result = estimateOdometer({
      anchors: [dash(41000, '2026-07-01T00:00:00Z'), dash(41200, '2026-08-01T00:00:00Z')],
      at: at('2026-07-15T00:00:00Z'),
    });
    expect(result.anchor.km).toBe(41000);
  });
});
