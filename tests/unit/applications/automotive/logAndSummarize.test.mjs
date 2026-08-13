// tests/unit/applications/automotive/logAndSummarize.test.mjs
//
// The write path, end to end through real YAML: log fill-ups in miles and
// gallons, read them back, and confirm the overview reconciles them into an
// odometer and an mpg figure.
//
// Unit conversion is the risk this pins. The form speaks miles and gallons, the
// files speak kilometres and litres, and a leak in either direction is a bug
// that stays invisible until a mileage figure is quietly 1.6x wrong.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import yaml from 'js-yaml';
import { YamlVehicleRecordDatastore } from '#adapters/persistence/yaml/YamlVehicleRecordDatastore.mjs';
import { LogFuel } from '#apps/automotive/usecases/LogFuel.mjs';
import { LogServiceRecord } from '#apps/automotive/usecases/LogServiceRecord.mjs';
import { GetVehicleOverview } from '#apps/automotive/usecases/GetVehicleOverview.mjs';

const VEHICLE = 'test-vehicle';
const silent = { debug() {}, info() {}, warn() {} };

/** History with no trips — this suite is about hand-entered records. */
const emptyHistory = {
  listVehicleIds: async () => [],
  listTripDescriptors: async () => [],
  readTrip: async () => null,
  readLatestSnapshot: async () => null,
};

let root;
let records;
let logFuel;
let logService;
let overview;
let counter;

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'automotive-records-'));
  records = new YamlVehicleRecordDatastore({ recordsRoot: root, logger: silent });
  counter = 0;
  const idGenerator = (date, kind) => `${date.toISOString().slice(0, 10)}-${kind}-${++counter}`;
  logFuel = new LogFuel({ recordRepository: records, idGenerator, logger: silent });
  logService = new LogServiceRecord({ recordRepository: records, idGenerator, logger: silent });
  overview = new GetVehicleOverview({
    historyRepository: emptyHistory, recordRepository: records, logger: silent,
  });
});

afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

const readFuelFile = () =>
  yaml.load(fs.readFileSync(path.join(root, VEHICLE, 'fuel.yml'), 'utf8'));

describe('LogFuel', () => {
  it('converts miles and gallons to km and litres on the way in', async () => {
    await logFuel.execute({
      vehicleId: VEHICLE, date: '2026-08-01', odometerMi: 25000, volumeGal: 10, priceTotal: 40,
    });

    const [row] = readFuelFile();
    // 25,000 mi = 40,233.6 km; 10 gal = 37.854 L. Stored in the canonical units.
    expect(row.odometer_km).toBeCloseTo(40233.6, 1);
    expect(row.volume_l).toBeCloseTo(37.854, 2);
    expect(row.price_total).toBe(40);
  });

  it('accepts canonical units directly when given them', async () => {
    await logFuel.execute({ vehicleId: VEHICLE, date: '2026-08-01', odometerKm: 100, volumeL: 50 });
    const [row] = readFuelFile();
    expect(row.odometer_km).toBe(100);
    expect(row.volume_l).toBe(50);
  });

  it('round-trips through the datastore as a domain entity', async () => {
    await logFuel.execute({ vehicleId: VEHICLE, date: '2026-08-01', volumeGal: 10, odometerMi: 100 });
    const [log] = await records.listFuelLogs(VEHICLE);
    expect(log.canCloseInterval).toBe(true);
    expect(log.pricePerLitre).toBeNull();
  });

  it('rejects a zero-volume fill rather than writing it', async () => {
    await expect(
      logFuel.execute({ vehicleId: VEHICLE, date: '2026-08-01', volumeGal: 0 }),
    ).rejects.toThrow(/volume/i);
    expect(fs.existsSync(path.join(root, VEHICLE, 'fuel.yml'))).toBe(false);
  });

  it('edits in place when given an existing id', async () => {
    const first = await logFuel.execute({ vehicleId: VEHICLE, date: '2026-08-01', volumeGal: 10 });
    await logFuel.execute({ vehicleId: VEHICLE, id: first.id, date: '2026-08-01', volumeGal: 12 });
    const rows = readFuelFile();
    expect(rows).toHaveLength(1);
    expect(rows[0].volume_l).toBeCloseTo(45.42, 1);
  });
});

describe('GetVehicleOverview', () => {
  it('reports no odometer until a dash reading exists', async () => {
    await logFuel.execute({ vehicleId: VEHICLE, date: '2026-08-01', volumeGal: 10 });
    const result = await overview.execute({ vehicleId: VEHICLE, now: new Date('2026-08-12') });
    expect(result.odometer.km).toBeNull();
    expect(result.odometer.confidence).toBe('unknown');
  });

  it('anchors the odometer to the latest dash reading from any record type', async () => {
    await logFuel.execute({ vehicleId: VEHICLE, date: '2026-07-01', volumeGal: 10, odometerMi: 25000 });
    // A service invoice records mileage too, and is equally authoritative.
    await logService.execute({
      vehicleId: VEHICLE, date: '2026-08-01', type: 'oil-change', odometerMi: 25500, intervalMonths: 6,
    });

    const result = await overview.execute({ vehicleId: VEHICLE, now: new Date('2026-08-12') });
    expect(result.odometer.source).toBe('dash');
    expect(result.odometer.confidence).toBe('exact');
    expect(result.odometer.km).toBeCloseTo(25500 * 1.609344, 0);
  });

  it('computes mpg once two full tanks exist, and not before', async () => {
    await logFuel.execute({ vehicleId: VEHICLE, date: '2026-07-01', volumeGal: 10, odometerMi: 25000 });
    let result = await overview.execute({ vehicleId: VEHICLE, now: new Date('2026-08-12') });
    expect(result.fuel.needsMoreData).toBe(true);

    await logFuel.execute({ vehicleId: VEHICLE, date: '2026-07-20', volumeGal: 10, odometerMi: 25300 });
    result = await overview.execute({ vehicleId: VEHICLE, now: new Date('2026-08-12') });
    expect(result.fuel.needsMoreData).toBe(false);
    // 300 miles on the 10 gallons pumped at the close of the interval.
    expect(result.fuel.avgMpg).toBeCloseTo(30, 1);
  });

  it('surfaces a service interval as a reminder', async () => {
    await logService.execute({
      vehicleId: VEHICLE, date: '2026-02-01', type: 'oil-change', intervalMonths: 6,
    });
    const result = await overview.execute({ vehicleId: VEHICLE, now: new Date('2026-08-12') });
    expect(result.reminders).toHaveLength(1);
    expect(result.reminders[0].status).toBe('overdue');
  });

  it('survives a vehicle with no records at all', async () => {
    const result = await overview.execute({ vehicleId: 'nobody', now: new Date('2026-08-12') });
    expect(result.odometer.km).toBeNull();
    expect(result.reminders).toEqual([]);
    expect(result.counts).toEqual({ service_records: 0, fuel_logs: 0, documents: 0 });
  });
});
