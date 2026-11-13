import { describe, it, expect } from 'vitest';
import { lessonScaleRoot, checkInRoots } from './lessonKey.mjs';
import { checkInDrillFor, checkInStepFor } from './presenceLadder.mjs';
import { SCALE_ROOTS } from '../../browser/PianoKiosk/modes/Games/gateMaterial.js';

describe('lessonScaleRoot', () => {
  it.each([
    ['01 Left Hand C Position', 'C'],
    ['05 Right Hand G Position', 'G'],
    ['A Major Scale, Hands Separate & Together, 2 Octaves', 'A'],
    ['B Major & Minor Improvisation', 'B'],
    ['Bb Major Scale', 'A#'],
    ['F# Position Warm-up', 'F#'],
    ['Songs in the key of D', 'D'],
    ['Basic Groove, Pentatonic Scale, C Scale Harmonies', 'C'],
  ])('lessonScaleRoot(%j) → %s', (t, r) => expect(lessonScaleRoot(t)).toBe(r));

  it.each([
    '4 Ways to Build a Major 7 Chord, Major 7 Chord Shapes & Chord Symbols',
    'Beethoven’s Sonata in F Minor, Op. 2, No. 1',
    'Introduction', '', null,
  ])('no key in %j', (t) => expect(lessonScaleRoot(t)).toBeNull());
});

describe('checkInRoots', () => {
  it('title wins, then config, then C/G/F', () => {
    expect(checkInRoots({ title: '03 Right Hand G Position', drillRoots: ['D'] })).toEqual({ roots: ['G'], source: 'title' });
    expect(checkInRoots({ title: 'Introduction', drillRoots: ['D', 'A'] })).toEqual({ roots: ['D', 'A'], source: 'config' });
    expect(checkInRoots({ title: 'Introduction' })).toEqual({ roots: ['C', 'G', 'F'], source: 'default' });
  });

  it('flat config roots are spelt as the drill knows them', () => {
    expect(checkInRoots({ title: 'Introduction', drillRoots: ['Bb', 'Eb', 'G'] })).toEqual({ roots: ['A#', 'D#', 'G'], source: 'config' });
  });

  it('a flat-key title deals a loadable check-in drill', () => {
    const spec = checkInDrillFor(checkInStepFor(1), { roots: checkInRoots({ title: 'Bb Major Scale' }).roots });
    expect(spec.roots[0]).toBe('A#');
    expect(SCALE_ROOTS).toContain(spec.roots[0]);
  });
});
