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
   * @param {object} record - from `mintToken`: `{ token, tokenClass, subject, issuedAt, expiresAt,
   *   revokedAt }`, and on a `subject_next` token optionally `{ accessCode, accessCodeExpiresAt }` —
   *   the printed 6-digit panel alias and its own, shorter study-day clock. Both keys are absent
   *   together on a token with no code; neither is ever stored as a null column.
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
   * Look up a token by its printed 6-digit panel code.
   *
   * The code has its OWN, shorter clock than the token it aliases: a code whose
   * study day has passed must not resolve even though its printed QR still scans.
   *
   * NOT a collision predicate for minting. It is async, so `taken: (code) =>
   * registry.getByAccessCode(code)` hands `mintAccessCode` a Promise, which is
   * always truthy — every draw reads as taken and the mint dies claiming the
   * 1,000,000-code space is exhausted. Use {@link liveAccessCodes} instead.
   *
   * @param {string} code - the six digits typed at the panel
   * @returns {Promise<object|null>} null when unknown, expired, or revoked —
   *   the caller says "Try again"; a keypad never dead-ends
   */
  async getByAccessCode(code) {
    throw new Error('ITokenRegistry.getByAccessCode must be implemented');
  }

  /**
   * Every panel code currently live, as one Set — the collision surface a mint
   * needs. `mintAccessCode` tests `taken(code)` SYNCHRONOUSLY, so a caller
   * awaits this once and then draws against the Set:
   *
   * @example
   * const live = await tokens.liveAccessCodes();
   * const code = mintAccessCode({ rng, taken: (c) => live.has(c) || mintedHere.has(c) });
   *
   * Live means what {@link getByAccessCode} would resolve: unexpired,
   * unrevoked, and on a `subject_next` record. Read fresh, not from a cache: a
   * stale answer here mints a duplicate code onto a child's paper.
   *
   * @returns {Promise<Set<string>>}
   */
  async liveAccessCodes() {
    throw new Error('ITokenRegistry.liveAccessCodes must be implemented');
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
