// tests/unit/domains/automotive/fuelStopDetection.test.mjs
//
// A tank cannot refill itself, so a rise in fuel level IS a fill-up — no place
// registry, no geography, and it works at a station you'll never revisit. This
// suite pins that detection, including the two properties that make it usable
// on this vehicle: it needs only two readings BRACKETING the fill (the engine
// bus answers intermittently, giving 2-3 readings per ~200-sample trip), and
// the rise appears BETWEEN trips because refuelling happens engine-off.
//
// The headline case is real: readings of 43, 43, 40, 93 in the live tree on
// 2026-08-12, where 40 -> 93 is a tank fill that place-based detection missed
// entirely because nothing had been named yet.

import { describe, it, expect } from 'vitest';
import { detectFillUps, unloggedFillUps } from '#domains/automotive/services/FuelStopDetectionService.mjs';

const at = (iso) => new Date(iso);
const reading = (pct, iso, tripId) => ({ pct, at: at(iso), tripId });

describe('detectFillUps', () => {
  it('finds the real 40% -> 93% fill from the live tree', () => {
    const fills = detectFillUps([
      reading(43, '2026-07-31T17:20:00Z'),
      reading(43, '2026-07-31T17:38:00Z'),
      reading(40, '2026-08-11T18:03:00Z'),
      reading(93, '2026-08-12T18:42:00Z'),
    ]);

    expect(fills).toHaveLength(1);
    expect(fills[0].fromPct).toBe(40);
    expect(fills[0].toPct).toBe(93);
    expect(fills[0].risePct).toBe(53);
    expect(fills[0].filledToFull).toBe(true);
  });

  it('reports both bounds rather than a false-precision moment', () => {
    // The fill happened while the device was off, somewhere in the gap.
    const [fill] = detectFillUps([
      reading(20, '2026-08-01T09:00:00Z'),
      reading(95, '2026-08-02T17:00:00Z'),
    ]);
    expect(fill.notBefore).toEqual(at('2026-08-01T09:00:00Z'));
    expect(fill.at).toEqual(at('2026-08-02T17:00:00Z'));
  });

  it('ignores gauge noise below the threshold', () => {
    // Senders slosh with cornering, gradient, and how level the car is parked.
    expect(detectFillUps([
      reading(40, '2026-08-01T09:00:00Z'),
      reading(44, '2026-08-01T10:00:00Z'),
      reading(41, '2026-08-01T11:00:00Z'),
    ])).toEqual([]);
  });

  it('ignores fuel being consumed', () => {
    expect(detectFillUps([
      reading(90, '2026-08-01T09:00:00Z'),
      reading(60, '2026-08-05T09:00:00Z'),
      reading(30, '2026-08-09T09:00:00Z'),
    ])).toEqual([]);
  });

  it('works from two sparse readings with nothing in between', () => {
    // The whole point: intermittent ECU sessions are enough.
    const fills = detectFillUps([
      reading(15, '2026-08-01T09:00:00Z'),
      reading(88, '2026-08-04T09:00:00Z'),
    ]);
    expect(fills).toHaveLength(1);
  });

  it('estimates volume when a tank capacity is configured', () => {
    const [fill] = detectFillUps(
      [reading(20, '2026-08-01T09:00:00Z'), reading(70, '2026-08-02T09:00:00Z')],
      { tankCapacityL: 72 },
    );
    // 50 points of a 72 L tank.
    expect(fill.estimatedVolumeL).toBe(36);
  });

  it('leaves volume null with no configured capacity, rather than guessing', () => {
    const [fill] = detectFillUps([
      reading(20, '2026-08-01T09:00:00Z'), reading(70, '2026-08-02T09:00:00Z'),
    ]);
    expect(fill.estimatedVolumeL).toBeNull();
  });

  it('distinguishes a splash from a fill', () => {
    const [splash] = detectFillUps([
      reading(30, '2026-08-01T09:00:00Z'), reading(55, '2026-08-02T09:00:00Z'),
    ]);
    expect(splash.filledToFull).toBe(false);
  });

  it('finds several fills across a longer history, newest first', () => {
    const fills = detectFillUps([
      reading(20, '2026-07-01T09:00:00Z'),
      reading(95, '2026-07-02T09:00:00Z'),
      reading(25, '2026-07-20T09:00:00Z'),
      reading(90, '2026-07-21T09:00:00Z'),
    ]);
    expect(fills).toHaveLength(2);
    expect(fills[0].at).toEqual(at('2026-07-21T09:00:00Z'));
  });

  it('discards malformed and out-of-range readings', () => {
    expect(detectFillUps([
      reading(-1, '2026-08-01T09:00:00Z'),
      { pct: 'x', at: at('2026-08-02T09:00:00Z') },
      reading(120, '2026-08-03T09:00:00Z'),
    ])).toEqual([]);
  });

  it('returns nothing for an empty or single-reading series', () => {
    expect(detectFillUps([])).toEqual([]);
    expect(detectFillUps([reading(50, '2026-08-01T09:00:00Z')])).toEqual([]);
  });
});

describe('unloggedFillUps', () => {
  const detected = detectFillUps([
    reading(40, '2026-08-11T18:03:00Z'),
    reading(93, '2026-08-12T18:42:00Z'),
  ]);

  it('suppresses a fill already logged', () => {
    expect(unloggedFillUps(detected, [{ date: at('2026-08-12T00:00:00Z') }])).toEqual([]);
  });

  it('tolerates a logged date a day either side of the detected window', () => {
    // The detected time is the first reading AFTER the fill, which can land a
    // day later than the receipt — the device may not wake until the next drive.
    expect(unloggedFillUps(detected, [{ date: at('2026-08-10T00:00:00Z') }])).toEqual([]);
    expect(unloggedFillUps(detected, [{ date: at('2026-08-14T00:00:00Z') }])).toEqual([]);
  });

  it('still surfaces a fill logged far from the detected window', () => {
    expect(unloggedFillUps(detected, [{ date: at('2026-06-01T00:00:00Z') }])).toHaveLength(1);
  });

  it('surfaces everything when nothing has been logged', () => {
    expect(unloggedFillUps(detected, [])).toHaveLength(1);
  });
});
