import { describe, it, expect } from 'vitest';
import { applyTimingDrafts } from './timingDrafts.js';

// Owner, 2026-11-22: "I can't hear what I did unless I save the timing": an unsaved timing draft plays.
describe('applyTimingDrafts', () => {
  const cues = [{ id: 'w1', in: 10, out: 11, effect: 'mute' }, { id: 'w1~p2', in: 30, out: 31 }, { id: 'w2', in: 20, out: 21 }];
  it('moves the edges of a drafted cue, by id or base id, and leaves the rest', () => {
    const out = applyTimingDrafts(cues, { w1: [9.5, 11.4] });
    expect(out[0]).toEqual({ id: 'w1', in: 9.5, out: 11.4, effect: 'mute' });
    expect(out[2]).toBe(cues[2]);
  });
  it('returns the same array with no drafts', () => {
    expect(applyTimingDrafts(cues, {})).toBe(cues);
    expect(applyTimingDrafts(cues, null)).toBe(cues);
  });
  it('ignores a draft that is not a forward span', () => {
    expect(applyTimingDrafts(cues, { w2: [21, 20] })[2]).toBe(cues[2]);
  });
});
