import { FILES, RANKS, isSquare } from '@shared-gaming/chess/index.mjs';

/**
 * Addressing squares by READING instead of by spelling.
 *
 * A player who can read both clefs but cannot yet spell a chord is locked out of
 * chord addressing entirely — and that is most beginners, for years. This scheme
 * gives them the same board through the skill they do have: the rank is a note on
 * the bass staff, the file is a note on the treble staff, and a square is the two
 * played together. Left hand picks the row, right hand picks the column.
 *
 * It is not a simplification of chord addressing, it is a different vocabulary for
 * the same 64 squares, so every other part of the game — narrowing, hover, pick-up,
 * destination badges, the record — works unchanged.
 *
 * Both sets are one diatonic octave of naturals, which is exactly what a first
 * reading method covers and keeps every square inside a comfortable two-hand span.
 *
 * Sequential by default, because a scale is the thing being learnt. The existing
 * `shuffle_each_turn` config re-deals both axes exactly as it does for chords —
 * the scheme is two arrays either way — which turns the board into a sight-
 * reading drill rather than a memorised layout.
 */

/** Treble staff, middle C to the C above — the files, left to right. */
const TREBLE = Object.freeze([60, 62, 64, 65, 67, 69, 71, 72]);
/**
 * Bass staff, the ranks, 1 (White's home) at the bottom.
 *
 * Runs down from the B under middle C to the B an octave below it, so the two
 * axes are contiguous: the board spans B2 to C5 without a gap, and no note in
 * the player's reach belongs to neither axis. Like the files, it starts and
 * ends on the same letter — see `axisIndex` for how a played B is resolved.
 */
const BASS = Object.freeze([47, 48, 50, 52, 53, 55, 57, 59]);

/**
 * Middle C is the split, and it belongs to the treble.
 *
 * Everything at or above it selects a FILE; everything below it selects a RANK.
 * One boundary, stated once, so a player never has to wonder which hand a note
 * counted as — and it is the boundary they already know from reading.
 */
export const SPLIT_MIDI = 60;

export const DEFAULT_STAFF_SCHEME = Object.freeze({
  id: 'grand-staff-naturals-v1',
  kind: 'staff',
  // Same key names as a chord scheme so the shuffle, the board walk, and the
  // rim-label plumbing need no branch: `roots` addresses files, `qualities`
  // addresses ranks, whatever the values happen to mean.
  roots: TREBLE,
  qualities: BASS,
});

export const isStaffScheme = (scheme) => scheme?.kind === 'staff';

const LETTERS = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

/** Letter name of a MIDI note, without its octave — what a badge has room for. */
export function noteLetter(midi) {
  if (!Number.isFinite(midi)) return null;
  return LETTERS[((midi % 12) + 12) % 12];
}

/** Letter name with its octave number, for anywhere that has the room. */
export function noteName(midi) {
  if (!Number.isFinite(midi)) return null;
  return `${noteLetter(midi)}${Math.floor(midi / 12) - 1}`;
}

/**
 * Square -> the two notes that address it.
 *
 * Shaped like a chord address (`symbol`, `pitch_classes`) so consumers that only
 * want something to print or compare do not need to know which scheme they hold.
 * `symbol` reads treble-over-bass — the right hand written above the left, as on
 * the staff.
 */
export function squareToStaffAddress(square, scheme = DEFAULT_STAFF_SCHEME) {
  if (!isSquare(square)) return null;
  const treble = scheme.roots[FILES.indexOf(square[0])];
  const bass = scheme.qualities[RANKS.indexOf(square[1])];
  if (!Number.isFinite(treble) || !Number.isFinite(bass)) return null;
  return {
    square,
    kind: 'staff',
    root: treble,
    quality: bass,
    treble,
    bass,
    midis: [bass, treble],
    name: `${noteName(treble)} over ${noteName(bass)}`,
    symbol: `${noteLetter(treble)}/${noteLetter(bass)}`,
    pitch_classes: [...new Set([bass, treble].map((n) => ((n % 12) + 12) % 12))].sort((a, b) => a - b),
  };
}

/** The two notes -> the square they address, or null when they address none. */
export function staffToSquare(treble, bass, scheme = DEFAULT_STAFF_SCHEME) {
  const file = scheme.roots.indexOf(treble);
  const rank = scheme.qualities.indexOf(bass);
  if (file < 0 || rank < 0) return null;
  return `${FILES[file]}${RANKS[rank]}`;
}

/**
 * Which slot on an axis does this note name?
 *
 * By LETTER, not by exact pitch: a player reaching for the D column should get
 * it whether they play the D on the staff or the D an octave up, and being
 * marked wrong for the octave teaches nothing about the board.
 *
 * The one place the octave does decide is the letter that appears twice. Each
 * axis spans a full octave, so it starts and ends on C — the first column is
 * middle C and the last is the C above it. A played C is therefore genuinely
 * ambiguous, and the only honest tiebreak is which of the two the player was
 * actually nearer to.
 */
