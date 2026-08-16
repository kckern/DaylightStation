// backend/src/3_applications/hardware/automotiveRelay.mjs
//
// Automotive (obd-relay) wiring — the in-car Freematics device (see
// _extensions/obd-relay) connects to the WS event bus as a device client
// whenever the car is on home WiFi, streams live snapshots/events, and uploads
// trips it buffered to flash while driving. Mirrors foodScaleRelay.mjs:
//
//   1) INGEST  (client → bus): messages with source `obd-relay` are
//      re-broadcast on the vehicle's configured topic (default `automotive`)
//      so any app/display can subscribe live. `trip` messages arrive chunked
//      (`seq`/`final`) and are reassembled per (vehicle, trip_id).
//
//   2) PERSIST (bus-side): snapshots (throttled) and events append to
//      {dataDir}/{persistence.dir}/{id}/{YYYY-MM-DD}.yml, keyed by the
//      HOUSEHOLD-LOCAL day — a UTC key filed every evening drive under
//      tomorrow and split trips that crossed 00:00Z. Each reassembled trip
//      writes {.../}{id}/trips/{YYYY-MM}/{YYYY-MM-DD}_{HHMM}_{trip_id}.yml.
//      After a trip persists, the device gets {"type":"trip-ack"} via
//      sendToClient so it deletes its buffered copy — the ack MUST only follow
//      a durable write, and is also sent for trips dropped below the sample
//      floor (otherwise the device retries the same blip forever).
//
// Trip file format: samples are keyed objects, one per line, and a reading that
// was never taken is an ABSENT KEY rather than a sentinel. The firmware reports
// `rpm: 0` / `coolant_c: 0` when no ECU session exists, `fuel_pct: -1` for no
// reading, and `lat/lon: 0` before GNSS lock — persisting those verbatim reads
// as "engine idling at the Gulf of Guinea". `meta` carries a derived summary
// (duration, distance, max speed, gps fix rate, ecu) so a trip list or monthly
// rollup never has to parse the sample block.
//
// Trip timestamps: trips that started away from home carry boot-relative times.
// When the upload happens in the same power session (upload_boot_ms ≥
// ended_boot_ms), wall-clock start/end are rebased from upload_epoch_ms;
// otherwise times stay unrecoverable and `time_source: boot-relative`.
//
// Config-driven from the household SSOT (config/vehicles.yml), passed as
// `config`. Design: docs/_wip/plans/2026-07-14-obd-relay-design.md
import path from 'path';
import yaml from 'js-yaml';
import { formatIsoLocal, formatLocalTimestamp, getDateInTimezone } from '#domains/core/utils/time.mjs';
import { DEFAULT_TIMEZONE } from '#domains/core/utils/timezone.mjs';

const RELAY_SOURCE = 'obd-relay';
const DEFAULT_TOPIC = 'automotive';
const DEFAULT_SNAPSHOT_MIN_S = 60;
const DEFAULT_MIN_TRIP_SAMPLES = 0; // opt-in; 0 keeps every trip
const CHUNK_TTL_MS = 10 * 60 * 1000; // drop stale partial trip reassemblies
const DEFAULT_SCHEMA = 't,lat,lon,speed_kph,rpm,coolant_c,fuel_pct,batt_v';

/** Units for every field the firmware can report, emitted per trip for the keys present. */
const UNITS = {
  t: 's', lat: 'deg', lon: 'deg', speed_kph: 'km/h',
  rpm: 'rpm', coolant_c: 'C', fuel_pct: '%', batt_v: 'V',
  alt_m: 'm', heading: 'deg', hdop: '', sat: '',
};

/**
 * GNSS extras and their firmware "no reading" sentinels.
 *
 * These ride in the same GPS_DATA struct the firmware already reads; they were
 * discarded before. Each has its own sentinel because -1 is a legitimate
 * altitude (below sea level) but not a legitimate satellite count.
 */
const GNSS_EXTRAS = [
  { field: 'alt_m', absent: (v) => v <= -9000 },      // -9999 = no reading
  { field: 'heading', absent: (v) => v < 0 },          // -1
  { field: 'hdop', absent: (v) => v < 0 },             // -1
  { field: 'sat', absent: (v) => v < 0 },              // -1
];

