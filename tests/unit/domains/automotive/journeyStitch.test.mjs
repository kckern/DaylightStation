// tests/unit/domains/automotive/journeyStitch.test.mjs
//
// The device's trip boundaries are ignition cycles, so one errand arrives as
// several trips and the raw list reads as noise. This suite pins the
// translation into journeys, and pins the two refusals that keep the timeline
// honest: boot-relative trips are never merged (arrival order is not event
// order), and sub-threshold garage shuffles are classified rather than deleted.

import { describe, it, expect } from 'vitest';
import { stitchJourneys } from '#domains/automotive/services/JourneyStitchService.mjs';
import { GeoFix } from '#domains/automotive/value-objects/GeoFix.mjs';

const at = (iso) => new Date(iso);

/** Trip descriptor with sane defaults; override what a case is actually about. */
const trip = (overrides = {}) => ({
  tripId: 'trip-1',
  startedAt: at('2026-08-11T18:00:00Z'),
  endedAt: at('2026-08-11T18:10:00Z'),
  timeSource: 'device',
  distanceKm: 5,
  maxSpeedKph: 60,
  durationS: 600,
  ecu: true,
  startFix: null,
  endFix: null,
  ...overrides,
});

describe('stitchJourneys', () => {
  it('merges trips separated by less than the dwell threshold', () => {
    const journeys = stitchJourneys([
      trip({ tripId: 'a', startedAt: at('2026-08-11T18:00:00Z'), endedAt: at('2026-08-11T18:10:00Z') }),
      // 4-minute stop — someone ran into the shop.
      trip({ tripId: 'b', startedAt: at('2026-08-11T18:14:00Z'), endedAt: at('2026-08-11T18:25:00Z') }),
    ], { dwellThresholdS: 600 });

    expect(journeys).toHaveLength(1);
    expect(journeys[0].legs).toHaveLength(2);
    expect(journeys[0].stops).toHaveLength(1);
    expect(journeys[0].stops[0].durationS).toBe(240);
  });

  it('splits trips separated by more than the dwell threshold', () => {
    const journeys = stitchJourneys([
      trip({ tripId: 'a', startedAt: at('2026-08-11T09:00:00Z'), endedAt: at('2026-08-11T09:20:00Z') }),
      trip({ tripId: 'b', startedAt: at('2026-08-11T17:00:00Z'), endedAt: at('2026-08-11T17:20:00Z') }),
    ], { dwellThresholdS: 600 });

    expect(journeys).toHaveLength(2);
    expect(journeys.every((j) => j.legs.length === 1)).toBe(true);
  });

  it('sums distance and takes the max speed across legs', () => {
    const journeys = stitchJourneys([
      trip({ tripId: 'a', distanceKm: 4, maxSpeedKph: 50, durationS: 600,
        startedAt: at('2026-08-11T18:00:00Z'), endedAt: at('2026-08-11T18:10:00Z') }),
      trip({ tripId: 'b', distanceKm: 6.5, maxSpeedKph: 88, durationS: 660,
        startedAt: at('2026-08-11T18:14:00Z'), endedAt: at('2026-08-11T18:25:00Z') }),
    ], { dwellThresholdS: 600 });

    expect(journeys[0].distanceKm).toBe(10.5);
    expect(journeys[0].maxSpeedKph).toBe(88);
    expect(journeys[0].drivingS).toBe(1260);
    // Elapsed includes the stop; driving does not.
    expect(journeys[0].elapsedS).toBe(1500);
  });

  it('never merges boot-relative trips, and sorts them last', () => {
    // Arrival order is the order the car reached home WiFi, not event order.
    const journeys = stitchJourneys([
      trip({ tripId: 'clocked', startedAt: at('2026-08-11T18:00:00Z'), endedAt: at('2026-08-11T18:10:00Z') }),
      trip({ tripId: 'x', startedAt: null, endedAt: null, timeSource: 'boot-relative' }),
      trip({ tripId: 'y', startedAt: null, endedAt: null, timeSource: 'boot-relative' }),
    ]);

    expect(journeys).toHaveLength(3);
    const undateable = journeys.filter((j) => !j.clockRecoverable);
    expect(undateable).toHaveLength(2);
    expect(undateable.every((j) => j.legs.length === 1)).toBe(true);
    // Clocked journey sorts ahead of the undateable ones.
    expect(journeys[0].clockRecoverable).toBe(true);
  });

  it('applies the size floor to undateable trips too', () => {
    // Clock state and size are independent questions. A zero-distance ignition
    // blip is a shuffle whether or not anyone knows when it happened —
    // conflating the two once surfaced 50 blips as though they were outings.
    const journeys = stitchJourneys([
      trip({ tripId: 'blip', startedAt: null, endedAt: null, timeSource: 'boot-relative', distanceKm: 0 }),
      trip({ tripId: 'real', startedAt: null, endedAt: null, timeSource: 'boot-relative', distanceKm: 18 }),
    ], { shuffleFloorKm: 0.2 });

    const byId = Object.fromEntries(journeys.map((j) => [j.legs[0].tripId, j]));
    expect(byId.blip.classification).toBe('shuffle');
    expect(byId.blip.clockRecoverable).toBe(false);
    // An undateable trip can still be a real 18 km outing.
    expect(byId.real.classification).toBe('journey');
    expect(byId.real.clockRecoverable).toBe(false);
  });

  it('classifies a sub-floor outing as a shuffle without dropping it', () => {
    const journeys = stitchJourneys([
      trip({ tripId: 'garage', distanceKm: 0.012, maxSpeedKph: 0 }),
    ], { shuffleFloorKm: 0.2 });

    expect(journeys).toHaveLength(1);
    expect(journeys[0].classification).toBe('shuffle');
    expect(journeys[0].isShuffle).toBe(true);
    // Still carries its data — hidden is a view decision, not a deletion.
    expect(journeys[0].distanceKm).toBe(0.012);
  });

  it('reports newest first', () => {
    const journeys = stitchJourneys([
      trip({ tripId: 'old', startedAt: at('2026-08-01T10:00:00Z'), endedAt: at('2026-08-01T10:10:00Z') }),
      trip({ tripId: 'new', startedAt: at('2026-08-11T10:00:00Z'), endedAt: at('2026-08-11T10:10:00Z') }),
    ]);
    expect(journeys[0].legs[0].tripId).toBe('new');
    expect(journeys[1].legs[0].tripId).toBe('old');
  });

  it('prefers the arriving leg fix for a stop position', () => {
    const arrived = new GeoFix({ lat: 47.4, lon: -122.2 });
    const departed = new GeoFix({ lat: 47.5, lon: -122.3 });
    const journeys = stitchJourneys([
      trip({ tripId: 'a', endFix: arrived,
        startedAt: at('2026-08-11T18:00:00Z'), endedAt: at('2026-08-11T18:10:00Z') }),
      trip({ tripId: 'b', startFix: departed,
        startedAt: at('2026-08-11T18:14:00Z'), endedAt: at('2026-08-11T18:25:00Z') }),
    ], { dwellThresholdS: 600 });

    expect(journeys[0].stops[0].fix.equals(arrived)).toBe(true);
  });

  it('reports hasEcu when any leg saw the engine bus', () => {
    const journeys = stitchJourneys([
      trip({ tripId: 'a', ecu: false, startedAt: at('2026-08-11T18:00:00Z'), endedAt: at('2026-08-11T18:10:00Z') }),
      trip({ tripId: 'b', ecu: true, startedAt: at('2026-08-11T18:14:00Z'), endedAt: at('2026-08-11T18:25:00Z') }),
    ], { dwellThresholdS: 600 });
    expect(journeys[0].hasEcu).toBe(true);
  });

  it('joins sub-minute leg gaps without recording a stop', () => {
    // Observed 2026-08-12 in the live tree: one 25-minute drive arrived as four
    // legs separated by 1s, 2s and 2s — the recorder rotating its trip file, not
    // the car stopping. The legs must merge, but reporting them as stops would
    // claim "3 stops" for a drive that had none and offer each artifact for
    // naming as a place.
    const journeys = stitchJourneys([
      trip({ tripId: 'a', startedAt: at('2026-08-12T18:00:00Z'), endedAt: at('2026-08-12T18:10:00Z') }),
      trip({ tripId: 'b', startedAt: at('2026-08-12T18:10:02Z'), endedAt: at('2026-08-12T18:20:00Z') }),
    ], { minStopS: 60 });

    expect(journeys).toHaveLength(1);
    expect(journeys[0].legs).toHaveLength(2);
    expect(journeys[0].stops).toEqual([]);
  });

  it('still records a stop once the gap clears the floor', () => {
    const journeys = stitchJourneys([
      trip({ tripId: 'a', startedAt: at('2026-08-12T18:00:00Z'), endedAt: at('2026-08-12T18:10:00Z') }),
      trip({ tripId: 'b', startedAt: at('2026-08-12T18:15:00Z'), endedAt: at('2026-08-12T18:25:00Z') }),
    ], { minStopS: 60 });

    expect(journeys[0].stops).toHaveLength(1);
    expect(journeys[0].stops[0].durationS).toBe(300);
  });

  it('returns nothing for no trips', () => {
    expect(stitchJourneys([])).toEqual([]);
    expect(stitchJourneys(null)).toEqual([]);
  });
});
