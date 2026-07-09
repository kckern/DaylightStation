import { describe, it, expect } from 'vitest';
import { baseCourseAndPart } from './normalizePlan.mjs';

describe('baseCourseAndPart', () => {
  it('strips a trailing en-dash part number', () => {
    expect(baseCourseAndPart('Silent Night – Rhumba 1')).toEqual({ base: 'Silent Night – Rhumba', part: 1 });
    expect(baseCourseAndPart('Jazz Swing Rhythm Essentials – 2')).toEqual({ base: 'Jazz Swing Rhythm Essentials', part: 2 });
  });
  it('strips a trailing bare part number', () => {
    expect(baseCourseAndPart('Epic Minor Chords 2')).toEqual({ base: 'Epic Minor Chords', part: 2 });
  });
  it('leaves single-part courses untouched', () => {
    expect(baseCourseAndPart('Altered Dominant Rootless Voicings')).toEqual({ base: 'Altered Dominant Rootless Voicings', part: null });
  });
  it('does not strip a number that is part of the name', () => {
    expect(baseCourseAndPart('5 Jazz Comping Approaches 1')).toEqual({ base: '5 Jazz Comping Approaches', part: 1 });
    expect(baseCourseAndPart('2-5-1 Soloing with Bebop Scales')).toEqual({ base: '2-5-1 Soloing with Bebop Scales', part: null });
  });
});
