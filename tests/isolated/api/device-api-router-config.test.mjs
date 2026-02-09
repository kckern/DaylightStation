// tests/isolated/api/device-api-router-config.test.mjs
import { describe, test, expect, jest } from '@jest/globals';
import { createDeviceRouter } from '../../../backend/src/4_api/v1/routers/device.mjs';
import express from 'express';
import request from 'supertest';

describe('createDeviceRouter - configService forwarding', () => {
  test('/config endpoint returns device config from configService', async () => {
    const mockDeviceConfig = {
      devices: {
        'office-tv': {
          type: 'linux-pc',
          modules: {
            'piano-visualizer': {
              on_open: 'script.office_tv_hdmi_3'
            }
          }
        }
      }
    };

    const mockConfigService = {
      getHouseholdDevices: jest.fn().mockReturnValue(mockDeviceConfig)
    };

    const mockDeviceService = {
      listDevices: () => [],
      get: () => null
    };

    // This mirrors what createDeviceApiRouter should pass through:
    // configService must be forwarded from the bootstrap layer to the router
    const router = createDeviceRouter({
      deviceService: mockDeviceService,
      configService: mockConfigService,
      logger: { info: () => {}, debug: () => {}, warn: () => {}, error: () => {} }
    });

    const app = express();
    app.use('/device', router);

    const res = await request(app).get('/device/config');
    expect(res.status).toBe(200);
    expect(res.body.devices['office-tv'].modules['piano-visualizer'].on_open)
      .toBe('script.office_tv_hdmi_3');
  });

  test('/config endpoint fails when configService is not provided (the bug)', async () => {
    const mockDeviceService = {
      listDevices: () => [],
      get: () => null
    };

    // Simulate the bug: createDeviceApiRouter did NOT pass configService
    const router = createDeviceRouter({
      deviceService: mockDeviceService,
      // configService intentionally omitted to demonstrate the bug
      logger: { info: () => {}, debug: () => {}, warn: () => {}, error: () => {} }
    });

    const app = express();
    app.use('/device', router);

    const res = await request(app).get('/device/config');
    // Without configService, this should error (500)
    expect(res.status).toBe(500);
  });
});
