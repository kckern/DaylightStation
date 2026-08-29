import { describe, expect, it, vi } from 'vitest';
import { createItemRouter } from './item.mjs';

function handler(router, method, routePath) {
  return router.stack.find((layer) => layer.route?.path === routePath && layer.route.methods[method])
    .route.stack.at(-1).handle;
}
function response() {
  return {
    statusCode: 200, body: null,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
  };
}

describe('item API translation', () => {
  it('preserves the container envelope and API-owned parent thumbnail URL', async () => {
    const itemService = { get: vi.fn(async () => ({
      kind: 'container', source: 'plex', localId: 'show',
      item: { id: 'plex:show', title: 'Show', itemType: 'container', metadata: { type: 'show' }, thumbnail: '/show.jpg' },
      items: [{ id: 'episode', title: 'Episode' }], info: { seasons: 1 },
      parents: { season1: { index: 1, title: 'Season 1', thumbnail: null, type: 'season' } },
    })) };
    const res = response();
    await handler(createItemRouter({ itemService }), 'get', '/:source{/*splat}')(
      { params: { source: 'plex', splat: ['show'] }, query: {} }, res, (error) => { if (error) throw error; },
    );
    expect(res.body).toMatchObject({
      id: 'plex:show', plex: 'show', source: 'plex', path: 'show', title: 'Show', label: 'Show',
      parents: { season1: { thumbnail: '/api/v1/display/plex/season1' } },
      items: [{ id: 'episode', title: 'Episode' }],
    });
  });

  it('preserves menu-log validation and response bytes from the semantic service', async () => {
    const itemService = { recordMenuSelection: vi.fn(() => ({ 'plex:1': 12 })) };
    const route = handler(createItemRouter({ itemService }), 'post', '/menu-log');
    const missing = response();
    await route({ body: {} }, missing, (error) => { if (error) throw error; });
    expect(missing).toMatchObject({ statusCode: 400, body: { error: 'assetId is required' } });
    const found = response();
    await route({ body: { assetId: 'plex:1' } }, found, (error) => { if (error) throw error; });
    expect(found.body).toEqual({ 'plex:1': 12 });
  });
});
