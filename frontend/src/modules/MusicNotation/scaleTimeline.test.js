import { describe, it, expect } from 'vitest';
import { scaleTimeline } from './scoreTimeline.js';

describe('scaleTimeline', () => {
  it('factor 1 is identity (new array, same t)', () => {
    const tl = [{ t: 0, i: 0 }, { t: 500, i: 1 }];
    const out = scaleTimeline(tl, 1);
    expect(out).toEqual(tl);
    expect(out).not.toBe(tl); // new array
  });
  it('factor 2 slows to half speed (t doubles)', () => {
    expect(scaleTimeline([{ t: 0 }, { t: 500 }, { t: 1000 }], 2)).toEqual([{ t: 0 }, { t: 1000 }, { t: 2000 }]);
  });
  it('factor 0.5 speeds up (t halves)', () => {
    expect(scaleTimeline([{ t: 0 }, { t: 800 }], 0.5)).toEqual([{ t: 0 }, { t: 400 }]);
  });
  it('preserves other fields and order', () => {
    expect(scaleTimeline([{ t: 100, note: 60, type: 'note_on' }], 2)).toEqual([{ t: 200, note: 60, type: 'note_on' }]);
  });
});
