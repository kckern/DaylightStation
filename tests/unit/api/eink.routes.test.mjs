import { describe, it, expect } from 'vitest';
import express from 'express';
import request from 'supertest';
import { createEinkRouter } from '#api/v1/routers/eink.mjs';

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]); // \x89PNG header bytes
const HASH = 'deadbeefcafef00d';

const makeApp = (over = {}) => {
  const einkPanelService = {
    renderResult: async () => ({ png: PNG, view: 'home' }),
    stateSnapshot: async () => ({
      id: 'kitchen-eink',
      rotation: 0,
      buttons: { green: 'select', right: 'next', left: 'prev' },
      nextWakeSec: 900,
      image: '/api/v1/eink/kitchen-eink/panel',
      imageHash: HASH,
      view: 'home',
    }),
    advance: async (_id, action) => ({ action, index: 1, view: 'dashboard', viewCount: 2 }),
    ...over,
  };
  const app = express();
  app.use('/eink', createEinkRouter({ einkPanelService, logger: { info() {}, error() {}, warn() {} } }));
  return app;
};

describe('eink routes — /:id/panel (pure render)', () => {
  it('200 + image/png + no-cache with the rendered PNG', async () => {
    const res = await request(makeApp()).get('/eink/kitchen-eink/panel');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/image\/png/);
    expect(res.headers['cache-control']).toBe('no-cache');
    expect(Buffer.from(res.body).equals(PNG)).toBe(true);
  });

  it('does not 304 even when If-None-Match is sent (change detection is on /config)', async () => {
    const res = await request(makeApp())
      .get('/eink/kitchen-eink/panel')
      .set('If-None-Match', '*');
    expect(res.status).toBe(200);
    expect(Buffer.from(res.body).equals(PNG)).toBe(true);
  });

  it('404 when the panel config is not found', async () => {
    const res = await request(makeApp({
      renderResult: async () => { const e = new Error('not found'); e.status = 404; throw e; },
    })).get('/eink/nope/panel');
    expect(res.status).toBe(404);
  });
});

describe('eink routes — /:id/config (state snapshot)', () => {
  it('serves the runtime config + next_wake + image + image_hash as text/plain', async () => {
    const res = await request(makeApp()).get('/eink/kitchen-eink/config');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/text\/plain/);
    expect(res.headers['cache-control']).toBe('no-cache');
    expect(res.text).toContain('id=kitchen-eink');
    expect(res.text).toContain('rotation=0');
    expect(res.text).toContain('btn_green=select');
    expect(res.text).toContain('btn_right=next');
    expect(res.text).toContain('btn_left=prev');
    expect(res.text).toContain('next_wake=900');
    expect(res.text).toContain('image=/api/v1/eink/kitchen-eink/panel');
    expect(res.text).toContain(`image_hash=${HASH}`);
  });

  it('404 when the panel config is not found', async () => {
    const res = await request(makeApp({
      stateSnapshot: async () => { const e = new Error('not found'); e.status = 404; throw e; },
    })).get('/eink/nope/config');
    expect(res.status).toBe(404);
  });
});

describe('eink routes — /:id/action/:action', () => {
  it('advances the view and returns ok', async () => {
    const res = await request(makeApp()).get('/eink/kitchen-eink/action/next');
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.action).toBe('next');
    expect(res.body.view).toBe('dashboard');
  });

  it('404 (unmatched route) when no action segment is given', async () => {
    const res = await request(makeApp()).get('/eink/kitchen-eink/action');
    expect(res.status).toBe(404);
  });
});
