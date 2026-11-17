import express from 'express';
import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';
import { createAdminDeviceRemoteRouter } from './device-remote.mjs';

function build(error) {
  const service = { getStatus: vi.fn(async () => { throw error; }) };
  const app = express();
  app.use(express.json());
  app.use('/devices/:deviceId/fully-kiosk', createAdminDeviceRemoteRouter({
    service,
    logger: { warn: vi.fn(), error: vi.fn() },
  }));
  return app;
}

describe('admin device remote router: daylight-android gateway errors', () => {
  it.each([
    ['NOT_DAYLIGHT_ANDROID', 422],
    ['DAYLIGHT_ANDROID_UNSUPPORTED', 501],
    ['DAYLIGHT_ANDROID_CONFIGURATION_ERROR', 503],
    ['DAYLIGHT_ANDROID_TIMEOUT', 504],
    ['DAYLIGHT_ANDROID_UNREACHABLE', 502],
    ['DAYLIGHT_ANDROID_AUTH_REJECTED', 502],
    ['DAYLIGHT_ANDROID_COMMAND_REJECTED', 502],
    ['DAYLIGHT_ANDROID_INVALID_RESPONSE', 502],
  ])('maps %s to HTTP %i with a message of its own', async (code, status) => {
    const error = Object.assign(new Error('private upstream details'), { code });
    const response = await request(build(error))
      .get('/devices/tablet/fully-kiosk/status')
      .expect(status);

    expect(response.body).toMatchObject({ ok: false, code });
    if (status >= 500) {
      expect(response.body.error).not.toContain('private upstream details');
      expect(response.body.error).not.toBe('Internal server error');
      expect(response.body.error).not.toMatch(/Fully/);
    }
  });
});
