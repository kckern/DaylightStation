import { createHash } from 'node:crypto';

/** Canonical JSON for application-level digests and idempotency keys. */
export function stableRecordText(value) {
  return JSON.stringify(canonicalize(value));
}

export function stableRecordDigest(value) {
  return createHash('sha256').update(stableRecordText(value)).digest('hex');
}

function canonicalize(value) {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error('Stable records cannot contain non-finite numbers');
    return value;
  }
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype) {
    return Object.fromEntries(Object.keys(value).sort()
      .filter((key) => value[key] !== undefined)
      .map((key) => [key, canonicalize(value[key])]));
  }
  throw new Error('Stable records must contain only JSON data');
}
