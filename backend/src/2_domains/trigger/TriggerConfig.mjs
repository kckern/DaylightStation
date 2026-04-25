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

const ENTRIES_KEY_BY_TYPE = {
  nfc: 'tags',
  barcode: 'codes',
  voice: 'keywords',
};

function isPlainObject(v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

export function parseTriggerConfig(raw, type = 'nfc') {
  if (!raw) return {};
  if (!isPlainObject(raw)) {
    throw new Error('trigger config must be an object');
  }

  const entriesKey = ENTRIES_KEY_BY_TYPE[type];
  if (!entriesKey) {
    throw new Error(`Unknown trigger type: ${type}`);
  }

  const out = {};
  for (const [location, locConfig] of Object.entries(raw)) {
    if (!isPlainObject(locConfig)) {
      throw new Error(`location "${location}" must be an object`);
    }
    if (typeof locConfig.target !== 'string' || locConfig.target.length === 0) {
      throw new Error(`location "${location}" must declare a target device (string)`);
    }

    const entries = {};
    const rawEntries = locConfig[entriesKey] || {};
    if (!isPlainObject(rawEntries)) {
      throw new Error(`location "${location}" ${entriesKey} must be an object`);
    }
    for (const [value, entry] of Object.entries(rawEntries)) {
      if (!isPlainObject(entry)) {
        throw new Error(`${entriesKey.slice(0, -1)} "${value}" must be an object`);
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
