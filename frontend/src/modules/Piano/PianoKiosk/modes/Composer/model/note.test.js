import { describe, it, expect } from 'vitest';
import { makeNote, makeRest, noteDivisions } from './note.js';

describe('makeNote', () => {
  it('builds a pitched note with cached midi (C4=60) and defaults', () => {
    const n = makeNote({ step: 'C', octave: 4 }, { type: 'quarter' });
    expect(n).toMatchObject({
      rest: false, pitch: { step: 'C', octave: 4, alter: 0 }, midi: 60,
      type: 'quarter', dots: 0, tie: null, triplet: false, chord: false, staff: 1, voice: 1,
    });
  });
  it('honors dots and alter (F#4 = 66, dotted)', () => {
    const n = makeNote({ step: 'F', octave: 4, alter: 1 }, { type: 'quarter', dots: 1 });
    expect(n.midi).toBe(66);
    expect(n.dots).toBe(1);
  });
  it('carries note.tuplet through opts so a rebuild cannot bypass the non-3:2 guard (C5)', () => {
    const note = makeNote({ step: 'C', octave: 4 }, { type: '16th' });
    note.tuplet = { actual: 5, normal: 4 }; // a quintuplet parsed from an import
    const rebuilt = makeNote(note.pitch, { ...note }); // e.g. replacePitch/nudgePitch path
    expect(rebuilt.tuplet).toEqual({ actual: 5, normal: 4 });
  });
});

describe('makeRest', () => {
  it('builds a rest (no pitch, no midi)', () => {
    const r = makeRest({ type: 'half' });
    expect(r.rest).toBe(true);
    expect(r.pitch).toBeUndefined();
    expect(r.type).toBe('half');
  });
});

describe('noteDivisions', () => {
  it('quarter = 24', () => { expect(noteDivisions(makeNote({ step: 'C', octave: 4 }, { type: 'quarter' }))).toBe(24); });
  it('dotted half = 72', () => { expect(noteDivisions(makeRest({ type: 'half', dots: 1 }))).toBe(72); });
  it('8th triplet = 8', () => { expect(noteDivisions(makeRest({ type: 'eighth', triplet: true }))).toBe(8); });
});
