import { isWhiteKey } from '../noteUtils.js';

/**
 * Fisher-Yates shuffle (in-place).
 */
function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

/**
 * Generate random pitches for a flashcard.
 *
 * @param {[number, number]} noteRange - [low, high] inclusive MIDI range
 * @param {'single'|'dyad'|'triad'} complexity
 * @param {boolean} whiteKeysOnly
 * @returns {number[]} array of MIDI pitches
 */
export function generateCardPitches(noteRange, complexity = 'single', whiteKeysOnly = false) {
  const counts = { single: 1, dyad: 2, triad: 3 };
  let count = counts[complexity] || 1;

  const [low, high] = noteRange;
  const available = [];
  for (let n = low; n <= high; n++) {
    if (whiteKeysOnly && !isWhiteKey(n)) continue;
    available.push(n);
  }
  shuffle(available);

  // Clamp count to available notes
  count = Math.min(count, available.length);

  return available.slice(0, count);
}

/**
 * Evaluate a chord match attempt.
 *
 * @param {Map<number, object>|null} activeNotes - currently held MIDI notes
 * @param {number[]|null} targetPitches - pitches the player must press
 * @returns {'idle'|'correct'|'wrong'|'partial'}
 */
export function evaluateMatch(activeNotes, targetPitches) {
  if (!activeNotes || activeNotes.size === 0 || !targetPitches?.length) {
    return 'idle';
  }

  const targetSet = new Set(targetPitches);
  let correctCount = 0;
  let hasWrong = false;

  for (const [note] of activeNotes) {
    if (targetSet.has(note)) correctCount++;
    else hasWrong = true;
  }

  if (correctCount === targetPitches.length) {
    return 'correct';
  }

  if (hasWrong) {
    return 'wrong';
  }

  if (correctCount > 0) {
    return 'partial';
  }

  return 'idle';
}
