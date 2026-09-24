/**
 * Guard for user-chosen config keys that the trigger parsers copy into maps
 * (`out[key] = …`). `__proto__` would replace the map's prototype; `constructor`
 * and `prototype` shadow Object members that later lookups trip over. Each is a
 * ValidationError, so lenient loading (onSkip) drops only the entry that holds it.
 *
 * Layer: ADAPTER (1_adapters/trigger/parsers).
 * @module adapters/trigger/parsers/safeKey
 */
import { ValidationError } from '#domains/core/errors/ValidationError.mjs';

const UNSAFE_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

/**
 * @param {string} key
 * @param {string} what - human label for the message ("source id", "state value", ...)
 * @param {string} [field] - the enclosing entry, for the error's field
 * @returns {string} the key, unchanged
 * @throws {ValidationError} code RESERVED_KEY
 */
export function assertSafeKey(key, what, field = key) {
  if (UNSAFE_KEYS.has(key)) {
    throw new ValidationError(`${what} "${key}" is a reserved JavaScript name`, { code: 'RESERVED_KEY', field });
  }
  return key;
}

export default assertSafeKey;
