import { coordToIndex } from '@shared-gaming/rulesets/checkers/engine.mjs';
import { shuffle } from '@shared-gaming/mechanics/random.mjs';
import { DEFAULT_STAFF_SCHEME, SPLIT_MIDI, axisIndex, noteLetter, noteName } from '../PianoChessGame/staffAddress.js';

/**
 * Checkers uses the same two-axis instrument vocabulary as chess: a square is
 * two notes, a file note and a rank note, played together.
 * `DEFAULT_STAFF_SCHEME`'s `roots` become
 * the eight file notes, its `qualities` the eight rank notes, same split at
 * middle C, same octave-tolerant matching. A player who has learned to read
 * one board reads both.
 *
 * Checkers only plays on the 32 DARK squares, so not every (file, rank) pair
 * is a legal address — `squareForAddress` returns null for a light square the
 * same way it returns null for an unrecognised note, and the caller (the
 * addressed-board source/destination grammar) already treats a null address
 * as "try again," not as a crash.
 *
 * "Rank 1" is the row nearest the human player (row 7 in the engine's
 * top-down coordinates, where red — the player's pieces — starts), matching
 * chess's own convention that rank 1 is the player's home rank.
 */

export const DEFAULT_FILE_NOTES = DEFAULT_STAFF_SCHEME.roots;
export const DEFAULT_RANK_NOTES = DEFAULT_STAFF_SCHEME.qualities;

const AXIS_LENGTH = 8;

/**
 * Deals a fresh mapping of the same sixteen notes onto the board — the
 * checkers equivalent of chess's `shuffleChordScheme`. Two independent draws
 * (the golden-ratio offset decorrelates the second from the first) so the
 * file axis and rank axis do not move together from one re-deal to the next.
 */
export function shuffleCheckersNotes(notes, seed) {
  const base = Number(seed) >>> 0;
  return {
    file_notes: shuffle(notes.file_notes, base).items,
    rank_notes: shuffle(notes.rank_notes, (base + 0x9E3779B9) >>> 0).items,
  };
}

/**
 * Two held notes -> the checkers square (0-31) they address, or null.
 *
 * Mirrors chess's `identifyStaffAddress`: exactly one note at or above middle
 * C (the file) and exactly one below it (the rank), matched by letter so an
 * octave slip still reads correctly. `column = fileIndex`; `row = 7 -
 * rankIndex` because rank index 0 is "rank 1," the player's home row, at the
 * bottom of the engine's top-down grid. `coordToIndex` returns null on a
 * light square, and that null passes straight through — an address that
 * names a square which was never playable is not a different kind of
 * failure, it's the same one.
 */
export function squareForAddress(heldNotes, notes) {
  const held = [...new Set((Array.isArray(heldNotes) ? heldNotes : []).filter(Number.isFinite))];
  if (held.length !== 2) return null;
  const above = held.filter((note) => note >= SPLIT_MIDI);
  const below = held.filter((note) => note < SPLIT_MIDI);
  if (above.length !== 1 || below.length !== 1) return null;
  const fileIndex = axisIndex(above[0], notes.file_notes);
  const rankIndex = axisIndex(below[0], notes.rank_notes);
  if (fileIndex < 0 || rankIndex < 0) return null;
  return coordToIndex(7 - rankIndex, fileIndex);
}

/** The file rail, left-to-right — column order, matching the board. */
export function fileRailAddresses(notes) {
  return notes.file_notes.map((midi) => ({ midi, label: noteName(midi), chord: noteLetter(midi) }));
}

/**
 * The rank rail, top-to-bottom — DISPLAY order, not axis-index order.
 *
 * Rank index 0 ("rank 1") sits at the BOTTOM of the board (row 7, the
 * player's home row), so the card that reads first walking down the rail is
 * rank index 7 ("rank 8," row 0). Reversing here is what keeps the rail's
 * visual order matching the board's actual row order — the rail is drawn
 * top-to-bottom in JSX, same as the board's rows.
 */
export function rankRailAddresses(notes) {
  return [...notes.rank_notes].reverse().map((midi) => ({ midi, label: noteName(midi), chord: noteLetter(midi) }));
}

/** Which file card (if any) a single held file note lights up. */
export function activeFileIndex(heldNotes, notes) {
  const held = [...new Set((Array.isArray(heldNotes) ? heldNotes : []).filter(Number.isFinite))]
    .filter((note) => note >= SPLIT_MIDI);
  if (held.length !== 1) return null;
  const index = axisIndex(held[0], notes.file_notes);
  return index < 0 ? null : index;
}

/**
 * Which rank card (if any) a single held rank note lights up, already
 * converted to the rail's DISPLAY order — see `rankRailAddresses`.
 */
export function activeRankDisplayIndex(heldNotes, notes) {
  const held = [...new Set((Array.isArray(heldNotes) ? heldNotes : []).filter(Number.isFinite))]
    .filter((note) => note < SPLIT_MIDI);
  if (held.length !== 1) return null;
  const index = axisIndex(held[0], notes.rank_notes);
  return index < 0 ? null : (AXIS_LENGTH - 1 - index);
}

export default {
  DEFAULT_FILE_NOTES, DEFAULT_RANK_NOTES, shuffleCheckersNotes,
  squareForAddress, fileRailAddresses, rankRailAddresses, activeFileIndex, activeRankDisplayIndex,
};
