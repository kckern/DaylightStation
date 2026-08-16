import { describe, expect, it } from 'vitest';
import { coordToIndex } from '@shared-gaming/checkers/engine.mjs';
import {
  DEFAULT_FILE_NOTES, DEFAULT_RANK_NOTES, activeFileIndex, activeRankDisplayIndex,
  fileRailAddresses, normalizeCheckersNotes, rankRailAddresses, shuffleCheckersNotes,
  squareForAddress,
} from './checkersAddress.js';

describe('Checkers file+rank addressing (mirrors chess: two notes name a square)', () => {
  it('addresses a square from its file note (>=C4) and rank note (<C4)', () => {
    // file index 0, rank index 0 ("rank 1", the row nearest the player, row 7).
    const notes = { file_notes: DEFAULT_FILE_NOTES, rank_notes: DEFAULT_RANK_NOTES };
    const square = squareForAddress([DEFAULT_FILE_NOTES[0], DEFAULT_RANK_NOTES[0]], notes);
    expect(square).toBe(coordToIndex(7, 0));
  });

  it('is order-independent — file-then-rank and rank-then-file address the same square', () => {
    const notes = { file_notes: DEFAULT_FILE_NOTES, rank_notes: DEFAULT_RANK_NOTES };
    const a = squareForAddress([DEFAULT_FILE_NOTES[3], DEFAULT_RANK_NOTES[5]], notes);
    const b = squareForAddress([DEFAULT_RANK_NOTES[5], DEFAULT_FILE_NOTES[3]], notes);
    expect(a).toBe(b);
    expect(a).toBe(coordToIndex(2, 3));
  });

  it('resolves nothing for a light square — a file/rank pair the board never plays', () => {
    // column 0 (file index 0) + row 0 (rank index 7, "rank 8") is a light
    // square: (row+col) even. There is no address for it, and squareForAddress
    // must say so rather than inventing a square that was never playable.
    const notes = { file_notes: DEFAULT_FILE_NOTES, rank_notes: DEFAULT_RANK_NOTES };
    expect(coordToIndex(0, 0)).toBeNull(); // sanity: confirms this really is a light square
    const square = squareForAddress([DEFAULT_FILE_NOTES[0], DEFAULT_RANK_NOTES[7]], notes);
    expect(square).toBeNull();
  });

  it('resolves nothing for one note, two notes on the same axis, or three or more notes', () => {
    const notes = { file_notes: DEFAULT_FILE_NOTES, rank_notes: DEFAULT_RANK_NOTES };
    expect(squareForAddress([DEFAULT_FILE_NOTES[0]], notes)).toBeNull();
    expect(squareForAddress([DEFAULT_FILE_NOTES[0], DEFAULT_FILE_NOTES[1]], notes)).toBeNull();
    expect(squareForAddress([DEFAULT_FILE_NOTES[0], DEFAULT_RANK_NOTES[0], DEFAULT_RANK_NOTES[1]], notes)).toBeNull();
  });

  it('tolerates octave displacement by letter, same as the chess staff scheme', () => {
    const notes = { file_notes: DEFAULT_FILE_NOTES, rank_notes: DEFAULT_RANK_NOTES };
    // DEFAULT_FILE_NOTES[2] is 64 (E4), the only E in the axis (unlike C,
    // which legitimately occupies both index 0 and index 7 — the octave the
    // 8-note diatonic run wraps on). 76 (E5) is the same letter, one octave
    // up, and isn't itself in the array, so this exercises the pitch-class
    // fallback rather than landing on a second exact slot.
    const square = squareForAddress([76, DEFAULT_RANK_NOTES[0]], notes);
    expect(square).toBe(coordToIndex(7, 2));
  });
});

describe('Checkers rail addresses', () => {
  it('lists the file rail left-to-right, matching the board columns', () => {
    const notes = { file_notes: DEFAULT_FILE_NOTES, rank_notes: DEFAULT_RANK_NOTES };
    const addresses = fileRailAddresses(notes);
    expect(addresses.map((address) => address.midi)).toEqual(DEFAULT_FILE_NOTES);
  });

  it('lists the rank rail top-to-bottom, so rank 1 (row 7) is the LAST card', () => {
    const notes = { file_notes: DEFAULT_FILE_NOTES, rank_notes: DEFAULT_RANK_NOTES };
    const addresses = rankRailAddresses(notes);
    expect(addresses[0].midi).toBe(DEFAULT_RANK_NOTES[7]); // "rank 8", row 0, drawn first (top)
    expect(addresses[7].midi).toBe(DEFAULT_RANK_NOTES[0]); // "rank 1", row 7, drawn last (bottom)
  });
});