/** Fields that only carry meaning when an engine-bus session was established. */
const ECU_FIELDS = ['rpm', 'coolant_c', 'fuel_pct'];

/**
 * @param {object}   deps
 * @param {object}   deps.eventBus  IEventBus (WebSocketEventBus) — needs
 *                                  onClientMessage + subscribe + broadcast + sendToClient
 * @param {string}   deps.dataDir   resolved data dir (configService.getDataDir())
 * @param {object}   [deps.config]  parsed config/vehicles.yml — { persistence:{dir,snapshot_min_s,min_trip_samples}, vehicles:{<id>:{topic}} }
 * @param {string}   [deps.timezone] IANA zone for day keys + trip filenames
 *                                  (configService.getHouseholdTimezone())
 * @param {object}   [deps.logger]  structured logger
 * @param {() => number} [deps.now] clock (injectable for tests)
 * @returns {{ dispose: () => void, flush: () => Promise<void> }}
 */
/**
 * `dayLog` is INJECTED — an append-only day-log store (D5: data operations
 * go through datastore ports, never `fs` from the application layer).
 *
 * This relay used to hold its own DEFAULT_DIR for the automotive log and
 * join it onto dataDir itself. That put storage layout in the application
 * layer, which the layer guidelines forbid outright ("Application layer never
 * builds file paths"). The composition root resolves the location, including
 * any `persistence.dir` override, and hands down one directory.
 */
