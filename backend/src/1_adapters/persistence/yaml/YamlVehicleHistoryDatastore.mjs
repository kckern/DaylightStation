/**
 * Read side of the relay-owned automotive history tree.
 *
 *   household/history/automotive/<vehicle-id>/
 *     <YYYY-MM-DD>.yml            day log — snapshots, events, trip summaries
 *     trips/<YYYY-MM>/<name>.yml  full trip recordings with samples
 *
 * Write-free on purpose (see `IVehicleHistoryRepository`). The relay owns this
 * tree; this adapter only ever reads it.
 *
 * ## Why the day log is the index and the trip files are the payload
 *
 * The relay already writes a derived summary into each day log's `kind: trip`
 * record — distance, duration, max speed, ECU state. Building a timeline
 * therefore costs one small YAML read per day, not one read per trip. The trip
 * files (hundreds of sample rows each) are only opened when something actually
 * needs coordinates: journey endpoints, or a detail view.
 *
 * @module adapters/persistence/yaml/YamlVehicleHistoryDatastore
 */

import path from 'path';
import { IVehicleHistoryRepository } from '#apps/automotive/ports/IVehicleHistoryRepository.mjs';
import { GeoFix } from '#domains/automotive/value-objects/GeoFix.mjs';
import {
  loadYamlSafe, listFiles, listDirs, dirExists, loadContainedYaml,
} from '#system/utils/FileIO.mjs';
import { InfrastructureError } from '#system/utils/errors/index.mjs';

const DAY_FILE = /^(\d{4}-\d{2}-\d{2})\.yml$/;

export class YamlVehicleHistoryDatastore extends IVehicleHistoryRepository {
  #historyRoot;
  #logger;

  /**
   * @param {object} deps
   * @param {string} deps.historyRoot absolute path to .../history/automotive
   * @param {object} [deps.logger]
   */
  constructor({ historyRoot, logger = console } = {}) {
    super();
    if (!historyRoot) {
      throw new InfrastructureError('YamlVehicleHistoryDatastore requires historyRoot', {
        code: 'MISSING_DEPENDENCY', dependency: 'historyRoot',
      });
    }
    this.#historyRoot = historyRoot;
    this.#logger = logger;
  }

