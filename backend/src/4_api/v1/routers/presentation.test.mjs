import { describe, expect, it, vi } from 'vitest';
import { createPresentationRouter } from './presentation.mjs';
import { GetPublicPresentationCatalog } from '#apps/presentation/GetPublicPresentationCatalog.mjs';

function invoke(router, routePath, params) {
  const layer = router.stack.find((entry) => entry.route?.path === routePath); const result = { status: 200, body: null };
  const response = { status(value) { result.status = value; return this; }, json(value) { result.body = value; return this; } };
  layer.route.stack[0].handle({ params, headers: {} }, response); return result;
}

describe('presentation API', () => {
  it('publishes neutral v2 catalog metadata and hides filesystem integrity fields', async () => {
    const catalog = {
      get: vi.fn(() => ({ schema_version: 2, kind: 'presentation-catalog', pack: { id: 'demo' }, style_profiles: {}, materials: { grass: {} }, terrain_interfaces: {}, assets: {
        hero: { status: 'approved', source: 'assets/hero.png', source_sha256: 'a'.repeat(64), pixel_density: 1, world: {} },
      } })),
      getAsset: vi.fn(),
    };
    const response = invoke(createPresentationRouter({ catalog, getPublicCatalog: new GetPublicPresentationCatalog({ catalog }) }), '/catalogs/:packId', { packId: 'demo' });
    expect(response.status).toBe(200); expect(response.body.kind).toBe('presentation-runtime-catalog');
    expect(response.body.materials).toEqual({ grass: {} });
    expect(response.body.assets.hero.source).toBeUndefined();
    expect(response.body.assets.hero.source_sha256).toBeUndefined();
    expect(response.body.assets.hero.image_url).toBe('/api/v1/presentation/catalogs/demo/assets/hero/image');
  });

  it('returns a neutral not-found response', async () => {
    const catalog = { get: () => null };
    const response = invoke(createPresentationRouter({ catalog, getPublicCatalog: new GetPublicPresentationCatalog({ catalog }) }), '/catalogs/:packId', { packId: 'missing' });
    expect(response.status).toBe(404); expect(response.body.error).toBe('presentation_catalog_not_found');
  });

  it('publishes mounted scene descriptors and individual validated scenes', () => {
    const scene = { schema_version: 2, kind: 'top-down-scene', id: 'oasis', catalog: 'demo' };
    const catalog = {
      get: vi.fn(), getAsset: vi.fn(),
      listScenes: vi.fn(() => ({ pack_id: 'demo', scenes: [{ id: 'oasis', theme: 'desert', manifest: 'scenes/oasis.yml' }] })),
      getScene: vi.fn(() => scene),
    };
    const router = createPresentationRouter({ catalog, getPublicCatalog: new GetPublicPresentationCatalog({ catalog }) });
    const index = invoke(router, '/catalogs/:packId/scenes', { packId: 'demo' });
    expect(index.status).toBe(200); expect(index.body.scenes).toEqual([expect.objectContaining({ id: 'oasis', theme: 'desert' })]);
    const loaded = invoke(router, '/catalogs/:packId/scenes/:sceneId', { packId: 'demo', sceneId: 'oasis' });
    expect(loaded.status).toBe(200); expect(loaded.body).toBe(scene);
  });

  it('does not expose scenes outside a registered mounted scene index', () => {
    const catalog = { get: vi.fn(), listScenes: vi.fn(() => null), getScene: vi.fn(() => null) };
    const router = createPresentationRouter({ catalog, getPublicCatalog: new GetPublicPresentationCatalog({ catalog }) });
    expect(invoke(router, '/catalogs/:packId/scenes', { packId: 'missing' }).body.error).toBe('presentation_scene_index_not_found');
    expect(invoke(router, '/catalogs/:packId/scenes/:sceneId', { packId: 'demo', sceneId: '../secret' }).body.error).toBe('presentation_scene_not_found');
  });
});
