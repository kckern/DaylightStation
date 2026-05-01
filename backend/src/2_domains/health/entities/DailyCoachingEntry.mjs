/**
 * DailyCoachingEntry Value Object (PRD F-001)
 *
 * Represents the `coaching` field inside a daily health entry. Captures three
 * optional sections used by the personalized pattern-aware coaching feature:
 *
 *   - post_workout_protein: did the user take their post-workout protein?
 *   - daily_strength_micro: a single small strength movement and rep count
 *   - daily_note:           a short free-form journal note (<=200 chars)
 *
 * Shape (YAML on disk):
 *
 *   coaching:
 *     post_workout_protein:
 *       taken: true
 *       timestamp: "07:15"        # optional
 *       source: "shake_brand"     # optional
 *     daily_strength_micro:
 *       movement: "pull_up"
 *       reps: 5
 *     daily_note: "felt heavy"     # optional
 *
 * All three sections are optional. Absent sections are stored as `null` on the
 * instance and are omitted from `serialize()`.
 *
 * @module domains/health/entities
 */

const VALID_TOP_LEVEL_KEYS = new Set([
  'post_workout_protein',
  'daily_strength_micro',
  'daily_note',
]);

const VALID_PROTEIN_KEYS = new Set(['taken', 'timestamp', 'source']);
const VALID_STRENGTH_KEYS = new Set(['movement', 'reps']);

const DAILY_NOTE_MAX_LENGTH = 200;

export class DailyCoachingEntry {
  /**
   * @param {Object} [raw] - Raw object as parsed from YAML. May be empty.
   */
  constructor(raw = {}) {
    if (raw === null || raw === undefined) raw = {};
    if (typeof raw !== 'object' || Array.isArray(raw)) {
      throw new TypeError('DailyCoachingEntry expects an object');
    }
    for (const key of Object.keys(raw)) {
      if (!VALID_TOP_LEVEL_KEYS.has(key)) {
        throw new Error(`DailyCoachingEntry: unknown top-level key "${key}"`);
      }
    }
    this.postWorkoutProtein = this.#parseProtein(raw.post_workout_protein);
    this.dailyStrengthMicro = this.#parseStrength(raw.daily_strength_micro);
    this.dailyNote = this.#parseNote(raw.daily_note);
  }

  /**
   * Convert to a YAML-shaped plain object for persistence.
   * Only present (non-null) sections are included.
   * @returns {Object}
   */
  serialize() {
    const out = {};
    if (this.postWorkoutProtein !== null) {
      out.post_workout_protein = { ...this.postWorkoutProtein };
    }
    if (this.dailyStrengthMicro !== null) {
      out.daily_strength_micro = { ...this.dailyStrengthMicro };
    }
    if (this.dailyNote) {
      out.daily_note = this.dailyNote;
    }
    return out;
  }

  #parseProtein(raw) {
    if (raw === undefined || raw === null) return null;
    if (typeof raw !== 'object' || Array.isArray(raw)) {
      throw new TypeError('DailyCoachingEntry.post_workout_protein must be an object');
    }
    for (const key of Object.keys(raw)) {
      if (!VALID_PROTEIN_KEYS.has(key)) {
        throw new Error(`DailyCoachingEntry.post_workout_protein: unknown key "${key}"`);
      }
    }
    if (typeof raw.taken !== 'boolean') {
      throw new TypeError(
        'DailyCoachingEntry.post_workout_protein.taken must be a boolean (strict — no string coercion)'
      );
    }
    const out = { taken: raw.taken };
    if (raw.timestamp !== undefined) {
      if (typeof raw.timestamp !== 'string') {
        throw new TypeError('DailyCoachingEntry.post_workout_protein.timestamp must be a string');
      }
      out.timestamp = raw.timestamp;
    }
    if (raw.source !== undefined) {
      if (typeof raw.source !== 'string') {
        throw new TypeError('DailyCoachingEntry.post_workout_protein.source must be a string');
      }
      out.source = raw.source;
    }
    return out;
  }

  #parseStrength(raw) {
    if (raw === undefined || raw === null) return null;
    if (typeof raw !== 'object' || Array.isArray(raw)) {
      throw new TypeError('DailyCoachingEntry.daily_strength_micro must be an object');
    }
    for (const key of Object.keys(raw)) {
      if (!VALID_STRENGTH_KEYS.has(key)) {
        throw new Error(`DailyCoachingEntry.daily_strength_micro: unknown key "${key}"`);
      }
    }
    if (typeof raw.movement !== 'string' || raw.movement.length === 0) {
      throw new TypeError(
        'DailyCoachingEntry.daily_strength_micro.movement must be a non-empty string'
      );
    }
    if (
      typeof raw.reps !== 'number' ||
      !Number.isInteger(raw.reps) ||
      raw.reps < 0
    ) {
      throw new TypeError(
        'DailyCoachingEntry.daily_strength_micro.reps must be a non-negative integer'
      );
    }
    return { movement: raw.movement, reps: raw.reps };
  }

  #parseNote(raw) {
    if (raw === undefined || raw === null) return null;
    if (typeof raw !== 'string') {
      throw new TypeError('DailyCoachingEntry.daily_note must be a string');
    }
    const trimmed = raw.trim();
    if (trimmed.length === 0) return null;
    if (trimmed.length > DAILY_NOTE_MAX_LENGTH) {
      throw new RangeError(
        `DailyCoachingEntry.daily_note exceeds ${DAILY_NOTE_MAX_LENGTH} chars (got ${trimmed.length})`
      );
    }
    return trimmed;
  }
}

export default DailyCoachingEntry;
