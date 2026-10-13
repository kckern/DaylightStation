/**
 * In-memory session lock service.
 * Prevents multiple clients from persisting the same fitness session.
 *
 * Not distributed — runs per-process. Suitable for single-server deployment.
 */
export class SessionLockService {
  constructor({ ttlMs = 120000 } = {}) {
    this._locks = new Map();
    this._ttlMs = ttlMs;
  }

  /**
   * Try to acquire a lock for a session.
   * @param {string} sessionId
   * @param {string} clientId
   * @returns {{ granted: boolean, leader: string }}
   */
  acquire(sessionId, clientId) {
    const existing = this._locks.get(sessionId);

    if (existing) {
      // Same client renewing
      if (existing.clientId === clientId) {
        existing.acquiredAt = Date.now();
        return { granted: true, leader: clientId };
      }

      // Different client — check if lock is stale
      if ((Date.now() - existing.acquiredAt) < this._ttlMs) {
        return { granted: false, leader: existing.clientId };
      }
      // Lock expired, allow takeover
    }

    this._locks.set(sessionId, { clientId, acquiredAt: Date.now() });
    return { granted: true, leader: clientId };
  }

  /**
   * Release a lock. Only the holding client can release.
   * @param {string} sessionId
   * @param {string} clientId
   * @returns {boolean}
   */
  release(sessionId, clientId) {
    const existing = this._locks.get(sessionId);
    if (!existing || existing.clientId !== clientId) return false;
    this._locks.delete(sessionId);
    return true;
  }

  /**
   * Check who holds a lock (if anyone).
   * @param {string} sessionId
   * @returns {{ leader: string, acquiredAt: number } | null}
   */
  check(sessionId) {
    const existing = this._locks.get(sessionId);
    if (!existing) return null;
    if ((Date.now() - existing.acquiredAt) >= this._ttlMs) {
      this._locks.delete(sessionId);
      return null;
    }
    return { leader: existing.clientId, acquiredAt: existing.acquiredAt };
  }
}
