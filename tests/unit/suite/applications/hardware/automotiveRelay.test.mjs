// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
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
const TZ = 'America/Los_Angeles';

// 2026-08-12T00:30:00Z is 2026-08-11 17:30 in America/Los_Angeles (PDT, UTC-7).
// Every assertion below leans on that gap: a UTC day key would file these
// records under 2026-08-12, the local key under 2026-08-11.
const EVENING = Date.UTC(2026, 7, 12, 0, 30, 0);
const LOCAL_DAY = '2026-08-11';

describe('automotiveRelay', () => {
  let bus, dataDir, relay, clock;
  const historyRoot = () => path.join(dataDir, 'household', 'history', 'automotive');
  const readDayLog = async (day = LOCAL_DAY) =>
    yaml.load(await fs.readFile(path.join(historyRoot(), VEHICLE, `${day}.yml`), 'utf8'));
  const readTrip = async (relPath) =>
    yaml.load(await fs.readFile(path.join(historyRoot(), VEHICLE, 'trips', relPath), 'utf8'));
  const make = (config = {}) => createAutomotiveRelay({
    eventBus: bus, dataDir, config, logger, timezone: TZ, now: () => clock,
  });

  beforeEach(async () => {
    bus = makeBus();
    clock = EVENING;
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

  // ── Day log ────────────────────────────────────────────────────────────────

  it('keys the day log by the local date, not UTC', async () => {
    relay = make();
    bus.ingest('c1', { source: SRC, type: 'event', id: VEHICLE, event: 'wifi-joined' });
    await relay.flush();

    const names = await fs.readdir(path.join(historyRoot(), VEHICLE));
    expect(names).toContain(`${LOCAL_DAY}.yml`);
    expect(names).not.toContain('2026-08-12.yml');
  });

  it('uses the injected clock for the day key rather than wall time', async () => {
    relay = make();
    clock = Date.UTC(2021, 0, 2, 3, 0, 0); // 2021-01-01 19:00 PST
    bus.ingest('c1', { source: SRC, type: 'event', id: VEHICLE, event: 'wifi-joined' });
    await relay.flush();

    const names = await fs.readdir(path.join(historyRoot(), VEHICLE));
    expect(names).toEqual(['2021-01-01.yml']);
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

    const dayLog = await readDayLog();
    expect(dayLog).toHaveLength(1); // second snapshot throttled
    expect(dayLog[0].kind).toBe('snapshot');
    expect(dayLog[0].battery_v).toBe(14.2);

    clock += 61_000; // past the window
    bus.ingest('c1', { ...snap, battery_v: 12.6 });
    await relay.flush();
    const dayLog2 = await readDayLog();
    expect(dayLog2).toHaveLength(2);
    expect(dayLog2[1].battery_v).toBe(12.6);
  });

  it('nulls snapshot sentinels instead of persisting them as readings', async () => {
    relay = make();
    bus.ingest('c1', {
      source: SRC, type: 'snapshot', id: VEHICLE,
      battery_v: 14.7, fuel_pct: -1, coolant_c: 0, rpm: 0, speed_kph: 0,
      dtc: [], gps: { lat: 0, lon: 0 },
    });
    await relay.flush();

    const [record] = await readDayLog();
    expect(record.fuel_pct).toBeNull();   // -1 means "no reading", not 1% below empty
    expect(record.gps).toBeNull();        // (0,0) is the Gulf of Guinea, not a fix
    expect(record.battery_v).toBe(14.7);  // real reading survives
  });

  it('persists events and honors per-vehicle topic override', async () => {
    relay = make({ vehicles: { [VEHICLE]: { topic: 'car-events' } } });
    bus.ingest('c1', { source: SRC, type: 'event', id: VEHICLE, event: 'wifi-joined' });
    await relay.flush();

    expect(bus.broadcasts[0].topic).toBe('car-events');
    const dayLog = await readDayLog();
    expect(dayLog[0]).toMatchObject({ kind: 'event', event: 'wifi-joined' });
  });

  // ── Trip files ─────────────────────────────────────────────────────────────

  const tripMsg = (over = {}) => ({
    source: SRC, type: 'trip', id: VEHICLE, trip_id: 'abc1', seq: 0, final: true,
    samples: [
      [1000, 47.6, -122.3, 30, 1500, 88, 63, 14.2],
      [2000, 47.61, -122.3, 42, 1800, 89, 63, 14.2],
    ],
    meta: {
      started_epoch_ms: EVENING, ended_boot_ms: 2000, upload_boot_ms: 9000,
      upload_epoch_ms: EVENING + 9000, samples: 2,
      schema: 't,lat,lon,speed_kph,rpm,coolant_c,fuel_pct,batt_v',
    },
    ...over,
  });

  it('files trips under a month shard named by local start time', async () => {
    relay = make();
    bus.ingest('c9', tripMsg());
    await relay.flush();

    const months = await fs.readdir(path.join(historyRoot(), VEHICLE, 'trips'));
    expect(months).toEqual(['2026-08']);
    const files = await fs.readdir(path.join(historyRoot(), VEHICLE, 'trips', '2026-08'));
    expect(files).toEqual(['2026-08-11_1730_abc1.yml']);
  });

  it('marks trips with an unrecoverable clock instead of misfiling them by date', async () => {
    relay = make();
    bus.ingest('c1', tripMsg({
      trip_id: 'stale1',
      samples: [[900_000, 0, 0, 10, 0, 0, -1, 13.9]],
      // upload_boot_ms < ended_boot_ms ⇒ device rebooted between trip and upload
      meta: { started_epoch_ms: 0, ended_boot_ms: 900_000, upload_boot_ms: 30_000, upload_epoch_ms: EVENING },
    }));
    await relay.flush();

    const files = await fs.readdir(path.join(historyRoot(), VEHICLE, 'trips', '2026-08'));
    expect(files).toEqual(['unknown_2026-08-11_1730_stale1.yml']);
    const trip = await readTrip('2026-08/unknown_2026-08-11_1730_stale1.yml');
    expect(trip.meta.started).toBeNull();
    expect(trip.meta.time_source).toBe('boot-relative');
  });

  it('reassembles chunked trips and acks the uploading client after the write', async () => {
    relay = make();
    const rows = (n, offset = 0) => Array.from({ length: n }, (_, i) => [1000 + (offset + i) * 1000, 47.6, -122.3, 30, 1500, 88, 63, 14.2]);

    bus.ingest('c9', tripMsg({ seq: 0, final: false, samples: rows(3), meta: undefined }));
    bus.ingest('c9', tripMsg({ seq: 1, final: true, samples: rows(2, 3) }));
    await relay.flush();

    const trip = await readTrip('2026-08/2026-08-11_1730_abc1.yml');
    expect(trip.samples).toHaveLength(5);
    expect(bus.clientSends).toEqual([{ clientId: 'c9', message: { type: 'trip-ack', trip_id: 'abc1' } }]);

    const dayLog = await readDayLog();
    expect(dayLog.some((r) => r.kind === 'trip' && r.trip_id === 'abc1' && r.samples === 5)).toBe(true);

    // live subscribers get meta only, never the sample block
    const tripBroadcast = bus.broadcasts.find((b) => b.payload.kind === 'trip');
    expect(tripBroadcast.payload.trip_id).toBe('abc1');
    expect(tripBroadcast.payload.samples).toBeUndefined();
  });

  it('rebases boot-relative times when uploaded in the same power session', async () => {
    relay = make();
    bus.ingest('c1', tripMsg({
      trip_id: 'away1',
      samples: [[2000, 0, 0, 10, 1000, 80, 50, 13.9], [7000, 0, 0, 20, 1500, 85, 50, 14.0]],
      meta: { started_epoch_ms: 0, ended_boot_ms: 7000, upload_boot_ms: 100_000, upload_epoch_ms: EVENING },
    }));
    await relay.flush();

    const [file] = await fs.readdir(path.join(historyRoot(), VEHICLE, 'trips', '2026-08'));
    const trip = await readTrip(path.join('2026-08', file));
    expect(trip.meta.time_source).toBe('rebased');
    // started = EVENING - (100_000 - 2000) = 17:28:22 local
    expect(trip.meta.started).toBe('2026-08-11T17:28:22-07:00');
    expect(trip.meta.ended).toBe('2026-08-11T17:28:27-07:00');
  });

  // ── Sample encoding ────────────────────────────────────────────────────────

  it('writes samples as keyed objects with t in seconds from trip start', async () => {
    relay = make();
    bus.ingest('c1', tripMsg());
    await relay.flush();

    const trip = await readTrip('2026-08/2026-08-11_1730_abc1.yml');
    expect(trip.samples[0]).toEqual({ t: 0, lat: 47.6, lon: -122.3, speed_kph: 30, rpm: 1500, coolant_c: 88, fuel_pct: 63, batt_v: 14.2 });
    expect(trip.samples[1].t).toBe(1);
    expect(trip.units).toMatchObject({ t: 's', speed_kph: 'km/h', batt_v: 'V' });
    expect(trip.meta.schema).toBeUndefined(); // keys replace the positional decoder ring
  });

  it('omits engine fields entirely when the ECU never answered', async () => {
    relay = make();
    bus.ingest('c1', tripMsg({
      // rpm/coolant flat zero and fuel pinned at -1 across the whole trip
      samples: [
        [1000, 47.6, -122.3, 30, 0, 0, -1, 14.2],
        [2000, 47.61, -122.3, 42, 0, 0, -1, 14.3],
      ],
    }));
    await relay.flush();

    const trip = await readTrip('2026-08/2026-08-11_1730_abc1.yml');
    expect(trip.meta.ecu).toBe(false);
    expect(trip.samples[0]).toEqual({ t: 0, lat: 47.6, lon: -122.3, speed_kph: 30, batt_v: 14.2 });
    expect(trip.samples[0]).not.toHaveProperty('rpm');
    expect(trip.units).not.toHaveProperty('rpm');
  });

  it('omits engine fields on rows where the ECU session dropped mid-trip', async () => {
    relay = make();
    bus.ingest('c1', tripMsg({
      samples: [
        [1000, 47.6, -122.3, 30, 1509, 38, 43, 14.7],   // bus answering
        [2000, 47.61, -122.3, 42, 0, 0, -1, 14.6],      // session dropped
        [3000, 47.62, -122.3, 44, 1600, 39, 43, 14.6],  // back
      ],
    }));
    await relay.flush();

    const trip = await readTrip('2026-08/2026-08-11_1730_abc1.yml');
    expect(trip.meta.ecu).toBe(true);
    // coolant does not fall to 0 C mid-drive — that row is a gap, not a reading
    expect(trip.samples[1]).not.toHaveProperty('rpm');
    expect(trip.samples[1]).not.toHaveProperty('coolant_c');
    expect(trip.samples[1].speed_kph).toBe(42); // GPS-derived fields survive
    expect(trip.samples[2].rpm).toBe(1600);
  });

  it('keeps a genuine idle row, where the bus answered but the engine was stopped', async () => {
    relay = make();
    bus.ingest('c1', tripMsg({
      samples: [
        [1000, 47.6, -122.3, 0, 0, 82, 43, 14.7],   // stopped at a light, bus alive
        [2000, 47.61, -122.3, 42, 1600, 83, 43, 14.6],
      ],
    }));
    await relay.flush();

    const trip = await readTrip('2026-08/2026-08-11_1730_abc1.yml');
    expect(trip.samples[0].rpm).toBe(0);
    expect(trip.samples[0].coolant_c).toBe(82);
  });

  it('omits gps keys on samples with no fix, keeping the rest of the row', async () => {
    relay = make();
    bus.ingest('c1', tripMsg({
      samples: [
        [1000, 0, 0, 0, 1500, 88, 63, 14.2],       // pre-fix
        [2000, 47.61, -122.3, 42, 1800, 89, 63, 14.2],
      ],
    }));
    await relay.flush();

    const trip = await readTrip('2026-08/2026-08-11_1730_abc1.yml');
    expect(trip.samples[0]).not.toHaveProperty('lat');
    expect(trip.samples[0].rpm).toBe(1500);
    expect(trip.samples[1].lat).toBe(47.61);
    expect(trip.meta.gps_fix_pct).toBe(50);
  });

  // ── Derived summary ────────────────────────────────────────────────────────

  it('derives a trip summary so listings never parse the sample block', async () => {
    relay = make();
    bus.ingest('c1', tripMsg());
    await relay.flush();

    const trip = await readTrip('2026-08/2026-08-11_1730_abc1.yml');
    expect(trip.meta.duration_s).toBe(1);
    expect(trip.meta.max_speed_kph).toBe(42);
    expect(trip.meta.gps_fix_pct).toBe(100);
    expect(trip.meta.ecu).toBe(true);
    // 47.60 → 47.61 at fixed longitude ≈ 1.11 km
    expect(trip.meta.distance_km).toBeCloseTo(1.11, 2);
  });

  // ── Empty-trip suppression ─────────────────────────────────────────────────

  it('drops trips below the sample floor but still acks so the device clears flash', async () => {
    relay = make({ persistence: { min_trip_samples: 10 } });
    bus.ingest('c7', tripMsg({ trip_id: 'blip', samples: [] }));
    await relay.flush();

    await expect(fs.readdir(path.join(historyRoot(), VEHICLE, 'trips'))).rejects.toThrow();
    expect(bus.clientSends).toEqual([{ clientId: 'c7', message: { type: 'trip-ack', trip_id: 'blip' } }]);

    const dayLog = await readDayLog();
    expect(dayLog.some((r) => r.kind === 'trip-dropped' && r.trip_id === 'blip' && r.samples === 0)).toBe(true);
  });

  it('keeps trips at or above the sample floor', async () => {
    relay = make({ persistence: { min_trip_samples: 2 } });
    bus.ingest('c1', tripMsg());
    await relay.flush();

    const files = await fs.readdir(path.join(historyRoot(), VEHICLE, 'trips', '2026-08'));
    expect(files).toHaveLength(1);
  });
});
