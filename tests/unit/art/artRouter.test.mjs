import { describe, it, expect, vi } from 'vitest';
import { createArtRouter } from '../../../backend/src/4_api/v1/routers/art.mjs';

// Find the GET /featured handler in an express router and return it.
function featuredHandler(router) {
  const layer = router.stack.find((l) => l.route?.path === '/featured' && l.route.methods.get);
  return layer.route.stack[layer.route.stack.length - 1].handle;
}
const res = () => {
  const r = { statusCode: 200, body: null };
  r.status = (c) => { r.statusCode = c; return r; };
  r.json = (b) => { r.body = b; return r; };
  return r;
};
const logger = { debug() {}, info() {}, warn() {}, error() {} };

describe('art router /featured', () => {
  it('passes ?collection= to selectFeatured', async () => {
    const selectFeatured = vi.fn(async () => ({ mode: 'single', matte: {}, panels: [] }));
    const router = createArtRouter({ artAdapter: { selectFeatured }, logger });
    await featuredHandler(router)({ query: { collection: 'baroque' } }, res(), () => {});
    expect(selectFeatured).toHaveBeenCalledWith({ collection: 'baroque' });
  });

  it('passes collection: undefined when absent', async () => {
    const selectFeatured = vi.fn(async () => ({ mode: 'single', matte: {}, panels: [] }));
    const router = createArtRouter({ artAdapter: { selectFeatured }, logger });
    await featuredHandler(router)({ query: {} }, res(), () => {});
    expect(selectFeatured).toHaveBeenCalledWith({ collection: undefined });
  });
});