export function createAutomotiveRelay({
  eventBus, dataDir, dayLog, config = {}, timezone = DEFAULT_TIMEZONE, logger = console, now = Date.now,
}) {
  if (!eventBus?.onClientMessage || !eventBus?.broadcast) {
    throw new Error('createAutomotiveRelay: eventBus with onClientMessage + broadcast required');
  }

  const vehicleDefs = config?.vehicles || {};
  const snapshotMinMs = (Number(config?.persistence?.snapshot_min_s) > 0
    ? Number(config.persistence.snapshot_min_s)
    : DEFAULT_SNAPSHOT_MIN_S) * 1000;
  const minTripSamples = Number(config?.persistence?.min_trip_samples) > 0
    ? Number(config.persistence.min_trip_samples)
    : DEFAULT_MIN_TRIP_SAMPLES;
  const topicForId = (id) => vehicleDefs[id]?.topic || DEFAULT_TOPIC;

  // Serialize all writes: day logs are read-modify-write, and a trip-ack must
  // not be sent before its trip file is durably written.
  let writeChain = Promise.resolve();
  const enqueue = (label, id, fn) => {
    const p = writeChain.then(fn);
    writeChain = p.catch((err) => logger.warn?.(`automotive.persist.${label}_failed`, { id, error: err.message }));
    return p;
  };

  const lastSnapshotPersist = new Map(); // vehicle id -> ms
  const pendingTrips = new Map();        // `${id}:${trip_id}` -> { samples, touchedAt }

  const ingest = (clientId, message) => {
    if (!message || message.source !== RELAY_SOURCE) return;
    const id = typeof message.id === 'string' && message.id ? message.id : 'unknown';
    const at = now();
    const ts = formatIsoLocal(new Date(at), timezone);
    const topic = topicForId(id);

    if (message.type === 'hello') {
      logger.info?.('automotive.ingest.hello', { clientId, id, fw: message.fw, rssi: message.rssi });
      eventBus.broadcast(topic, { id, event: 'hello', fw: message.fw, rssi: message.rssi, ts });
      return;
    }

    if (message.type === 'snapshot') {
      const snapshot = {
        id,
        kind: 'snapshot',
        ...normalizeSnapshotReadings(message),
        dtc: Array.isArray(message.dtc) ? message.dtc : [],
        ts,
      };
      eventBus.broadcast(topic, snapshot);
      const last = lastSnapshotPersist.get(id) || 0;
      if (at - last >= snapshotMinMs) {
        lastSnapshotPersist.set(id, at);
        enqueue('snapshot', id, () => dayLog.appendAt(id, at, snapshot, { omitKeys: ['id'] }));
      }
      return;
    }

    if (message.type === 'event') {
      // Most events are a bare name. `harsh-motion` carries a magnitude and raw
      // axes, and dropping them would leave a breadcrumb that says something
      // happened without saying what — so known payload fields ride along.
      const detail = {};
      if (Number.isFinite(Number(message.g))) detail.g = Number(message.g);
      if (Array.isArray(message.acc)) detail.acc = message.acc.map(Number).filter(Number.isFinite);
      if (Number.isFinite(Number(message.speed_kph)) && Number(message.speed_kph) >= 0) {
        detail.speed_kph = Number(message.speed_kph);
      }
      const record = { id, kind: 'event', event: String(message.event || 'unknown'), ...detail, ts };
      eventBus.broadcast(topic, record);
      enqueue('event', id, () => dayLog.appendAt(id, at, record, { omitKeys: ['id'] }));
      return;
    }

    if (message.type === 'trip') {
      handleTripChunk(clientId, id, topic, message, at, ts);
      return;
    }
  };

  const handleTripChunk = (clientId, id, topic, message, at, ts) => {
    const tripId = typeof message.trip_id === 'string' && message.trip_id ? message.trip_id : null;
    if (!tripId) { logger.warn?.('automotive.trip.missing_id', { clientId, id }); return; }
    const key = `${id}:${tripId}`;

    // expire stale partials (device rebooted mid-upload and restarted at seq 0)
    for (const [k, v] of pendingTrips) {
      if (at - v.touchedAt > CHUNK_TTL_MS) pendingTrips.delete(k);
    }

    const pending = pendingTrips.get(key) || { samples: [], touchedAt: at };
    if (Array.isArray(message.samples)) pending.samples.push(...message.samples);
    pending.touchedAt = at;
    pendingTrips.set(key, pending);

    if (!message.final) return;
    pendingTrips.delete(key);

    const meta = message.meta && typeof message.meta === 'object' ? message.meta : {};
    const trip = buildTripRecord(id, tripId, meta, pending.samples, at, ts, timezone);
    const count = trip.samples.length;

    // A trip too short to mean anything (ignition blip, failed ECU handshake)
    // gets no file — but MUST still be acked, or the device re-uploads it every
    // time it reaches home WiFi. The day log keeps a breadcrumb.
    if (count < minTripSamples) {
      enqueue('trip-dropped', id, async () => {
        await dayLog.appendAt(id, at, {
          id, kind: 'trip-dropped', trip_id: tripId, ts, samples: count, reason: 'below-sample-floor',
        }, at, timezone);
        eventBus.sendToClient?.(clientId, { type: 'trip-ack', trip_id: tripId });
        logger.info?.('automotive.trip.dropped', { id, tripId, samples: count, floor: minTripSamples });
      });
      return;
    }

    // Persist FULL trip, then summary to the day log, then ack the device.
    enqueue('trip', id, async () => {
      const relPath = await dayLog.writeDocument(id, path.join('trips', tripRelPath(trip, timezone)), dumpTrip(trip));
      await dayLog.appendAt(id, at, {
        id, kind: 'trip', trip_id: tripId, ts,
        file: relPath,
        started: trip.meta.started,
        ended: trip.meta.ended,
        time_source: trip.meta.time_source,
        duration_s: trip.meta.duration_s,
        distance_km: trip.meta.distance_km,
        max_speed_kph: trip.meta.max_speed_kph,
        ecu: trip.meta.ecu,
        samples: count,
      }, at, timezone);
      const acked = eventBus.sendToClient?.(clientId, { type: 'trip-ack', trip_id: tripId });
      logger.info?.('automotive.trip.persisted', { id, tripId, samples: count, file: relPath, acked: Boolean(acked) });
    });
    eventBus.broadcast(topic, { id, kind: 'trip', trip_id: tripId, meta: trip.meta, ts });
  };

  const offClientMessage = eventBus.onClientMessage(ingest);

  logger.info?.('automotive.relay.ready', { snapshotMinMs, minTripSamples, timezone });
  return {
    dispose: () => { try { offClientMessage?.(); } catch { /* noop */ } },
    /** test hook: resolves when all enqueued writes have settled */
    flush: () => writeChain,
  };
}

