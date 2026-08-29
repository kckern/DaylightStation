import { FILES, RANKS, isSquare } from '@shared-gaming/rulesets/chess/index.mjs';

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
 * `addressing.shuffle: each_turn` re-deals both axes exactly as it does for chords —
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

export const staffTokenNotes = (token) => (Array.isArray(token) ? token : [token]).filter(Number.isFinite);
const tokenKey = (token) => staffTokenNotes(token).slice().sort((a, b) => a - b).join(',');
const scalarScheme = (scheme) => [...(scheme?.roots || []), ...(scheme?.qualities || [])].every(Number.isFinite);

/**
 * Where THIS scheme's two axes part company.
 *
 * Middle C is the split for the grand-staff default, and stating it as a
 * constant was right for exactly as long as `grand` was the only pair. A
 * treble-only scheme stacks both axes above middle C and a bass-only one puts
 * both below it, so a fixed boundary sends every note to the same axis and the
 * board stops answering.
 *
 * Derived instead: the two axes occupy disjoint ranges by construction (see
 * `materialFor`), so the boundary is the midpoint of the gap between them, and
 * which side is which falls out of the same comparison. Returns `null` when the
 * ranges overlap — a scheme whose axes share pitches cannot be split, and a
 * caller that gets null should refuse the address rather than guess.
 */
export function splitFor(scheme = DEFAULT_STAFF_SCHEME) {
  const x = scheme?.roots;
  const y = scheme?.qualities;
  if (!Array.isArray(x) || !Array.isArray(y) || !x.length || !y.length) return null;
  const xNotes = x.flatMap(staffTokenNotes);
  const yNotes = y.flatMap(staffTokenNotes);
  if (!xNotes.length || !yNotes.length) return null;
  const xLow = Math.min(...xNotes);
  const xHigh = Math.max(...xNotes);
  const yLow = Math.min(...yNotes);
  const yHigh = Math.max(...yNotes);
  // Files above ranks — the grand-staff arrangement, and treble-only/bass-only.
  if (yHigh < xLow) return { boundary: Math.ceil((yHigh + xLow) / 2), filesAbove: true };
  // Ranks above files — `inverted`, where the left hand picks the file.
  if (xHigh < yLow) return { boundary: Math.ceil((xHigh + yLow) / 2), filesAbove: false };
  return null;
}

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
  if (Array.isArray(midi)) return midi.map(noteLetter).filter(Boolean).join('–');
  if (!Number.isFinite(midi)) return null;
  return LETTERS[((midi % 12) + 12) % 12];
}

/** Letter name with its octave number, for anywhere that has the room. */
export function noteName(midi) {
  if (Array.isArray(midi)) return midi.map(noteName).filter(Boolean).join('–');
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
  const trebleNotes = staffTokenNotes(treble);
  const bassNotes = staffTokenNotes(bass);
  if (!trebleNotes.length || !bassNotes.length) return null;
  return {
    square,
    kind: 'staff',
    root: treble,
    quality: bass,
    treble,
    bass,
    midis: [...bassNotes, ...trebleNotes],
    name: `${noteName(treble)} over ${noteName(bass)}`,
    symbol: `${noteLetter(treble)}/${noteLetter(bass)}`,
    pitch_classes: [...new Set([...bassNotes, ...trebleNotes].map((n) => ((n % 12) + 12) % 12))].sort((a, b) => a - b),
  };
}

