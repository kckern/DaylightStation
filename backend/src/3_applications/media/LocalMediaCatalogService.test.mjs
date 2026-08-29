import { describe, expect, it, vi } from 'vitest';
import { LocalMediaCatalogService } from './LocalMediaCatalogService.mjs';

describe('LocalMediaCatalogService', () => {
  it('reports unavailable without touching infrastructure', async () => {
    const service = new LocalMediaCatalogService({ source: null });
    await expect(service.roots()).resolves.toEqual({ kind: 'unavailable' });
    await expect(service.reindex()).resolves.toEqual({ kind: 'unavailable' });
  });

  it('reindexes all roots and preserves the legacy file-count semantics', async () => {
    const source = {
      clearCache: vi.fn(),
      getRoots: vi.fn().mockResolvedValue([{ path: 'a' }, { path: 'b' }]),
      getList: vi.fn().mockResolvedValueOnce([1, 2]).mockResolvedValueOnce({ children: [3] }),
    };
    const service = new LocalMediaCatalogService({ source });
    await expect(service.reindex()).resolves.toEqual({ kind: 'completed', roots: 2, files: 3 });
    expect(source.clearCache).toHaveBeenCalledOnce();
  });
});
