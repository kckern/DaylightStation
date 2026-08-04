/**
 * ITokenRegistry — persistence contract for printed action tokens.
 * @module applications/school/ports/ITokenRegistry
 *
 * Tokens are opaque (spec §6.1): the barcode carries no meaning, so ALL of it —
 * class, subject, expiry, revocation — lives in this registry. That is what makes
 * "cancel that ticket" and "change the policy" one server-side write instead of
 * a reprint of every piece of paper in the house.
 *
 * @example
 * class YamlTokenRegistry extends ITokenRegistry {
 *   async put(record) { ... }
 * }
 */
export class ITokenRegistry {
  /**
   * Store a minted token record.
   *
   * @param {object} record - from `mintToken`: `{ token, tokenClass, subject, issuedAt, expiresAt, revokedAt }`
   * @returns {Promise<object>} the stored record
   */
  async put(record) {
    throw new Error('ITokenRegistry.put must be implemented');
  }

  /**
   * Atomically claim an opaque token's immutable meaning. A retry with the
   * same class and subject returns the original record; another meaning is a
   * conflict and must never overwrite what an already-printed code does.
   *
   * @returns {Promise<{status:'accepted'|'duplicate'|'conflict', record:object}>}
   */
  async claim(record) { // eslint-disable-line no-unused-vars
    throw new Error('ITokenRegistry.claim must be implemented');
  }

  /**
   * Look up a scanned token.
   *
   * @param {string} token - the scanned code, with or without the `sch:` prefix
   * @returns {Promise<object|null>} null when unknown or unreadable — the caller
   *   prints an explanation slip; a scan never fails silently
   */
  async get(token) {
    throw new Error('ITokenRegistry.get must be implemented');
  }

  /**
   * Cancel a token, keeping the record for the audit trail.
   *
   * @param {string} token
   * @param {{ at?: string }} [opts] - ISO revocation time (injected, not read from a clock here)
   * @returns {Promise<object|null>} the revoked record, or null when unknown
   */
  async revoke(token, opts) {
    throw new Error('ITokenRegistry.revoke must be implemented');
  }
}

export default ITokenRegistry;
