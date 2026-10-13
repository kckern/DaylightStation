/**
 * Assigns one live fitness session ID per household and identifies its writer.
 * Mirrors are intentionally read-only: they render local device events but
 * share the writer's session identity, so the existing persistence lock can
 * never create a competing record.
 */
export class FitnessLiveSessionAuthority {
  constructor({ ttlMs = 120000, now = () => Date.now(), createSessionId = null } = {}) {
    this.ttlMs = ttlMs;
    this.now = now;
    this.createSessionId = createSessionId || (() => `fs_${this._timestamp(this.now())}`);
    this.sessions = new Map();
  }

  _timestamp(ms) {
    const date = new Date(ms);
    const pad = (n) => String(n).padStart(2, '0');
    return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`;
  }

  claim(householdId, clientId, { writerEligible } = {}) {
    const key = householdId || 'default';
    const existing = this.sessions.get(key);
    const now = this.now();
    if (existing && now - existing.lastSeenAt >= this.ttlMs) this.sessions.delete(key);
    const active = this.sessions.get(key);
    if (active) {
      if (active.clientId === clientId) active.lastSeenAt = now;
      return { role: active.clientId === clientId ? 'writer' : 'mirror', sessionId: active.sessionId, startTime: active.startTime };
    }
    if (!writerEligible) return { role: 'waiting', sessionId: null, startTime: null };
    const record = { clientId, sessionId: this.createSessionId(), startTime: now, lastSeenAt: now };
    this.sessions.set(key, record);
    return { role: 'writer', sessionId: record.sessionId, startTime: record.startTime };
  }

  release(householdId, clientId) {
    const record = this.sessions.get(householdId || 'default');
    if (!record || record.clientId !== clientId) return false;
    this.sessions.delete(householdId || 'default');
    return true;
  }
}
