import { describe, it, expect } from 'vitest';
import { itemMenuEntries, splitItemMenu } from './itemMenuTable.js';

// Keep on Phone wherever audio items have menus (lifecycle spec §3.2): a row's ⋯, a
// tile's ⋯ and the info view's More.
const keep = [{ kind: 'keepOn:phone@install-aaaa-1111', label: 'Keep on Phone · SM-S921U' }, { kind: 'keepOn:phone@install-bbbb-2222', label: 'Keep on Phone · sdk_gphone64' }];

describe('itemMenuEntries keep slot', () => {
  for (const surface of ['row', 'tile', 'detail']) {
    it(`${surface}: every phone install is an entry, behind More on rows and tiles`, () => {
      const entries = itemMenuEntries({ surface, kind: 'collection', keep });
      expect(entries.filter((e) => /^keepOn:/.test(e.kind ?? '')).map((e) => e.label)).toEqual(keep.map((k) => k.label));
      if (surface !== 'detail') {
        const split = splitItemMenu(entries);
        expect(split.filter((e) => /^keepOn:/.test(e.kind ?? '')).every((e) => e.more)).toBe(true);
      }
    });
  }
  it('no phones, no entries (and no stray divider)', () => {
    const entries = itemMenuEntries({ surface: 'detail', kind: 'leaf' });
    expect(entries.some((e) => /keep/i.test(e.kind ?? ''))).toBe(false);
    for (let i = 1; i < entries.length; i++) expect(entries[i].divider && entries[i - 1].divider).toBeFalsy();
  });
});
