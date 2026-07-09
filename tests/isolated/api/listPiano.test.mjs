// tests/isolated/api/listPiano.test.mjs
import { describe, it, expect } from 'vitest';
import { toListItem } from '#api/v1/routers/list.mjs';

describe('toListItem piano passthrough', () => {
  it('surfaces metadata.piano to the top level', () => {
    const out = toListItem({
      id: 'plex:1', source: 'plex', title: 'X', itemType: 'leaf',
      metadata: { type: 'episode', itemIndex: 1, piano: { course: 'C', styles: ['Jazz Ballads'], category: undefined } },
    });
    expect(out.piano).toEqual({ course: 'C', style: 'Jazz Ballads' });
  });
  it('omits piano when absent', () => {
    const out = toListItem({ id: 'plex:2', source: 'plex', title: 'Y', itemType: 'leaf', metadata: { type: 'episode' } });
    expect(out.piano).toBeUndefined();
  });
});
