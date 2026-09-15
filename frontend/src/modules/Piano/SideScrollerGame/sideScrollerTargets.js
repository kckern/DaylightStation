/**
 * Note targets for the side-scroller's action staves.
 *
 * Up to three actions — jump (top staff), duck (bottom staff) and, on levels
 * that spawn blocks, shoot (top band beside jump). The pitch sets never share a
 * note, so holding one action's chord can never fire another.
 */
import { shuffle, buildNotePool } from '../noteUtils.js';

export const MIN_ACTION_SEPARATION = 4; // Minimum semitones between notes of different actions

const NOTES_PER_ACTION = { single: 1, dyad: 2, triad: 3 };

/**
 * Take `count` unused notes from an already-shuffled pool, preferring notes at
 * least MIN_ACTION_SEPARATION from every note in `avoid`. Marks them used.
 */
function take(pool, count, used, avoid) {
  const free = pool.filter((n) => !used.has(n));
  const separated = free.filter((n) => avoid.every((a) => Math.abs(n - a) >= MIN_ACTION_SEPARATION));
  const chosen = (separated.length >= count ? separated : free).slice(0, count);
  chosen.forEach((n) => used.add(n));
  return chosen;
}

/**
 * @param {[number, number]} noteRange - [low, high] MIDI range (inclusive)
 * @param {'single'|'dyad'|'triad'} complexity - notes per action
 * @param {boolean} whiteKeysOnly
 * @param {{ shoot?: boolean }} [opts] - include a shoot target
 * @returns {{ jump: number[], duck: number[], shoot?: number[] }}
 */
export function generateScrollerTargets(noteRange, complexity, whiteKeysOnly, { shoot = false } = {}) {
  let count = NOTES_PER_ACTION[complexity] || 1;
  const available = shuffle([...buildNotePool(noteRange, whiteKeysOnly)]);
  const used = new Set();

  // Separate by clef: treble (>= 60 / C4) feeds the top staves (jump, shoot),
  // bass (< 60) feeds duck on the bottom staff.
  const trebleNotes = available.filter((n) => n >= 60);
  const bassNotes = available.filter((n) => n < 60);
  const topActions = shoot ? 2 : 1;

  if (bassNotes.length >= count && trebleNotes.length >= count * topActions) {
    const duck = take(bassNotes, count, used, []);
    const jump = take(trebleNotes, count, used, []);
    return shoot ? { jump, duck, shoot: take(trebleNotes, count, used, jump) } : { jump, duck };
  }

  // All in one clef — pick from the shuffled pool, keeping actions apart.
  if (available.length < count * (shoot ? 3 : 2)) count = 1;
  return assignOneClef(available, count, shoot);
}

/** True when every note of every action is MIN_ACTION_SEPARATION from every other action's. */
function actionsApart(targets) {
  const actions = Object.values(targets);
  return actions.every((notes, i) => actions.slice(i + 1).every((other) => (
    notes.every((n) => other.every((o) => Math.abs(n - o) >= MIN_ACTION_SEPARATION))
  )));
}

/**
 * One clef, several actions. Greedy picks can paint themselves into a corner —
 * duck E♭4 and jump A4 leave no note in the octave four semitones from both —
 * so a few reshuffles are tried before settling for the closest the pool gave.
 */
const ONE_CLEF_ATTEMPTS = 8;
function assignOneClef(pool, count, shoot) {
  let last = null;
  for (let attempt = 0; attempt < ONE_CLEF_ATTEMPTS; attempt += 1) {
    const order = attempt === 0 ? pool : shuffle([...pool]);
    const used = new Set();
    const duck = take(order, count, used, []);
    const jump = take(order, count, used, duck);
    last = shoot
      ? { jump, duck, shoot: take(order, count, used, [...duck, ...jump]) }
      : { jump, duck };
    if (actionsApart(last)) return last;
  }
  return last;
}
