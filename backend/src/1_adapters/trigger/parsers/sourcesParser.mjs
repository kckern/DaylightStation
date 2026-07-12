/**
 * Parser for triggers/sources.yml. One map keyed by source id; each entry
 * carries `modality` (nfc|state) and optional `location` (defaults to key).
 * Partitions by modality and delegates per-entry validation to the existing
 * nfc/state location parsers by reconstructing their raw keyed-by-location shape.
 *
 * Guard mapping: guards.authenticate.secret -> auth_token;
 * guards.debounce.windowMs -> debounce_ms (carried, consumed later).
 *
 * Layer: ADAPTER (1_adapters/trigger/parsers).
 * @module adapters/trigger/parsers/sourcesParser
 */
import { ValidationError } from '#domains/core/errors/ValidationError.mjs';
import { parseNfcLocations } from './nfcLocationsParser.mjs';
import { parseStateLocations } from './stateLocationsParser.mjs';

function isPlainObject(v) { return v !== null && typeof v === 'object' && !Array.isArray(v); }

// Flatten a source entry into the shape the legacy per-entry parser expects
// (keyed by location, with auth_token/debounce_ms lifted out of guards).
function toLegacyEntry(entry) {
  const { modality, location, guards, ...rest } = entry;
  const legacy = { ...rest };
  const secret = guards?.authenticate?.secret ?? guards?.authenticate?.token;
  if (secret != null) legacy.auth_token = secret;
  const windowMs = guards?.debounce?.windowMs;
  if (windowMs != null) legacy.debounce_ms = windowMs;
  return legacy;
}

export function parseSources(raw) {
  if (!raw) return { nfc: { locations: {} }, state: { locations: {} }, barcode: { locations: {} } };
  if (!isPlainObject(raw)) {
    throw new ValidationError('sources.yml root must be an object', { code: 'INVALID_CONFIG_ROOT' });
  }
  const nfcRaw = {};
  const stateRaw = {};
  const barcodeRaw = {};
  for (const [sourceId, entry] of Object.entries(raw)) {
    if (!isPlainObject(entry)) {
      throw new ValidationError(`source "${sourceId}" must be an object`, { code: 'INVALID_SOURCE', field: sourceId });
    }
    const location = entry.location || sourceId;
    if (entry.modality === 'nfc') nfcRaw[location] = toLegacyEntry(entry);
    else if (entry.modality === 'state') stateRaw[location] = toLegacyEntry(entry);
    else if (entry.modality === 'barcode') {
      const legacy = toLegacyEntry(entry);
      barcodeRaw[location] = {
        target: legacy.target,
        default_action: legacy.default_action || legacy.action || 'queue',
        actions: legacy.actions || ['queue', 'play', 'open'],
      };
    }
    else throw new ValidationError(`source "${sourceId}" has unknown modality "${entry.modality}"`, { code: 'UNKNOWN_MODALITY', field: sourceId });
  }
  // parseNfcLocations strips unknown keys into `defaults`; debounce_ms lands there
  // harmlessly. Lift it back onto the location for later consumers.
  const nfcLocations = parseNfcLocations(nfcRaw);
  for (const loc of Object.keys(nfcLocations)) {
    if (nfcLocations[loc].defaults?.debounce_ms != null) {
      nfcLocations[loc].debounce_ms = nfcLocations[loc].defaults.debounce_ms;
      delete nfcLocations[loc].defaults.debounce_ms;
    }
  }
  return { nfc: { locations: nfcLocations }, state: { locations: parseStateLocations(stateRaw) }, barcode: { locations: barcodeRaw } };
}

export default parseSources;
