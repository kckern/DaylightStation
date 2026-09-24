/**
 * Parser for voice sources (sources.yml entries with `modality: voice`).
 *
 * Output shape:
 *   { [locationId]: { target, auth_token, routing: { mode, confidenceFloor }, commands: { [keyword]: entry } } }
 *
 * Command ids are normalized with voiceKeyword so `/voice/Play_Jazz`, the
 * transcript "play jazz" and the YAML key `play jazz` all meet at `play_jazz`.
 * `none` is reserved: it is the decision model's "no command" option.
 *
 * Layer: ADAPTER (1_adapters/trigger/parsers).
 * @module adapters/trigger/parsers/voiceLocationsParser
 */
import { ValidationError } from '#domains/core/errors/ValidationError.mjs';
import { voiceKeyword } from '#domains/trigger/services/VoiceResolver.mjs';

const ROUTING_MODES = new Set(['off', 'confirm', 'route']);
const RESERVED_COMMAND_IDS = new Set(['none']);

function isPlainObject(v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

function parseRouting(locationId, raw) {
  const routing = isPlainObject(raw) ? raw : {};
  const mode = routing.mode ?? 'confirm';
  if (!ROUTING_MODES.has(mode)) {
    throw new ValidationError(`voice location "${locationId}" routing.mode must be off|confirm|route`, { code: 'INVALID_ROUTING_MODE', field: locationId });
  }
  const floor = routing.confidence_floor ?? null;
  if (floor !== null && !(typeof floor === 'number' && floor >= 0 && floor <= 1)) {
    throw new ValidationError(`voice location "${locationId}" routing.confidence_floor must be a number 0..1`, { code: 'INVALID_CONFIDENCE_FLOOR', field: locationId });
  }
  return { mode, confidenceFloor: floor };
}

export function parseVoiceLocations(raw) {
  if (!raw) return {};
  if (!isPlainObject(raw)) {
    throw new ValidationError('voice sources must be an object', { code: 'INVALID_CONFIG_ROOT' });
  }
  const out = {};
  for (const [locationId, loc] of Object.entries(raw)) {
    if (!isPlainObject(loc)) {
      throw new ValidationError(`voice location "${locationId}" must be an object`, { code: 'INVALID_LOCATION', field: locationId });
    }
    if (typeof loc.target !== 'string' || loc.target.length === 0) {
      throw new ValidationError(`voice location "${locationId}" must declare a target device (non-empty string)`, { code: 'MISSING_TARGET', field: locationId });
    }
    if (!isPlainObject(loc.commands) || Object.keys(loc.commands).length === 0) {
      throw new ValidationError(`voice location "${locationId}" needs at least one command`, { code: 'MISSING_COMMANDS', field: locationId });
    }
    const commands = {};
    for (const [rawId, entry] of Object.entries(loc.commands)) {
      const id = voiceKeyword(rawId);
      if (!id || RESERVED_COMMAND_IDS.has(id)) {
        throw new ValidationError(`voice command "${rawId}" at "${locationId}" has a reserved or empty id`, { code: 'INVALID_COMMAND_ID', field: rawId });
      }
      if (!isPlainObject(entry) || typeof entry.action !== 'string' || entry.action.length === 0) {
        throw new ValidationError(`voice command "${rawId}" at "${locationId}" has no action`, { code: 'COMMAND_MISSING_ACTION', field: rawId });
      }
      if (commands[id]) {
        throw new ValidationError(`voice commands at "${locationId}" collide on "${id}"`, { code: 'DUPLICATE_COMMAND', field: rawId });
      }
      commands[id] = entry;
    }
    out[locationId] = {
      target: loc.target,
      auth_token: loc.auth_token ?? null,
      routing: parseRouting(locationId, loc.routing),
      commands,
    };
  }
  return out;
}

export default parseVoiceLocations;
