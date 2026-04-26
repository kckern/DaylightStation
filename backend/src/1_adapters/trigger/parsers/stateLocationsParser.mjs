/**
 * Parser for triggers/state/locations.yml. State events are inherently
 * location-bound (entity_id is owned by a specific location), so the data
 * lives per-location with no separate registry. The `states` map is keyed by
 * the state value (lowercased) -> action override block.
 *
 * Layer: ADAPTER (1_adapters/trigger).
 *
 * Output shape:
 *   { [locationId]: { target, auth_token, states: { [stateValue]: <entry> } } }
 *
 * @module adapters/trigger/parsers/stateLocationsParser
 */

import { ValidationError } from '#domains/core/errors/ValidationError.mjs';

function isPlainObject(v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

export function parseStateLocations(raw) {
  if (!raw) return {};
  if (!isPlainObject(raw)) {
    throw new ValidationError('state/locations.yml root must be an object', { code: 'INVALID_CONFIG_ROOT' });
  }

  const out = {};
  for (const [locationId, locConfig] of Object.entries(raw)) {
    if (!isPlainObject(locConfig)) {
      throw new ValidationError(`location "${locationId}" must be an object`, { code: 'INVALID_LOCATION', field: locationId });
    }
    if (typeof locConfig.target !== 'string' || locConfig.target.length === 0) {
      throw new ValidationError(`location "${locationId}" must declare a target device (non-empty string)`, { code: 'MISSING_TARGET', field: locationId });
    }

    const states = {};
    if (locConfig.states !== undefined) {
      if (!isPlainObject(locConfig.states)) {
        throw new ValidationError(`location "${locationId}" states must be an object`, { code: 'INVALID_STATES', field: locationId });
      }
      for (const [value, entry] of Object.entries(locConfig.states)) {
        if (!isPlainObject(entry)) {
          throw new ValidationError(`state "${value}" must be an object`, { code: 'INVALID_STATE_ENTRY', field: value });
        }
        states[value.toLowerCase()] = entry;
      }
    }

    out[locationId] = {
      target: locConfig.target,
      auth_token: locConfig.auth_token ?? null,
      states,
    };
  }

  return out;
}

export default parseStateLocations;
