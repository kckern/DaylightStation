import { shuffle, buildNotePool } from '../noteUtils.js';
import { PITCH_CLASS_NAMES } from '../theory/chordNaming.js';

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

  const available = shuffle([...buildNotePool(noteRange, whiteKeysOnly)]);

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

// ─── Chord-spelling cards ───────────────────────────────────────

/**
 * Chord qualities available to chord-spelling levels. Interval templates match
 * theory/chordNaming.js; suffixes follow its sharp-root symbol convention.
 * longName is the spelled-out form shown under the tab-style symbol.
 */
export const CHORD_QUALITIES = {
  major:      { intervals: [0, 4, 7],        suffix: '',     longName: 'major' },
  minor:      { intervals: [0, 3, 7],        suffix: 'm',    longName: 'minor' },
  diminished: { intervals: [0, 3, 6],        suffix: '°',    longName: 'diminished' },
  augmented:  { intervals: [0, 4, 8],        suffix: '+',    longName: 'augmented' },
  sus2:       { intervals: [0, 2, 7],        suffix: 'sus2', longName: 'suspended 2nd' },
  sus4:       { intervals: [0, 5, 7],        suffix: 'sus4', longName: 'suspended 4th' },
  dominant7:  { intervals: [0, 4, 7, 10],    suffix: '7',    longName: 'dominant 7th' },
  major7:     { intervals: [0, 4, 7, 11],    suffix: 'maj7', longName: 'major 7th' },
  minor7:     { intervals: [0, 3, 7, 10],    suffix: 'm7',   longName: 'minor 7th' },
  dominant9:  { intervals: [0, 2, 4, 7, 10], suffix: '9',    longName: 'dominant 9th' },
  major9:     { intervals: [0, 2, 4, 7, 11], suffix: 'maj9', longName: 'major 9th' },
  minor9:     { intervals: [0, 2, 3, 7, 10], suffix: 'm9',   longName: 'minor 9th' },
};

// Root-name lookup: sharp names from the theory module plus flat aliases, so
// piano.yml levels can say roots: [Bb, Eb] as naturally as [A#, D#].
const ROOT_NAME_TO_PC = Object.fromEntries([
  ...PITCH_CLASS_NAMES.map((n, pc) => [n, pc]),
  ['Db', 1], ['Eb', 3], ['Gb', 6], ['Ab', 8], ['Bb', 10],
]);

const ALL_ROOTS = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11];

/** Parse a level's roots list (note names or pitch-class numbers) → pitch classes. */
function parseRoots(roots) {
  const parsed = (roots ?? [])
    .map(r => (typeof r === 'number' ? ((r % 12) + 12) % 12 : ROOT_NAME_TO_PC[r]))
    .filter(pc => pc !== undefined);
  return parsed.length ? parsed : ALL_ROOTS;
}

/**
 * Generate a chord-spelling card: a random root from the level's root list + a
 * random quality from its allowed list, never the exact same (root, quality)
 * as prevCard unless that is the only combination available.
 *
 * @param {string[]} qualities - allowed CHORD_QUALITIES keys
 * @param {{root: number, quality: string}|null} [prevCard]
 * @param {Array<string|number>|null} [roots] - allowed roots (note names or 0–11); omit for all 12
 * @returns {{type: 'chord', root: number, rootName: string, quality: string, suffix: string, label: string, longLabel: string, pitchClasses: Set<number>}}
 */
export function generateChordCard(qualities, prevCard = null, roots = null) {
  const allowed = (qualities ?? []).filter(q => CHORD_QUALITIES[q]);
  const pool = allowed.length ? allowed : ['major'];
  const rootPool = parseRoots(roots);

  let root, quality;
  let attempts = 0;
  do {
    root = rootPool[Math.floor(Math.random() * rootPool.length)];
    quality = pool[Math.floor(Math.random() * pool.length)];
    attempts++;
  } while (
    prevCard && root === prevCard.root && quality === prevCard.quality
    && rootPool.length * pool.length > 1 && attempts < 24
  );

  const { intervals, suffix, longName } = CHORD_QUALITIES[quality];
  const rootName = PITCH_CLASS_NAMES[root];

  return {
    type: 'chord',
    root,
    rootName,
    quality,
    suffix,
    label: `${rootName}${suffix}`,
    longLabel: `${rootName} ${longName}`,
    pitchClasses: new Set(intervals.map(iv => (root + iv) % 12)),
  };
}

/**
 * Classify why a chord attempt evaluated 'wrong' — for telemetry.
 *
 * @param {Map<number, object>} activeNotes
 * @param {{root: number, pitchClasses: Set<number>}} card
 * @returns {'wrong-note'|'wrong-bass'}
 */
export function chordMissReason(activeNotes, card) {
  for (const [note] of activeNotes) {
    if (!card.pitchClasses.has(((note % 12) + 12) % 12)) return 'wrong-note';
  }
  return 'wrong-bass';
}

/**
 * Evaluate a chord-spelling attempt: octave-free but root-sensitive. Correct
 * means the held pitch classes exactly equal the chord's pitch-class set
 * (doubling allowed, no extras) AND the lowest held note is the root — a
 * complete chord over the wrong bass (Cm/Eb) is wrong, not correct.
 *
 * @param {Map<number, object>|null} activeNotes
 * @param {{root: number, pitchClasses: Set<number>}|null} card
 * @returns {'idle'|'correct'|'wrong'|'partial'}
 */
export function evaluateChordMatch(activeNotes, card) {
  if (!activeNotes || activeNotes.size === 0 || !card?.pitchClasses?.size) {
    return 'idle';
  }

  const heldClasses = new Set();
  let bass = Infinity;
  for (const [note] of activeNotes) {
    heldClasses.add(((note % 12) + 12) % 12);
    if (note < bass) bass = note;
  }

  for (const pc of heldClasses) {
    if (!card.pitchClasses.has(pc)) return 'wrong';
  }

  const complete = [...card.pitchClasses].every(pc => heldClasses.has(pc));
  if (complete) {
    return ((bass % 12) + 12) % 12 === card.root ? 'correct' : 'wrong';
  }

  return 'partial';
}

/**
 * Root-position MIDI voicing for a chord card, rooted in the C4 octave —
 * used to highlight the answer on the keyboard after a hit.
 *
 * @param {{root: number, quality: string}} card
 * @param {number} [baseMidi=60] - MIDI note of the octave's C
 * @returns {number[]}
 */
export function rootPositionVoicing(card, baseMidi = 60) {
  const intervals = CHORD_QUALITIES[card.quality]?.intervals ?? [0];
  return intervals.map(iv => baseMidi + card.root + iv);
}

/**
 * Resolve a user's starting level index from the flashcards config.
 *
 * @param {Array<{name?: string}>} levels
 * @param {Object<string, string>|null|undefined} userStartLevels - user id → level name
 * @param {string|null|undefined} currentUser
 * @returns {number} level index (0 when no per-user start applies)
 */
export function resolveStartLevel(levels, userStartLevels, currentUser) {
  const levelName = currentUser ? userStartLevels?.[currentUser] : null;
  if (!levelName) return 0;
  const idx = (levels ?? []).findIndex(l => l?.name === levelName);
  return idx >= 0 ? idx : 0;
}
