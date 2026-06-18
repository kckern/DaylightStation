// backend/src/2_domains/fitness/value-objects/LockdownState.mjs

/**
 * Emergency lockdown state. Times are UNIX epoch SECONDS.
 * Pure value object: immutable, no I/O.
 */
export class LockdownState {
  #lockedUntil;
  #lockedBy;
  #lockedAt;

  constructor({ lockedUntil, lockedBy, lockedAt }) {
    if (!lockedBy || typeof lockedBy !== 'string') {
      throw new Error('LockdownState: lockedBy (string) required');
    }
    if (!Number.isFinite(lockedUntil) || !Number.isFinite(lockedAt) || lockedUntil <= lockedAt) {
      throw new Error('LockdownState: lockedUntil must be a finite epoch after lockedAt');
    }
    this.#lockedUntil = lockedUntil;
    this.#lockedBy = lockedBy;
    this.#lockedAt = lockedAt;
    Object.freeze(this);
  }

  get lockedUntil() { return this.#lockedUntil; }
  get lockedBy() { return this.#lockedBy; }
  get lockedAt() { return this.#lockedAt; }

  /** @param {number} now epoch seconds */
  isActive(now) { return now < this.#lockedUntil; }

  toData() {
    return { lockedUntil: this.#lockedUntil, lockedBy: this.#lockedBy, lockedAt: this.#lockedAt };
  }

  static fromData(data) { return new LockdownState(data); }

  static create({ lockedBy, durationSec, now }) {
    if (!Number.isFinite(durationSec) || durationSec <= 0) {
      throw new Error('LockdownState.create: durationSec must be > 0');
    }
    return new LockdownState({ lockedBy, lockedAt: now, lockedUntil: now + durationSec });
  }
}
