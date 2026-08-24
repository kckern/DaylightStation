// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { regroupByLocalDay, convertLegacyTrip, repairTelemetryDocument } from './automotive/lib.mjs';

const TZ = 'America/Los_Angeles';

describe('regroupByLocalDay', () => {
  it('moves evening records back to the day they were actually driven', () => {
    const records = [
      { kind: 'event', event: 'wifi-joined', ts: '2026-08-12T00:07:51.240Z' }, // Aug 11, 17:07 PDT
      { kind: 'snapshot', battery_v: 14.7, ts: '2026-08-12T01:03:08.185Z' },   // Aug 11, 18:03 PDT
      { kind: 'event', event: 'wifi-joined', ts: '2026-08-12T18:00:00.000Z' }, // Aug 12, 11:00 PDT
    ];

    const grouped = regroupByLocalDay(records, TZ);

    expect([...grouped.keys()].sort()).toEqual(['2026-08-11', '2026-08-12']);
    expect(grouped.get('2026-08-11')).toHaveLength(2);
    expect(grouped.get('2026-08-12')).toHaveLength(1);
  });

  it('rewrites ts to local ISO with offset so the file is self-consistent', () => {
    const grouped = regroupByLocalDay([{ kind: 'event', ts: '2026-08-12T01:03:08.185Z' }], TZ);
    expect(grouped.get('2026-08-11')[0].ts).toBe('2026-08-11T18:03:08-07:00');
  });

  it('keeps records in chronological order within a day', () => {
    const grouped = regroupByLocalDay([
      { kind: 'event', ts: '2026-08-12T01:03:08.000Z' },
      { kind: 'event', ts: '2026-08-12T00:07:51.000Z' },
    ], TZ);
    const day = grouped.get('2026-08-11');
    expect(day.map((r) => r.ts)).toEqual([
      '2026-08-11T17:07:51-07:00',
      '2026-08-11T18:03:08-07:00',
    ]);
  });

  it('quarantines records with no usable ts instead of dropping them', () => {
    const grouped = regroupByLocalDay([{ kind: 'event', ts: 'not-a-date' }], TZ);
    expect(grouped.get('unknown')).toHaveLength(1);
  });

  it('nulls legacy snapshot sentinels so one file never mixes both conventions', () => {
    const grouped = regroupByLocalDay([{
      kind: 'snapshot', battery_v: 14.72, fuel_pct: -1, coolant_c: 0, rpm: 0,
      speed_kph: 0, dtc: [], gps: { lat: 0, lon: 0 }, ts: '2026-08-12T01:03:08.185Z',
    }], TZ);

    const [record] = grouped.get('2026-08-11');
    expect(record.fuel_pct).toBeNull();
    expect(record.gps).toBeNull();
    expect(record.battery_v).toBe(14.72);
    // rpm/coolant 0 stay as-is: a parked car really does read zero, and a
    // single snapshot carries no trip-wide context to prove otherwise.
    expect(record.rpm).toBe(0);
  });

  it('leaves event records alone apart from the timestamp', () => {
    const grouped = regroupByLocalDay(
      [{ kind: 'event', event: 'wifi-joined', ts: '2026-08-12T01:03:08.185Z' }], TZ,
    );
    expect(grouped.get('2026-08-11')[0]).toEqual({
      kind: 'event', event: 'wifi-joined', ts: '2026-08-11T18:03:08-07:00',
    });
  });
});

describe('convertLegacyTrip', () => {
  const legacy = {
    meta: {
      vehicle: 'family-car',
      trip_id: '628772d0-4ac9',
      started: null,
      ended: null,
      time_approx: true,
      samples: 3,
      schema: 't,lat,lon,speed_kph,rpm,coolant_c,fuel_pct,batt_v',
      received: '2026-08-12T01:03:08.186Z',
    },
    samples: [
      [19175, 0, 0, 0, 0, 0, -1, 14.7],
      [20175, 47.6, -122.3, 12, 0, 0, -1, 14.7],
      [21175, 47.61, -122.3, 30, 0, 0, -1, 14.6],
    ],
  };

  it('rewrites positional rows as keyed samples with t from trip start', () => {
    const { trip } = convertLegacyTrip(legacy, TZ);
    expect(trip.samples[0]).toEqual({ t: 0, batt_v: 14.7 });
    expect(trip.samples[1]).toEqual({ t: 1, lat: 47.6, lon: -122.3, speed_kph: 12, batt_v: 14.7 });
    expect(trip.samples[2].t).toBe(2);
  });

  it('drops the dead-ECU columns and records that the bus never answered', () => {
    const { trip } = convertLegacyTrip(legacy, TZ);
    expect(trip.meta.ecu).toBe(false);
    expect(trip.samples.some((s) => 'rpm' in s || 'fuel_pct' in s)).toBe(false);
  });

  it('derives the summary a trip listing needs', () => {
    const { trip } = convertLegacyTrip(legacy, TZ);
    expect(trip.meta.duration_s).toBe(2);
    expect(trip.meta.max_speed_kph).toBe(30);
    expect(trip.meta.gps_fix_pct).toBe(67);
    expect(trip.meta.distance_km).toBeCloseTo(1.11, 2);
  });

  it('files a clockless trip under unknown_, dated by arrival', () => {
    const { relPath } = convertLegacyTrip(legacy, TZ);
    expect(relPath).toBe('2026-08/unknown_2026-08-11_1803_628772d0-4ac9.yml');
  });

  it('files a trip with a real start time by that time', () => {
    const withClock = {
      ...legacy,
      meta: { ...legacy.meta, started: Date.UTC(2026, 7, 12, 1, 3, 8), time_approx: false },
    };
    const { relPath, trip } = convertLegacyTrip(withClock, TZ);
    expect(relPath).toBe('2026-08/2026-08-11_1803_628772d0-4ac9.yml');
    expect(trip.meta.started).toBe('2026-08-11T18:03:08-07:00');
    expect(trip.meta.time_source).toBe('device');
  });

  it('reports an empty trip as droppable rather than converting it', () => {
    const { droppable, trip } = convertLegacyTrip({ ...legacy, samples: [] }, TZ);
    expect(droppable).toBe(true);
    expect(trip.meta.samples).toBe(0);
  });
});

describe('repairTelemetryDocument', () => {
  it('repairs legacy A6 scale, saturated 0x31, malformed VIN and duplicate refs', () => {
    const input = [
      { kind: 'snapshot', odometer_km: 723591, distance_since_cleared_km: 65535, vin: 'garbage' },
      { kind: 'trip', trip_id: 'same', odometer_start_km: 723590 },
      { kind: 'trip', trip_id: 'same', odometer_start_km: 723590 },
    ];
    const { document, stats } = repairTelemetryDocument(input);
    expect(document[0].odometer_km).toBe(72359.1);
    expect(document[0]).not.toHaveProperty('distance_since_cleared_km');
    expect(document[0]).not.toHaveProperty('vin');
    expect(document).toHaveLength(2);
    expect(stats).toEqual({ odometers: 2, saturatedDistances: 1, invalidVins: 1, duplicateTrips: 1 });
  });

  it('is idempotent for schema-2 telemetry', () => {
    const first = repairTelemetryDocument({ meta: { telemetry_schema: 2, odometer_end_km: 72359.1 } });
    const second = repairTelemetryDocument(first.document);
    expect(second.document.meta.odometer_end_km).toBe(72359.1);
    expect(second.stats.odometers).toBe(0);
  });
});
