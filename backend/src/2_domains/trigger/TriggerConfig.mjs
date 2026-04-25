/**
 * Trigger config parser + validator.
 *
 * Parses a location-rooted YAML shape into a normalized registry consumed by
 * TriggerDispatchService. Each top-level key is a location (e.g. `livingroom`,
 * `office`); each location declares default `target` + `action`, an optional
 * `auth_token`, and modality-specific entries (currently `tags` for nfc).
 *
 * Future modality types map to other entries keys:
 *   nfc    → tags
 *   barcode→ codes
 *   voice  → keywords
 *
 * @module domains/trigger/TriggerConfig
 */

import { ValidationError } from '#domains/core/errors/ValidationError.mjs';

const ENTRIES_KEY_BY_TYPE = {
  nfc: 'tags',
  barcode: 'codes',
  voice: 'keywords',
};

function isPlainObject(v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

export function parseTriggerConfig(raw, type) {
  if (typeof type !== 'string' || type.length === 0) {
    throw new ValidationError('type is required', { code: 'MISSING_TYPE' });
  }

  if (!raw) return {};
  if (!isPlainObject(raw)) {
    throw new ValidationError('trigger config must be an object', { code: 'INVALID_CONFIG_ROOT' });
  }

  const entriesKey = ENTRIES_KEY_BY_TYPE[type];
  if (!entriesKey) {
    throw new ValidationError(`Unknown trigger type: ${type}`, { code: 'UNKNOWN_TRIGGER_TYPE', field: type });
  }

  const out = {};
  for (const [location, locConfig] of Object.entries(raw)) {
    if (!isPlainObject(locConfig)) {
      throw new ValidationError(`location "${location}" must be an object`, { code: 'INVALID_LOCATION', field: location });
    }
    if (typeof locConfig.target !== 'string' || locConfig.target.length === 0) {
      throw new ValidationError(`location "${location}" must declare a target device (string)`, { code: 'MISSING_TARGET', field: location });
    }

    const entries = {};
    const rawEntries = locConfig[entriesKey] || {};
    if (!isPlainObject(rawEntries)) {
      throw new ValidationError(`location "${location}" ${entriesKey} must be an object`, { code: 'INVALID_ENTRIES', field: location });
    }
    for (const [value, entry] of Object.entries(rawEntries)) {
      if (!isPlainObject(entry)) {
        throw new ValidationError(`${entriesKey.slice(0, -1)} "${value}" must be an object`, { code: 'INVALID_ENTRY', field: value });
      }
      entries[value.toLowerCase()] = entry;
    }

    out[location] = {
      target: locConfig.target,
      action: locConfig.action,
      auth_token: locConfig.auth_token ?? null,
      entries,
    };
  }

  return out;
}

export default parseTriggerConfig;
