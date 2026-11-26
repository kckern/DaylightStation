import { IRequestObservationSource } from '#apps/auth/ports/IRequestObservationSource.mjs';
import { InfrastructureError } from '#system/utils/errors/index.mjs';

const minute = 60_000;
const day = 24 * 60 * minute;
const limit = 25_000;
const events = {
  'access.inventory.window': ['windows', ['writerId', 'sequence', 'start', 'end', 'overflow', 'observations']],
  'access.inventory.station': ['sightings', ['householdId', 'id', 'lastSeen']],
  'access.inventory.caller': ['callers', ['householdId', 'id', 'kind', 'transport', 'lastSeen']],
};

function decode(field, value) {
  if (field === 'householdId' && (value == null || value === 'null')) return null;
  if (field === 'observations') return typeof value === 'string' ? JSON.parse(value) : value;
  if (['sequence', 'start', 'end', 'lastSeen'].includes(field)) {
    return typeof value === 'string' && /^\d+$/.test(value) ? Number(value) : value;
  }
  if (field === 'overflow' && typeof value === 'string') {
    if (value === 'true') return true;
    if (value === 'false') return false;
  }
  return value;
}

export class LogStoreRequestObservationSource extends IRequestObservationSource {
  constructor({ baseUrl, fetchImpl = fetch }) {
    super();
    this.endpoint = new URL('/select/logsql/query', baseUrl);
    this.fetchImpl = fetchImpl;
  }

  async read({ since, until }) {
    const start = Date.parse(since);
    const end = Date.parse(until);
    const result = { windows: [], sightings: [], callers: [] };
    const messages = Object.keys(events).map(event => `"${event}"`).join(' OR ');
    try {
      // Windows are emitted at their end, after the last request counted.
      for (let from = start; from < end + minute; from += day) {
        const to = Math.min(end + minute, from + day);
        const query = `_time:[${new Date(from).toISOString()},${new Date(to).toISOString()}) AND (${messages})`;
        const response = await this.fetchImpl(this.endpoint, {
          method: 'POST',
          body: new URLSearchParams({ query, limit: String(limit) }),
          signal: AbortSignal.timeout(15_000),
        });
        if (!response.ok) throw new Error(`Log query failed (${response.status})`);
        const lines = (await response.text()).split('\n').filter(line => line.trim());
        if (lines.length >= limit) throw new Error('Log query reached its row limit');
        for (const line of lines) {
          const row = JSON.parse(line);
          const descriptor = events[row._msg];
          if (!descriptor || !Object.hasOwn(events, row._msg)) throw new Error('Unexpected log record');
          const [group, fields] = descriptor;
          const value = Object.fromEntries(fields.map(field => [field, decode(field, row[`data.${field}`])]));
          if (group !== 'windows' && !Number.isSafeInteger(value.lastSeen)) throw new Error('Invalid observation time');
          if (group === 'windows' || (value.lastSeen >= start && value.lastSeen < end)) result[group].push(value);
        }
      }
      return result;
    } catch (cause) {
      throw new InfrastructureError('Access inventory log source unavailable', { code: 'access_inventory_log_unavailable', cause });
    }
  }
}
