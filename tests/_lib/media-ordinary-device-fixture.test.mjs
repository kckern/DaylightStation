import { describe, expect, it } from 'vitest';
import request from 'supertest';
import { ORDINARY_DEVICE_ID, createMediaOrdinaryDeviceFixture } from './media-ordinary-device-fixture.mjs';

describe('media ordinary device fixture', () => {
  it('rejects a physical device load while retaining the one virtual identity', async () => {
    const fixture = createMediaOrdinaryDeviceFixture({ upstream: 'http://127.0.0.1:3111' });
    expect(fixture.deviceId).toBe(ORDINARY_DEVICE_ID);
    await request(fixture.app)
      .get('/livingroom-tv/load?play=plex:55854&dispatchId=physical-command')
      .expect(403, { ok: false, error: 'ordinary acceptance blocks physical device routes' });
    await fixture.stop();
  });
});
