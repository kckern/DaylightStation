/**
 * Typing tutor — pure engine (the drill's brains, no React, no I/O).
 * Barebones slice of the typing-tutor spec: Mode 1 (Drill) only — a target
 * line, live per-character correctness, running WPM + accuracy. No arcade, no
 * weak-key targeting, no persistence yet; those are named deferrals.
 *
 * Kept pure and separate from the view (the PianoSpaceInvaders convention) so
 * the stats and character-status logic are unit-testable without a DOM.
 */

/**
 * The barebones lesson set — hand-authorable data, ordered home-row → words →
 * a sentence, so nothing is letter-soup for long. A real curriculum would live
 * in `data/content/typing/{lessonId}.yml` (spec §3); these ship in code as the
 * minimal viable drill.
 */
export const LESSONS = [
  { id: 'home-row', label: 'Home row', text: 'asdf jkl; asdf jkl; fj dk sl a; fjdk sla;' },
  { id: 'home-words', label: 'Home-row words', text: 'a lad asks; all fall; a jak; dad asks a lass' },
  { id: 'top-row', label: 'Top row', text: 'the quick red fox; we type with ease; you require it' },
  { id: 'sentence', label: 'A sentence', text: 'The quick brown fox jumps over the lazy dog.' },
  { id: 'prose', label: 'Prose', text: 'Practice a little every day and your fingers learn the way.' },
];

/**
 * Per-character status of the typed attempt against the target.
 *
 * @param {string} target - the line to type
 * @param {string} typed - what has been typed so far
 * @returns {{statuses: Array<'correct'|'incorrect'|'pending'>, caret: number}}
 *   statuses is parallel to `target`; caret is the index of the next char to type.
 */
export function computeCharStatuses(target, typed) {
  const t = target ?? '';
  const y = typed ?? '';
  const statuses = [];
  for (let i = 0; i < t.length; i += 1) {
    if (i >= y.length) statuses.push('pending');
    else statuses.push(y[i] === t[i] ? 'correct' : 'incorrect');
  }
  return { statuses, caret: Math.min(y.length, t.length) };
}

/**
 * Running stats for a (possibly partial) attempt.
 *
 * WPM uses the standard 5-chars-per-word convention over correctly-typed
 * characters (so errors don't inflate speed). Accuracy is correct / typed.
 * With no elapsed time or nothing typed, WPM is 0 rather than Infinity/NaN.
 *
 * @param {string} target
 * @param {string} typed
 * @param {number} elapsedMs
 * @returns {{wpm:number, accuracy:number, correct:number, typed:number, done:boolean}}
 */
export function computeStats(target, typed, elapsedMs) {
  const t = target ?? '';
  const y = typed ?? '';
  let correct = 0;
  for (let i = 0; i < y.length && i < t.length; i += 1) {
    if (y[i] === t[i]) correct += 1;
  }
  const minutes = elapsedMs > 0 ? elapsedMs / 60000 : 0;
  const wpm = minutes > 0 ? Math.round((correct / 5) / minutes) : 0;
  const accuracy = y.length > 0 ? Math.round((correct / y.length) * 100) : 100;
  return { wpm, accuracy, correct, typed: y.length, done: y.length >= t.length && t.length > 0 };
}

/**
 * Accept a keystroke into the running `typed` string, applying the drill's
 * input rules. Printable single characters append; Backspace deletes one
 * (backspace is allowed in this barebones drill — the spec's no-backspace
 * default is a later config). Everything else (arrows, modifiers, Enter, Tab)
 * is ignored. Never grows past the target length.
 *
 * @param {string} typed - current typed string
 * @param {string} key - a KeyboardEvent.key value
 * @param {string} target - the target line (to cap length)
 * @returns {string} the next typed string
 */
export function applyKey(typed, key, target) {
  const y = typed ?? '';
  if (key === 'Backspace') return y.slice(0, -1);
  if (key.length === 1 && y.length < (target ?? '').length) return y + key;
  return y;
}
