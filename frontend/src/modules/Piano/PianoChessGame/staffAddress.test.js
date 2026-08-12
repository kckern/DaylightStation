import { describe, expect, it } from 'vitest';
import { SQUARES } from '@shared-gaming/chess/index.mjs';
import {
  DEFAULT_STAFF_SCHEME, identifyStaffAddress, noteLetter, noteName,
  squareToStaffAddress, staffCandidateSquares, staffToSquare, validateStaffScheme,
} from './staffAddress.js';
import { identifyChord, squareToChord, findChordCollisions, validateChordScheme } from './chordAddress.js';
import { candidateSquares } from './chordCandidates.js';
import { advanceCursor, createCursorState, minNotesFor } from './chordCursor.js';
import { staffStep } from './StaffNoteLabel.jsx';

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
    expect(squareToStaffAddress('a1').midis).toEqual([36, 60]);
    expect(squareToStaffAddress('h8').midis).toEqual([48, 72]);
    expect(squareToStaffAddress('a1').symbol).toBe('C/C');
    expect(squareToStaffAddress('c3').symbol).toBe('E/E');
  });

  it('round-trips square to notes and back', () => {
    for (const square of SQUARES) {
      const { treble, bass } = squareToStaffAddress(square);
      expect(staffToSquare(treble, bass)).toBe(square);
    }
    expect(staffToSquare(61, 36), 'a note on neither staff addresses nothing').toBe(null);
  });

  it('identifies a square from one note on each staff', () => {
    expect(identifyStaffAddress([36, 60]).square).toBe('a1');
    expect(identifyStaffAddress([60, 36]).square, 'order is free').toBe('a1');
    expect(identifyStaffAddress([48, 72]).square).toBe('h8');
  });

  it('refuses anything that is not exactly one note per staff', () => {
    expect(identifyStaffAddress([60, 62]).square, 'two treble notes').toBe(null);
    expect(identifyStaffAddress([36, 38]).square, 'two bass notes').toBe(null);
    expect(identifyStaffAddress([36, 60, 64]).square, 'a third note').toBe(null);
    expect(identifyStaffAddress([60]).square, 'half an address').toBe(null);
    expect(identifyStaffAddress([61, 37]).square, 'notes on neither staff').toBe(null);
    expect(identifyStaffAddress([]).square).toBe(null);
  });

  it('lights a whole rank or a whole file from one note', () => {
    // A bass note names a rank: eight squares, all on rank 1.
    const rank = staffCandidateSquares([36]);
    expect(rank.length).toBe(8);
    expect(new Set(rank.map((sq) => sq[1]))).toEqual(new Set(['1']));
    // A treble note names a file.
    const file = staffCandidateSquares([60]);
    expect(file.length).toBe(8);
    expect(new Set(file.map((sq) => sq[0]))).toEqual(new Set(['a']));
    // Both together leave exactly the square where they meet.
    expect(staffCandidateSquares([36, 60])).toEqual(['a1']);
    // Anything off the staves is not on the way to a square.
    expect(staffCandidateSquares([61])).toEqual([]);
  });

  it('validates the shipped scheme and rejects overlapping staves', () => {
    expect(validateStaffScheme(S)).toEqual({ valid: true, errors: [] });
    const overlap = { ...S, qualities: [...S.qualities.slice(0, 7), 60] };
    expect(validateStaffScheme(overlap).valid).toBe(false);
    expect(validateStaffScheme(overlap).errors.join(' ')).toMatch(/both staves/);
  });

  it('names notes for the badges', () => {
    expect(noteLetter(60)).toBe('C');
    expect(noteName(60)).toBe('C4');
    expect(noteName(36)).toBe('C2');
  });
});

describe('the shared addresser dispatches on the scheme', () => {
  it('routes squareToChord, identifyChord, candidates and validation', () => {
    expect(squareToChord('a1', S).symbol).toBe('C/C');
    expect(identifyChord([36, 60], S).square).toBe('a1');
    expect(candidateSquares([36], S).length).toBe(8);
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
    let { state } = tick(createCursorState(), [36, 60], 0);
    const settled = tick(state, [36, 60], 200);
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

  it('reads a cross-staff octave as its square, not as an escape', () => {
    // C2-with-C4 IS an octave, and it is also square a1. The square wins —
    // otherwise eight squares of the board would be unreachable.
    const first = tick(createCursorState(), [36, 48], 0);
    expect(identifyStaffAddress([36, 48]).square, 'both notes are bass — not an address').toBe(null);
    const settled = tick(createCursorState(), [36, 60], 0);
    const preview = tick(settled.state, [36, 60], 200);
    expect(preview.event.square).toBe('a1');
    expect(first.event).toBe(null);
  });
});

describe('the rim labels', () => {
  it('places each note on its own staff', () => {
    // Treble: E4 is the bottom line (step 0); C4 sits two steps below it.
    expect(staffStep(64, 'treble')).toBe(0);
    expect(staffStep(60, 'treble')).toBe(-2);
    expect(staffStep(72, 'treble')).toBe(5);
    // Bass: G2 is the bottom line; C2 sits four steps below.
    expect(staffStep(43, 'bass')).toBe(0);
    expect(staffStep(36, 'bass')).toBe(-4);
    expect(staffStep(48, 'bass')).toBe(3);
  });

  it('keeps every rim note within reach of a ledger line or two', () => {
    for (const midi of S.roots) expect(Math.abs(staffStep(midi, 'treble'))).toBeLessThanOrEqual(10);
    for (const midi of S.qualities) expect(Math.abs(staffStep(midi, 'bass'))).toBeLessThanOrEqual(10);
  });
});
