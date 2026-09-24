/**
 * Parser for triggers/sources.yml. One map keyed by source id; each entry
 * carries `modality` (nfc|state|barcode|voice) and optional `location` (defaults to key).
 * Partitions by modality and delegates per-entry validation to the existing
 * nfc/state location parsers by reconstructing their raw keyed-by-location shape.
 *
 * Guard mapping: guards.authenticate.secret -> auth_token;
 * guards.debounce.windowMs -> debounce_ms (carried, consumed later).
 *
 * PER-SOURCE ISOLATION. With `onSkip`, a source that cannot be parsed (not an
 * object, unknown modality, fails its modality's validation) is reported to
 * `onSkip({ kind: 'source', id, code, message })` and left out; every other
 * source still loads. Without it the parser is strict and throws, as before.
 * The boot path passes `onSkip`: one bad entry used to throw out of the whole
 * load and leave EVERY tag in the house unregistered.
 *
 * Layer: ADAPTER (1_adapters/trigger/parsers).
 * @module adapters/trigger/parsers/sourcesParser
 */
import { ValidationError } from '#domains/core/errors/ValidationError.mjs';
import { parseNfcLocations } from './nfcLocationsParser.mjs';
import { parseStateLocations } from './stateLocationsParser.mjs';
import { parseVoiceLocations } from './voiceLocationsParser.mjs';

const MODALITIES = ['nfc', 'state', 'barcode', 'voice'];

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

/**
 * Run one entry's parse. Strict (no onSkip): errors propagate. Lenient: a
 * ValidationError is reported and the entry dropped (returns undefined).
 */
export function isolateEntry(onSkip, kind, id, parse) {
  if (!onSkip) return parse();
  try {
    return parse();
  } catch (error) {
    if (!(error instanceof ValidationError)) throw error;
    onSkip({ kind, id, code: error.code || error.context?.code || null, message: error.message });
    return undefined;
  }
}

export function parseSources(raw, { onSkip = null } = {}) {
  if (!raw) return { nfc: { locations: {} }, state: { locations: {} }, barcode: { locations: {} }, voice: { locations: {} } };
  if (!isPlainObject(raw)) {
    throw new ValidationError('sources.yml root must be an object', { code: 'INVALID_CONFIG_ROOT' });
  }
  const nfcRaw = {};
  const stateRaw = {};
  const barcodeRaw = {};
  const nfcSourceOf = {};
  const stateSourceOf = {};
  const voiceRaw = {};
  const voiceSourceOf = {};
  for (const [sourceId, entry] of Object.entries(raw)) {
    const accepted = isolateEntry(onSkip, 'source', sourceId, () => {
      if (!isPlainObject(entry)) {
        throw new ValidationError(`source "${sourceId}" must be an object`, { code: 'INVALID_SOURCE', field: sourceId });
      }
      if (!MODALITIES.includes(entry.modality)) {
        throw new ValidationError(`source "${sourceId}" has unknown modality "${entry.modality}"`, { code: 'UNKNOWN_MODALITY', field: sourceId });
      }
      return true;
    });
    if (!accepted) continue;
    const location = entry.location || sourceId;
    if (entry.modality === 'nfc') { nfcRaw[location] = toLegacyEntry(entry); nfcSourceOf[location] = sourceId; }
    else if (entry.modality === 'state') { stateRaw[location] = toLegacyEntry(entry); stateSourceOf[location] = sourceId; }
    else if (entry.modality === 'voice') { voiceRaw[location] = toLegacyEntry(entry); voiceSourceOf[location] = sourceId; }
    else if (entry.modality === 'barcode') {
      const legacy = toLegacyEntry(entry);
      barcodeRaw[location] = {
        target: legacy.target,
        default_action: legacy.default_action || legacy.action || 'queue',
        actions: legacy.actions || ['queue', 'play', 'open'],
      };
    }
  }
  // Lenient: validate each location on its own so one bad entry drops alone.
  const perLocation = (rawMap, sourceOf, parse) => (onSkip
    ? Object.assign({}, ...Object.entries(rawMap).map(([loc, legacy]) =>
      isolateEntry(onSkip, 'source', sourceOf[loc] || loc, () => parse({ [loc]: legacy })) || {}))
    : parse(rawMap));
  // parseNfcLocations strips unknown keys into `defaults`; debounce_ms lands there
  // harmlessly. Lift it back onto the location for later consumers.
  const nfcLocations = perLocation(nfcRaw, nfcSourceOf, parseNfcLocations);
  for (const loc of Object.keys(nfcLocations)) {
    if (nfcLocations[loc].defaults?.debounce_ms != null) {
      nfcLocations[loc].debounce_ms = nfcLocations[loc].defaults.debounce_ms;
      delete nfcLocations[loc].defaults.debounce_ms;
    }
  }
  return {
    nfc: { locations: nfcLocations },
    state: { locations: perLocation(stateRaw, stateSourceOf, parseStateLocations) },
    barcode: { locations: barcodeRaw },
    voice: { locations: perLocation(voiceRaw, voiceSourceOf, parseVoiceLocations) },
  };
}

export default parseSources;
