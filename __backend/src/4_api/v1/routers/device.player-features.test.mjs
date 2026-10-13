import express from 'express';
import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';
import { createDeviceRouter } from './device.mjs';

// Player features on a screen (tech doc §4.11): each route sends ONE
// `session` envelope and maps the screen's ack like every session control.
function appWith(sessionService) {
  const app = express();
  app.use(express.json());
  app.use('/api/v1/device', createDeviceRouter({ sessionService }));
  return app;
}
const service = (result = { ok: true, commandId: 'c1' }) => ({
  configured: () => true, config: vi.fn(), session: vi.fn().mockResolvedValue(result), transport: vi.fn(), queue: vi.fn(),
});

describe('player feature routes', () => {
  it.each([
    ['tracks', { subtitle: '1278358' }, 'set-tracks', { subtitle: '1278358' }],
    ['tracks', { subtitle: 'off', audio: '7' }, 'set-tracks', { audio: '7', subtitle: 'off' }],
    ['brief/close', {}, 'close-brief', {}],
    ['music-behind', { op: 'start', contentId: 'plex:500', title: 'Album' }, 'music-behind', { op: 'start', contentId: 'plex:500', title: 'Album' }],
    ['music-behind', { op: 'next' }, 'music-behind', { op: 'next' }],
  ])('POST /session/%s → session(%s)', async (path, body, action, params) => {
    const sessionService = service();
    const res = await request(appWith(sessionService)).post(`/api/v1/device/tv-a/session/${path}`).send({ ...body, commandId: 'c1' });
    expect(res.status).toBe(200);
    expect(sessionService.session).toHaveBeenCalledWith('tv-a', { action, params, commandId: 'c1', origin: undefined });
  });

  it.each([
    ['tracks', {}],
    ['tracks', { audio: 3 }],
    ['music-behind', { op: 'start' }],
    ['music-behind', { op: 'louder' }],
  ])('POST /session/%s rejects %j', async (path, body) => {
    const sessionService = service();
    const res = await request(appWith(sessionService)).post(`/api/v1/device/tv-a/session/${path}`).send({ ...body, commandId: 'c1' });
    expect(res.status).toBe(400);
    expect(sessionService.session).not.toHaveBeenCalled();
  });

  it('maps a screen refusal (no brief up) to 502 with its code', async () => {
    const sessionService = service({ ok: false, code: 'NO_BRIEF', error: 'Nothing is being shown briefly' });
    const res = await request(appWith(sessionService)).post('/api/v1/device/tv-a/session/brief/close').send({ commandId: 'c1' });
    expect(res.status).toBe(502);
    expect(res.body.code).toBe('NO_BRIEF');
  });
});
