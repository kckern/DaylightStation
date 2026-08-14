import { describe, expect, it } from 'vitest';
import { resolveAddressedSelection } from '../game-platform/families/addressed-board/interactionGrammars.js';
import { DEFAULT_FILE_NOTES, DEFAULT_RANK_NOTES, squareForAddress } from './checkersAddress.js';

/**
 * These used to assert against `square_notes`/`squareForNotes` — the 32-
 * unique-note addressing scheme this game shipped with. That scheme is gone
 * (see checkersAddress.js for why: it could never grow a truthful axis rail,
 * because no row or column shared a note to draw a rail card FROM). Checkers
 * now addresses a square the same way chess does — a file note and a rank
 * note, played together — so these tests assert against `checkersAddress.js`
 * instead. Full coverage of that module (octave tolerance, light-square
 * rejection, the legacy-config fallback, the re-deal) lives in
 * `checkersAddress.test.js`; this file just confirms PianoCheckers.jsx's own
 * remaining local contract: the addressed-board selection grammar it shares
 * with the other two games.
 */
describe('Piano Checkers addressing', () => {
  it('addresses a square by playing its file and rank notes together', () => {
    const notes = { file_notes: DEFAULT_FILE_NOTES, rank_notes: DEFAULT_RANK_NOTES };
    const square = squareForAddress([DEFAULT_FILE_NOTES[0], DEFAULT_RANK_NOTES[0]], notes);
    expect(square).not.toBeNull();
  });

  it('uses the addressed-board source/destination grammar', () => {
    expect(resolveAddressedSelection({ selected: null, address: 20, sources: [20], destinations: [] }))
      .toEqual({ selected: 20, committed: null, rejection: null });
    expect(resolveAddressedSelection({ selected: 20, address: 16, sources: [20], destinations: [16, 17] }))
      .toEqual({ selected: null, committed: { from: 20, to: 16 }, rejection: null });
  });
});
