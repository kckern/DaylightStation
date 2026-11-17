import { composeFitnessTransportPush } from '../../domain/notifications/fitnessTransportPush.mjs';

const FIELDS = new Set(['type', 'incidentId', 'state', 'reason', 'bootId', 'silenceMs', 'timestamp', 'service', 'version', 'buildId', 'deviceId']);
function metadata(event) {
  const d = event?.type === 'fitness_transport' ? event.data : null;
  if (!d || Object.keys(d).some(key => !FIELDS.has(key))) return null;
  if (!['lost', 'recovered'].includes(d.type) || !['lost', 'healthy', 'recovering', 'quiet', 'suspect'].includes(d.state)) return null;
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}$/.test(d.incidentId ?? '')) return null;
  if (d.bootId !== null && (typeof d.bootId !== 'string' || d.bootId.length > 128)) return null;
  if (!['delivery-gap', 'health-missing', 'sample-delivered', 'source-quiet', 'inactive', 'stopped'].includes(d.reason)) return null;
  if (!Number.isFinite(d.silenceMs) || d.silenceMs < 0 || d.silenceMs > 86400000) return null;
  if (typeof d.timestamp !== 'string' || !/(Z|[+-]\d{2}:\d{2})$/.test(d.timestamp) || !Number.isFinite(Date.parse(d.timestamp))) return null;
  const identity = {};
  for (const field of ['service', 'version', 'buildId', 'deviceId']) {
    // Legacy committed incidents have no provenance; never invent it.
    const value = d[field] === undefined ? 'unknown' : d[field];
    if (typeof value !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9._:/@+-]{0,127}$/.test(value)) return null;
    identity[field] = value;
  }
  return { ...d, ...identity };
}

/** Durable metadata queue. Only accepted session saves can enqueue work. */
export class FitnessTransportIncidentService {
  constructor({ store, sendPush, allowedHouseholdId, logger, now = () => performance.now(), wallNow = Date.now }) {
    Object.assign(this, { store, sendPush, allowedHouseholdId, logger, now, wallNow });
    this.tail = Promise.resolve();
    this.deadlines = new Map();
  }

  recordCommitted(session, householdId) {
    if (!householdId || householdId !== this.allowedHouseholdId) {
      this.logger?.warn?.('fitness.transport.alert_scope_rejected', {});
      return Promise.resolve();
    }
    const events = [...(session?.events ?? []), ...(session?.timeline?.events ?? [])].map(metadata).filter(Boolean);
    return this.#serialize(() => this.#drain(events));
  }

  // Registered on the existing production agents Scheduler. It can only read
  // previously authorized durable work; a tick cannot create an incident.
  register(scheduler) {
    return scheduler.registerTask('fitness:transport-incident-retry', '* * * * *', () => this.tick());
  }

  tick() { return this.#serialize(() => this.#drain([])); }

  #serialize(work) {
    const result = this.tail.then(work);
    this.tail = result.catch(() => {});
    return result;
  }

  async #drain(events) {
    const householdId = this.allowedHouseholdId;
    if (!householdId) return;
    const queue = await this.store.readTransportIncidents(householdId);
    const records = queue.incidents;
    for (const event of events) {
      const existing = Object.hasOwn(records, event.incidentId) ? records[event.incidentId] : null;
      if (event.type === 'lost' && !existing) {
        records[event.incidentId] = { metadata: event, status: 'pending', delivered: 'unknown', attempts: 0 };
      } else if (event.type === 'recovered' && existing) {
        existing.recoveredAt = event.timestamp;
        if (existing.status !== 'accepted') existing.status = 'resolved';
      }
    }
    // Commit before contacting the provider. Browser saves never write this file.
    if (events.length) await this.store.writeTransportIncidents(householdId, queue);
    for (const [id, record] of Object.entries(records)) {
      if (!['pending', 'failed'].includes(record.status)) continue;
      if (!this.deadlines.has(id)) {
        const remaining = Math.max(0, Math.min(300000, (record.retryAt ?? 0) - this.wallNow()));
        this.deadlines.set(id, this.now() + remaining);
      }
      if (this.now() < this.deadlines.get(id)) continue;
      record.attempts += 1;
      record.status = 'pending';
      record.retryAt = this.wallNow() + (record.attempts === 1 ? 60000 : record.attempts === 2 ? 120000 : 300000);
      this.deadlines.set(id, this.now() + (record.attempts === 1 ? 60000 : record.attempts === 2 ? 120000 : 300000));
      await this.store.writeTransportIncidents(householdId, queue);
      try {
        const result = await this.sendPush?.(composeFitnessTransportPush(record.metadata), householdId);
        if (result?.accepted !== true) throw new Error('push_target_unavailable');
        record.status = 'accepted';
        record.acceptedAt = new Date(this.wallNow()).toISOString();
        record.delivered = 'unknown';
        this.logger?.info?.('fitness.transport.alert_accepted', { incidentId: id, householdId, delivered: 'unknown' });
      } catch {
        record.status = 'failed';
        record.lastError = 'push_unavailable_or_failed';
        record.failedAt = new Date(this.wallNow()).toISOString();
        this.logger?.warn?.('fitness.transport.alert_failed', { incidentId: id, householdId, attempts: record.attempts });
      }
      await this.store.writeTransportIncidents(householdId, queue);
    }
  }
}
