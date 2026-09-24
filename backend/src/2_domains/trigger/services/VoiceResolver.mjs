/**
 * Voice resolver: maps a spoken keyword (or a transcript that normalizes to
 * one) at a location to that location's configured command intent.
 *
 * Layer: DOMAIN service (2_domains/trigger/services). Pure. The decision
 * model that maps free text to a command lives in the application layer
 * (VoiceCommandMatcher); this file only knows exact keywords.
 *
 * @module domains/trigger/services/VoiceResolver
 */

/**
 * Keyword form of a command id or a transcript: lowercase, every run of
 * non-letters/digits collapsed to '_', trimmed of '_'. "Play Jazz!" → "play_jazz".
 * @param {string} value
 * @returns {string}
 */
export function voiceKeyword(value) {
  return String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '_')
    .replace(/^_+|_+$/g, '');
}

const RESERVED_KEYS = new Set(['action', 'target', 'content', 'scene', 'service', 'entity', 'data', 'description']);
const PASSTHROUGH_KEYS = ['content', 'scene', 'service', 'entity', 'data'];

/**
 * @class VoiceResolver
 * @stateless
 */
export class VoiceResolver {
  /**
   * @param {Object} args
   * @param {string} args.location
   * @param {string} args.value     keyword or transcript
   * @param {Object} args.registry  the `voice` slice: { locations }
   * @returns {Object|null} intent (same shape as StateResolver) or null
   */
  static resolve({ location, value, registry }) {
    const locationConfig = registry?.locations?.[location];
    if (!locationConfig) return null;
    return VoiceResolver.intentFor(locationConfig, voiceKeyword(value));
  }

  /**
   * Intent for one command id at a location.
   * @param {Object} locationConfig  one entry of registry.voice.locations
   * @param {string} commandId       keyword-normalized id
   * @returns {Object|null}
   */
  static intentFor(locationConfig, commandId) {
    const commands = locationConfig?.commands ?? {};
    // hasOwn: an inherited key ("constructor", "__proto__") is not a command.
    if (!Object.hasOwn(commands, commandId)) return null;
    const entry = commands[commandId];
    if (!entry) return null;
    const params = {};
    for (const [k, v] of Object.entries(entry)) {
      if (!RESERVED_KEYS.has(k)) params[k] = v;
    }
    const intent = { action: entry.action, target: entry.target ?? locationConfig.target, params };
    for (const key of PASSTHROUGH_KEYS) {
      if (entry[key] !== undefined) intent[key] = entry[key];
    }
    return intent;
  }

  /**
   * The location's commands as choice options: id → description (null = self-explanatory id).
   * @param {Object} locationConfig
   * @returns {Object<string, string|null>}
   */
  static commandOptions(locationConfig) {
    const out = {};
    for (const [id, entry] of Object.entries(locationConfig?.commands || {})) {
      out[id] = typeof entry?.description === 'string' && entry.description.trim() ? entry.description.trim() : null;
    }
    return out;
  }
}

export default VoiceResolver;
