import { describe, it, expect } from 'vitest';
import { collapseInactiveGroups } from './band.js';

/** A placed rail entry, as `placedRailSegments` yields it. */
const at = (index, part, over = {}) => ({
  index,
  segment: {
    contentId: 'w1',
    name: `no ${index}`,
    offset: index * 10,
    duration: 10,
    groupPath: [{ index: part, title: `Part ${part}` }, { index: part * 10, title: 'Scene' }],
    ...over,
  },
});

/** Three Parts, three numbers each. */
const RAIL = [
  at(0, 1), at(1, 1), at(2, 1),
  at(3, 2), at(4, 2), at(5, 2),
  at(6, 3), at(7, 3), at(8, 3),
];

describe('collapseInactiveGroups', () => {
  it('draws the active group in full and folds each other group to one segment', () => {
    const out = collapseInactiveGroups(RAIL, { activeGroupIndex: 2, depth: 0 });
    expect(out).toHaveLength(5); // [Part 1] + 3 numbers + [Part 3]
    expect(out[0].segment.collapsed).toBe(true);
    expect(out[1].segment.name).toBe('no 3');
    expect(out[2].segment.name).toBe('no 4');
    expect(out[3].segment.name).toBe('no 5');
    expect(out[4].segment.collapsed).toBe(true);
  });

  it('names a folded segment for the group it stands in for', () => {
    const [first] = collapseInactiveGroups(RAIL, { activeGroupIndex: 2, depth: 0 });
    expect(first.segment.name).toBe('Part 1');
  });

  it('gives a folded segment the whole duration of what it replaced', () => {
    const [first] = collapseInactiveGroups(RAIL, { activeGroupIndex: 2, depth: 0 });
    expect(first.segment.duration).toBe(30);
    expect(first.segment.offset).toBe(0);
    expect(first.segment.count).toBe(3);
  });

  it('keeps the rail on one unbroken axis — no time is created or lost', () => {
    const total = (list) => list.reduce((n, p) => n + p.segment.duration, 0);
    const out = collapseInactiveGroups(RAIL, { activeGroupIndex: 2, depth: 0 });
    expect(total(out)).toBe(total(RAIL));
    // Every segment starts where the last one stopped.
    out.reduce((cursor, p) => {
      expect(p.segment.offset).toBe(cursor);
      return cursor + p.segment.duration;
    }, 0);
  });

  it('gives a folded segment no rail index, so nothing can resolve as active inside it', () => {
    const out = collapseInactiveGroups(RAIL, { activeGroupIndex: 2, depth: 0 });
    expect(out[0].index).toBeNull();
    // The sounding segments keep the indices the playhead is resolved against.
    expect(out.slice(1, 4).map((p) => p.index)).toEqual([3, 4, 5]);
  });

  it('folds each leading group SEPARATELY when the last one is active', () => {
    // Two inactive Parts are two folds, not one blob: a fold that spanned both
    // could not name itself, and the name is the only thing it has to offer.
    const out = collapseInactiveGroups(RAIL, { activeGroupIndex: 3, depth: 0 });
    expect(out).toHaveLength(2 + 3);
    expect(out.slice(0, 2).map((p) => p.segment.name)).toEqual(['Part 1', 'Part 2']);
    expect(out.slice(0, 2).map((p) => p.segment.duration)).toEqual([30, 30]);
  });

  it('returns the rail untouched when no group is active', () => {
    expect(collapseInactiveGroups(RAIL, { activeGroupIndex: null, depth: 0 })).toEqual(RAIL);
  });

  it('returns the rail untouched when the active group is the only one', () => {
    const one = [at(0, 1), at(1, 1)];
    expect(collapseInactiveGroups(one, { activeGroupIndex: 1, depth: 0 })).toEqual(one);
  });

  it('leaves a rail with no ancestry alone', () => {
    const bare = [{ index: 0, segment: { name: 'a', offset: 0, duration: 10 } }];
    expect(collapseInactiveGroups(bare, { activeGroupIndex: 1, depth: 0 })).toEqual(bare);
  });

  it('survives an empty rail', () => {
    expect(collapseInactiveGroups([], { activeGroupIndex: 1, depth: 0 })).toEqual([]);
  });
});
