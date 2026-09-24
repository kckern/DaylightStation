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
