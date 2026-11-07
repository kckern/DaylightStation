import { describe, test, expect, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import { createContentFilterRouter } from '../../../../__app_modules/media/media/server/api/contentFilter.mjs';

const mk = (art) => {
  const app = express();
  app.use('/cf', createContentFilterRouter({ getContentFilter: { execute: async () => ({}) }, contentFilterArt: art, logger: { info() {}, warn() {} } }));
  return app;
};

describe('GET /:ratingKey/art', () => {
  test('returns the cascade result for a digit-sanitised rating key', async () => {
    const execute = vi.fn(async () => ({ logo: '/l', background: '/b', poster: '/p', source: 'alternative' }));
    const res = await request(mk({ execute })).get('/cf/12ab3/art');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ logo: '/l', background: '/b', poster: '/p', source: 'alternative' });
    expect(execute).toHaveBeenCalledWith({ ratingKey: '123' });
  });
  test('400 on a key with no digits', async () => {
    expect((await request(mk({ execute: vi.fn() })).get('/cf/abc/art')).status).toBe(400);
  });
});