const numOrNull = (v) => (Number.isFinite(Number(v)) ? Number(v) : null);

/**
 * The reading fields of a snapshot, with the firmware's unambiguous sentinels
 * mapped to null: `fuel_pct: -1` (PID unsupported / no session) and a (0,0) GPS
 * "fix". `rpm`/`coolant_c` zeros are left alone — a parked car really does read
 * zero, and a lone snapshot carries no trip-wide context to prove otherwise.
 *
 * Exported so the history migration (cli/automotive/lib.mjs) normalizes legacy
 * records by the same rule; a day log must not mix both conventions.
 */
export function normalizeSnapshotReadings(source) {
  const normalized = {
    battery_v: reading(source.battery_v, 'batt_v'),
    fuel_pct: reading(source.fuel_pct, 'fuel_pct'),
    coolant_c: numOrNull(source.coolant_c),
    rpm: numOrNull(source.rpm),
    speed_kph: numOrNull(source.speed_kph),
    gps: fixOrNull(source.gps),
  };

  // The slow-moving diagnostic set: ambient/oil temperature, engine load,
  // distance and time driven with the MIL on, warm-ups and time since codes
  // were cleared. The firmware only emits PIDs the car actually answered, so
  // whatever arrives is real — pass it through rather than enumerating a list
  // that would need editing every time a PID is added to the probe table.
  //
  // `time_since_cleared` is the one worth knowing about: a DROP means somebody
  // cleared the codes, which is precisely what resets the 0x31 distance counter
  // the odometer accumulates from.
  if (source.diag && typeof source.diag === 'object') {
    const diag = {};
    for (const [key, value] of Object.entries(source.diag)) {
      const n = numOrNull(value);
      if (n !== null) diag[key] = n;
    }
    if (Object.keys(diag).length) normalized.diag = diag;
  }

  // Identity, straight from the ECU. Worth persisting because it is the one
  // field that proves WHICH car produced this history — the device is portable.
  if (typeof source.vin === 'string' && source.vin.trim()) normalized.vin = source.vin.trim();

  const counters = {
    distance_since_cleared_km: numOrNull(source.distance_since_cleared_km),
    odometer_km: numOrNull(source.odometer_km),
  };
  for (const [key, value] of Object.entries(counters)) {
    if (value !== null && value >= 0) normalized[key] = value;
  }

  return normalized;
}

/** A single reading, with the firmware's per-field "no reading" sentinel mapped to null. */
function reading(value, field) {
  const n = numOrNull(value);
  if (n === null) return null;
  if (field === 'fuel_pct' && n < 0) return null;   // -1 = PID unsupported / no session
  if (field === 'batt_v' && n <= 0) return null;
  return n;
}

/**
 * Did the engine bus actually answer for this row?
 *
 * The all-sentinel signature — rpm 0, coolant 0, fuel below zero — is what the
 * firmware emits with no session. Any single real value breaks it: a car idling
 * at a light reports rpm 0 but still reports a warm coolant and a fuel level.
 */
function hasEcuReading(rpm, coolant, fuel) {
  return (rpm !== null && rpm > 0)
    || (coolant !== null && coolant !== 0)
    || (fuel !== null && fuel >= 0);
}

/** A GPS fix, or null when the device reported the pre-lock (0,0) placeholder. */
function fixOrNull(gps) {
  if (!gps || typeof gps !== 'object') return null;
  const lat = numOrNull(gps.lat);
  const lon = numOrNull(gps.lon);
  if (lat === null || lon === null) return null;
  if (lat === 0 && lon === 0) return null;                 // null island, not Kent
  if (Math.abs(lat) > 90 || Math.abs(lon) > 180) return null;
  return { lat, lon };
}

/**
 * Rebase boot-relative trip times to wall clock when the upload happened in the
 * same power session; otherwise leave them unrecoverable.
 * @returns {{startedMs: number|null, endedMs: number|null, source: string}}
 */
