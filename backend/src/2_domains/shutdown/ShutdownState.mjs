/** Durable public-kiosk shutdown state. ISO timestamps keep the hand-edit path humane. */
export class ShutdownState {
  constructor({ locked_at, locked_until, targets = [], source = null } = {}) {
    const until = Date.parse(locked_until);
    const at = Date.parse(locked_at);
    const normalizedTargets = Array.isArray(targets)
      ? [...new Set(targets.filter((v) => typeof v === 'string' && v))] : [];
    if (!Number.isFinite(at) || !Number.isFinite(until) || until <= at || !normalizedTargets.length) {
      throw new Error('ShutdownState: locked_at, locked_until, and non-empty targets required');
    }
    this.lockedAt = new Date(at).toISOString();
    this.lockedUntil = new Date(until).toISOString();
    this.targets = normalizedTargets;
    this.source = source;
    Object.freeze(this.targets); Object.freeze(this);
  }
  isActive(now) {
    if (!Number.isFinite(now)) throw new Error('ShutdownState: now is required');
    return now < Date.parse(this.lockedUntil);
  }
  includes(target) { return this.targets.includes(target); }
}
