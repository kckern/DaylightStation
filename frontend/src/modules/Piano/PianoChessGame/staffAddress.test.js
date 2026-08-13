import { describe, expect, it } from 'vitest';
import { SQUARES } from '@shared-gaming/chess/index.mjs';
import {
  DEFAULT_STAFF_SCHEME, identifyStaffAddress, noteLetter, noteName,
  squareToStaffAddress, staffCandidateSquares, staffToSquare, validateStaffScheme,
} from './staffAddress.js';
import { identifyChord, squareToChord, findChordCollisions, validateChordScheme } from './chordAddress.js';
import { candidateSquares } from './chordCandidates.js';
import { advanceCursor, createCursorState, minNotesFor } from './chordCursor.js';
import { getStaffPosition } from '../../MusicNotation/model/pitch.js';

const S = DEFAULT_STAFF_SCHEME;

describe('staff addressing', () => {
  it('addresses every square with a distinct pair of notes', () => {
    const seen = new Set();
    for (const square of SQUARES) {
      const address = squareToStaffAddress(square);
      expect(address, `no address for ${square}`).toBeTruthy();
      seen.add(address.midis.join(','));
    }
    expect(seen.size).toBe(64);
  });

  it('reads the rank off the bass staff and the file off the treble staff', () => {
    // a1 is the bottom-left square: lowest bass note, lowest treble note.
    expect(squareToStaffAddress('a1').midis).toEqual([47, 60]);
    expect(squareToStaffAddress('h8').midis).toEqual([59, 72]);
    expect(squareToStaffAddress('a1').symbol).toBe('C/B');
    expect(squareToStaffAddress('h8').symbol).toBe('C/B');
    // The two axes are contiguous — the ranks stop where the files start.
    expect(Math.max(...S.qualities)).toBeLessThan(Math.min(...S.roots));
  });

  it('round-trips square to notes and back', () => {
    for (const square of SQUARES) {
      const { treble, bass } = squareToStaffAddress(square);
      expect(staffToSquare(treble, bass)).toBe(square);
    }
    expect(staffToSquare(61, 47), 'a note on neither axis addresses nothing').toBe(null);
  });

  it('identifies a square from one note on each staff', () => {
    expect(identifyStaffAddress([47, 60]).square).toBe('a1');
    expect(identifyStaffAddress([60, 47]).square, 'order is free').toBe('a1');
    expect(identifyStaffAddress([59, 72]).square).toBe('h8');
  });

  it('refuses anything that is not exactly one note per staff', () => {
    expect(identifyStaffAddress([60, 62]).square, 'two notes above the split').toBe(null);
    expect(identifyStaffAddress([47, 50]).square, 'two notes below it').toBe(null);
    expect(identifyStaffAddress([47, 60, 64]).square, 'a third note').toBe(null);
    expect(identifyStaffAddress([60]).square, 'half an address').toBe(null);
    expect(identifyStaffAddress([61, 49]).square, 'letters that are on neither axis').toBe(null);
    expect(identifyStaffAddress([]).square).toBe(null);
  });

  it('does not care which octave, except where the letter repeats', () => {
    // D above high C is still the D column — being marked wrong for the octave
    // teaches nothing about the board.
    expect(identifyStaffAddress([47, 74]).square).toBe('b1');
    expect(identifyStaffAddress([47, 62]).square, 'the D on the staff, same column').toBe('b1');
    // C is the letter at both ends of the file axis, so there the octave decides.
    expect(identifyStaffAddress([47, 60]).square, 'middle C is the first column').toBe('a1');
    expect(identifyStaffAddress([47, 72]).square, 'the C above is the last').toBe('h1');
    expect(identifyStaffAddress([47, 84]).square, 'higher still is nearest the last').toBe('h1');
    // Same rule on the ranks, where B repeats.
    expect(identifyStaffAddress([47, 60]).square, 'the low B is rank 1').toBe('a1');
    expect(identifyStaffAddress([59, 60]).square, 'the B under middle C is rank 8').toBe('a8');
  });

  it('lights a whole rank or a whole file from one note', () => {
    // A bass note names a rank: eight squares, all on rank 1.
    const rank = staffCandidateSquares([47]);
    expect(rank.length).toBe(8);
    expect(new Set(rank.map((sq) => sq[1]))).toEqual(new Set(['1']));
    // A treble note names a file.
    const file = staffCandidateSquares([60]);
    expect(file.length).toBe(8);
    expect(new Set(file.map((sq) => sq[0]))).toEqual(new Set(['a']));
    // Both together leave exactly the square where they meet.
    expect(staffCandidateSquares([47, 60])).toEqual(['a1']);
    // A letter on neither axis is not on the way to a square.
    expect(staffCandidateSquares([61])).toEqual([]);
  });

  it('validates the shipped scheme and rejects overlapping staves', () => {
    expect(validateStaffScheme(S)).toEqual({ valid: true, errors: [] });
    const overlap = { ...S, qualities: [...S.qualities.slice(0, 7), 72] };
    expect(validateStaffScheme(overlap).valid).toBe(false);
    expect(validateStaffScheme(overlap).errors.join(' ')).toMatch(/both staves/);
  });

  it('names notes for the badges', () => {
    expect(noteLetter(60)).toBe('C');
    expect(noteName(60)).toBe('C4');
    expect(noteName(47)).toBe('B2');
  });
});

