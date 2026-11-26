import { randomUUID } from 'node:crypto';

export function observationHost(value) {
  if (typeof value !== 'string' || value.length > 260) return null;
  const host = value.toLowerCase();
  return /^(?:[a-z0-9](?:[a-z0-9.-]*[a-z0-9.]|)|\[[0-9a-f:.]+\])(?::[0-9]{1,5})?$/.test(host) ? host : null;
}

export function createAccessObservationCounts({
  logger, clock = Date.now, writerId = randomUUID(), intervalMs = 60_000, maxHosts = 100,
}) {
  let start = clock();
  let end = Math.floor(start / intervalMs) * intervalMs + intervalMs;
  let sequence = 0;
  let overflow = false;
  let rows = new Map();
  const diagnosedFallbacks = new Set();

  function flush(now = clock()) {
    while (now >= end) {
      logger.info('access.inventory.window', {
        writerId, sequence: ++sequence, start, end, overflow, observations: [...rows.values()],
      });
      rows = new Map();
      diagnosedFallbacks.clear();
      overflow = false;
      // Leave a gap when the writer missed more than a full subsequent window.
      start = now >= end + 2 * intervalMs ? Math.floor(now / intervalMs) * intervalMs : end;
      end = start + intervalMs;
    }
  }

  function record({ host, ingress, resolution = 'unresolved-by-router', householdId = null }) {
    flush();
    const normalizedHost = observationHost(host);
    const key = JSON.stringify([ingress, normalizedHost, resolution, householdId]);
    const previous = rows.get(key);
    if (previous) {
      previous.requests += 1;
    } else if (rows.size < maxHosts) {
      rows.set(key, { ingress, host: normalizedHost, resolution, householdId, requests: 1 });
    } else {
      overflow = true;
    }
  }

  return {
    flush, record,
    recordStation(sighting) { logger.info('access.inventory.station', sighting); },
    recordScheduledJobs(ids) {
      const lastSeen = clock();
      for (const id of ids) logger.info('access.inventory.caller', { id, kind: 'job', transport: 'scheduler', lastSeen });
    },
    recordResolution({ host, householdId, resolution }) {
      if (resolution !== 'fallback') return;
      flush();
      const normalizedHost = observationHost(host);
      if (diagnosedFallbacks.has(normalizedHost) || diagnosedFallbacks.size >= maxHosts) return;
      diagnosedFallbacks.add(normalizedHost);
      logger.warn('access.household.unresolved', { host: normalizedHost, householdId });
    },
    start() {
      if (sequence === 0 && rows.size === 0) {
        start = clock();
        end = (Math.floor(start / intervalMs) + 1) * intervalMs;
      }
      const timer = setInterval(() => flush(), Math.min(intervalMs, 1000));
      timer.unref();
      return () => clearInterval(timer);
    },
  };
}
