/**
 * Trigger config parser + validator (multi-modality).
 *
 * Parses a location-rooted YAML shape into a normalized registry consumed by
 * TriggerDispatchService. Each top-level key is a location (e.g. `livingroom`,
 * `office`); each location declares default `target` + `action`, an optional
 * `auth_token`, and one or more modality-specific entries blocks.
 *
 * Modality → YAML entries-key mapping:
 *   nfc     → tags
 *   barcode → codes
 *   voice   → keywords
 *   state   → states
 *
 * The parser performs a single pass over the YAML. Modalities present in the
 * YAML are added to the location's `entries` object; modalities absent from
 * the YAML do NOT appear there (no empty buckets).
 *
 * Output shape:
 *
 *   {
 *     [location]: {
 *       target: string,
 *       action: string|undefined,
 *       auth_token: string|null,
 *       entries: {
 *         [modality]: { [valueLowercased]: <entry-object> }
 *       }
 *     }
 *   }
 *
 * @module domains/trigger/TriggerConfig
 */

import { ValidationError } from '#domains/core/errors/ValidationError.mjs';

export const ENTRIES_KEY_BY_TYPE = {
  nfc: 'tags',
  barcode: 'codes',
  voice: 'keywords',
  state: 'states',
};

function isPlainObject(v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

export function parseTriggerConfig(raw) {
  if (!raw) return {};
  if (!isPlainObject(raw)) {
    throw new ValidationError('trigger config must be an object', { code: 'INVALID_CONFIG_ROOT' });
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
    for (const [modality, entriesKey] of Object.entries(ENTRIES_KEY_BY_TYPE)) {
      if (!(entriesKey in locConfig)) continue;
      const rawEntries = locConfig[entriesKey];
      if (!isPlainObject(rawEntries)) {
        throw new ValidationError(`location "${location}" ${entriesKey} must be an object`, { code: 'INVALID_ENTRIES', field: location });
      }
      const modalityEntries = {};
      for (const [value, entry] of Object.entries(rawEntries)) {
        if (!isPlainObject(entry)) {
          throw new ValidationError(`${entriesKey.slice(0, -1)} "${value}" must be an object`, { code: 'INVALID_ENTRY', field: value });
        }
        modalityEntries[value.toLowerCase()] = entry;
      }
      entries[modality] = modalityEntries;
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
