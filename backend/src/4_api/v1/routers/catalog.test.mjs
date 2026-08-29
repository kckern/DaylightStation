import { describe, expect, it } from 'vitest';
import { createCatalogRouter } from './catalog.mjs';

function handler(router) {
  return router.stack.find((layer) => layer.route?.path === '/:source/:id').route.stack[0].handle;
}
function response() {
  return {
    statusCode: 200, headers: {}, body: null,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
    setHeader(name, value) { this.headers[name] = value; },
    send(body) { this.body = body; return this; },
  };
}

describe('catalog router', () => {
  it('preserves PDF headers and bytes from the injected operation', async () => {
    const router = createCatalogRouter({
      generateCatalog: async () => ({ kind: 'generated', value: { title: 'Family', pdf: Buffer.from('pdf') } }),
    });
    const res = response();
    await handler(router)({ params: { source: 'plex', id: '1' }, query: {} }, res);
    expect(res.statusCode).toBe(200);
    expect(res.headers).toEqual({
      'Content-Type': 'application/pdf',
      'Content-Disposition': 'inline; filename="Family.pdf"',
    });
    expect(res.body).toEqual(Buffer.from('pdf'));
  });

  it.each([
    [{ kind: 'empty' }, 404, { error: 'No items in list' }],
    [{ kind: 'render_unavailable' }, 500, { error: 'All QR code fetches failed' }],
  ])('translates semantic failures without changing the public envelope', async (outcome, status, body) => {
    const router = createCatalogRouter({ generateCatalog: async () => outcome });
    const res = response();
    await handler(router)({ params: { source: 'plex', id: '1' }, query: {} }, res);
    expect(res).toMatchObject({ statusCode: status, body });
  });

  it('preserves the upstream rejection status without putting HTTP in the use case result', async () => {
    const error = Object.assign(new Error('rejected'), { code: 'catalog_list_source_rejected', status: 503 });
    const router = createCatalogRouter({ generateCatalog: async () => { throw error; } });
    const res = response();
    await handler(router)({ params: { source: 'plex', id: '1' }, query: {} }, res);
    expect(res).toMatchObject({ statusCode: 503, body: { error: 'Failed to fetch list' } });
  });

  it('keeps the generic failure response for unexpected errors', async () => {
    const router = createCatalogRouter({
      generateCatalog: async () => { throw new Error('unexpected'); },
      logger: { error() {} },
    });
    const res = response();
    await handler(router)({ params: { source: 'plex', id: '1' }, query: {} }, res);
    expect(res).toMatchObject({ statusCode: 500, body: { error: 'Catalog generation failed' } });
  });
});
