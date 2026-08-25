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
  isActive(now = Date.now()) { return now < Date.parse(this.lockedUntil); }
  includes(target) { return this.targets.includes(target); }
  toData() { return { schema_version: 1, locked_at: this.lockedAt, locked_until: this.lockedUntil, targets: this.targets, source: this.source }; }
  static create({ durationSeconds, targets, source, now = Date.now() }) {
    if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) throw new Error('ShutdownState: durationSeconds must be positive');
    return new ShutdownState({ locked_at: new Date(now).toISOString(), locked_until: new Date(now + durationSeconds * 1000).toISOString(), targets, source });
  }
  static fromData(data) { return new ShutdownState(data); }
}
