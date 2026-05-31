import { describe, test, expect } from 'vitest';
import { stripEmpty } from '#api/v1/utils/stripEmpty.mjs';

describe('stripEmpty', () => {
  test('removes null, undefined, empty arrays, and empty objects', () => {
    const input = { a: 1, b: null, c: undefined, d: [], e: {}, f: 'keep' };
    expect(stripEmpty(input)).toEqual({ a: 1, f: 'keep' });
  });

  test('keeps falsy-but-meaningful values 0, false, and empty string', () => {
    const input = { zero: 0, no: false, blank: '' };
    expect(stripEmpty(input)).toEqual({ zero: 0, no: false, blank: '' });
  });

  test('recurses into nested objects and arrays', () => {
    const input = {
      metadata: { city: null, exif: { make: 'samsung', lensModel: null }, people: [] },
      items: [{ id: 'x', tag: null }, { id: 'y', notes: [] }],
    };
    expect(stripEmpty(input)).toEqual({
      metadata: { exif: { make: 'samsung' } },
      items: [{ id: 'x' }, { id: 'y' }],
    });
  });

  test('drops nested objects that become empty after stripping', () => {
    expect(stripEmpty({ a: { b: null }, keep: 1 })).toEqual({ keep: 1 });
  });

  test('returns primitives unchanged', () => {
    expect(stripEmpty('hi')).toBe('hi');
    expect(stripEmpty(0)).toBe(0);
  });
});