describe('the shared addresser dispatches on the scheme', () => {
  it('routes squareToChord, identifyChord, candidates and validation', () => {
    expect(squareToChord('a1', S).symbol).toBe('C/B');
    expect(identifyChord([47, 60], S).square).toBe('a1');
    expect(candidateSquares([47], S).length).toBe(8);
    expect(validateChordScheme(S).valid).toBe(true);
    // Distinctness is structural for a staff scheme — two disjoint note sets.
    expect(findChordCollisions(S)).toEqual([]);
  });

  it('leaves the chord vocabulary untouched', () => {
    expect(squareToChord('a1').symbol).toBe('A');
    expect(identifyChord([60, 64, 67]).square).toBe('c1');
  });
});

describe('the cursor in the reading vocabulary', () => {
  const tick = (state, notes, now) => advanceCursor(state, notes, now, { scheme: S });

  it('needs two notes, not three', () => {
    expect(minNotesFor(S)).toBe(2);
    expect(minNotesFor(undefined)).toBe(3);
  });

  it('recognises a square from a two-note address', () => {
    let { state } = tick(createCursorState(), [47, 60], 0);
    const settled = tick(state, [47, 60], 200);
    expect(settled.event).toEqual(expect.objectContaining({ type: 'preview', square: 'a1' }));
    state = settled.state;
    expect(tick(state, [], 260).event).toEqual(expect.objectContaining({ type: 'commit', square: 'a1' }));
  });

  it('still escapes on an octave played within one staff', () => {
    // C4 and C5 are both treble notes, so they address nothing and stay free to
    // mean "put it back".
    const first = tick(createCursorState(), [60, 72], 0);
    const settled = tick(first.state, [60, 72], 200);
    expect(settled.event).toEqual(expect.objectContaining({ type: 'preview', square: null }));
    expect(tick(settled.state, [], 260).event).toEqual({ type: 'escape' });
  });

  it('reads an address that happens to be an octave as its square', () => {
    // B2-with-B3 is an octave AND both notes are below the split, so it is not
    // an address and stays free to mean "put it back".
    expect(identifyStaffAddress([47, 59]).square).toBe(null);
    // But a cross-split octave like C4-with-C5 is not an address either (both
    // are above the split), while the square a1 is C-over-B — no collision at
    // all between the escape and the board under these axes.
    const settled = tick(createCursorState(), [47, 60], 0);
    expect(tick(settled.state, [47, 60], 200).event.square).toBe('a1');
  });
});

describe('the rim labels', () => {
  it('lands each axis on the clef the shared engraver would choose', () => {
    // The rim delegates to SvgStaffRenderer, which reads the clef off the pitch
    // (C4 and above is treble). That is the whole reason the two note sets were
    // chosen where they were: the files come out treble and the ranks bass with
    // nothing having to be told which is which.
    for (const midi of S.roots) expect(getStaffPosition(midi).clef, `file note ${midi}`).toBe('treble');
    for (const midi of S.qualities) expect(getStaffPosition(midi).clef, `rank note ${midi}`).toBe('bass');
  });

  it('keeps every rim note close enough to its staff to read', () => {
    // Position is diatonic steps above the bottom line; the renderer draws
    // ledger lines, but a note far outside the staff stops being legible at rim
    // size. Two ledger lines either way is the limit.
    for (const midi of [...S.roots, ...S.qualities]) {
      const { position } = getStaffPosition(midi);
      expect(position, `note ${midi} sits at ${position}`).toBeGreaterThanOrEqual(-4);
      expect(position, `note ${midi} sits at ${position}`).toBeLessThanOrEqual(12);
    }
  });
});
