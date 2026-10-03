/**
 * POST /play/log names the screen whose spot it is (RQ-PLAY-09).
 *
 * Source of the spot device, in order:
 *   1. body `deviceId` (optional; a caller reporting for another surface)
 *   2. the X-Daylight-Device header, but only when the client actually sent
 *      it (deviceResolver's `deviceIdSource === 'header'`). The User-Agent
 *      fallback is not an identity and never keys a spot.
 */
import { describe, it, expect, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import { createPlayRouter } from './play.mjs';
import { deviceResolver } from '#api/middleware/deviceResolver.mjs';

function makeApp() {
  const execute = vi.fn().mockResolvedValue({ response: {} });
  const app = express();
  app.use(express.json());
  app.use('/api/v1', deviceResolver());
  app.use('/api/v1/play', createPlayRouter({
    recordPlaybackProgress: { execute },
    logger: { info: vi.fn(), warn: vi.fn() },
  }));
  return { app, execute };
}

const body = { type: 'plex', assetId: 'plex:1', percent: 10, seconds: 720 };

describe('POST /play/log spot device', () => {
  it('uses the X-Daylight-Device header', async () => {
    const { app, execute } = makeApp();
    await request(app).post('/api/v1/play/log').set('X-Daylight-Device', 'fleet:livingroom-tv').send(body).expect(200);
    expect(execute).toHaveBeenCalledWith(expect.objectContaining({ spotDeviceId: 'fleet:livingroom-tv', deviceId: 'fleet:livingroom-tv' }));
  });

  it('prefers an explicit body deviceId', async () => {
    const { app, execute } = makeApp();
    await request(app).post('/api/v1/play/log').set('X-Daylight-Device', 'browser:phone').send({ ...body, deviceId: 'fleet:office-tv' }).expect(200);
    expect(execute).toHaveBeenCalledWith(expect.objectContaining({ spotDeviceId: 'fleet:office-tv' }));
  });

  it('never keys a spot by User-Agent', async () => {
    const { app, execute } = makeApp();
    await request(app).post('/api/v1/play/log').set('User-Agent', 'Mozilla/5.0 (X11)').send(body).expect(200);
    expect(execute).toHaveBeenCalledWith(expect.objectContaining({ spotDeviceId: null }));
  });
});
