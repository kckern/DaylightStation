/**
 * Short ID utilities
 * @module infrastructure/utils/shortId
 *
 * Generate and validate short IDs for entities.
 */

import crypto from 'crypto';

const CHARSET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

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

export const ShortId = {
  CHARSET,
  shortId,
  shortIdFromUuid,
  isShortId,
  isUuid,
};

export default ShortId;
