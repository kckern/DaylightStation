import { describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import { promises as fs } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import yaml from 'js-yaml';
import { createAutomotiveRelay } from '#apps/hardware/automotiveRelay.mjs';

const logger = { debug() {}, info() {}, warn() {}, error() {} };

function makeBus() {
  const handlers = [];
  const broadcasts = [];
  const clientSends = [];
  return {
    onClientMessage: (cb) => { handlers.push(cb); },
    broadcast: (topic, payload) => broadcasts.push({ topic, payload }),
    sendToClient: (clientId, message) => { clientSends.push({ clientId, message }); return true; },
    subscribe: () => () => {},
    // test drivers
    ingest: (clientId, message) => handlers.forEach((cb) => cb(clientId, message)),
    broadcasts,
    clientSends,
  };
}

const SRC = 'obd-relay';
const VEHICLE = 'test-car';
const day = () => new Date().toISOString().slice(0, 10);

describe('automotiveRelay', () => {
  let bus, dataDir, relay, clock;
  const historyRoot = () => path.join(dataDir, 'household', 'history', 'automotive');
  const make = (config = {}) => createAutomotiveRelay({
    eventBus: bus, dataDir, config, logger, now: () => clock,
  });

  beforeEach(async () => {
    bus = makeBus();
    clock = 1_800_000_000_000;
    dataDir = await fs.mkdtemp(path.join(tmpdir(), 'automotive-relay-'));
  });

  afterEach(async () => {
    relay?.dispose();
    await fs.rm(dataDir, { recursive: true, force: true });
  });

  it('ignores messages from other sources', async () => {
    relay = make();
    bus.ingest('c1', { source: 'food-scale-relay', type: 'snapshot', id: VEHICLE });
    await relay.flush();
    expect(bus.broadcasts).toHaveLength(0);
  });

  it('rebroadcasts snapshots on the automotive topic and persists with throttle', async () => {
    relay = make({ persistence: { snapshot_min_s: 60 } });
    const snap = { source: SRC, type: 'snapshot', id: VEHICLE, battery_v: 14.2, fuel_pct: 63, coolant_c: 88, rpm: 840, speed_kph: 0, dtc: [], gps: { lat: 1, lon: 2 } };

    bus.ingest('c1', snap);
    clock += 10_000; // within throttle window
    bus.ingest('c1', { ...snap, battery_v: 14.1 });
    await relay.flush();

    expect(bus.broadcasts).toHaveLength(2);
    expect(bus.broadcasts[0].topic).toBe('automotive');
    expect(bus.broadcasts[0].payload.battery_v).toBe(14.2);

    const dayLog = yaml.load(await fs.readFile(path.join(historyRoot(), VEHICLE, `${day()}.yml`), 'utf8'));
    expect(dayLog).toHaveLength(1); // second snapshot throttled
    expect(dayLog[0].kind).toBe('snapshot');
    expect(dayLog[0].battery_v).toBe(14.2);

    clock += 61_000; // past the window
    bus.ingest('c1', { ...snap, battery_v: 12.6 });
    await relay.flush();
    const dayLog2 = yaml.load(await fs.readFile(path.join(historyRoot(), VEHICLE, `${day()}.yml`), 'utf8'));
    expect(dayLog2).toHaveLength(2);
    expect(dayLog2[1].battery_v).toBe(12.6);
  });

  it('persists events and honors per-vehicle topic override', async () => {
    relay = make({ vehicles: { [VEHICLE]: { topic: 'car-events' } } });
    bus.ingest('c1', { source: SRC, type: 'event', id: VEHICLE, event: 'wifi-joined' });
    await relay.flush();

    expect(bus.broadcasts[0].topic).toBe('car-events');
    const dayLog = yaml.load(await fs.readFile(path.join(historyRoot(), VEHICLE, `${day()}.yml`), 'utf8'));
    expect(dayLog[0]).toMatchObject({ kind: 'event', event: 'wifi-joined' });
  });

  it('reassembles chunked trips, persists, and acks the uploading client', async () => {
    relay = make();
    const rows = (n, offset = 0) => Array.from({ length: n }, (_, i) => [1000 + (offset + i) * 1000, 47.6, -122.3, 30, 1500, 88, 63, 14.2]);

    bus.ingest('c9', { source: SRC, type: 'trip', id: VEHICLE, trip_id: 'abc1', seq: 0, final: false, samples: rows(3) });
    bus.ingest('c9', {
      source: SRC, type: 'trip', id: VEHICLE, trip_id: 'abc1', seq: 1, final: true, samples: rows(2, 3),
      meta: { started_epoch_ms: 1_799_999_000_000, ended_boot_ms: 5000, upload_boot_ms: 9000, upload_epoch_ms: 1_800_000_000_000, samples: 5, schema: 't,lat,lon,speed_kph,rpm,coolant_c,fuel_pct,batt_v', time_approx: false },
    });
    await relay.flush();

    const trip = yaml.load(await fs.readFile(path.join(historyRoot(), VEHICLE, 'trips', 'abc1.yml'), 'utf8'));
    expect(trip.samples).toHaveLength(5);
    expect(trip.meta.started).toBe(1_799_999_000_000);
    expect(trip.meta.time_approx).toBe(false);

    // day log gets a summary record
    const dayLog = yaml.load(await fs.readFile(path.join(historyRoot(), VEHICLE, `${day()}.yml`), 'utf8'));
    expect(dayLog.some((r) => r.kind === 'trip' && r.trip_id === 'abc1' && r.samples === 5)).toBe(true);

    // ack goes to the uploading client only after the durable write
    expect(bus.clientSends).toEqual([{ clientId: 'c9', message: { type: 'trip-ack', trip_id: 'abc1' } }]);

    // live subscribers got a meta-only broadcast
    const tripBroadcast = bus.broadcasts.find((b) => b.payload.kind === 'trip');
    expect(tripBroadcast.payload.trip_id).toBe('abc1');
    expect(tripBroadcast.payload.samples).toBeUndefined();
  });

  it('rebases boot-relative times when uploaded in the same power session', async () => {
    relay = make();
    bus.ingest('c1', {
      source: SRC, type: 'trip', id: VEHICLE, trip_id: 'away1', seq: 0, final: true,
      samples: [[2000, 0, 0, 10, 1000, 80, 50, 13.9], [7000, 0, 0, 20, 1500, 85, 50, 14.0]],
      meta: { started_epoch_ms: 0, time_approx: true, ended_boot_ms: 7000, upload_boot_ms: 100_000, upload_epoch_ms: 1_800_000_000_000 },
    });
    await relay.flush();

    const trip = yaml.load(await fs.readFile(path.join(historyRoot(), VEHICLE, 'trips', 'away1.yml'), 'utf8'));
    expect(trip.meta.started).toBe(1_800_000_000_000 - (100_000 - 2000));
    expect(trip.meta.ended).toBe(1_800_000_000_000 - (100_000 - 7000));
    expect(trip.meta.time_approx).toBe(false);
  });

  it('keeps time_approx when the buffered trip is from an earlier power session', async () => {
    relay = make();
    bus.ingest('c1', {
      source: SRC, type: 'trip', id: VEHICLE, trip_id: 'stale1', seq: 0, final: true,
      samples: [[900_000, 0, 0, 10, 1000, 80, 50, 13.9]],
      // upload_boot_ms < ended_boot_ms ⇒ device rebooted between trip and upload
      meta: { started_epoch_ms: 0, time_approx: true, ended_boot_ms: 900_000, upload_boot_ms: 30_000, upload_epoch_ms: 1_800_000_000_000 },
    });
    await relay.flush();

    const trip = yaml.load(await fs.readFile(path.join(historyRoot(), VEHICLE, 'trips', 'stale1.yml'), 'utf8'));
    expect(trip.meta.started).toBeNull();
    expect(trip.meta.ended).toBeNull();
    expect(trip.meta.time_approx).toBe(true);
  });
});
