import { describe, expect, it, vi } from 'vitest';
import { HttpCatalogListSource } from './HttpCatalogListSource.mjs';

describe('HttpCatalogListSource', () => {
  it('normalizes a successful HTTP response to application input', async () => {
    const fetchImpl = vi.fn(async () => ({
      ok: true,
      json: async () => ({ title: 'Family', items: [{ id: 'one' }] }),
    }));
    const source = new HttpCatalogListSource({ baseUrl: 'http://catalog.test/', fetchImpl });
    await expect(source.getList('plex', 'family')).resolves.toEqual({ title: 'Family', items: [{ id: 'one' }] });
    expect(fetchImpl).toHaveBeenCalledWith('http://catalog.test/api/v1/list/plex/family');
  });

  it('turns an upstream status into a typed adapter error for API translation', async () => {
    const source = new HttpCatalogListSource({
      baseUrl: 'http://catalog.test',
      fetchImpl: async () => ({ ok: false, status: 429 }),
    });
    await expect(source.getList('plex', 'family')).rejects.toMatchObject({
      code: 'catalog_list_source_rejected',
      status: 429,
    });
  });
});