  async listVehicleIds() {
    if (!dirExists(this.#historyRoot)) return [];
    return listDirs(this.#historyRoot).sort();
  }

  async listTripDescriptors(vehicleId, { from = null, to = null, withFixes = false } = {}) {
    const vehicleDir = this.#vehicleDir(vehicleId);
    if (!dirExists(vehicleDir)) return [];

    const days = listFiles(vehicleDir)
      .map((name) => ({ name, day: name.match(DAY_FILE)?.[1] }))
      .filter((entry) => entry.day)
      .filter((entry) => withinDayWindow(entry.day, from, to))
      .sort((a, b) => a.day.localeCompare(b.day));

    const descriptors = [];
    let legacyCount = 0;
    for (const { name } of days) {
      const records = loadYamlSafe(path.join(vehicleDir, name.replace(/\.yml$/, '')));
      if (!Array.isArray(records)) continue;
      for (const record of records) {
        if (record?.kind !== 'trip') continue;
        if (isLegacyStub(record)) { legacyCount += 1; continue; }
        descriptors.push(this.#toDescriptor(record));
      }
    }

    if (legacyCount) {
      this.#logger.warn?.('automotive.history.legacy_records_skipped', {
        vehicleId, count: legacyCount, remedy: 'node cli/automotive.cli.mjs migrate --apply',
      });
    }
    this.lastLegacyCount = legacyCount;

    // The same trip can appear in two day logs when the device re-uploads
    // before an ack lands. Keep one descriptor per trip id — the first, since
    // day logs are read oldest-first and a later duplicate carries no new data.
    const unique = dedupeByTripId([...descriptors, ...this.#orphanedTrips(vehicleId, descriptors, from, to)]);

    if (!withFixes) return unique;
    return Promise.all(unique.map((descriptor) => this.#withFixes(vehicleId, descriptor)));
  }

  async readTrip(vehicleId, relPath) {
    const tripsDir = path.join(this.#vehicleDir(vehicleId), 'trips');
    if (!dirExists(tripsDir)) return null;
    try {
      // Containment matters: `relPath` originates in a YAML field and can reach
      // this method from an HTTP route, so it is untrusted path input.
      return loadContainedYaml(tripsDir, relPath) || null;
    } catch (error) {
      this.#logger.warn?.('automotive.history.trip_read_failed', {
        vehicleId, relPath, error: error.message,
      });
      return null;
    }
  }

  async readLatestSnapshot(vehicleId) {
    const vehicleDir = this.#vehicleDir(vehicleId);
    if (!dirExists(vehicleDir)) return null;

    const days = listFiles(vehicleDir)
      .filter((name) => DAY_FILE.test(name))
      .sort()
      .reverse();

    // Walk backwards from the newest day: a day can contain events and dropped
    // trips but no snapshot at all, so "newest file" is not "newest snapshot".
    for (const name of days) {
      const records = loadYamlSafe(path.join(vehicleDir, name.replace(/\.yml$/, '')));
      if (!Array.isArray(records)) continue;
      for (let i = records.length - 1; i >= 0; i -= 1) {
        if (records[i]?.kind === 'snapshot') return records[i];
      }
    }
    return null;
  }

  #vehicleDir(vehicleId) {
    return path.join(this.#historyRoot, sanitize(vehicleId));
  }

  /**
   * Trip FILES that no day-log record points at.
   *
   * The day log is an index; `trips/` is the content. Those can disagree, and
   * on the live tree they badly do: pre-migration day-log records carry no
   * `file` pointer, so index-only reading loses every trip written before the
   * format change — including, measured 2026-08-12, the only two trips holding
   * an earlier fuel-level reading, which is what fill-up detection needs to
   * compare against.
   *
   * Rather than making the reader depend on a migration nobody has run, this
   * sweeps the trip directory for unreferenced files and builds descriptors
   * from each file's own `meta`, which carries the full derived summary anyway.
   *
   * Listing is cheap (filenames only); a file is opened only when it turns out
   * to be unreferenced, so a fully-migrated tree pays almost nothing.
   */
  #orphanedTrips(vehicleId, indexed, from, to) {
    const tripsDir = path.join(this.#vehicleDir(vehicleId), 'trips');
    if (!dirExists(tripsDir)) return [];

    const seen = new Set(indexed.map((d) => d.tripId).filter(Boolean));
    const orphans = [];
    for (const month of listDirs(tripsDir)) {
      for (const name of listFiles(path.join(tripsDir, month))) {
        if (!name.endsWith('.yml')) continue;
        // Trip filenames end in the device trip id, so most orphan checks are
        // answered without opening anything.
        const tripId = name.replace(/\.yml$/, '').split('_').pop();
        if (tripId && seen.has(tripId)) continue;

        const relPath = `${month}/${name}`;
        const trip = loadYamlSafe(path.join(tripsDir, month, name.replace(/\.yml$/, '')));
        const meta = trip?.meta;
        if (!meta?.trip_id || seen.has(meta.trip_id)) continue;

        const descriptor = this.#toDescriptor({
          trip_id: meta.trip_id,
          ts: meta.received,
          file: relPath,
          started: meta.started,
          ended: meta.ended,
          time_source: meta.time_source,
          duration_s: meta.duration_s,
          distance_km: meta.distance_km,
          max_speed_kph: meta.max_speed_kph,
          ecu: meta.ecu,
          samples: meta.samples,
        });
        const day = (descriptor.startedAt || descriptor.receivedAt)?.toISOString().slice(0, 10);
        if (day && !withinDayWindow(day, from, to)) continue;

        seen.add(meta.trip_id);
        orphans.push(descriptor);
      }
    }

    if (orphans.length) {
      this.#logger.warn?.('automotive.history.unindexed_trips_recovered', {
        vehicleId, count: orphans.length, remedy: 'node cli/automotive.cli.mjs migrate --apply',
      });
    }
    return orphans;
  }

  /** Day-log trip summary → the shape `stitchJourneys` consumes. */
  #toDescriptor(record) {
    return {
      tripId: String(record.trip_id || ''),
      startedAt: toDateOrNull(record.started),
      endedAt: toDateOrNull(record.ended),
      timeSource: record.time_source || 'unknown',
      distanceKm: Number(record.distance_km) || 0,
      maxSpeedKph: Number.isFinite(record.max_speed_kph) ? record.max_speed_kph : null,
      durationS: Number(record.duration_s) || 0,
      ecu: record.ecu === true,
      sampleCount: Number(record.samples) || 0,
      file: record.file || null,
      // Arrival time. The only clock an unclocked trip has, and the fallback
      // for ordering fuel readings when the drive itself was never dated.
      receivedAt: toDateOrNull(record.ts),
      startFix: null,
      endFix: null,
      counterStartKm: null,
      counterEndKm: null,
      fuelReadings: [],
    };
  }

