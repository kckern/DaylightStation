import { describe, test, expect } from '@jest/globals';
import { buildVirtualSeasons } from '../../../frontend/src/modules/Fitness/lib/playlistVirtualSeasons.js';

describe('buildVirtualSeasons', () => {
  test('creates virtual parents and assigns parentId to items', () => {
    const items = Array.from({ length: 45 }, (_, i) => ({
      id: `plex:${1000 + i}`,
      title: `Episode ${i + 1}`,
      label: `Episode ${i + 1}`,
      grandparentTitle: `Show ${Math.floor(i / 3)}`,
      grandparentId: `${100 + Math.floor(i / 3)}`
    }));

    const { parents, items: tagged } = buildVirtualSeasons(items, 20);

    // 45 items / 20 per page = 3 virtual seasons
    expect(Object.keys(parents)).toHaveLength(3);

    // Season indices start at 1 (not 0)
    const indices = Object.values(parents).map(p => p.index);
    expect(indices).toEqual([1, 2, 3]);

    // Season titles are range-based
    const titles = Object.values(parents).map(p => p.title);
    expect(titles).toEqual(['1\u201320', '21\u201340', '41\u201345']);

    // All items have parentId assigned
    expect(tagged.every(item => item.parentId != null)).toBe(true);

    // First 20 items belong to first season
    const firstSeasonId = Object.keys(parents)[0];
    expect(tagged.slice(0, 20).every(item => item.parentId === firstSeasonId)).toBe(true);

    // Items 20-39 belong to second season
    const secondSeasonId = Object.keys(parents)[1];
    expect(tagged.slice(20, 40).every(item => item.parentId === secondSeasonId)).toBe(true);
  });

  test('prefixes labels with show name (ShowName—EpTitle)', () => {
    const items = [
      { id: 'plex:1', label: 'Stretch', grandparentTitle: 'Focus T25', grandparentId: '100' },
      { id: 'plex:2', label: 'Cool Down', grandparentTitle: 'P90X', grandparentId: '200' },
      { id: 'plex:3', title: 'Recovery', grandparentId: '300' } // no grandparentTitle
    ];

    const { items: tagged } = buildVirtualSeasons(items, 20);

    expect(tagged[0].label).toBe('Focus T25\u2014Stretch');
    expect(tagged[1].label).toBe('P90X\u2014Cool Down');
    expect(tagged[2].label).toBe('Recovery'); // no show name, unchanged
  });

  test('assigns unique show thumbnails per season', () => {
    // 9 items, 3 per page = 3 seasons
    // Page 1: [A, A, A] → picks A (first unused). used={A}
    // Page 2: [A, A, B] → skips A (used), picks B. used={A,B}
    // Page 3: [A, B, C] → skips A (used), skips B (used), picks C. used={A,B,C}
    const items = [
      { id: '1', label: 'E1', grandparentId: 'showA' },
      { id: '2', label: 'E2', grandparentId: 'showA' },
      { id: '3', label: 'E3', grandparentId: 'showA' },
      { id: '4', label: 'E4', grandparentId: 'showA' },
      { id: '5', label: 'E5', grandparentId: 'showA' },
      { id: '6', label: 'E6', grandparentId: 'showB' },
      { id: '7', label: 'E7', grandparentId: 'showA' },
      { id: '8', label: 'E8', grandparentId: 'showB' },
      { id: '9', label: 'E9', grandparentId: 'showC' }
    ];

    const { parents } = buildVirtualSeasons(items, 3, {
      resolveShowImage: (gpId) => `/img/${gpId}`
    });

    const thumbs = Object.values(parents).map(p => p.thumbnail);
    expect(thumbs[0]).toBe('/img/showA');
    expect(thumbs[1]).toBe('/img/showB'); // skips A (used)
    expect(thumbs[2]).toBe('/img/showC'); // skips A and B (both used)
  });

  test('handles items fewer than page size (single season)', () => {
    const items = Array.from({ length: 5 }, (_, i) => ({
      id: `plex:${i}`,
      label: `Episode ${i + 1}`
    }));

    const { parents } = buildVirtualSeasons(items, 20);

    expect(Object.keys(parents)).toHaveLength(1);
    expect(Object.values(parents)[0].title).toBe('1\u20135');
    expect(Object.values(parents)[0].index).toBe(1);
  });

  test('handles empty items', () => {
    const { parents, items: tagged } = buildVirtualSeasons([], 20);
    expect(Object.keys(parents)).toHaveLength(0);
    expect(tagged).toHaveLength(0);
  });

  test('respects custom page size', () => {
    const items = Array.from({ length: 30 }, (_, i) => ({
      id: `plex:${i}`,
      label: `Episode ${i + 1}`
    }));

    const { parents } = buildVirtualSeasons(items, 10);

    expect(Object.keys(parents)).toHaveLength(3);
    const titles = Object.values(parents).map(p => p.title);
    expect(titles).toEqual(['1\u201310', '11\u201320', '21\u201330']);
  });
});
