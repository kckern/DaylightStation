import { describe, expect, it } from 'vitest';
import { DEFAULT_CHORD_SCHEME, chordPitchClasses } from './chordAddress.js';
import { recognizeGesture } from './chordGestures.js';

describe('recognizeGesture', () => {
  it('reads three adjacent semitones as a request for legal moves', () => {
    expect(recognizeGesture([60, 61, 62])).toBe('hint');
  });

  it('reads four adjacent semitones as a request for the best move', () => {
    expect(recognizeGesture([60, 61, 62, 63])).toBe('best');
  });

  it('ignores a two-note semitone pair, which is a legitimate maj7 fragment', () => {
    // B and C are the seventh and root of Cmaj7 — a real partial chord.
    expect(recognizeGesture([59, 60])).toBeNull();
  });

  it('ignores ordinary chords', () => {
    expect(recognizeGesture([60, 64, 67])).toBeNull();
    expect(recognizeGesture([60, 64, 67, 71])).toBeNull();
  });

  it('ignores an octave, which already means take-it-back', () => {
    expect(recognizeGesture([60, 72])).toBeNull();
  });

  it('requires the semitones to be adjacent, not merely close', () => {
    expect(recognizeGesture([60, 61, 63])).toBeNull();
  });

  it('recognises the shape in any octave', () => {
    expect(recognizeGesture([36, 37, 38])).toBe('hint');
  });

  it('never collides with a square: no gesture shape is a subset of any board chord', () => {
    for (const quality of DEFAULT_CHORD_SCHEME.qualities) {
      for (const root of DEFAULT_CHORD_SCHEME.roots) {
        const classes = chordPitchClasses(root, quality);
        // Every 3- and 4-length run of consecutive pitch classes must be absent.
        for (let start = 0; start < 12; start += 1) {
          const run3 = [0, 1, 2].map((i) => (start + i) % 12);
          const run4 = [0, 1, 2, 3].map((i) => (start + i) % 12);
          expect(run3.every((pc) => classes.includes(pc))).toBe(false);
          expect(run4.every((pc) => classes.includes(pc))).toBe(false);
        }
      }
    }
  });
});

describe('the replay gesture', () => {
  it('recognises five adjacent semitones', () => {
    expect(recognizeGesture([60, 61, 62, 63, 64])).toBe('replay');
  });

  it('stays distinct from the other two requests', () => {
    expect(recognizeGesture([60, 61, 62])).toBe('hint');
    expect(recognizeGesture([60, 61, 62, 63])).toBe('best');
  });

  it('is not a chord any square could mean', () => {
    // The whole basis for the gesture vocabulary: no square voices an unbroken
    // semitone run, so this can never collide with move input.
    expect(recognizeGesture([60, 64, 67, 71, 74])).toBeNull();
  });

  it('ignores octave doubling, as the other gestures do', () => {
    expect(recognizeGesture([60, 61, 62, 63, 64, 72])).toBe('replay');
  });
});
