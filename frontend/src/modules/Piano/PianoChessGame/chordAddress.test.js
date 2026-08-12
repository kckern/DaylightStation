import { describe, expect, it } from 'vitest';
import { SQUARES } from '@shared-gaming/chess/index.mjs';
import {
  DEFAULT_CHORD_SCHEME, chordBoard, chordPitchClasses, chordToSquare,
  findChordCollisions, identifyChord, moveToChordPair, shuffleChordScheme,
  squareToChord, validateChordScheme,
} from './chordAddress.js';

describe('chord addressing', () => {
  it('accepts the default scheme', () => {
    expect(validateChordScheme(DEFAULT_CHORD_SCHEME)).toEqual({ valid: true, errors: [] });
  });

  it('rejects schemes that are not a clean 8x8', () => {
    expect(validateChordScheme({ roots: ['A'], qualities: DEFAULT_CHORD_SCHEME.qualities }).valid).toBe(false);
    // B and Cb are the same key, so the board could not tell those files apart.
    const duplicated = { roots: ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'B'], qualities: DEFAULT_CHORD_SCHEME.qualities };
    expect(validateChordScheme(duplicated).errors.join(' ')).toMatch(/repeat a pitch class/);
    const unknown = { ...DEFAULT_CHORD_SCHEME, qualities: [...DEFAULT_CHORD_SCHEME.qualities.slice(0, 7), 'klezmer'] };
    expect(validateChordScheme(unknown).errors.join(' ')).toMatch(/unknown quality/);
  });

  it('addresses every square with a distinct chord', () => {
    const board = chordBoard();
    expect(Object.keys(board).length).toBe(64);
    expect(new Set(Object.values(board).map((chord) => chord.symbol)).size).toBe(64);
    for (const square of SQUARES) expect(board[square], `no chord for ${square}`).toBeTruthy();
  });

  it('reads the file letter as the chord letter', () => {
    expect(squareToChord('a1').symbol).toBe('A');
    expect(squareToChord('c1').symbol).toBe('C');
    expect(squareToChord('g1').symbol).toBe('G');
    expect(squareToChord('h1').symbol, 'file h carries the one accidental').toBe('Bb');
  });

  it('climbs the ranks through the qualities', () => {
    expect(squareToChord('c1').symbol).toBe('C');
    expect(squareToChord('c2').symbol).toBe('Cm');
    expect(squareToChord('c5').symbol).toBe('C7');
    expect(squareToChord('c8').symbol).toBe('Cdim');
  });

  it('round-trips square to chord and back', () => {
    for (const square of SQUARES) {
      const chord = squareToChord(square);
      expect(chordToSquare(chord.root, chord.quality)).toBe(square);
    }
    expect(chordToSquare('C#', 'major'), 'off-scheme roots have no square').toBe(null);
    expect(chordToSquare('C', 'minor7'), 'off-scheme qualities have no square').toBe(null);
  });

  it('spells chords as pitch classes', () => {
    expect(chordPitchClasses('C', 'major')).toEqual([0, 4, 7]);
    expect(chordPitchClasses('A', 'minor')).toEqual([0, 4, 9]);
    expect(chordPitchClasses('G', 'seventh')).toEqual([2, 5, 7, 11]);
  });

  it('identifies a played chord regardless of octave, voicing or inversion', () => {
    expect(identifyChord([60, 64, 67]).square, 'C major in root position').toBe('c1');
    expect(identifyChord([72, 76, 79]).square, 'an octave up is the same chord').toBe('c1');
    expect(identifyChord([67, 72, 76]).square, 'second inversion still reads as C').toBe('c1');
    expect(identifyChord([60, 64, 67, 72, 76]).square, 'doublings are free').toBe('c1');
    expect(identifyChord([62, 65, 69]).square, 'D minor').toBe('d2');
    expect(identifyChord([]).square).toBe(null);
    expect(identifyChord([60, 61]).square, 'a non-chord matches nothing').toBe(null);
  });

  it('leaves no square ambiguous under the default scheme', () => {
    expect(findChordCollisions(), 'every square must be a distinct set of notes').toEqual([]);
  });

  it('reports the schemes that cannot be played by ear', () => {
    // Augmented triads are symmetric, so C-aug and E-aug are one chord.
    const augmented = { ...DEFAULT_CHORD_SCHEME, qualities: [...DEFAULT_CHORD_SCHEME.qualities.slice(0, 7), 'augmented'] };
    const collisions = findChordCollisions(augmented);
    expect(collisions.length > 0, 'an augmented rank must be reported as ambiguous').toBeTruthy();
    expect(collisions.every((collision) => collision.members.every((member) => member.square[1] === '8'))).toBeTruthy();

    // sus2 and sus4 are inversions of each other: C-sus2 and G-sus4 are one chord.
    const bothSus = { ...DEFAULT_CHORD_SCHEME, qualities: [...DEFAULT_CHORD_SCHEME.qualities.slice(0, 3), 'sus2', ...DEFAULT_CHORD_SCHEME.qualities.slice(4)] };
    expect(findChordCollisions(bothSus).length > 0, 'sus2 alongside sus4 must be reported as ambiguous').toBeTruthy();
  });

  it('falls back to the bass note when a scheme is ambiguous', () => {
    const augmented = { ...DEFAULT_CHORD_SCHEME, qualities: [...DEFAULT_CHORD_SCHEME.qualities.slice(0, 7), 'augmented'] };
    expect(identifyChord([60, 64, 68], augmented).square, 'C in the bass reads as C-aug').toBe('c8');
    expect(identifyChord([64, 68, 72], augmented).square, 'E in the bass reads as E-aug').toBe('e8');
    expect(identifyChord([60, 64, 68], augmented).candidates.length, 'the ambiguity is still reported').toBe(2);
  });

  it('re-deals the same chords onto different squares', () => {
    const dealt = shuffleChordScheme(DEFAULT_CHORD_SCHEME, 7);
    expect([...dealt.roots].sort(), 'the vocabulary must not change').toEqual([...DEFAULT_CHORD_SCHEME.roots].sort());
    expect([...dealt.qualities].sort()).toEqual([...DEFAULT_CHORD_SCHEME.qualities].sort());
    expect(validateChordScheme(dealt).valid).toBe(true);
    expect(dealt.roots, 'seed 7 must actually move the roots').not.toEqual(DEFAULT_CHORD_SCHEME.roots);
  });

  it('cannot make a scheme ambiguous by re-dealing it', () => {
    // Collisions depend on which chords are in play, never on where they sit —
    // so a collision-free scheme stays collision-free however it is dealt.
    for (let seed = 0; seed < 50; seed += 1) {
      expect(findChordCollisions(shuffleChordScheme(DEFAULT_CHORD_SCHEME, seed)), `seed ${seed}`).toEqual([]);
    }
  });

  it('deals the same board for the same seed and a different one otherwise', () => {
    expect(shuffleChordScheme(DEFAULT_CHORD_SCHEME, 3)).toEqual(shuffleChordScheme(DEFAULT_CHORD_SCHEME, 3));
    const boards = new Set();
    for (let seed = 0; seed < 20; seed += 1) {
      const dealt = shuffleChordScheme(DEFAULT_CHORD_SCHEME, seed);
      boards.add(`${dealt.roots.join()}|${dealt.qualities.join()}`);
    }
    expect(boards.size > 15, `expected mostly distinct deals, got ${boards.size}/20`).toBeTruthy();
  });

  it('keeps every square reachable after a re-deal', () => {
    const dealt = shuffleChordScheme(DEFAULT_CHORD_SCHEME, 11);
    const board = chordBoard(dealt);
    expect(new Set(Object.values(board).map((chord) => chord.symbol)).size).toBe(64);
    for (const square of SQUARES) {
      const chord = squareToChord(square, dealt);
      expect(chordToSquare(chord.root, chord.quality, dealt)).toBe(square);
      expect(identifyChord(chord.pitch_classes.map((pc) => 60 + pc), dealt).candidates.some((c) => c.square === square)).toBe(true);
    }
  });

  it('renders a move as the two chords that perform it', () => {
    const pair = moveToChordPair('e2', 'e4');
    expect(pair.notation).toBe('Em -> Eadd2');
    expect(pair.from.square).toBe('e2');
    expect(pair.to.square).toBe('e4');
    expect(moveToChordPair('e2', 'zz')).toBe(null);
  });
});
