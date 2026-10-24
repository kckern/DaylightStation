// @vitest-environment node
import express from 'express';
import { describe, expect, it } from 'vitest';
import request from '../../../../../tests/_lib/memory-http/request.mjs';
import { createDeviceRouter } from './device.mjs';

function setup() {
  const calls = [];
  const dispatchService = { configured: () => true, checkInput: () => ({ ok: true }), logLoadStart() {},
    load: async (deviceId, query) => { calls.push(query); return { ok: true, deviceId, query }; } };
  const app = express();
  app.use('/api/v1/device', createDeviceRouter({ dispatchService }));
  app.use((error, _req, res, _next) => res.status(error.status ?? 500).json({ code: error.code }));
  return { app, calls };
}

describe('quality on a device load', () => {
  it('normalizes values before dispatch so false does not become a truthy string', async () => {
    const { app } = setup();
    const result = await request(app).get('/api/v1/device/tv/load?play=plex:42&maxVideoResolution=720p&maxVideoBitrate=4000&transcode=force&adaptive=false').expect(200);
    expect(result.body.query).toMatchObject({ maxResolution: '720', maxVideoBitrate: 4000, transcode: 'force', adaptive: false });
    expect(result.body.query).not.toHaveProperty('maxVideoResolution');
  });
  it('refuses bad quality without waking or loading the device', async () => {
    const { app, calls } = setup();
    await request(app).get('/api/v1/device/tv/load?play=plex:42&maxResolution=banana').expect(400);
    expect(calls).toHaveLength(0);
  });
});
