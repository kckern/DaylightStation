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
//   2) PERSIST (bus-side): snapshots (throttled), events, and trip summaries
//      append to {dataDir}/{persistence.dir}/{id}/{YYYY-MM-DD}.yml; each
//      reassembled trip writes {.../}{id}/trips/{trip_id}.yml in full. After a
//      trip persists, the device gets {"type":"trip-ack"} via sendToClient so
//      it deletes its buffered copy — the ack MUST only follow a durable write.
//
// Trip timestamps: trips that started away from home carry boot-relative times
// (`time_approx`). When the upload happens in the same power session
// (upload_boot_ms ≥ ended_boot_ms), wall-clock start/end are rebased from
// upload_epoch_ms; otherwise times stay boot-relative and time_approx remains.
//
// Config-driven from the household SSOT (config/vehicles.yml), passed as
// `config`. Design: docs/_wip/plans/2026-07-14-obd-relay-design.md
import { promises as fs } from 'fs';
import path from 'path';
import yaml from 'js-yaml';

const RELAY_SOURCE = 'obd-relay';
const DEFAULT_TOPIC = 'automotive';
const DEFAULT_DIR = 'household/history/automotive'; // relative to dataDir
const DEFAULT_SNAPSHOT_MIN_S = 60;
const CHUNK_TTL_MS = 10 * 60 * 1000; // drop stale partial trip reassemblies

/**
 * @param {object}   deps
 * @param {object}   deps.eventBus  IEventBus (WebSocketEventBus) — needs
 *                                  onClientMessage + subscribe + broadcast + sendToClient
 * @param {string}   deps.dataDir   resolved data dir (configService.getDataDir())
 * @param {object}   [deps.config]  parsed config/vehicles.yml — { persistence:{dir,snapshot_min_s}, vehicles:{<id>:{topic}} }
 * @param {object}   [deps.logger]  structured logger
 * @param {() => number} [deps.now] clock (injectable for tests)
 * @returns {{ dispose: () => void }}
 */
export function createAutomotiveRelay({ eventBus, dataDir, config = {}, logger = console, now = Date.now }) {
  if (!eventBus?.onClientMessage || !eventBus?.broadcast) {
    throw new Error('createAutomotiveRelay: eventBus with onClientMessage + broadcast required');
  }

  const vehicleDefs = config?.vehicles || {};
  const persistDir = (config?.persistence?.dir || DEFAULT_DIR).replace(/^\/+/, '');
  const snapshotMinMs = (Number(config?.persistence?.snapshot_min_s) > 0
    ? Number(config.persistence.snapshot_min_s)
    : DEFAULT_SNAPSHOT_MIN_S) * 1000;
  const historyRoot = path.join(dataDir, ...persistDir.split('/'));
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
    const ts = new Date(now()).toISOString();
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
        battery_v: numOrNull(message.battery_v),
        fuel_pct: numOrNull(message.fuel_pct),
        coolant_c: numOrNull(message.coolant_c),
        rpm: numOrNull(message.rpm),
        speed_kph: numOrNull(message.speed_kph),
        dtc: Array.isArray(message.dtc) ? message.dtc : [],
        gps: message.gps && typeof message.gps === 'object' ? message.gps : null,
        ts,
      };
      eventBus.broadcast(topic, snapshot);
      const last = lastSnapshotPersist.get(id) || 0;
      if (now() - last >= snapshotMinMs) {
        lastSnapshotPersist.set(id, now());
        enqueue('snapshot', id, () => appendRecord(historyRoot, id, snapshot));
      }
      return;
    }

    if (message.type === 'event') {
      const record = { id, kind: 'event', event: String(message.event || 'unknown'), ts };
      eventBus.broadcast(topic, record);
      enqueue('event', id, () => appendRecord(historyRoot, id, record));
      return;
    }

    if (message.type === 'trip') {
      handleTripChunk(clientId, id, topic, message, ts);
      return;
    }
  };

  const handleTripChunk = (clientId, id, topic, message, ts) => {
    const tripId = typeof message.trip_id === 'string' && message.trip_id ? message.trip_id : null;
    if (!tripId) { logger.warn?.('automotive.trip.missing_id', { clientId, id }); return; }
    const key = `${id}:${tripId}`;

    // expire stale partials (device rebooted mid-upload and restarted at seq 0)
    for (const [k, v] of pendingTrips) {
      if (now() - v.touchedAt > CHUNK_TTL_MS) pendingTrips.delete(k);
    }

    const pending = pendingTrips.get(key) || { samples: [], touchedAt: now() };
    if (Array.isArray(message.samples)) pending.samples.push(...message.samples);
    pending.touchedAt = now();
    pendingTrips.set(key, pending);

    if (!message.final) return;
    pendingTrips.delete(key);

    const meta = message.meta && typeof message.meta === 'object' ? message.meta : {};
    const trip = buildTripRecord(id, tripId, meta, pending.samples, ts);

    // Persist FULL trip, then summary to the day log, then ack the device.
    enqueue('trip', id, async () => {
      await writeTrip(historyRoot, id, tripId, trip);
      await appendRecord(historyRoot, id, {
        id, kind: 'trip', trip_id: tripId, ts,
        started: trip.meta.started ?? null,
        ended: trip.meta.ended ?? null,
        time_approx: trip.meta.time_approx,
        samples: trip.samples.length,
      });
      const acked = eventBus.sendToClient?.(clientId, { type: 'trip-ack', trip_id: tripId });
      logger.info?.('automotive.trip.persisted', { id, tripId, samples: trip.samples.length, acked: Boolean(acked) });
    });
    eventBus.broadcast(topic, { id, kind: 'trip', trip_id: tripId, meta: trip.meta, ts });
  };

  const offClientMessage = eventBus.onClientMessage(ingest);

  logger.info?.('automotive.relay.ready', { historyRoot, snapshotMinMs });
  return {
    dispose: () => { try { offClientMessage?.(); } catch { /* noop */ } },
    /** test hook: resolves when all enqueued writes have settled */
    flush: () => writeChain,
  };
}

