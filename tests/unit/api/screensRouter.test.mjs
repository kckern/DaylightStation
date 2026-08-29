import { describe, expect, it, vi } from 'vitest';
import { createScreensRouter } from '#api/v1/routers/screens.mjs';

function getHandler(router, routePath) {
  const layer = router.stack.find((entry) =>
    entry.route?.path === routePath && entry.route.methods.get);
  return layer.route.stack[layer.route.stack.length - 1].handle;
}

function response() {
  const res = { statusCode: 200, body: null };
  res.status = (statusCode) => { res.statusCode = statusCode; return res; };
  res.json = (body) => { res.body = body; return res; };
  return res;
}

async function call(handler, req) {
  const res = response();
  await handler(req, res, (error) => { if (error) throw error; });
  return res;
}

describe('screens router HTTP translation', () => {
  it('requires the injected application service', () => {
    expect(() => createScreensRouter()).toThrow('screensQueryService');
  });

  it('returns the list service envelope unchanged', async () => {
    const screensQueryService = {
      listScreens: vi.fn().mockResolvedValue({
        screens: [{ id: 'office', name: 'Office', resolution: null }],
      }),
    };
    const router = createScreensRouter({ screensQueryService });

    const res = await call(getHandler(router, '/'), {});

    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({
      screens: [{ id: 'office', name: 'Office', resolution: null }],
    });
  });

  it('preserves the invalid screen ID status and envelope', async () => {
    const screensQueryService = { getScreen: vi.fn() };
    const router = createScreensRouter({ screensQueryService, logger: { warn: vi.fn() } });

    const res = await call(getHandler(router, '/:screenId'), {
      params: { screenId: '../office' },
    });

    expect(res.statusCode).toBe(400);
    expect(res.body).toEqual({
      error: 'Invalid screen ID',
      message: 'Screen ID must contain only letters, numbers, hyphens, and underscores',
    });
    expect(screensQueryService.getScreen).not.toHaveBeenCalled();
  });

  it('preserves the not-found status and envelope', async () => {
    const screensQueryService = {
      getScreen: vi.fn().mockResolvedValue({ outcome: 'not-found' }),
    };
    const router = createScreensRouter({ screensQueryService });

    const res = await call(getHandler(router, '/:screenId'), {
      params: { screenId: 'missing' },
    });

    expect(res.statusCode).toBe(404);
    expect(res.body).toEqual({ error: 'Screen not found', screenId: 'missing' });
  });

  it('preserves invalid-config and found responses', async () => {
    const screensQueryService = {
      getScreen: vi.fn()
        .mockResolvedValueOnce({ outcome: 'invalid-config' })
        .mockResolvedValueOnce({ outcome: 'found', screen: { screen: 'office' } }),
    };
    const router = createScreensRouter({ screensQueryService });
    const handler = getHandler(router, '/:screenId');

    const invalid = await call(handler, { params: { screenId: 'office' } });
    expect(invalid.statusCode).toBe(400);
    expect(invalid.body).toEqual({
      error: 'Invalid screen config',
      message: 'Missing required "screen" field',
    });

    const found = await call(handler, { params: { screenId: 'office' } });
    expect(found.statusCode).toBe(200);
    expect(found.body).toEqual({ screen: 'office' });
  });

  it('preserves the router error envelope', () => {
    const logger = { error: vi.fn() };
    const router = createScreensRouter({ screensQueryService: {}, logger });
    const errorHandler = router.stack.find((entry) =>
      !entry.route && entry.handle.length === 4).handle;
    const res = response();

    errorHandler(
      new Error('screen read failed'),
      { url: '/office', method: 'GET' },
      res,
      () => {},
    );

    expect(res.statusCode).toBe(500);
    expect(res.body).toEqual({ error: 'screen read failed' });
  });
});