function resolveTripClock(meta, samples) {
  const startedEpoch = Number(meta.started_epoch_ms) || 0;
  const uploadEpoch = Number(meta.upload_epoch_ms) || 0;
  const uploadBoot = Number(meta.upload_boot_ms) || 0;
  const endedBoot = Number(meta.ended_boot_ms) || 0;
  const firstBoot = samples.length ? Number(samples[0]?.[0]) || 0 : 0;

  if (startedEpoch > 0) {
    const spanMs = samples.length > 1
      ? (Number(samples[samples.length - 1]?.[0]) || 0) - firstBoot
      : 0;
    return { startedMs: startedEpoch, endedMs: startedEpoch + Math.max(0, spanMs), source: 'device' };
  }

  const sameSession = uploadEpoch > 0 && uploadBoot > 0 && uploadBoot >= endedBoot;
  if (sameSession) {
    const bootToWall = (bootMs) => uploadEpoch - (uploadBoot - bootMs);
    return {
      startedMs: firstBoot > 0 ? bootToWall(firstBoot) : null,
      endedMs: endedBoot > 0 ? bootToWall(endedBoot) : null,
      source: 'rebased',
    };
  }

  return { startedMs: null, endedMs: null, source: 'boot-relative' };
}

/** Great-circle distance between two fixes, in km. */
function haversineKm(a, b) {
  const R = 6371.0088;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lon - a.lon);
  const s = Math.sin(dLat / 2) ** 2
    + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

/**
 * Turn positional device rows into keyed samples + a derived summary.
 *
 * `t` is rebased to seconds from the first sample: the raw value is
 * boot-relative milliseconds, meaningless on its own and different for every
 * trip. Sampling is irregular (observed gaps of 1s and 5s in the same trip), so
 * `t` still has to be carried per row — it cannot be implied by row position.
 */
export function buildTripRecord(id, tripId, meta, rawSamples, at, ts, timezone) {
  const cols = (typeof meta.schema === 'string' && meta.schema ? meta.schema : DEFAULT_SCHEMA).split(',');
  const col = (row, name) => {
    const i = cols.indexOf(name);
    return i === -1 ? null : numOrNull(row[i]);
  };

  // An ECU session either happened for this trip or it didn't — decide once,
  // across the whole trip, rather than guessing per row. A parked car really
  // does read rpm 0, so a single zero proves nothing; an entire trip of zeros
  // with fuel pinned at -1 proves the bus never answered.
  const ecu = rawSamples.some((row) =>
    hasEcuReading(col(row, 'rpm'), col(row, 'coolant_c'), col(row, 'fuel_pct')));

  const t0 = rawSamples.length ? Number(rawSamples[0]?.[0]) || 0 : 0;
  let fixCount = 0;
  let distanceKm = 0;
  let maxSpeed = null;
  let prevFix = null;
  let lastT = 0;

  const samples = rawSamples.map((row) => {
    const sample = {};
    const tRaw = Number(row[0]) || 0;
    lastT = round((tRaw - t0) / 1000, 3);
    sample.t = lastT;

    const fix = fixOrNull({ lat: col(row, 'lat'), lon: col(row, 'lon') });
    if (fix) {
      fixCount += 1;
      sample.lat = fix.lat;
      sample.lon = fix.lon;
      if (prevFix) distanceKm += haversineKm(prevFix, fix);
      prevFix = fix;
    }

    // Speed comes from GNSS or the ECU; with neither, a reported 0 is noise.
    const speed = col(row, 'speed_kph');
    if (speed !== null && (fix || ecu)) {
      sample.speed_kph = speed;
      if (maxSpeed === null || speed > maxSpeed) maxSpeed = speed;
    }

    // The bus drops in and out mid-trip, so trip-level `ecu` is not enough: a
    // row reading rpm 0 AND coolant 0 AND fuel -1 is a gap in the session, not
    // an engine stalled at 0 C. A genuine idle (stopped at a light) still
    // reports real coolant and fuel, so it keeps its fields.
    if (ecu && hasEcuReading(col(row, 'rpm'), col(row, 'coolant_c'), col(row, 'fuel_pct'))) {
      for (const field of ECU_FIELDS) {
        const v = reading(col(row, field), field);
        if (v !== null) sample[field] = v;
      }
    }

    const batt = reading(col(row, 'batt_v'), 'batt_v');
    if (batt !== null) sample.batt_v = batt;

    // Absent key, never a sentinel — same rule the ECU fields follow. A stored
    // `sat: -1` would read as a satellite count downstream.
    for (const { field, absent } of GNSS_EXTRAS) {
      const value = col(row, field);
      if (value !== null && !absent(value)) sample[field] = value;
    }

    return sample;
  });

  const { startedMs, endedMs, source } = resolveTripClock(meta, rawSamples);
  const present = new Set(samples.flatMap((s) => Object.keys(s)));

  return {
    meta: {
      vehicle: id,
      ...odometerCounters(meta),
      trip_id: tripId,                                    // device id, kept for ack correlation
      started: startedMs ? formatIsoLocal(new Date(startedMs), timezone) : null,
      ended: endedMs ? formatIsoLocal(new Date(endedMs), timezone) : null,
      time_source: source,                                // device | rebased | boot-relative
      duration_s: lastT,
      samples: samples.length,
      distance_km: round(distanceKm, 3),
      max_speed_kph: maxSpeed,
      gps_fix_pct: samples.length ? Math.round((fixCount / samples.length) * 100) : 0,
      ecu,
      dtc: Array.isArray(meta.dtc) ? meta.dtc : [],
      received: ts,
    },
    units: Object.fromEntries(Object.entries(UNITS).filter(([k]) => present.has(k))),
    samples,
  };
}