const numOrNull = (v) => (Number.isFinite(Number(v)) ? Number(v) : null);

/**
 * Rebase boot-relative trip times to wall clock when the upload happened in the
 * same power session; otherwise leave boot-relative and keep time_approx.
 */
function buildTripRecord(id, tripId, meta, samples, ts) {
  const startedEpoch = Number(meta.started_epoch_ms) || 0;
  const uploadEpoch = Number(meta.upload_epoch_ms) || 0;
  const uploadBoot = Number(meta.upload_boot_ms) || 0;
  const endedBoot = Number(meta.ended_boot_ms) || 0;
  const firstBoot = samples.length ? Number(samples[0]?.[0]) || 0 : 0;

  let started = startedEpoch > 0 ? startedEpoch : null;
  let ended = null;
  let timeApprox = Boolean(meta.time_approx) && !started;

  const sameSession = uploadEpoch > 0 && uploadBoot > 0 && uploadBoot >= endedBoot;
  if (sameSession) {
    const bootToWall = (bootMs) => uploadEpoch - (uploadBoot - bootMs);
    if (!started && firstBoot > 0) { started = bootToWall(firstBoot); timeApprox = false; }
    if (endedBoot > 0) ended = bootToWall(endedBoot);
  }

  return {
    meta: {
      vehicle: id,
      trip_id: tripId,
      started,               // epoch ms | null (unrecoverable clock)
      ended,                 // epoch ms | null
      time_approx: timeApprox,
      samples: samples.length,
      schema: typeof meta.schema === 'string' ? meta.schema : '',
      received: ts,
    },
    samples,                 // positional rows per meta.schema (boot-relative t)
  };
}

/** Write one full trip as its own YAML file. */
async function writeTrip(historyRoot, id, tripId, trip) {
  const dir = path.join(historyRoot, id, 'trips');
  await fs.mkdir(dir, { recursive: true });
  const file = path.join(dir, `${sanitize(tripId)}.yml`);
  await fs.writeFile(file, yaml.dump(trip, { noRefs: true }), 'utf8');
}

/** Append one record to the vehicle's append-only day log (read-modify-write). */
async function appendRecord(historyRoot, id, record) {
  const day = new Date().toISOString().slice(0, 10); // YYYY-MM-DD (UTC)
  const dir = path.join(historyRoot, sanitize(id));
  const file = path.join(dir, `${day}.yml`);
  await fs.mkdir(dir, { recursive: true });

  let list = [];
  try {
    const existing = yaml.load(await fs.readFile(file, 'utf8'));
    if (Array.isArray(existing)) list = existing;
  } catch { /* first record of the day */ }

  const { id: _omit, ...rest } = record;
  list.push(rest);
  await fs.writeFile(file, yaml.dump(list, { noRefs: true }), 'utf8');
}

const sanitize = (s) => String(s).replace(/[^a-zA-Z0-9_-]/g, '_');
