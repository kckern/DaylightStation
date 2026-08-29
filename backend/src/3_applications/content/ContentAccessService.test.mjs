import { describe, expect, it, vi } from 'vitest';
import { ContentAccessService } from './ContentAccessService.mjs';

describe('ContentAccessService', () => {
  it('resolves display metadata without exposing the adapter to HTTP', async () => {
    const contentCatalog = {
      getThumbnailUrl: vi.fn().mockResolvedValue(null),
      getItem: vi.fn().mockResolvedValue({ title: 'Work', thumbnail: 'https://host/thumb' }),
    };
    const service = new ContentAccessService({
      contentIdResolver: { resolve: () => ({ source: 'plex', localId: '7' }) },
      contentCatalog,
    });
    await expect(service.display('plex:7', 'plex', '7')).resolves.toEqual({
      kind: 'found', source: 'plex', localId: '7', thumbnailUrl: 'https://host/thumb', title: 'Work',
    });
    expect(contentCatalog.getItem).toHaveBeenCalledWith({ source: 'plex', localId: '7' }, 'plex:7');
  });

  it('preserves queue fallback order and delegates queue resolution', async () => {
    const contentCatalog = {
      getItem: vi.fn(),
      resolvePlayables: vi.fn().mockResolvedValue({ items: ['raw'], audio: { mode: 'stereo' } }),
    };
    const resolver = { resolve: vi.fn((id) => id === 'query:fhe' ? { source: 'query', localId: 'fhe' } : null) };
    const queueService = { resolveQueue: vi.fn().mockResolvedValue([{ id: 'plex:1' }]) };
    const service = new ContentAccessService({ contentIdResolver: resolver, contentCatalog, queueService });
    const result = await service.queue({ compoundId: 'fhe', parsedSource: 'fhe', localId: null, shuffle: true });
    expect(resolver.resolve.mock.calls.map(([id]) => id)).toEqual(['fhe', 'fhe', 'query:fhe']);
    expect(result).toMatchObject({ kind: 'found', source: 'query', finalId: 'query:fhe', audio: { mode: 'stereo' } });
    expect(queueService.resolveQueue).toHaveBeenCalledWith({ items: ['raw'], audio: { mode: 'stereo' } }, 'query', { shuffle: true });
  });
});