  /**
   * Attach endpoint coordinates (and, once the firmware emits them, the trip's
   * 0x31 counter readings) by opening the trip file.
   *
   * A trip can have GPS-bearing metadata and no coordinates in its samples at
   * all — observed in the real tree — so both endpoints stay null rather than
   * being faked from `meta`.
   */
  async #withFixes(vehicleId, descriptor) {
    if (!descriptor.file) return descriptor;
    const trip = await this.readTrip(vehicleId, descriptor.file);
    if (!trip) return descriptor;

    const samples = Array.isArray(trip.samples) ? trip.samples : [];
    const base = descriptor.startedAt || descriptor.receivedAt;
    let startFix = null;
    let endFix = null;
    const fuelReadings = [];
    for (const sample of samples) {
      const fix = GeoFix.fromRaw(sample);
      if (fix) {
        if (!startFix) startFix = fix;
        endFix = fix;
      }
      // Fuel level is what detects a fill-up — a tank cannot refill itself, so
      // a rise between trips IS a purchase. Readings are sparse (the engine bus
      // answers intermittently), which is fine: detection needs two readings
      // bracketing the fill, not a continuous series.
      if (Number.isFinite(sample?.fuel_pct) && sample.fuel_pct >= 0 && base instanceof Date) {
        fuelReadings.push({
          pct: sample.fuel_pct,
          at: new Date(base.getTime() + (Number(sample.t) || 0) * 1000),
          tripId: descriptor.tripId,
        });
      }
    }

    return {
      ...descriptor,
      startFix,
      endFix,
      fuelReadings,
      // Absent until the firmware change ships; read defensively so the app
      // gains mileage the moment it starts arriving, with no code change here.
      counterStartKm: numberOrNull(trip.meta?.distance_start_km),
      counterEndKm: numberOrNull(trip.meta?.distance_end_km),
    };
  }
}

/**
 * Is this a day-log record written before the trip-file format landed?
 *
 * The pre-migration relay wrote `time_approx: true` and little else — no
 * `file`, no `distance_km`, no `duration_s`. Mapped naively these become
 * journeys reading "0 km, time unknown", which is not a record of anything;
 * they are pointers to trips whose data was never persisted in a readable form.
 *
 * They are SKIPPED rather than rendered as empty outings, and counted so the
 * app can say what is missing and name the fix. The migration
 * (`cli/automotive.cli.mjs migrate`) is what converts them; until it runs, this
 * keeps 55 empty rows off the timeline.
 *
 * The test is structural, not version-flagged: a record with neither a file
 * pointer nor a distance carries nothing a timeline can show, whatever wrote it.
 */
function isLegacyStub(record) {
  const hasFile = typeof record.file === 'string' && record.file.length > 0;
  const hasDistance = Number.isFinite(record.distance_km);
  return !hasFile && !hasDistance;
}

function dedupeByTripId(descriptors) {
  const seen = new Set();
  const unique = [];
  for (const descriptor of descriptors) {
    if (!descriptor.tripId || seen.has(descriptor.tripId)) continue;
    seen.add(descriptor.tripId);
    unique.push(descriptor);
  }
  return unique;
}

/** Day-granular window test against a `YYYY-MM-DD` filename. */
function withinDayWindow(day, from, to) {
  if (from instanceof Date && day < from.toISOString().slice(0, 10)) return false;
  if (to instanceof Date && day > to.toISOString().slice(0, 10)) return false;
  return true;
}

function toDateOrNull(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

const numberOrNull = (v) => (Number.isFinite(Number(v)) && v !== null && v !== '' ? Number(v) : null);
const sanitize = (s) => String(s).replace(/[^a-zA-Z0-9_-]/g, '_');
