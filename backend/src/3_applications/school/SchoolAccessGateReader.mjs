import { resolveGate } from '#domains/school/accessGate.mjs';

/** Resolves the live physical-access policy, including the parent's force override. */
export class SchoolAccessGateReader {
  constructor({ readConfig, readPresence, clock }) {
    this.readConfig = readConfig;
    this.readPresence = readPresence;
    this.clock = clock;
  }

  read() {
    const config = this.readConfig?.() || null;
    if (config?.force === 'open') {
      return { level: 'open', reason: 'forced-open', missing: [], stale: false };
    }
    if (config?.force === 'closed') {
      return { level: 'disabled', reason: 'forced-closed', missing: [], stale: false };
    }
    return resolveGate({
      presence: this.readPresence(config?.device_id || 'portal'),
      now: this.clock.now(),
      required: config?.devices || [],
      ttlMs: config?.ttl_ms ?? undefined,
    });
  }
}

export default SchoolAccessGateReader;
