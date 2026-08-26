/**
 * ID Utilities for Domain Layer
 * @module core/utils/id
 *
 * Pure functions for ID generation and validation.
 * Moved to domain layer as these are shared kernel utilities
 * used across domain entities.
 */

import crypto from 'crypto';

const CHARSET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const LOWER_CHARSET = 'abcdefghijklmnopqrstuvwxyz0123456789';

/**
 * A case-insensitive short id — lowercase letters and digits only.
 *
 * THE CASE-DRIFT HAZARD, killed at the source. A mixed-case id does not
 * survive the round trip through this system: session ids mint mixed-case, and
 * `slugify` (receipts.mjs) folds them to lowercase for document ids, so ONE
 * session ends up spelled two ways in one tree —
 * `ses_hmSsHlJR` in the receipt id and `records/session-results`, and
 * `ws-ses-hmsshljr` in the worksheet artifact id and the print-document path.
 * The fold is 62^n -> 36^n and therefore lossy: two case-twin sessions would
 * silently merge into one worksheet document id. Worse, that data tree syncs
 * to a case-insensitive macOS checkout, so mixed-case filenames are exposed to
 * an APFS collision.
 *
 * A lowercase alphabet makes the fold the identity function, so the drift and
 * the collision class both stop existing for anything minted from here on.
 * Length 10 over this alphabet is ~51.7 bits, comfortably more than the ~47.6
 * bits of the mixed-case 8 it replaces — narrowing the alphabet must not
 * narrow the entropy.
 *
 * Existing mixed-case ids stay valid forever. They are identifiers, not files
 * to fix, and `out:ses_X` has already crossed into the economy ledger.
 *
 * @param {number} [length=10]
 * @returns {string}
 */
export function shortIdLower(length = 10) {
  const bytes = crypto.randomBytes(length);
  return Array.from(bytes, (b) => LOWER_CHARSET[b % LOWER_CHARSET.length]).join('');
}

/**
 * Generate a random short ID
 * @param {number} [length=10] - Length of the ID
 * @returns {string}
 */
export function shortId(length = 10) {
  const bytes = crypto.randomBytes(length);
  return Array.from(bytes, (b) => CHARSET[b % CHARSET.length]).join('');
}

/**
 * Generate a deterministic short ID from a UUID
 * @param {string} uuid - UUID to convert
 * @param {number} [length=10] - Length of the ID
 * @returns {string}
 */
export function shortIdFromUuid(uuid, length = 10) {
  const hash = crypto.createHash('sha256').update(String(uuid)).digest();
  return Array.from(hash.slice(0, length), (b) => CHARSET[b % CHARSET.length]).join('');
}

/**
 * Check if a value is a valid short ID
 * @param {any} value - Value to check
 * @param {number} [length=10] - Expected length
 * @returns {boolean}
 */
export function isShortId(value, length = 10) {
  return typeof value === 'string' && new RegExp(`^[A-Za-z0-9]{${length}}$`).test(value);
}

/**
 * Check if a value is a valid UUID
 * @param {any} value - Value to check
 * @returns {boolean}
 */
export function isUuid(value) {
  return typeof value === 'string' && UUID_REGEX.test(value);
}

export const IdUtils = {
  CHARSET,
  shortId,
  shortIdFromUuid,
  isShortId,
  isUuid,
};

export default IdUtils;
