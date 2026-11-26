const ingressKinds = new Set(['http', 'websocket']);
const resolutions = new Set(['exact', 'pattern', 'fallback', 'unresolved-by-router']);

function requireArray(value, field) {
  if (!Array.isArray(value)) throw new Error(`Invalid access inventory ${field}`);
  return value;
}

function utcMillis(value) {
  return typeof value === 'string' && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{3})?Z$/.test(value)
    ? Date.parse(value) : NaN;
}

function normalizeWindows(records) {
  const windows = new Map();
  for (const record of requireArray(records, 'windows')) {
    if (!record || typeof record.writerId !== 'string' || !record.writerId
        || !Number.isSafeInteger(record.sequence) || record.sequence < 1
        || !Number.isSafeInteger(record.start) || !Number.isSafeInteger(record.end) || record.end <= record.start
        || typeof record.overflow !== 'boolean') {
      throw new Error('Invalid access inventory window');
    }
    for (const row of requireArray(record.observations, 'window observations')) {
      if (!row || !ingressKinds.has(row.ingress) || !resolutions.has(row.resolution)
          || !(row.host === null || typeof row.host === 'string')
          || !(row.householdId === null || typeof row.householdId === 'string')
          || !Number.isSafeInteger(row.requests) || row.requests < 1) {
        throw new Error('Invalid access inventory count');
      }
    }
    const key = JSON.stringify([record.writerId, record.sequence]);
    if (windows.has(key) && JSON.stringify(windows.get(key)) !== JSON.stringify(record)) {
      throw new Error('Conflicting access inventory window');
    }
    windows.set(key, record);
  }
  return [...windows.values()].sort((a, b) => a.start - b.start || a.end - b.end);
}

function scopeKey(row) {
  return JSON.stringify([row.householdId ?? null, row.id, row.kind ?? null, row.transport ?? null]);
}

export class AccessInventory {
  constructor({ observationSource, registrationSource, requiredActivities = [] }) {
    this.requiredActivities = requiredActivities;
    this.observationSource = observationSource;
    this.registrationSource = registrationSource;
  }

  async report({ since, until }) {
    const start = utcMillis(since);
    const end = utcMillis(until);
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) {
      throw new RangeError('Inventory requires an increasing UTC interval');
    }

    const [observed, registrations] = await Promise.all([
      this.observationSource.read({ since, until }),
      this.registrationSource.read({ since, until }),
    ]);
    const windows = normalizeWindows(observed.windows);
    const mappedHosts = new Set(Object.keys(registrations.domainMapping ?? {}).map(key => key.toLowerCase()));
    const hosts = new Map();
    const reasons = new Set();
    let coveredThrough = start;
    for (const record of windows) {
      if (record.start >= end || record.end <= start) continue;
      if (record.start < start || record.end > end) {
        reasons.add('partial_window');
        continue;
      }
      if (record.start > coveredThrough) reasons.add('window_gap');
      if (record.start < coveredThrough) reasons.add('overlapping_windows');
      coveredThrough = Math.max(coveredThrough, record.end);
      if (record.overflow) reasons.add('window_overflow');

      for (const row of record.observations) {
        const current = hosts.get(row.host) ?? {
          host: row.host, mapped: mappedHosts.has(row.host), requests: 0, upgrades: 0, evidence: [],
        };
        if (row.ingress === 'http') current.requests += row.requests;
        else current.upgrades += row.requests;
        const entry = current.evidence.find(item => item.ingress === row.ingress
          && item.resolution === row.resolution && item.householdId === row.householdId);
        if (entry) entry.requests += row.requests;
        else current.evidence.push({ ...row });
        hosts.set(row.host, current);
      }
    }
    if (coveredThrough < end) reasons.add('window_gap');
    if (!hosts.size) reasons.add('no_ingress_observed');
    for (const reason of observed.incomplete ?? []) reasons.add(reason);
    const activities = new Set();
    for (const { activity, at } of requireArray(registrations.activities ?? [], 'activity evidence')) {
      const time = utcMillis(at);
      if (!Number.isFinite(time)) throw new Error('Invalid activity observation time');
      if (time >= start && time < end) activities.add(activity);
    }
    const missingActivities = this.requiredActivities.filter(activity => !activities.has(activity));
    if (missingActivities.length) reasons.add('required_activities_missing');

    const unknown = hosts.has(null) ? [{ kind: 'unknown-host', id: 'invalid-or-missing-host' }] : [];
    const devices = new Map(requireArray(registrations.devices, 'registered devices').map(row => [
      scopeKey(row), { ...row, lastSeen: null },
    ]));
    for (const row of requireArray(observed.sightings, 'station sightings')) {
      if (typeof row.householdId !== 'string' || typeof row.id !== 'string' || !Number.isSafeInteger(row.lastSeen)) {
        throw new Error('Invalid access inventory station sighting');
      }
      if (row.lastSeen < start || row.lastSeen >= end) continue;
      const device = devices.get(scopeKey(row));
      if (!device) unknown.push({ ...row, kind: 'station' });
      else {
        device.proof = 'declared-header';
        device.lastSeen = Math.max(device.lastSeen ?? row.lastSeen, row.lastSeen);
      }
    }
    const callers = new Map(requireArray(registrations.callers, 'registered callers').map(row => [scopeKey(row), { ...row }]));
    for (const row of requireArray(observed.callers, 'observed callers')) {
      if (!row || typeof row.kind !== 'string' || typeof row.id !== 'string' || typeof row.transport !== 'string') {
        throw new Error('Invalid access inventory caller');
      }
      const caller = callers.get(scopeKey(row));
      if (!caller && row.kind === 'job' && row.transport === 'scheduler') {
        callers.set(scopeKey(row), { ...row, provisioningOwner: 'local-operator' });
      } else if (!caller) {
        unknown.push(row);
      } else if (row.lastSeen != null) {
        caller.lastSeen = Math.max(caller.lastSeen ?? row.lastSeen, row.lastSeen);
      }
    }
    return {
      hosts: [...hosts.values()],
      devices: [...devices.values()],
      callers: [...callers.values()],
      unknown,
      coverage: { since, until, complete: reasons.size === 0, reasons: [...reasons], missingActivities },
    };
  }
}
