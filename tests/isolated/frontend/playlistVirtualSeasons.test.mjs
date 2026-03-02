import { describe, test, expect } from '@jest/globals';
import { buildVirtualSeasons } from '../../../frontend/src/modules/Fitness/lib/playlistVirtualSeasons.js';

describe('buildVirtualSeasons', () => {
  test('creates virtual parents and assigns parentId to items', () => {
    const items = Array.from({ length: 45 }, (_, i) => ({
      id: `plex:${1000 + i}`,
      title: `Episode ${i + 1}`
    }));

    const { parents, items: tagged } = buildVirtualSeasons(items, 20);

    // 45 items / 20 per page = 3 virtual seasons
    expect(Object.keys(parents)).toHaveLength(3);

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

  test('handles items fewer than page size (single season)', () => {
    const items = Array.from({ length: 5 }, (_, i) => ({
      id: `plex:${i}`,
      title: `Episode ${i + 1}`
    }));

    const { parents, items: tagged } = buildVirtualSeasons(items, 20);

    expect(Object.keys(parents)).toHaveLength(1);
    expect(Object.values(parents)[0].title).toBe('1\u20135');
  });

  test('handles empty items', () => {
    const { parents, items: tagged } = buildVirtualSeasons([], 20);
    expect(Object.keys(parents)).toHaveLength(0);
    expect(tagged).toHaveLength(0);
  });

  test('respects custom page size', () => {
    const items = Array.from({ length: 30 }, (_, i) => ({
      id: `plex:${i}`,
      title: `Episode ${i + 1}`
    }));

    const { parents } = buildVirtualSeasons(items, 10);

    expect(Object.keys(parents)).toHaveLength(3);
    const titles = Object.values(parents).map(p => p.title);
    expect(titles).toEqual(['1\u201310', '11\u201320', '21\u201330']);
  });
});
