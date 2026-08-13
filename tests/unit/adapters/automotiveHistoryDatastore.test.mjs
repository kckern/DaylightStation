// tests/unit/adapters/automotiveHistoryDatastore.test.mjs
//
// The real history tree contains two generations of day-log record. The
// pre-migration format wrote `time_approx: true` and little else — no file
// pointer, no distance — so mapped naively it yields journeys reading
// "0 km, time unknown", which record nothing. Measured 2026-08-12: 55 of 59
// trip records in the live tree were that shape. This suite pins the skip, the
// count, and the reading of the current format.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import yaml from 'js-yaml';
import { YamlVehicleHistoryDatastore } from '#adapters/persistence/yaml/YamlVehicleHistoryDatastore.mjs';

const VEHICLE = 'test-vehicle';
const silent = { debug() {}, info() {}, warn() {} };

let root;
let store;

const writeDay = (day, records) => {
  const dir = path.join(root, VEHICLE);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, `${day}.yml`), yaml.dump(records), 'utf8');
};

const writeTrip = (relPath, trip) => {
  const file = path.join(root, VEHICLE, 'trips', relPath);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, yaml.dump(trip), 'utf8');
};

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'automotive-history-'));
  store = new YamlVehicleHistoryDatastore({ historyRoot: root, logger: silent });
});

afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

describe('YamlVehicleHistoryDatastore', () => {
  it('lists vehicles that have history', async () => {
    writeDay('2026-08-12', []);
    expect(await store.listVehicleIds()).toEqual([VEHICLE]);
  });

  it('returns nothing for a vehicle with no history', async () => {
    expect(await store.listTripDescriptors('nobody')).toEqual([]);
    expect(await store.readLatestSnapshot('nobody')).toBeNull();
  });

  it('skips pre-migration stubs and counts them', async () => {
    writeDay('2026-07-30', [
      { kind: 'trip', trip_id: 'legacy-1', ts: '2026-07-30T18:40:43-07:00', started: null, ended: null, time_approx: true, samples: 0 },
      { kind: 'trip', trip_id: 'legacy-2', ts: '2026-07-30T19:00:00-07:00', started: null, ended: null, time_approx: true, samples: 398 },
      { kind: 'trip', trip_id: 'current', ts: '2026-07-30T20:00:00-07:00', file: '2026-07/x.yml', started: null, ended: null, time_source: 'boot-relative', duration_s: 300, distance_km: 3.1, max_speed_kph: 60, ecu: false, samples: 61 },
    ]);

    const descriptors = await store.listTripDescriptors(VEHICLE);
    expect(descriptors).toHaveLength(1);
    expect(descriptors[0].tripId).toBe('current');
    expect(store.lastLegacyCount).toBe(2);
  });

  it('maps a current-format record onto a trip descriptor', async () => {
    writeDay('2026-08-11', [
      { kind: 'trip', trip_id: 'abc', ts: '2026-08-11T18:13:13-07:00', file: '2026-08/t.yml',
        started: '2026-08-11T18:05:19-07:00', ended: '2026-08-11T18:13:08-07:00',
        time_source: 'device', duration_s: 469, distance_km: 7.45, max_speed_kph: 73, ecu: true, samples: 94 },
    ]);

    const [descriptor] = await store.listTripDescriptors(VEHICLE);
    expect(descriptor.startedAt).toBeInstanceOf(Date);
    expect(descriptor.distanceKm).toBe(7.45);
    expect(descriptor.maxSpeedKph).toBe(73);
    expect(descriptor.ecu).toBe(true);
    expect(descriptor.timeSource).toBe('device');
  });

  it('deduplicates a trip that appears in two day logs', async () => {
    // The device re-uploads until a trip-ack lands, so the same trip can be
    // written twice across a day boundary.
    const record = { kind: 'trip', trip_id: 'dupe', file: '2026-08/t.yml', started: null, ended: null, distance_km: 2, samples: 20 };
    writeDay('2026-08-11', [record]);
    writeDay('2026-08-12', [record]);
    expect(await store.listTripDescriptors(VEHICLE)).toHaveLength(1);
  });

  it('attaches endpoint fixes from the trip file when asked', async () => {
    writeDay('2026-08-12', [
      { kind: 'trip', trip_id: 'abc', file: '2026-08/t.yml', started: null, ended: null, distance_km: 3, samples: 3 },
    ]);
    writeTrip('2026-08/t.yml', {
      meta: { vehicle: VEHICLE },
      samples: [
        { t: 0, lat: 47.1, lon: -122.1 },
        { t: 5, batt_v: 14 },
        { t: 10, lat: 47.2, lon: -122.2 },
      ],
    });

    const [descriptor] = await store.listTripDescriptors(VEHICLE, { withFixes: true });
    expect(descriptor.startFix.lat).toBe(47.1);
    expect(descriptor.endFix.lat).toBe(47.2);
  });

  it('leaves fixes null when the trip carries no coordinates', async () => {
    // Observed in the real tree: a trip whose meta claims a GPS fix rate but
    // whose samples contain no lat/lon at all.
    writeDay('2026-08-12', [
      { kind: 'trip', trip_id: 'nofix', file: '2026-08/n.yml', started: null, ended: null, distance_km: 3, samples: 2 },
    ]);
    writeTrip('2026-08/n.yml', { meta: { gps_fix_pct: 88 }, samples: [{ t: 0, batt_v: 14.6 }, { t: 4, batt_v: 14.6 }] });

    const [descriptor] = await store.listTripDescriptors(VEHICLE, { withFixes: true });
    expect(descriptor.startFix).toBeNull();
    expect(descriptor.endFix).toBeNull();
  });

  it('reads the 0x31 counter readings once the firmware emits them', async () => {
    writeDay('2026-08-12', [
      { kind: 'trip', trip_id: 'ctr', file: '2026-08/c.yml', started: null, ended: null, distance_km: 12, samples: 2 },
    ]);
    writeTrip('2026-08/c.yml', {
      meta: { distance_start_km: 41200, distance_end_km: 41212 },
      samples: [{ t: 0 }, { t: 5 }],
    });

    const [descriptor] = await store.listTripDescriptors(VEHICLE, { withFixes: true });
    expect(descriptor.counterStartKm).toBe(41200);
    expect(descriptor.counterEndKm).toBe(41212);
  });

  it('finds the newest snapshot across days that have none', async () => {
    writeDay('2026-08-10', [{ kind: 'snapshot', battery_v: 12.4, ts: '2026-08-10T10:00:00-07:00' }]);
    // A day of events and dropped trips, but no snapshot at all.
    writeDay('2026-08-11', [{ kind: 'event', event: 'wifi-joined', ts: '2026-08-11T10:00:00-07:00' }]);

    const snapshot = await store.readLatestSnapshot(VEHICLE);
    expect(snapshot.battery_v).toBe(12.4);
  });

  it('refuses to read a trip file outside the trips directory', async () => {
    writeDay('2026-08-12', []);
    fs.writeFileSync(path.join(root, 'secret.yml'), yaml.dump({ meta: {} }), 'utf8');
    // `file` reaches this method from a YAML field and can come via HTTP.
    expect(await store.readTrip(VEHICLE, '../../secret.yml')).toBeNull();
  });
});
