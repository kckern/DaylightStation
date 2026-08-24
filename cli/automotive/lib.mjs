// cli/automotive/lib.mjs
//
// One-shot migration of history/automotive/ from the original write format to
// the current one. Two independent conversions:
//
//   Day logs — records were filed under a UTC day key, so every drive after
//   ~17:00 local landed in tomorrow's file and any drive crossing 00:00Z was
//   split across two. `regroupByLocalDay` re-buckets by household-local day and
//   rewrites each `ts` to local ISO-with-offset.
//
//   Trips — samples were positional rows decoded by `meta.schema`, with the
//   firmware's sentinels (rpm/coolant 0 for "no ECU", fuel -1, lat/lon 0 for
//   "no fix") persisted as if they were readings. `convertLegacyTrip` re-runs
//   them through the relay's own buildTripRecord so migrated files are
//   byte-identical to what the relay writes today, and returns the file's new
//   month-sharded path.
//
// The conversion functions are pure; all I/O lives in cli/automotive.cli.mjs.
import {
  buildTripRecord,
  tripRelPath,
  normalizeSnapshotReadings,
} from '#apps/hardware/automotiveRelay.mjs';
import { formatIsoLocal, getDateInTimezone } from '#domains/core/utils/time.mjs';

/**
 * Re-bucket day-log records by the local day their `ts` falls in.
 *
 * @param {Array<object>} records - records from one or more legacy day files
 * @param {string} timezone - IANA zone
 * @returns {Map<string, Array<object>>} local day (YYYY-MM-DD) → records, each
 *          sorted chronologically, with `ts` rewritten to local ISO. Records
 *          with an unparseable `ts` collect under the key `unknown`.
 */
export function regroupByLocalDay(records, timezone) {
  const grouped = new Map();
  const push = (key, record) => {
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key).push(record);
  };

  for (const record of records) {
    // Snapshots persisted before the sentinel fix still carry `fuel_pct: -1`
    // and (0,0) "fixes"; re-normalize by the relay's own rule so a migrated day
    // log never mixes both conventions in the same file.
    const normalized = record?.kind === 'snapshot'
      ? { ...record, ...normalizeSnapshotReadings(record) }
      : { ...record };

    const at = Date.parse(record?.ts);
    if (!Number.isFinite(at)) {
      push('unknown', normalized);
      continue;
    }
    const date = new Date(at);
    push(getDateInTimezone(date, timezone), {
      ...normalized,
      ts: formatIsoLocal(date, timezone),
      _at: at,
    });
  }

  for (const [key, list] of grouped) {
    list.sort((a, b) => (a._at ?? 0) - (b._at ?? 0));
    grouped.set(key, list.map(({ _at, ...rest }) => rest));
  }
  return grouped;
}

/**
 * Convert one legacy trip document to the current format.
 *
 * @param {object} doc - parsed legacy trip YAML ({ meta, samples })
 * @param {string} timezone - IANA zone
 * @returns {{trip: object, relPath: string, droppable: boolean}}
 *          `droppable` marks trips with no samples — an ignition blip or a
 *          failed ECU handshake, carrying nothing worth a file.
 */
export function convertLegacyTrip(doc, timezone) {
  const legacyMeta = doc?.meta || {};
  const samples = Array.isArray(doc?.samples) ? doc.samples : [];
  const receivedAt = Date.parse(legacyMeta.received);
  const at = Number.isFinite(receivedAt) ? receivedAt : Date.now();

  // Re-express the legacy meta in the shape buildTripRecord consumes. A legacy
  // `started` was epoch ms; anything else was already unrecoverable, and the
  // boot-relative rebase cannot be redone after the fact (the upload session's
  // millis() clock is long gone), so those stay unknown rather than guessed.
  const started = Number(legacyMeta.started) || 0;
  const trip = buildTripRecord(
    legacyMeta.vehicle || 'unknown',
    legacyMeta.trip_id || 'unknown',
    {
      started_epoch_ms: started,
      schema: legacyMeta.schema,
      dtc: legacyMeta.dtc,
    },
    samples,
    at,
    formatIsoLocal(new Date(at), timezone),
    timezone,
  );

  return {
    trip,
    relPath: tripRelPath(trip, timezone),
    droppable: samples.length === 0,
  };
}

/**
 * Repair telemetry values emitted before firmware schema 2.
 * Pure and idempotent: a second pass reports no changes and never divides an
 * already-correct odometer again.
 */
export function repairTelemetryDocument(input) {
  const doc = structuredClone(input);
  const stats = { odometers: 0, saturatedDistances: 0, invalidVins: 0, duplicateTrips: 0 };
  const validVin = (v) => typeof v === 'string' && /^[A-HJ-NPR-Z0-9]{17}$/.test(v.trim().toUpperCase());

  const repairObject = (obj, inheritedLegacy = true) => {
    if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return;
    const schema = Number(obj.telemetry_schema ?? obj.meta?.telemetry_schema ?? 1);
    const legacy = inheritedLegacy && schema < 2 && Number(obj.telemetry_revision || 1) < 2;

    for (const key of ['odometer', 'odometer_km', 'odometer_start_km', 'odometer_end_km']) {
      if (legacy && Number.isFinite(Number(obj[key])) && Number(obj[key]) > 200000) {
        obj[key] = Number(obj[key]) / 10;
        stats.odometers += 1;
      }
    }
    for (const key of ['distance_since_cleared', 'distance_since_cleared_km', 'distance_start_km', 'distance_end_km']) {
      if (Number(obj[key]) === 65535) {
        delete obj[key];
        stats.saturatedDistances += 1;
      }
    }
    if ('vin' in obj && !validVin(obj.vin)) {
      delete obj.vin;
      stats.invalidVins += 1;
    } else if (validVin(obj.vin)) {
      obj.vin = obj.vin.trim().toUpperCase();
    }
    if (obj.diag && typeof obj.diag === 'object') repairObject(obj.diag, legacy);
    if (obj.meta && typeof obj.meta === 'object') repairObject(obj.meta, legacy);
  };

  if (Array.isArray(doc)) {
    const seenTrips = new Set();
    const repaired = [];
    for (const row of doc) {
      if (row?.kind === 'trip' && row.trip_id) {
        const key = String(row.trip_id);
        if (seenTrips.has(key)) { stats.duplicateTrips += 1; continue; }
        seenTrips.add(key);
      }
      repairObject(row);
      repaired.push(row);
    }
    return { document: repaired, stats };
  }

  repairObject(doc);
  return { document: doc, stats };
}
