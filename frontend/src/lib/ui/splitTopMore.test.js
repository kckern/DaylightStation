import { describe, it, expect } from 'vitest';
import { splitTopMore } from './splitTopMore.js';

const ids = (list) => list.map((item) => item.id);
const make = (count) => Array.from({ length: count }, (_, i) => ({ id: `i${i}`, name: String.fromCharCode(97 + i) }));

describe('splitTopMore', () => {
  it('shows the top n and puts the rest under More', () => {
    const { top, more } = splitTopMore(make(6), { n: 3 });
    expect(ids(top)).toEqual(['i0', 'i1', 'i2']);
    expect(ids(more)).toEqual(['i3', 'i4', 'i5']);
  });

  it('a short list has no More', () => {
    expect(splitTopMore(make(3), { n: 3 }).more).toEqual([]);
    expect(splitTopMore([], { n: 3 })).toEqual({ top: [], more: [] });
  });

  it('never hides exactly one item behind More', () => {
    const { top, more } = splitTopMore(make(4), { n: 3 });
    expect(ids(top)).toEqual(['i0', 'i1', 'i2', 'i3']);
    expect(more).toEqual([]);
  });

  it('ranks with the comparator without changing the input', () => {
    const items = make(5);
    const { top } = splitTopMore(items, { n: 2, rank: (a, b) => b.name.localeCompare(a.name) });
    expect(ids(top)).toEqual(['i4', 'i3']);
    expect(ids(items)).toEqual(['i0', 'i1', 'i2', 'i3', 'i4']);
  });

  it('the active item is never hidden, wherever it ranks, and keeps its ranked place', () => {
    const { top, more } = splitTopMore(make(8), { n: 3, keepIds: ['i6'] });
    expect(ids(top)).toEqual(['i0', 'i1', 'i2', 'i6']);
    expect(more.some((item) => item.id === 'i6')).toBe(false);
    expect(ids(more)).toEqual(['i3', 'i4', 'i5', 'i7']);
  });

  it('a kept item is shown even when it may not go on top', () => {
    const { top } = splitTopMore(make(6), { n: 2, keepIds: ['i5'], canTop: (item) => item.id !== 'i5' });
    expect(ids(top)).toEqual(['i0', 'i1', 'i5']);
  });

  it('items that may not go on top go under More and leave their slot to the next', () => {
    const { top, more } = splitTopMore(make(6), { n: 3, canTop: (item) => item.id !== 'i1' });
    expect(ids(top)).toEqual(['i0', 'i2', 'i3']);
    expect(ids(more)).toEqual(['i1', 'i4', 'i5']);
  });

  it('reads ids through getId', () => {
    const rows = make(6).map((item) => ({ key: item.id }));
    const { top } = splitTopMore(rows, { n: 2, keepIds: ['i4'], getId: (row) => row.key });
    expect(top.map((row) => row.key)).toEqual(['i0', 'i1', 'i4']);
  });
});
