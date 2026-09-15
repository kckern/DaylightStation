import { describe, it, expect } from 'vitest';
import {
  inkForHead, keySignatureMarks, keySignatureSpec, letterAtPosition,
} from './keySignatureLayout.js';

describe('keySignatureSpec', () => {
  it('reads the sharps and flats of a major key, in signature order', () => {
    expect(keySignatureSpec('D')).toEqual({ kind: 'sharp', count: 2, letters: ['F', 'C'] });
    expect(keySignatureSpec('Bb')).toEqual({ kind: 'flat', count: 2, letters: ['B', 'E'] });
    expect(keySignatureSpec('A')).toEqual({ kind: 'sharp', count: 3, letters: ['F', 'C', 'G'] });
  });

  it('accepts the printed accidentals as well as the ASCII ones', () => {
    expect(keySignatureSpec('B♭')).toEqual(keySignatureSpec('Bb'));
    expect(keySignatureSpec('F♯')).toEqual(keySignatureSpec('F#'));
  });

  it('C major and no key at all both mean no signature', () => {
    expect(keySignatureSpec('C')).toBeNull();
    expect(keySignatureSpec(null)).toBeNull();
    expect(keySignatureSpec('')).toBeNull();
  });

  it('a key the table cannot name draws nothing rather than guessing', () => {
    expect(keySignatureSpec('C#')).toBeNull();
    expect(keySignatureSpec('H')).toBeNull();
  });
});

describe('keySignatureMarks — where each glyph sits', () => {
  it('treble sharps stand on the printed positions F C G D A E B', () => {
    expect(keySignatureMarks('B', 'treble').map((m) => m.position)).toEqual([8, 5, 9, 6, 3]);
    expect(keySignatureMarks('B', 'treble').every((m) => m.kind === 'sharp')).toBe(true);
  });

  it('bass sharps sit a third lower, as printed', () => {
    expect(keySignatureMarks('D', 'bass').map((m) => m.position)).toEqual([6, 3]);
  });

  it('flats run B E A D G C F on both clefs', () => {
    expect(keySignatureMarks('Ab', 'treble').map((m) => m.position)).toEqual([4, 7, 3, 6]);
    expect(keySignatureMarks('Ab', 'bass').map((m) => m.position)).toEqual([2, 5, 1, 4]);
    expect(keySignatureMarks('Ab', 'bass').map((m) => m.letter)).toEqual(['B', 'E', 'A', 'D']);
  });

  it('is empty for C major and for no key', () => {
    expect(keySignatureMarks('C', 'treble')).toEqual([]);
    expect(keySignatureMarks(null, 'bass')).toEqual([]);
  });
});

describe('letterAtPosition', () => {
  it('reads the treble staff up from E4 on the bottom line', () => {
    expect([0, 1, 2, 3, 4, 5, 6, 7, 8].map((p) => letterAtPosition(p, 'treble')))
      .toEqual(['E', 'F', 'G', 'A', 'B', 'C', 'D', 'E', 'F']);
    expect(letterAtPosition(-2, 'treble')).toBe('C');
  });

  it('reads the bass staff up from G2 on the bottom line', () => {
    expect([0, 1, 2, 3, 4].map((p) => letterAtPosition(p, 'bass'))).toEqual(['G', 'A', 'B', 'C', 'D']);
  });
});

describe('inkForHead — what a notehead carries beside it under a signature', () => {
  // Heads as pitch.js spells them: a sharp is spelled from the natural below,
  // so F# in the treble sits on F's own position (1), and Bb sits on B's (4).
  const fSharp = { position: 1, isSharp: true, isFlat: false };
  const fNatural = { position: 1, isSharp: false, isFlat: false };
  const bFlat = { position: 4, isSharp: false, isFlat: true };
  const gNatural = { position: 2, isSharp: false, isFlat: false };

  it('with no signature, a black key keeps its accidental and a white key has none', () => {
    expect(inkForHead(fSharp, null, 'treble')).toBe('sharp');
    expect(inkForHead(bFlat, null, 'treble')).toBe('flat');
    expect(inkForHead(fNatural, 'C', 'treble')).toBeNull();
  });

  it('a sharp the signature already carries is not drawn again', () => {
    expect(inkForHead(fSharp, 'D', 'treble')).toBeNull();
  });

  it('a natural where the signature says sharp gets a natural sign', () => {
    expect(inkForHead(fNatural, 'D', 'treble')).toBe('natural');
  });

  it('a white key the signature does not touch carries nothing', () => {
    expect(inkForHead(gNatural, 'D', 'treble')).toBeNull();
  });

  it('a flat is covered only by a FLAT signature on its letter', () => {
    expect(inkForHead(bFlat, 'F', 'treble')).toBeNull();
    // A♯ spelled as a sharp on A's line (3) is not covered by B♭'s flat.
    expect(inkForHead({ position: 3, isSharp: true, isFlat: false }, 'F', 'treble')).toBe('sharp');
  });

  it('follows the clef: the same position is a different letter on the bass staff', () => {
    // Position 6 is F3 on the bass staff, which D major sharps.
    expect(inkForHead({ position: 6, isSharp: true, isFlat: false }, 'D', 'bass')).toBeNull();
    expect(inkForHead({ position: 6, isSharp: false, isFlat: false }, 'D', 'bass')).toBe('natural');
  });
});
