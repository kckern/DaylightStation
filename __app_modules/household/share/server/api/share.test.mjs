/**
 * The share routes against the real path: router, shared quick-input route
 * and intake, ShareRouter and a fake handler. No app-wide body parser or CORS
 * handler, as in the real app (app.mjs exceptPaths).
 */
import { describe, it, expect, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import { createShareRouter } from './share.mjs';
import { ShareRouter } from '../application/ShareRouter.mjs';
import { createShareQuickInputs } from '../application/shareQuickInputs.mjs';
import { sharePolicy } from '../domain/sharePolicy.mjs';

const nullLogger = { debug() {}, info() {}, warn() {}, error() {} };

function build({ devices = { phone: { quick_input: { share: ['user_1'] } } } } = {}) {
  const handler = {
    kind: 'video',
    matches: (url) => url.startsWith('https://video.example/'),
    accept: vi.fn(({ target }) => ({ kind: 'video', provider: 'example', jobId: 's000000000001', target })),
    status: (id) => (id === 's000000000001' ? { id, state: 'downloading', progress: 0.4 } : null),
  };
  const policy = sharePolicy({ default_target: 'livingroom-tv', targets: { 'livingroom-tv': { label: 'Living room TV' }, 'office-tv': { label: 'Office' } } });
  const router = new ShareRouter({ handlers: [handler], logger: nullLogger });
  const ledgerFiles = new Map();
  const endpoints = createShareQuickInputs({
    router,
    policy,
    ledgerStore: {
      read: (u) => (ledgerFiles.has(u) ? structuredClone(ledgerFiles.get(u)) : null),
      write: (u, d) => { ledgerFiles.set(u, structuredClone(d)); return true; },
    },
    timezone: () => 'UTC',
    deviceConfig: (key) => devices[key],
    logger: nullLogger,
  });
  const app = express();
  app.use('/api/v1/share', createShareRouter({ endpoints, policy, router, logger: nullLogger }));
  return { app, handler };
}

const share = (app, path, text, { id = 'in_1', device = 'fleet:phone' } = {}) => request(app)
  .post(`${path}?user=user_1`)
  .set('Content-Type', 'text/plain; charset=utf-8')
  .set('X-Daylight-Device', device)
  .set('X-Daylight-Input-Id', id)
  .send(text);

describe('share routes', () => {
  it('routes a shared link to the default target and answers the receipt the phone checks', async () => {
    const { app, handler } = build();
    const res = await share(app, '/api/v1/share/text', 'Watch this https://video.example/v/1 !');
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ ok: true, inputId: 'in_1', duplicate: false, share: { jobId: 's000000000001', target: 'livingroom-tv' } });
    expect(handler.accept).toHaveBeenCalledWith({ url: 'https://video.example/v/1', target: 'livingroom-tv', username: 'user_1' });
  });

  it('a target route sends there', async () => {
    const { app } = build();
    const res = await share(app, '/api/v1/share/to/office-tv/text', 'https://video.example/v/1');
    expect(res.body.share.target).toBe('office-tv');
  });

  it('a retry of the same input does not start it twice', async () => {
    const { app, handler } = build();
    await share(app, '/api/v1/share/text', 'https://video.example/v/1');
    const again = await share(app, '/api/v1/share/text', 'https://video.example/v/1');
    expect(again.status).toBe(200);
    expect(again.body.duplicate).toBe(true);
    expect(handler.accept).toHaveBeenCalledTimes(1);
  });

  it('refuses for good what no handler takes (the phone parks it)', async () => {
    const { app } = build();
    expect((await share(app, '/api/v1/share/text', 'no link here')).status).toBe(422);
    expect((await share(app, '/api/v1/share/text', 'https://elsewhere.example/', { id: 'in_2' })).status).toBe(422);
  });

  it('refuses a device that is not bound for shares', async () => {
    const { app } = build({ devices: { phone: { quick_input: { journalist: ['user_1'] } } } });
    const res = await share(app, '/api/v1/share/text', 'https://video.example/v/1');
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('device_not_allowed');
  });

  it('lists targets and reports a job', async () => {
    const { app } = build();
    expect((await request(app).get('/api/v1/share/targets')).body.defaultTarget).toBe('livingroom-tv');
    expect((await request(app).get('/api/v1/share/jobs/s000000000001')).body).toMatchObject({ state: 'downloading', progress: 0.4 });
    expect((await request(app).get('/api/v1/share/jobs/s999999999999')).status).toBe(404);
    expect((await request(app).get('/api/v1/share/jobs/bad')).status).toBe(400);
  });
});
