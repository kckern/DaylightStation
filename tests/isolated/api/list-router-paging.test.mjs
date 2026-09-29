import { describe, test, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import { createListRouter } from '#backend/src/4_api/v1/routers/list.mjs';
import { ListBrowseService } from '#apps/content/services/ListBrowseService.mjs';
import { RegistryContentCatalogGateway } from '#adapters/content/RegistryContentCatalogGateway.mjs';

/**
 * The Media browse hook (useListBrowse) asks for `?take=N[&skip=M]` and reads
 * `total` to decide whether to load more. The router used to ignore both and
 * send the whole container — a 2811-title Plex library went out as 3.2 MB on
 * every open, slow enough to miss a 30 s runtime budget when the disk was busy.
 */
describe('list router paging', () => {
  let app;
  const leaves = Array.from({ length: 120 }, (_, i) => ({
    id: `plex:${1000 + i}`, title: `Title ${i}`, itemType: 'leaf', mediaUrl: `/stream/${1000 + i}`,
  }));

  beforeEach(() => {
    const adapter = {
      getList: vi.fn().mockResolvedValue(leaves),
      getItem: vi.fn().mockResolvedValue({ id: 'plex:library/sections/6/all', title: 'Movies' }),
      getContainerInfo: vi.fn().mockResolvedValue({ key: 'library/sections/6/all', title: 'Movies', type: 'section' }),
    };
    const contentIdResolver = {
      resolve: vi.fn().mockReturnValue({ adapter, localId: 'library/sections/6/all', source: 'plex' }),
    };
    const registry = { get: () => adapter };
    const router = createListRouter({
      listBrowse: new ListBrowseService({
        contentCatalog: new RegistryContentCatalogGateway({ registry }), contentIdResolver,
      }),
      logger: { info: vi.fn(), warn: vi.fn() },
    });
    app = express();
    app.use('/api/v1/list', router);
  });

  test('take returns the first page and the full total', async () => {
    const res = await request(app).get('/api/v1/list/plex/library/sections/6/all?take=50');
    expect(res.status).toBe(200);
    expect(res.body.items.map(i => i.id)).toEqual(leaves.slice(0, 50).map(i => i.id));
    expect(res.body.total).toBe(120);
  });

  test('take+skip returns the requested window, and the last page is short', async () => {
    const mid = await request(app).get('/api/v1/list/plex/library/sections/6/all?take=50&skip=50');
    expect(mid.body.items.map(i => i.id)).toEqual(leaves.slice(50, 100).map(i => i.id));
    expect(mid.body.total).toBe(120);
    const last = await request(app).get('/api/v1/list/plex/library/sections/6/all?take=50&skip=100');
    expect(last.body.items).toHaveLength(20);
    const past = await request(app).get('/api/v1/list/plex/library/sections/6/all?take=50&skip=500');
    expect(past.body.items).toEqual([]);
    expect(past.body.total).toBe(120);
  });

  test('without take the whole list is returned, as every other caller expects', async () => {
    const res = await request(app).get('/api/v1/list/plex/library/sections/6/all');
    expect(res.body.items).toHaveLength(120);
    expect(res.body.total).toBe(120);
  });

  describe('when the source can page', () => {
    let adapter;
    let pagedApp;
    beforeEach(() => {
      adapter = {
        getList: vi.fn().mockResolvedValue(leaves),
        getListPage: vi.fn(async (_id, { skip, take }) => ({ items: leaves.slice(skip, skip + take), total: leaves.length })),
        getItem: vi.fn().mockResolvedValue({ id: 'plex:library/sections/6/all', title: 'Movies' }),
        getContainerInfo: vi.fn().mockResolvedValue({ key: 'library/sections/6/all', title: 'Movies', type: 'section' }),
      };
      const contentIdResolver = {
        resolve: vi.fn().mockReturnValue({ adapter, localId: 'library/sections/6/all', source: 'plex' }),
      };
      const router = createListRouter({
        listBrowse: new ListBrowseService({
          contentCatalog: new RegistryContentCatalogGateway({ registry: { get: () => adapter } }), contentIdResolver,
        }),
        logger: { info: vi.fn(), warn: vi.fn() },
      });
      pagedApp = express();
      pagedApp.use('/api/v1/list', router);
    });

    test('asks the source for the window instead of fetching the whole container', async () => {
      const res = await request(pagedApp).get('/api/v1/list/plex/library/sections/6/all?take=50&skip=50');
      expect(adapter.getListPage).toHaveBeenCalledWith('plex:library/sections/6/all', { skip: 50, take: 50 });
      expect(adapter.getList).not.toHaveBeenCalled();
      expect(res.body.items.map(i => i.id)).toEqual(leaves.slice(50, 100).map(i => i.id));
      expect(res.body.total).toBe(120);
    });

    test('a reordering modifier still reads the whole container, then slices', async () => {
      const res = await request(pagedApp).get('/api/v1/list/plex/library/sections/6/all/recent_on_top?take=50');
      expect(adapter.getListPage).not.toHaveBeenCalled();
      expect(adapter.getList).toHaveBeenCalled();
      expect(res.body.items).toHaveLength(50);
      expect(res.body.total).toBe(120);
    });

    test('a source that declines to page (null) falls back to the whole list, sliced', async () => {
      adapter.getListPage.mockResolvedValue(null);
      const res = await request(pagedApp).get('/api/v1/list/plex/library/sections/6/all?take=50&skip=100');
      expect(adapter.getList).toHaveBeenCalled();
      expect(res.body.items.map(i => i.id)).toEqual(leaves.slice(100).map(i => i.id));
      expect(res.body.total).toBe(120);
    });

    test('without take the source is never asked to page', async () => {
      await request(pagedApp).get('/api/v1/list/plex/library/sections/6/all');
      expect(adapter.getListPage).not.toHaveBeenCalled();
    });
  });

  test('an invalid take or skip is ignored rather than truncating the list', async () => {
    for (const q of ['take=0', 'take=-5', 'take=abc', 'take=50&skip=-1', 'take=50&skip=x']) {
      const res = await request(app).get(`/api/v1/list/plex/library/sections/6/all?${q}`);
      const expected = q.startsWith('take=50') ? 50 : 120;
      expect({ q, n: res.body.items.length }).toEqual({ q, n: expected });
    }
  });
});
