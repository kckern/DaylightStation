import { describe, expect, it } from 'vitest';
import { beatLoopPosition } from './beatLoop.js';

const grid = { anchorMs: 1000, periodMs: 500, beats: 4 };
describe('beatLoopPosition', () => {
  it('is unlit until the first click sounds', () => {
    expect(beatLoopPosition({ ...grid, nowMs: 999 })).toEqual({ beat: 0, beats: 4, index: -1 });
  });
  it('steps through the bar and starts over on beat 1', () => {
    const at = (nowMs) => beatLoopPosition({ ...grid, nowMs }).beat;
    expect([1000, 1499, 1500, 2000, 2500, 3000, 3500, 4999].map(at)).toEqual([1, 1, 2, 3, 4, 1, 2, 4]);
  });
  it('counts clicks since the first', () => {
    expect(beatLoopPosition({ ...grid, nowMs: 3000 }).index).toBe(4);
  });
  it('is null for a grid it cannot read', () => {
    expect(beatLoopPosition({ ...grid, nowMs: 1, periodMs: 0 })).toBeNull();
    expect(beatLoopPosition({ ...grid, nowMs: NaN })).toBeNull();
    expect(beatLoopPosition({ ...grid, nowMs: 1, beats: 0 })).toBeNull();
  });
});
