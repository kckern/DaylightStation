// durationClass.js — a LIGHT duration classifier for MIDI-entered notes on the
// Composer note-entry staff (task 27). This is explicitly NOT a rhythm/tempo
// detector: it buckets a note's raw held time (note_on -> note_off, in
// milliseconds) into one of three coarse classes and maps each straight to a
// notation type. No half/dotted output — dots/triplet stay a SEPARATE,
// user-driven flag (see useComposerInput.js's numpad "." key), independent of
// this classifier.
//
// Defaults below are a first-pass, defensible starting point — NOT tuned from
// real playing data yet. That is the point of the new
// `composer.input.note-duration` log this classifier feeds (see
// useComposerInput.js): once real held-duration data is collected, these
// thresholds can be retuned here without touching any call site.
//
//   short  (<SHORT_MAX_MS)   -> 16th     — a quick tap / fast passage note
//   medium (<MEDIUM_MAX_MS)  -> eighth   — a normal, unhurried press
//   long   (>=MEDIUM_MAX_MS) -> quarter  — a deliberately held note
//
// Picked against a moderate practice tempo (~100-120 bpm, quarter ≈500-600ms):
// an eighth note at that tempo is ~250-300ms, so MEDIUM_MAX_MS sits comfortably
// below a full quarter's duration; SHORT_MAX_MS separates a brief "tap" from a
// normally "played" note at roughly a sixteenth's share of the same beat.

/** Below this held-ms, a note classifies as 'short' (-> 16th). */
export const SHORT_MAX_MS = 150;
/** Below this held-ms (and >= SHORT_MAX_MS), a note classifies as 'medium' (-> eighth). Held-ms at or above this is 'long' (-> quarter). */
export const MEDIUM_MAX_MS = 450;

/**
 * class -> Composer note `type`. Intentionally only these three values (spec: no
 * half/dotted). NOTE: the model's canonical sixteenth-note type string is `'16th'`
 * (see MusicNotation/duration.js's TYPE_DIVISIONS and useComposerInput.js's own
 * DURATION_KEYS numpad map), NOT `'sixteenth'` — match it exactly, or
 * noteDivisions()/the serializer throw on "unsupported note type".
 */
export const DURATION_CLASS_TYPE = Object.freeze({
  short: '16th',
  medium: 'eighth',
  long: 'quarter',
});

/**
 * Classify a held-note duration (ms, note_on -> note_off) into a coarse bucket.
 * Pure, no side effects — deliberately simple ("light"), not a rhythm detector.
 * @param {number} heldMs
 * @returns {'short'|'medium'|'long'}
 */
export function classifyHeldMs(heldMs) {
  if (heldMs < SHORT_MAX_MS) return 'short';
  if (heldMs < MEDIUM_MAX_MS) return 'medium';
  return 'long';
}

/** Classify straight to the Composer note `type` (16th|eighth|quarter). */
export function classifyHeldMsToType(heldMs) {
  return DURATION_CLASS_TYPE[classifyHeldMs(heldMs)];
}
