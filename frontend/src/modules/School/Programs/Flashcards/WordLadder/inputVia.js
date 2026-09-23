/**
 * How the child did the last thing (spec §8 `input`). One module-level note,
 * written centrally — by `useWordLadderKeys` when a mapped key fires its
 * action, and by the program root's capture listeners for a touch on any
 * button (TouchButton included) or an Enter that submits a field — and read
 * by whatever logs an answer, an advance, a skip or a clip:
 *
 *   'key:Space' | 'key:Enter' | 'key:Tab' | 'key:Backslash' | 'key:ArrowLeft'
 *   | 'key:<letter or digit>' | 'touch'
 *
 * Only the latest input is kept, never a history: nothing here logs, so
 * there is no per-keystroke volume. A note older than INPUT_WINDOW_MS reads as
 * null — whatever happens then was not the child's doing (an autoplay, a
 * server-timed advance).
 */
export const INPUT_WINDOW_MS = 1500;

let last = null; // { via, at }

const NAMED = { Space: 'Space', Enter: 'Enter', NumpadEnter: 'Enter', Tab: 'Tab', Backslash: 'Backslash', ArrowLeft: 'ArrowLeft' };

/** A key's name from its physical `code` (the Portal's keyboard may be on a Korean layout), else from `key`. */
export function keyLabel(event) {
  const code = event?.code;
  if (typeof code === 'string') {
    if (NAMED[code]) return NAMED[code];
    if (/^Key[A-Z]$/.test(code)) return code.slice(3);
    if (/^Digit[0-9]$/.test(code)) return code.slice(5);
  }
  const key = event?.key;
  if (key === ' ') return 'Space';
  if (typeof key === 'string' && key.length === 1) return key.toUpperCase();
  return typeof key === 'string' ? key : null;
}

export function noteInput(via) {
  last = via ? { via, at: Date.now() } : null;
}

export function noteKeyEvent(event) {
  const label = keyLabel(event);
  if (label) noteInput(`key:${label}`);
}

/** The last input, or null when there was none within `maxAgeMs`. */
export function currentInput(maxAgeMs = INPUT_WINDOW_MS) {
  if (!last || Date.now() - last.at > maxAgeMs) return null;
  return last.via;
}

/** Test/unmount helper. */
export function resetInput() { last = null; }
