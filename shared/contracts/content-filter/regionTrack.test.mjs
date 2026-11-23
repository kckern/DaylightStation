import { describe, it, expect } from 'vitest';
import { hasSighting, isTrackGap } from './regionTrack.mjs';

describe('regionTrack', () => {
  it('a keyframe with cells or whole-frame is a sighting; an empty one is a gap', () => {
    expect(isTrackGap({ in: 1, cells: [] , box: null })).toBe(true);
    expect(isTrackGap({ in: 1, cells: [4] })).toBe(false);
    expect(isTrackGap({ in: 1, whole: true })).toBe(false);
  });
  it('a track needs one sighting', () => {
    expect(hasSighting(undefined)).toBe(false);
    expect(hasSighting([])).toBe(false);
    expect(hasSighting([{ in: 1, cells: [], box: null }, { in: 2 }])).toBe(false);
    expect(hasSighting([{ in: 1, cells: [] }, { in: 2, cells: [7] }])).toBe(true);
  });
});
