import { describe, expect, it, vi } from 'vitest';
import { createPresentationRouter } from './presentation.mjs';

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
    const response = invoke(createPresentationRouter({ catalog }), '/catalogs/:packId', { packId: 'demo' });
    expect(response.status).toBe(200); expect(response.body.kind).toBe('presentation-catalog');
    expect(response.body.materials).toEqual({ grass: {} });
    expect(response.body.assets.hero.source).toBeUndefined();
    expect(response.body.assets.hero.source_sha256).toBeUndefined();
    expect(response.body.assets.hero.image_url).toBe('/api/v1/presentation/catalogs/demo/assets/hero/image');
  });

  it('returns a neutral not-found response', async () => {
    const response = invoke(createPresentationRouter({ catalog: { get: () => null } }), '/catalogs/:packId', { packId: 'missing' });
    expect(response.status).toBe(404); expect(response.body.error).toBe('presentation_catalog_not_found');
  });
});
