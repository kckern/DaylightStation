import { describe, it, expect } from 'vitest';
import { deepMerge } from '#system/utils/deepMerge.mjs';

describe('deepMerge (system SSOT)', () => {
  it('merges nested objects recursively', () => {
    expect(deepMerge(
      { a: 1, nested: { x: 1, y: 2 } },
      { nested: { y: 3, z: 4 } }
    )).toEqual({ a: 1, nested: { x: 1, y: 3, z: 4 } });
  });

  it('replaces arrays wholesale (override wins, no concat)', () => {
    expect(deepMerge({ w: [1, 2, 3] }, { w: [9] })).toEqual({ w: [9] });
  });

  it('skips undefined override values (base preserved)', () => {
    expect(deepMerge({ a: 1 }, { a: undefined })).toEqual({ a: 1 });
  });

  it('treats a null base as replaceable by the override', () => {
    expect(deepMerge(null, { a: 1 })).toEqual({ a: 1 });
    expect(deepMerge({ a: null }, { a: { b: 2 } })).toEqual({ a: { b: 2 } });
  });

  it('does not mutate the base object', () => {
    const base = { nested: { x: 1 } };
    deepMerge(base, { nested: { y: 2 } });
    expect(base).toEqual({ nested: { x: 1 } });
  });
});
