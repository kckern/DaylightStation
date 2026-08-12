import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { SQUARES } from './position.mjs';
import {
  DEFAULT_CHORD_SCHEME, chordBoard, chordPitchClasses, chordToSquare,
  findChordCollisions, identifyChord, moveToChordPair, shuffleChordScheme,
  squareToChord, validateChordScheme,
} from './chordAddress.mjs';

describe('chord addressing', () => {
  it('accepts the default scheme', () => {
    assert.deepEqual(validateChordScheme(DEFAULT_CHORD_SCHEME), { valid: true, errors: [] });
  });

  it('rejects schemes that are not a clean 8x8', () => {
    assert.equal(validateChordScheme({ roots: ['A'], qualities: DEFAULT_CHORD_SCHEME.qualities }).valid, false);
    // B and Cb are the same key, so the board could not tell those files apart.
    const duplicated = { roots: ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'B'], qualities: DEFAULT_CHORD_SCHEME.qualities };
    assert.match(validateChordScheme(duplicated).errors.join(' '), /repeat a pitch class/);
    const unknown = { ...DEFAULT_CHORD_SCHEME, qualities: [...DEFAULT_CHORD_SCHEME.qualities.slice(0, 7), 'klezmer'] };
    assert.match(validateChordScheme(unknown).errors.join(' '), /unknown quality/);
  });

  it('addresses every square with a distinct chord', () => {
    const board = chordBoard();
    assert.equal(Object.keys(board).length, 64);
    assert.equal(new Set(Object.values(board).map((chord) => chord.symbol)).size, 64);
    for (const square of SQUARES) assert.ok(board[square], `no chord for ${square}`);
  });

  it('reads the file letter as the chord letter', () => {
    assert.equal(squareToChord('a1').symbol, 'A');
    assert.equal(squareToChord('c1').symbol, 'C');
    assert.equal(squareToChord('g1').symbol, 'G');
    assert.equal(squareToChord('h1').symbol, 'Bb', 'file h carries the one accidental');
  });

  it('climbs the ranks through the qualities', () => {
    assert.equal(squareToChord('c1').symbol, 'C');
    assert.equal(squareToChord('c2').symbol, 'Cm');
    assert.equal(squareToChord('c5').symbol, 'C7');
    assert.equal(squareToChord('c8').symbol, 'Cdim');
  });

  it('round-trips square to chord and back', () => {
    for (const square of SQUARES) {
      const chord = squareToChord(square);
      assert.equal(chordToSquare(chord.root, chord.quality), square);
    }
    assert.equal(chordToSquare('C#', 'major'), null, 'off-scheme roots have no square');
    assert.equal(chordToSquare('C', 'minor7'), null, 'off-scheme qualities have no square');
  });

  it('spells chords as pitch classes', () => {
    assert.deepEqual(chordPitchClasses('C', 'major'), [0, 4, 7]);
    assert.deepEqual(chordPitchClasses('A', 'minor'), [0, 4, 9]);
    assert.deepEqual(chordPitchClasses('G', 'seventh'), [2, 5, 7, 11]);
  });

  it('identifies a played chord regardless of octave, voicing or inversion', () => {
    assert.equal(identifyChord([60, 64, 67]).square, 'c1', 'C major in root position');
    assert.equal(identifyChord([72, 76, 79]).square, 'c1', 'an octave up is the same chord');
    assert.equal(identifyChord([67, 72, 76]).square, 'c1', 'second inversion still reads as C');
    assert.equal(identifyChord([60, 64, 67, 72, 76]).square, 'c1', 'doublings are free');
    assert.equal(identifyChord([62, 65, 69]).square, 'd2', 'D minor');
    assert.equal(identifyChord([]).square, null);
    assert.equal(identifyChord([60, 61]).square, null, 'a non-chord matches nothing');
  });

  it('leaves no square ambiguous under the default scheme', () => {
    assert.deepEqual(findChordCollisions(), [], 'every square must be a distinct set of notes');
  });

  it('reports the schemes that cannot be played by ear', () => {
    // Augmented triads are symmetric, so C-aug and E-aug are one chord.
    const augmented = { ...DEFAULT_CHORD_SCHEME, qualities: [...DEFAULT_CHORD_SCHEME.qualities.slice(0, 7), 'augmented'] };
    const collisions = findChordCollisions(augmented);
    assert.ok(collisions.length > 0, 'an augmented rank must be reported as ambiguous');
    assert.ok(collisions.every((collision) => collision.members.every((member) => member.square[1] === '8')));

    // sus2 and sus4 are inversions of each other: C-sus2 and G-sus4 are one chord.
    const bothSus = { ...DEFAULT_CHORD_SCHEME, qualities: [...DEFAULT_CHORD_SCHEME.qualities.slice(0, 3), 'sus2', ...DEFAULT_CHORD_SCHEME.qualities.slice(4)] };
    assert.ok(findChordCollisions(bothSus).length > 0, 'sus2 alongside sus4 must be reported as ambiguous');
  });

  it('falls back to the bass note when a scheme is ambiguous', () => {
    const augmented = { ...DEFAULT_CHORD_SCHEME, qualities: [...DEFAULT_CHORD_SCHEME.qualities.slice(0, 7), 'augmented'] };
    assert.equal(identifyChord([60, 64, 68], augmented).square, 'c8', 'C in the bass reads as C-aug');
    assert.equal(identifyChord([64, 68, 72], augmented).square, 'e8', 'E in the bass reads as E-aug');
    assert.equal(identifyChord([60, 64, 68], augmented).candidates.length, 2, 'the ambiguity is still reported');
  });

  it('re-deals the same chords onto different squares', () => {
    const dealt = shuffleChordScheme(DEFAULT_CHORD_SCHEME, 7);
    assert.deepEqual([...dealt.roots].sort(), [...DEFAULT_CHORD_SCHEME.roots].sort(), 'the vocabulary must not change');
    assert.deepEqual([...dealt.qualities].sort(), [...DEFAULT_CHORD_SCHEME.qualities].sort());
    assert.equal(validateChordScheme(dealt).valid, true);
    assert.notDeepEqual(dealt.roots, DEFAULT_CHORD_SCHEME.roots, 'seed 7 must actually move the roots');
  });

  it('cannot make a scheme ambiguous by re-dealing it', () => {
    // Collisions depend on which chords are in play, never on where they sit —
    // so a collision-free scheme stays collision-free however it is dealt.
    for (let seed = 0; seed < 50; seed += 1) {
      assert.deepEqual(findChordCollisions(shuffleChordScheme(DEFAULT_CHORD_SCHEME, seed)), [], `seed ${seed}`);
    }
  });

  it('deals the same board for the same seed and a different one otherwise', () => {
    assert.deepEqual(shuffleChordScheme(DEFAULT_CHORD_SCHEME, 3), shuffleChordScheme(DEFAULT_CHORD_SCHEME, 3));
    const boards = new Set();
    for (let seed = 0; seed < 20; seed += 1) {
      const dealt = shuffleChordScheme(DEFAULT_CHORD_SCHEME, seed);
      boards.add(`${dealt.roots.join()}|${dealt.qualities.join()}`);
    }
    assert.ok(boards.size > 15, `expected mostly distinct deals, got ${boards.size}/20`);
  });

  it('keeps every square reachable after a re-deal', () => {
    const dealt = shuffleChordScheme(DEFAULT_CHORD_SCHEME, 11);
    const board = chordBoard(dealt);
    assert.equal(new Set(Object.values(board).map((chord) => chord.symbol)).size, 64);
    for (const square of SQUARES) {
      const chord = squareToChord(square, dealt);
      assert.equal(chordToSquare(chord.root, chord.quality, dealt), square);
      assert.equal(identifyChord(chord.pitch_classes.map((pc) => 60 + pc), dealt).candidates.some((c) => c.square === square), true);
    }
  });

  it('renders a move as the two chords that perform it', () => {
    const pair = moveToChordPair('e2', 'e4');
    assert.equal(pair.notation, 'Em -> Eadd2');
    assert.equal(pair.from.square, 'e2');
    assert.equal(pair.to.square, 'e4');
    assert.equal(moveToChordPair('e2', 'zz'), null);
  });
});
