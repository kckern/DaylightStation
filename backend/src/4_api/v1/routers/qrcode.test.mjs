import { describe, expect, it, vi } from 'vitest';
import { createQRCodeRouter } from './qrcode.mjs';
import { createGenerateQRCode } from '../../../3_applications/qrcode/GenerateQRCode.mjs';

function routeHandler(router) {
  return router.stack.find((layer) => layer.route?.path === '/' && layer.route.methods.get)
    .route.stack[0].handle;
}

function response() {
  const res = {
    statusCode: 200,
    headers: {},
    body: undefined,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
    setHeader(name, value) { this.headers[name] = value; },
    send(body) { this.body = body; return this; },
  };
  return res;
}

function makeRouter(overrides = {}) {
  const logger = { error: vi.fn(), warn: vi.fn(), debug: vi.fn() };
  const contentExpression = overrides.contentExpression || {
    fromQuery: () => ({
      screen: null,
      action: 'play',
      contentId: 'plex:1',
      options: {},
    }),
  };
  const operationConfig = {
    createContentExpression: vi.fn(() => ({ toString: () => 'play:plex:1' })),
    knownCommands: ['pause'],
    renderer: { renderSvg: vi.fn((data, options) => JSON.stringify({ data, options })) },
    assetGateway: {
      loadCommandIcon: vi.fn(async () => null),
      loadOptionBadges: vi.fn(async () => []),
      loadDefaultLogo: vi.fn(async () => null),
      fetchThumbnail: vi.fn(async () => null),
    },
    logger,
    ...overrides,
  };
  delete operationConfig.contentExpression;
  return createQRCodeRouter({
    generateQRCode: createGenerateQRCode(operationConfig),
    contentExpression,
    logger,
  });
}

describe('QR code router dependency boundary', () => {
  it('uses the injected expression factory and preserves the action payload', async () => {
    const createContentExpression = vi.fn(() => ({ toString: () => 'play:plex:1' }));
    const router = makeRouter({ createContentExpression });
    const res = response();

    await routeHandler(router)({ query: { play: 'plex:1', logo: 'false' } }, res);

    expect(createContentExpression).toHaveBeenCalledWith({
      screen: null,
      action: 'play',
      contentId: 'plex:1',
      options: {},
    });
    expect(res.statusCode).toBe(200);
    expect(res.headers['Content-Type']).toBe('image/svg+xml');
    expect(JSON.parse(res.body).data).toBe('play:plex:1');
  });

  it('uses injected command names without a domain import', async () => {
    const renderer = { renderSvg: vi.fn(() => '<svg/>') };
    const router = makeRouter({
      renderer,
      contentExpression: { fromQuery: () => ({ action: null, options: {} }) },
    });
    const res = response();

    await routeHandler(router)({ query: { data: 'pause', logo: 'false' } }, res);

    expect(res.statusCode).toBe(200);
    expect(renderer.renderSvg).toHaveBeenCalledWith('pause', expect.objectContaining({ label: 'PAUSE' }));
  });
});