export function axisIndex(midi, axis) {
  const pc = ((midi % 12) + 12) % 12;
  const matches = axis
    .map((note, index) => ({ note, index }))
    .filter((entry) => ((entry.note % 12) + 12) % 12 === pc);
  if (!matches.length) return -1;
  if (matches.length === 1) return matches[0].index;
  return matches.reduce((best, entry) => (
    Math.abs(entry.note - midi) < Math.abs(best.note - midi) ? entry : best
  )).index;
}

/**
 * Which square did those keys mean?
 *
 * Exact notes, not pitch classes: the octave is the whole point of reading, and
 * C4 and C5 are different lines on the staff.
 *
 * Exactly one note from each staff, and nothing else sounding. The strictness is
 * what keeps the escape reachable: an octave played within one hand puts two
 * notes on the SAME staff, which is not an address, so it still reads as "put it
 * back" — while a cross-staff octave like C2-with-C4 is simply the square those
 * two lines name.
 */
export function identifyStaffAddress(midiNotes, scheme = DEFAULT_STAFF_SCHEME) {
  const notes = [...new Set((Array.isArray(midiNotes) ? midiNotes : []).filter(Number.isFinite))];
  const pitch_classes = [...new Set(notes.map((n) => ((n % 12) + 12) % 12))].sort((a, b) => a - b);
  if (notes.length !== 2) return { square: null, candidates: [], pitch_classes };

  const above = notes.filter((note) => note >= SPLIT_MIDI);
  const below = notes.filter((note) => note < SPLIT_MIDI);
  if (above.length !== 1 || below.length !== 1) return { square: null, candidates: [], pitch_classes };

  const file = axisIndex(above[0], scheme.roots);
  const rank = axisIndex(below[0], scheme.qualities);
  if (file < 0 || rank < 0) return { square: null, candidates: [], pitch_classes };
  const square = `${FILES[file]}${RANKS[rank]}`;
  return {
    square,
    candidates: [{ square, symbol: squareToStaffAddress(square, scheme).symbol, root_in_bass: true }],
    pitch_classes,
  };
}

/**
 * Which squares are still possible given what is held.
 *
 * One note is half an address, and which half is visible on the board: a bass
 * note lights its whole rank, a treble note lights its whole file. That is a
 * better first lesson than the chord scheme's scatter, because the player can
 * see the row and column meet.
 */
export function staffCandidateSquares(heldNotes, scheme = DEFAULT_STAFF_SCHEME) {
  const notes = [...new Set((heldNotes || []).filter(Number.isFinite))];
  if (!notes.length) return [];
  const above = notes.filter((note) => note >= SPLIT_MIDI);
  const below = notes.filter((note) => note < SPLIT_MIDI);
  if (above.length > 1 || below.length > 1) return [];
  const fileIndex = above.length ? axisIndex(above[0], scheme.roots) : null;
  const rankIndex = below.length ? axisIndex(below[0], scheme.qualities) : null;
  // A note that is not one of the eight letters is not on the way to a square.
  if (fileIndex === -1 || rankIndex === -1) return [];
  const files = fileIndex === null ? FILES : [FILES[fileIndex]];
  const ranks = rankIndex === null ? RANKS : [RANKS[rankIndex]];
  const squares = [];
  for (const file of files) for (const rank of ranks) squares.push(`${file}${rank}`);
  return squares.sort();
}

/**
 * A staff scheme cannot collide with itself: every square is a distinct PAIR of
 * notes drawn from two disjoint sets, so distinctness is structural rather than
 * something to verify chord by chord. What can go wrong is an overlap between the
 * two staves, which would make one note ambiguous about which axis it names.
 */
export function validateStaffScheme(scheme) {
  const errors = [];
  const { roots: treble, qualities: bass } = scheme || {};
  if (!Array.isArray(treble) || treble.length !== 8) errors.push('a staff scheme needs 8 treble notes');
  if (!Array.isArray(bass) || bass.length !== 8) errors.push('a staff scheme needs 8 bass notes');
  if (errors.length) return { valid: false, errors };
  if (!treble.every(Number.isFinite) || !bass.every(Number.isFinite)) errors.push('staff notes must be MIDI numbers');
  if (new Set(treble).size !== 8) errors.push('the treble notes repeat');
  if (new Set(bass).size !== 8) errors.push('the bass notes repeat');
  const overlap = treble.filter((note) => bass.includes(note));
  if (overlap.length) errors.push(`a note cannot be on both staves: ${overlap.map(noteName).join(', ')}`);
  // The escape stays reachable only while some same-pitch-class octave pair is
  // NOT an address; two notes in one hand, both on the same staff, always is.
  if (bass.some((low) => treble.includes(low + 12) || treble.includes(low + 24))) {
    // Allowed, and deliberately so — see identifyStaffAddress: a cross-staff
    // octave reads as its square, and the escape is played within one staff.
  }
  return { valid: errors.length === 0, errors };
}

export default {
  DEFAULT_STAFF_SCHEME, SPLIT_MIDI, isStaffScheme, squareToStaffAddress, staffToSquare,
  identifyStaffAddress, staffCandidateSquares, validateStaffScheme, axisIndex, noteLetter, noteName,
};
