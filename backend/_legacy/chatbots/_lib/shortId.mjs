import crypto from 'crypto';

const CHARSET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
const SHORT_ID_REGEX = /^[A-Za-z0-9]{10}$/;
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function shortId(length = 10) {
  const bytes = crypto.randomBytes(length);
  return Array.from(bytes, (b) => CHARSET[b % CHARSET.length]).join('');
}

export function shortIdFromUuid(uuid, length = 10) {
  const hash = crypto.createHash('sha256').update(String(uuid)).digest();
  return Array.from(hash.slice(0, length), (b) => CHARSET[b % CHARSET.length]).join('');
}

export function isShortId(value, length = 10) {
  return typeof value === 'string' && new RegExp(`^[A-Za-z0-9]{${length}}$`).test(value);
}

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
