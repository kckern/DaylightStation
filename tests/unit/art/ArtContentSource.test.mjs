import { describe, it, expect } from 'vitest';
import { createArtContentSource } from '../../../backend/src/1_adapters/content/art/ArtContentSource.mjs';
import { validateAdapter } from '../../../backend/src/2_domains/content/services/validateContentSource.mjs';

const fakeArtAdapter = (over = {}) => ({
  getThumbnailUrl: async (preset) => (preset === 'july-4th' ? '/media/img/art/americana/flag/flag.jpg' : null),
  ...over,
});

describe('ArtContentSource', () => {
  it('satisfies the IContentSource contract (registrable)', () => {
    const src = createArtContentSource({ artAdapter: fakeArtAdapter() });
    expect(() => validateAdapter(src)).not.toThrow();
    expect(src.source).toBe('art');
    expect(src.prefixes).toEqual([{ prefix: 'art' }]);
  });

  it('delegates getThumbnailUrl and rewrites to the served static path', async () => {
    const src = createArtContentSource({ artAdapter: fakeArtAdapter() });
    expect(await src.getThumbnailUrl('july-4th')).toBe('/api/v1/static/img/art/americana/flag/flag.jpg');
    expect(await src.getThumbnailUrl('unknown')).toBeNull();
  });

  it('getItem strips the art: prefix and returns a thumbnail-bearing item', async () => {
    const src = createArtContentSource({ artAdapter: fakeArtAdapter() });
    const item = await src.getItem('art:july-4th');
    expect(item).toEqual({ id: 'art:july-4th', title: 'july-4th', thumbnail: '/api/v1/static/img/art/americana/flag/flag.jpg' });
    expect(await src.getItem('art:unknown')).toBeNull();
  });

  it('list/playable/siblings are empty (presets are not generic content)', async () => {
    const src = createArtContentSource({ artAdapter: fakeArtAdapter() });
    expect(await src.getList('art:july-4th')).toEqual([]);
    expect(await src.resolvePlayables('art:july-4th')).toEqual([]);
    expect(await src.resolveSiblings('art:july-4th')).toBeNull();
  });

  it('swallows adapter errors and returns null', async () => {
    const src = createArtContentSource({
      artAdapter: fakeArtAdapter({ getThumbnailUrl: async () => { throw new Error('boom'); } }),
      logger: { warn: () => {} },
    });
    expect(await src.getThumbnailUrl('july-4th')).toBeNull();
  });
});