/** The two notes -> the square they address, or null when they address none. */
export function staffToSquare(treble, bass, scheme = DEFAULT_STAFF_SCHEME) {
  const file = scheme.roots.findIndex((token) => tokenKey(token) === tokenKey(treble));
  const rank = scheme.qualities.findIndex((token) => tokenKey(token) === tokenKey(bass));
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
  if (!scalarScheme(scheme)) {
    const held = notes.slice().sort((a, b) => a - b).join(',');
    for (let file = 0; file < scheme.roots.length; file += 1) {
      for (let rank = 0; rank < scheme.qualities.length; rank += 1) {
        const expected = [...new Set([
          ...staffTokenNotes(scheme.roots[file]), ...staffTokenNotes(scheme.qualities[rank]),
        ])].sort((a, b) => a - b);
        if (expected.join(',') !== held) continue;
        const square = `${FILES[file]}${RANKS[rank]}`;
        return { square, candidates: [{ square, symbol: squareToStaffAddress(square, scheme).symbol, root_in_bass: true }], pitch_classes };
      }
    }
    return { square: null, candidates: [], pitch_classes };
  }
  if (notes.length !== 2) return { square: null, candidates: [], pitch_classes };

  const split = splitFor(scheme);
  // A scheme whose axes overlap cannot say which axis a note belongs to. Refuse
  // the address rather than guess — a wrong square committed is worse than a
  // press that did nothing.
  if (!split) return { square: null, candidates: [], pitch_classes };
  const above = notes.filter((note) => note >= split.boundary);
  const below = notes.filter((note) => note < split.boundary);
  if (above.length !== 1 || below.length !== 1) return { square: null, candidates: [], pitch_classes };

  const [fileNote, rankNote] = split.filesAbove ? [above[0], below[0]] : [below[0], above[0]];
  const file = axisIndex(fileNote, scheme.roots);
  const rank = axisIndex(rankNote, scheme.qualities);
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
  if (!scalarScheme(scheme)) {
    const squares = [];
    for (let file = 0; file < scheme.roots.length; file += 1) {
      for (let rank = 0; rank < scheme.qualities.length; rank += 1) {
        const expected = new Set([...staffTokenNotes(scheme.roots[file]), ...staffTokenNotes(scheme.qualities[rank])]);
        if (notes.every((note) => expected.has(note))) squares.push(`${FILES[file]}${RANKS[rank]}`);
      }
    }
    return squares.sort();
  }
  const split = splitFor(scheme);
  if (!split) return [];
  const above = notes.filter((note) => note >= split.boundary);
  const below = notes.filter((note) => note < split.boundary);
  if (above.length > 1 || below.length > 1) return [];
  const [fileSide, rankSide] = split.filesAbove ? [above, below] : [below, above];
  const fileIndex = fileSide.length ? axisIndex(fileSide[0], scheme.roots) : null;
  const rankIndex = rankSide.length ? axisIndex(rankSide[0], scheme.qualities) : null;
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
  const tokens = [...treble, ...bass].map(staffTokenNotes);
  if (tokens.some((notes) => notes.length < 1 || notes.length > 3)) errors.push('staff shapes need one to three MIDI notes');
  if (tokens.some((notes) => new Set(notes).size !== notes.length)) errors.push('a staff shape repeats a note');
  if (tokens.some((notes) => Math.max(...notes) - Math.min(...notes) > 7)) errors.push('a staff shape must fit within a perfect fifth');
  if (new Set(treble.map(tokenKey)).size !== 8) errors.push('the treble shapes repeat');
  if (new Set(bass.map(tokenKey)).size !== 8) errors.push('the bass shapes repeat');
  const overlap = treble.filter((token) => bass.some((other) => tokenKey(token) === tokenKey(other)));
  if (overlap.length) errors.push(`a shape cannot be on both staves: ${overlap.map(noteName).join(', ')}`);
  if (!splitFor(scheme)) errors.push('staff axes must occupy disjoint registers');
  // The escape stays reachable only while some same-pitch-class octave pair is
  // NOT an address; two notes in one hand, both on the same staff, always is.
  if (scalarScheme(scheme) && bass.some((low) => treble.includes(low + 12) || treble.includes(low + 24))) {
    // Allowed, and deliberately so — see identifyStaffAddress: a cross-staff
    // octave reads as its square, and the escape is played within one staff.
  }
  return { valid: errors.length === 0, errors };
}

export default {
  DEFAULT_STAFF_SCHEME, SPLIT_MIDI, splitFor, isStaffScheme, squareToStaffAddress, staffToSquare,
  identifyStaffAddress, staffCandidateSquares, validateStaffScheme, axisIndex, noteLetter, noteName, staffTokenNotes,
};
