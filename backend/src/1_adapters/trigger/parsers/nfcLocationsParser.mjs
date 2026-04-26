/**
 * Parser for triggers/nfc/locations.yml. Each top-level key is an NFC reader
 * location ID. Reserved fields (target, action, auth_token) are extracted as
 * first-class config; all other top-level keys become the location's `defaults`
 * object, which inherits into every tag scanned at this reader.
 *
 * Layer: ADAPTER (1_adapters/trigger). Knows YAML key shape — that's storage-
 * format knowledge per domain-layer-guidelines.md.
 *
 * Output shape:
 *   { [locationId]: { target, action, auth_token, defaults: { ...rest } } }
 *
 * @module adapters/trigger/parsers/nfcLocationsParser
 */

import { ValidationError } from '#domains/core/errors/ValidationError.mjs';

const RESERVED = new Set(['target', 'action', 'auth_token']);

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

    const defaults = {};
    for (const [k, v] of Object.entries(locConfig)) {
      if (RESERVED.has(k)) continue;
      defaults[k] = v;
    }

    out[locationId] = {
      target: locConfig.target,
      action: locConfig.action ?? null,
      auth_token: locConfig.auth_token ?? null,
      defaults,
    };
  }

  return out;
}

export default parseNfcLocations;
