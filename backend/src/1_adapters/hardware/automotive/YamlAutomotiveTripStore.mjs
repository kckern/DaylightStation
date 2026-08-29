import path from 'node:path';
import yaml from 'js-yaml';
import { IAutomotiveTripStore } from '#apps/hardware/ports/IAutomotiveTripStore.mjs';
import { fileExistsAsync, writeTextFileAsync } from '#system/utils/FileIO.mjs';
import { formatLocalTimestamp } from '#domains/core/utils/time.mjs';

const sanitize = (value) => String(value).replace(/[^a-zA-Z0-9_-]/g, '_');

export function automotiveTripStorageKey(trip, timezone) {
  const stamp = trip.meta.started ? new Date(trip.meta.started) : new Date(trip.meta.received);
  const [day, clock] = formatLocalTimestamp(stamp, timezone).split(' ');
  const hhmm = clock.slice(0, 5).replace(':', '');
  const prefix = trip.meta.started ? '' : 'unknown_';
  return { month: day.slice(0, 7), fileName: `${prefix}${day}_${hhmm}_${sanitize(trip.meta.trip_id)}.yml` };
}

export function automotiveTripRelativePath(trip, timezone) {
  const key = automotiveTripStorageKey(trip, timezone);
  return `${key.month}/${key.fileName}`;
}

export const encodeAutomotiveTrip = trip => yaml.dump(trip, { noRefs: true, flowLevel: 2, lineWidth: -1 });

export class YamlAutomotiveTripStore extends IAutomotiveTripStore {
  constructor({ root }) { super(); if (!root) throw new Error('YamlAutomotiveTripStore requires root'); this.root = root; }

  #location(vehicleId, { month, fileName }) {
    const reference = `trips/${month}/${fileName}`;
    return { reference, file: path.join(this.root, sanitize(vehicleId), 'trips', month, fileName) };
  }

  async inspect(vehicleId, trip, timezone) {
    const location = this.#location(vehicleId, automotiveTripStorageKey(trip, timezone));
    return { exists: await fileExistsAsync(location.file), reference: location.reference };
  }

  async save(vehicleId, trip, timezone) {
    const location = this.#location(vehicleId, automotiveTripStorageKey(trip, timezone));
    await writeTextFileAsync(location.file, encodeAutomotiveTrip(trip));
    return location.reference;
  }
}

export default YamlAutomotiveTripStore;
