import { describe, expect, it } from 'vitest';
import { recognizeHeldSet } from './recognition.js';

const held = (...notes) => new Map(notes.map((note) => [note, {}]));

describe('neutral held-set recognition', () => {
  it('recognizes exact pitches without creating assessment evidence', () => {
    expect(recognizeHeldSet(held(60), { pitches: [60, 64] })).toBe('partial');
    expect(recognizeHeldSet(held(60, 64), { pitches: [60, 64] })).toBe('correct');
    expect(recognizeHeldSet(held(60, 65), { pitches: [60, 64] })).toBe('wrong');
  });

  it('recognizes pitch-class chords and enforces root position by default', () => {
    const chord = { root: 0, pitchClasses: [0, 4, 7] };
    expect(recognizeHeldSet(held(48, 64, 67), chord, { equivalence: 'pitch-class' })).toBe('correct');
    expect(recognizeHeldSet(held(52, 67, 72), chord, { equivalence: 'pitch-class' })).toBe('wrong');
    expect(recognizeHeldSet(held(52, 67, 72), chord, { equivalence: 'pitch-class', bassMustBeRoot: false })).toBe('correct');
  });
});
