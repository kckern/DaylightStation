// tests/unit/domains/automotive/relayNewSignals.test.mjs
//
// Signals the device was already producing (or could produce) and the relay
// previously discarded: GNSS altitude/heading/fix-quality, the slow-moving
// diagnostic PID set, the VIN, and harsh-motion events.
//
// The rule every one of them follows is the file's existing contract: a reading
// that was never taken is an ABSENT KEY, never a sentinel. `sat: -1` persisted
// verbatim reads as a satellite count; `ambient_temp: 0` reads as freezing.

import { describe, it, expect } from 'vitest';
import {
  buildTripRecord, normalizeSnapshotReadings,
} from '#apps/hardware/automotiveRelay.mjs';

const TZ = 'America/Los_Angeles';
const TS = '2026-08-12T18:00:00-07:00';
const SCHEMA = 't,lat,lon,speed_kph,rpm,coolant_c,fuel_pct,batt_v,alt_m,heading,hdop,sat';

/** [t, lat, lon, speed, rpm, coolant, fuel, batt, alt, heading, hdop, sat] */
const row = (t, over = []) => [t, 47.1, -122.1, 30, 1500, 88, 50, 14.2, ...over];

describe('GNSS extras', () => {
  it('persists altitude, heading, hdop and satellites', () => {
    const trip = buildTripRecord('test-vehicle', 'abc', { schema: SCHEMA }, [
      row(0, [120.5, 270, 3, 9]),
      row(1000, [121.0, 271, 3, 9]),
    ], Date.now(), TS, TZ);

    expect(trip.samples[0].alt_m).toBe(120.5);
    expect(trip.samples[0].heading).toBe(270);
    expect(trip.samples[0].hdop).toBe(3);
    expect(trip.samples[0].sat).toBe(9);
    // Units are declared for the keys actually present.
    expect(trip.units.alt_m).toBe('m');
    expect(trip.units.heading).toBe('deg');
  });

  it('drops the firmware sentinels rather than storing them', () => {
    // -9999 altitude and -1 heading/hdop/sat all mean "no reading".
    const trip = buildTripRecord('test-vehicle', 'abc', { schema: SCHEMA }, [
      row(0, [-9999, -1, -1, -1]),
      row(1000, [-9999, -1, -1, -1]),
    ], Date.now(), TS, TZ);

    expect(trip.samples[0]).not.toHaveProperty('alt_m');
    expect(trip.samples[0]).not.toHaveProperty('heading');
    expect(trip.samples[0]).not.toHaveProperty('hdop');
    expect(trip.samples[0]).not.toHaveProperty('sat');
    expect(trip.units).not.toHaveProperty('sat');
  });

  it('keeps a genuinely negative altitude', () => {
    // Below sea level is real; only the -9999 sentinel means absent.
    const trip = buildTripRecord('test-vehicle', 'abc', { schema: SCHEMA }, [
      row(0, [-15.2, 90, 2, 8]),
      row(1000, [-15.0, 90, 2, 8]),
    ], Date.now(), TS, TZ);
    expect(trip.samples[0].alt_m).toBe(-15.2);
  });

  it('still parses a pre-upgrade 8-column trip', () => {
    // Trips buffered before the schema change must not be lost.
    const trip = buildTripRecord('test-vehicle', 'abc', {}, [
      [0, 47.1, -122.1, 30, 1500, 88, 50, 14.2],
      [1000, 47.2, -122.2, 32, 1500, 88, 50, 14.2],
    ], Date.now(), TS, TZ);
    expect(trip.samples).toHaveLength(2);
    expect(trip.samples[0]).not.toHaveProperty('alt_m');
    expect(trip.samples[0].speed_kph).toBe(30);
  });
});

describe('snapshot diagnostics', () => {
  it('passes through the diagnostic readings the car answered', () => {
    const out = normalizeSnapshotReadings({
      battery_v: 14.2,
      diag: { ambient_temp: 22, engine_oil_temp: 95, time_since_cleared: 4300 },
    });
    expect(out.diag).toEqual({ ambient_temp: 22, engine_oil_temp: 95, time_since_cleared: 4300 });
  });

  it('omits the diag block entirely when nothing answered', () => {
    expect(normalizeSnapshotReadings({ battery_v: 14.2 })).not.toHaveProperty('diag');
    expect(normalizeSnapshotReadings({ battery_v: 14.2, diag: {} })).not.toHaveProperty('diag');
  });

  it('drops non-numeric diagnostic values', () => {
    const out = normalizeSnapshotReadings({ diag: { ambient_temp: 22, junk: 'n/a' } });
    expect(out.diag).toEqual({ ambient_temp: 22 });
  });

  it('carries the VIN, which is what proves which car this history belongs to', () => {
    expect(normalizeSnapshotReadings({ vin: ' 1C4RC3BG0MR123456 ' }).vin).toBe('1C4RC3BG0MR123456');
    expect(normalizeSnapshotReadings({ vin: '' })).not.toHaveProperty('vin');
  });

  it('carries the odometer counters, omitting unread ones', () => {
    const out = normalizeSnapshotReadings({ distance_since_cleared_km: 4120, odometer_km: -1 });
    expect(out.distance_since_cleared_km).toBe(4120);
    expect(out).not.toHaveProperty('odometer_km');
  });

  it('keeps a real zero on the distance counter', () => {
    // 0 km since codes were cleared is a genuine answer right after a clear.
    expect(normalizeSnapshotReadings({ distance_since_cleared_km: 0 }).distance_since_cleared_km).toBe(0);
  });
});
