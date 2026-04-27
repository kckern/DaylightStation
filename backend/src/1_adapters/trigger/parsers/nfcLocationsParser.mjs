/**
 * Parser for triggers/nfc/locations.yml. Each top-level key is an NFC reader
 * location ID. Reserved fields (target, action, auth_token, notify_unknown,
 * end, end_location) are extracted as first-class config; all other top-level
 * keys become the location's `defaults` object, which inherits into every
 * tag scanned at this reader.
 *
 * Layer: ADAPTER (1_adapters/trigger).
 *
 * Output shape:
 *   { [locationId]: { target, action, auth_token, notify_unknown, end, end_location, defaults: { ...rest } } }
 *
 * @module adapters/trigger/parsers/nfcLocationsParser
 */

import { ValidationError } from '#domains/core/errors/ValidationError.mjs';

const RESERVED = new Set(['target', 'action', 'auth_token', 'notify_unknown', 'end', 'end_location']);
export const ALLOWED_END_BEHAVIORS = new Set(['tv-off', 'clear', 'nothing']);

function isPlainObject(v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

export function parseNfcLocations(raw) {
  if (!raw) return {};
  if (!isPlainObject(raw)) {
    throw new ValidationError('nfc/locations.yml root must be an object', { code: 'INVALID_CONFIG_ROOT' });
  }

  const out = {};
  for (const [locationId, locConfig] of Object.entries(raw)) {
    if (!isPlainObject(locConfig)) {
      throw new ValidationError(`location "${locationId}" must be an object`, { code: 'INVALID_LOCATION', field: locationId });
    }
    if (typeof locConfig.target !== 'string' || locConfig.target.length === 0) {
      throw new ValidationError(`location "${locationId}" must declare a target device (non-empty string)`, { code: 'MISSING_TARGET', field: locationId });
    }

    if (locConfig.end !== undefined && !ALLOWED_END_BEHAVIORS.has(locConfig.end)) {
      throw new ValidationError(
        `location "${locationId}" end must be one of ${[...ALLOWED_END_BEHAVIORS].join(', ')}`,
        { code: 'INVALID_END_BEHAVIOR', field: locationId }
      );
    }
    if (locConfig.end === 'tv-off' && (typeof locConfig.end_location !== 'string' || locConfig.end_location.length === 0)) {
      throw new ValidationError(
        `location "${locationId}" end: tv-off requires end_location (non-empty string)`,
        { code: 'MISSING_END_LOCATION', field: locationId }
      );
    }

    const defaults = {};
    for (const [k, v] of Object.entries(locConfig)) {
      if (RESERVED.has(k)) continue;
      defaults[k] = v;
    }

    out[locationId] = {
      target: locConfig.target,
      action: locConfig.action ?? null,
      auth_token: locConfig.auth_token ?? null,
      notify_unknown: locConfig.notify_unknown ?? null,
      end: locConfig.end ?? null,
      end_location: locConfig.end_location ?? null,
      defaults,
    };
  }

  return out;
}

export default parseNfcLocations;