/**
 * The trip's OBD odometer anchors, when the ECU answered for them.
 *
 * `distance_*` is PID 0x31 ("distance since codes cleared") and is the mileage
 * source: standard Mode 01 and wheel-derived, so it neither undercounts like
 * GPS nor loses the span at the start of a drive that standby slept through.
 * `odometer_*` is PID 0xA6, the true odometer, which most cars refuse.
 *
 * Absent keys rather than zeros, matching the rule the rest of this file
 * follows: the firmware emits -1 for "no reading", and a persisted 0 would read
 * as a car that has genuinely travelled nothing since its codes were cleared.
 */
function odometerCounters(meta) {
  const counters = {};
  for (const key of ['distance_start_km', 'distance_end_km', 'odometer_start_km', 'odometer_end_km']) {
    const value = numOrNull(meta[key]);
    if (value !== null && value >= 0) counters[key] = value;
  }
  return counters;
}

const round = (n, places) => Number(n.toFixed(places));

/**
 * Where a trip file lives, relative to the vehicle's trips/ dir: sharded by
 * month and named for its local start time.
 *
 * The device's own trip id is `esp_random()-millis()` — collision-free but
 * unsortable and meaningless, so it becomes a suffix rather than the whole
 * name. Trips whose clock is unrecoverable are prefixed `unknown_` and dated by
 * arrival, so they sort together instead of silently interleaving with real
 * timestamps.
 *
 * Exported for the history migration (cli/automotive.cli.mjs), which must place
 * converted files exactly where the relay would have.
 *
 * @returns {string} e.g. 2026-08/2026-08-11_1730_abc1.yml
 */
export function tripRelPath(trip, timezone) {
  const stamp = trip.meta.started
    ? new Date(trip.meta.started)
    : new Date(trip.meta.received);
  const [day, clock] = formatLocalTimestamp(stamp, timezone).split(' ');
  const hhmm = clock.slice(0, 5).replace(':', '');
  const prefix = trip.meta.started ? '' : 'unknown_';
  return path.join(day.slice(0, 7), `${prefix}${day}_${hhmm}_${sanitize(trip.meta.trip_id)}.yml`);
}

/** Serialize a trip: flowLevel 2 keeps one sample per line — diff-friendly, and
 *  a grepped line stays readable on its own. Exported for the migration. */
export const dumpTrip = (trip) => yaml.dump(trip, { noRefs: true, flowLevel: 2, lineWidth: -1 });

const sanitize = (s) => String(s).replace(/[^a-zA-Z0-9_-]/g, '_');
