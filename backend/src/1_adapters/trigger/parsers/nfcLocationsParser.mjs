/**
 * Parser for the NFC reader locations of triggers/sources.yml — the `modality:
 * nfc` entries, handed here keyed by location by sourcesParser.parseSources.
 * There is no triggers/nfc/locations.yml; that path predates the sources.yml
 * layout and nothing loads it, so don't go editing one.
 *
 * Each key is an NFC reader location ID. Reserved fields (target, action,
 * learner_action, auth_token, notify_unknown, end, end_location) are extracted
 * as first-class config; all other keys become the location's `defaults`
 * object, which inherits into every tag scanned at this reader.
 *
 * Layer: ADAPTER (1_adapters/trigger).
 *
 * Output shape:
 *   { [locationId]: { target, action, learner_action, auth_token, notify_unknown, end, end_location, defaults: { ...rest } } }
 *
 * @module adapters/trigger/parsers/nfcLocationsParser
 */

import { ValidationError } from '#domains/core/errors/ValidationError.mjs';

const RESERVED = new Set(['target', 'action', 'auth_token', 'notify_unknown', 'end', 'end_location', 'learner_action']);
export const ALLOWED_END_BEHAVIORS = new Set(['tv-off', 'clear', 'nothing']);

function isPlainObject(v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

export function parseNfcLocations(raw) {
  if (!raw) return {};
  if (!isPlainObject(raw)) {
    throw new ValidationError('nfc locations must be an object', { code: 'INVALID_CONFIG_ROOT' });
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
    // An empty learner_action is the trap worth catching: it reads as
    // "declared" to whoever is scanning the YAML, but it is falsy to the
    // resolver, so the reader behaves as though it had none. Refuse it, and
    // `!learner_action` downstream can only mean "not declared here".
    // An explicit null IS that declaration, and stays legal.
    if (locConfig.learner_action !== undefined && locConfig.learner_action !== null
        && (typeof locConfig.learner_action !== 'string' || locConfig.learner_action.trim().length === 0)) {
      throw new ValidationError(
        `location "${locationId}" learner_action must be a non-empty string (or omitted)`,
        { code: 'INVALID_LEARNER_ACTION', field: locationId }
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
      // What a SCHOOL LEARNER CARD means at this reader. The card names the
      // person; the reader decides what happens to them — print an agenda in
      // the study, open a reading session in the living room. Null means a
      // learner card is simply not actionable here — the intent is that it then
      // falls to the ordinary unknown-tag capture rather than a wrong action.
      // NfcResolver honours that on BOTH ingress doors: the bus ingress
      // (`nfcTapIngress`) is transport-only and no longer forks on
      // `school_learner` ahead of the resolver.
      // Trimmed, because the guard above validated the TRIMMED value: storing
      // the raw one let ' print-agenda ' pass as declared and then key nothing.
      learner_action: typeof locConfig.learner_action === 'string' ? locConfig.learner_action.trim() : (locConfig.learner_action ?? null),
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
