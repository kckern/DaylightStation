// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { deepMerge } from './deepMerge.mjs';

describe('deepMerge', () => {
  it('overlays scalars right-over-left', () => {
    expect(deepMerge({ a: 1, b: 2 }, { b: 3 })).toEqual({ a: 1, b: 3 });
  });
  it('merges nested objects, not arrays', () => {
    expect(deepMerge({ g: { mode: 'gate', zone: 'active' } }, { g: { zone: 'warm' } }))
      .toEqual({ g: { mode: 'gate', zone: 'warm' } });
  });
  it('treats arrays as replace-whole', () => {
    expect(deepMerge({ w: [1, 2] }, { w: [3] })).toEqual({ w: [3] });
  });
  it('ignores undefined right values, keeps left', () => {
    expect(deepMerge({ a: 1 }, { a: undefined })).toEqual({ a: 1 });
  });
});
