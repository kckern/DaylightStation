/**
 * Runtime ID generation. Entropy belongs outside the domain layer; callers
 * pass the resulting identifiers into domain factories.
 */
import { createHash, randomBytes, randomUUID } from 'node:crypto';

const CHARSET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
const LOWER_CHARSET = 'abcdefghijklmnopqrstuvwxyz0123456789';
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function shortIdLower(length = 10) {
  const bytes = randomBytes(length);
  return Array.from(bytes, (byte) => LOWER_CHARSET[byte % LOWER_CHARSET.length]).join('');
}

export function shortId(length = 10) {
  const bytes = randomBytes(length);
  return Array.from(bytes, (byte) => CHARSET[byte % CHARSET.length]).join('');
}

export function hexId(byteLength = 4) {
  return randomBytes(byteLength).toString('hex');
}

export function entropyBytes(byteLength) { return randomBytes(byteLength); }

export function uuidTail() { return randomUUID().split('-').pop(); }
export function uuid() { return randomUUID(); }

export function shortIdFromUuid(uuid, length = 10) {
  const hash = createHash('sha256').update(String(uuid)).digest();
  return Array.from(hash.slice(0, length), (byte) => CHARSET[byte % CHARSET.length]).join('');
}

export function isShortId(value, length = 10) {
  return typeof value === 'string' && new RegExp(`^[A-Za-z0-9]{${length}}$`).test(value);
}

export function isUuid(value) {
  return typeof value === 'string' && UUID_REGEX.test(value);
}

export const IdUtils = {
  CHARSET,
  shortId,
  shortIdLower,
  shortIdFromUuid,
  hexId,
  entropyBytes,
  uuidTail,
  uuid,
  isShortId,
  isUuid,
};

export default IdUtils;