describe('Checkers active-card highlighting', () => {
  it('highlights the file card that matches a single held file note', () => {
    const notes = { file_notes: DEFAULT_FILE_NOTES, rank_notes: DEFAULT_RANK_NOTES };
    expect(activeFileIndex([DEFAULT_FILE_NOTES[2]], notes)).toBe(2);
    expect(activeFileIndex([], notes)).toBeNull();
    expect(activeFileIndex([DEFAULT_RANK_NOTES[2]], notes)).toBeNull();
  });

  it('highlights the rank card in DISPLAY order, matching rankRailAddresses', () => {
    const notes = { file_notes: DEFAULT_FILE_NOTES, rank_notes: DEFAULT_RANK_NOTES };
    // rank index 0 ("rank 1") is the LAST rail card (index 7, see above).
    expect(activeRankDisplayIndex([DEFAULT_RANK_NOTES[0]], notes)).toBe(7);
    expect(activeRankDisplayIndex([DEFAULT_RANK_NOTES[7]], notes)).toBe(0);
  });
});

describe('Checkers re-dealing (shuffle_each_game)', () => {
  it('shuffles both axes deterministically from a seed', () => {
    const notes = { file_notes: DEFAULT_FILE_NOTES, rank_notes: DEFAULT_RANK_NOTES };
    const dealt = shuffleCheckersNotes(notes, 7);
    expect(shuffleCheckersNotes(notes, 7)).toEqual(dealt);
    expect([...dealt.file_notes].sort((a, b) => a - b)).toEqual([...DEFAULT_FILE_NOTES].sort((a, b) => a - b));
    expect([...dealt.rank_notes].sort((a, b) => a - b)).toEqual([...DEFAULT_RANK_NOTES].sort((a, b) => a - b));
  });

  it('draws the two axes independently, so a shared seed does not permute them identically', () => {
    const notes = { file_notes: DEFAULT_FILE_NOTES, rank_notes: DEFAULT_RANK_NOTES };
    const dealt = shuffleCheckersNotes(notes, 7);
    // Express each shuffled axis as the PERMUTATION of source indices it
    // drew, independent of which literal notes are in play, and require the
    // two permutations to differ — same seed, same shuffle function, but
    // offset (the golden-ratio constant) so the axes don't move together.
    const filePermutation = dealt.file_notes.map((midi) => DEFAULT_FILE_NOTES.indexOf(midi));
    const rankPermutation = dealt.rank_notes.map((midi) => DEFAULT_RANK_NOTES.indexOf(midi));
    expect(filePermutation).not.toEqual(rankPermutation);
  });
});

describe('Checkers config — legacy square_notes must never crash the game', () => {
  it('falls back to the default file/rank axes when the persisted config only has the old 32-note shape', () => {
    const legacy = { square_notes: Array.from({ length: 32 }, (_, index) => 48 + index) };
    expect(normalizeCheckersNotes(legacy)).toEqual({ file_notes: DEFAULT_FILE_NOTES, rank_notes: DEFAULT_RANK_NOTES });
  });

  it('falls back when file_notes/rank_notes are missing, malformed, or the wrong length', () => {
    expect(normalizeCheckersNotes(null)).toEqual({ file_notes: DEFAULT_FILE_NOTES, rank_notes: DEFAULT_RANK_NOTES });
    expect(normalizeCheckersNotes({})).toEqual({ file_notes: DEFAULT_FILE_NOTES, rank_notes: DEFAULT_RANK_NOTES });
    expect(normalizeCheckersNotes({ file_notes: [60, 62], rank_notes: DEFAULT_RANK_NOTES }))
      .toEqual({ file_notes: DEFAULT_FILE_NOTES, rank_notes: DEFAULT_RANK_NOTES });
  });

  it('passes through a valid, already-migrated config unchanged', () => {
    const shuffled = shuffleCheckersNotes({ file_notes: DEFAULT_FILE_NOTES, rank_notes: DEFAULT_RANK_NOTES }, 3);
    expect(normalizeCheckersNotes(shuffled)).toEqual(shuffled);
  });
});
