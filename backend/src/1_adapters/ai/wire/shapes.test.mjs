import { describe, it, expect } from 'vitest';
import { isTable, isEncodableData, templateShape } from './shapes.mjs';

describe('isTable', () => {
  it('accepts objects of primitives sharing one key set, in any key order', () => {
    expect(isTable([{ a: 1, b: 'x' }, { b: 'y', a: 2 }], 2)).toBe(true);
  });
  it('rejects differing key sets, nested values, and too few rows', () => {
    expect(isTable([{ a: 1 }, { b: 2 }], 2)).toBe(false);
    expect(isTable([{ a: { n: 1 } }, { a: { n: 2 } }], 2)).toBe(false);
    expect(isTable([{ a: 1 }], 2)).toBe(false);
  });
});

describe('isEncodableData', () => {
  it('accepts a top-level table of 2+ rows', () => {
    expect(isEncodableData([{ a: 1 }, { a: 2 }])).toBe(true);
  });
  it('accepts an object of primitives plus 2+-row tables', () => {
    expect(isEncodableData({ date: 'd', items: [{ a: 1 }, { a: 2 }] })).toBe(true);
  });
  it('rejects single objects and one-row arrays', () => {
    expect(isEncodableData({ name: 'Rice', grams: 158 })).toBe(false);
    expect(isEncodableData([{ a: 1 }])).toBe(false);
  });
});

describe('templateShape', () => {
  it('describes a one-array template with scalar siblings', () => {
    expect(templateShape({ date: 'YYYY-MM-DD', items: [{ name: 'Food', grams: 100, dish: 'Smoothie' }] })).toEqual({
      kind: 'table', arrayKey: 'items', columns: ['name', 'grams', 'dish'], scalarKeys: ['date'], stringColumns: ['name', 'dish'], numberColumns: ['grams'],
    });
  });
  it('calls a template with no array flat (even with a nested object)', () => {
    expect(templateShape({ name: '', volume: { amount: 1, unit: 'cup' } })).toEqual({ kind: 'flat' });
  });
  it('returns null (ambiguous) for two arrays, nested rows, or array plus nested object', () => {
    expect(templateShape({ a: [{ x: 1 }], b: [{ y: 1 }] })).toBeNull();
    expect(templateShape({ a: [{ x: { y: 1 } }] })).toBeNull();
    expect(templateShape({ a: [{ x: 1 }], meta: { k: 1 } })).toBeNull();
    expect(templateShape([{ x: 1 }])).toBeNull();
  });
});
