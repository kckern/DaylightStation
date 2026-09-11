// tests/isolated/api/device-self-input.test.mjs
//
// "Does the device asking have a keyboard?" — the one question the fleet
// registry can answer and the browser cannot.
//
// The Portal panel is a touchscreen with a bonded Bluetooth keyboard. No web
// API reports that keyboard: `pointer: fine` asks about a MOUSE, and the panel
// has none, so School's Sentence Ladder read the device as unable to type and
// hid its Dictation and Interpretation rungs — on the device those rungs were
// built for. devices.yml has always known better (`bluetooth_input.keyboards`);
// nothing served it.
import { describe, test, expect } from 'vitest';
import express from 'express';
import request from 'supertest';
import { createDeviceRouter } from '../../../backend/src/4_api/v1/routers/device.mjs';
import { deviceResolver } from '../../../backend/src/4_api/middleware/deviceResolver.mjs';

const DEVICES = {
  devices: {
    portal: {
      name: 'Portal',
      bluetooth_input: { keyboards: [{ alias: 'desk', name: 'Bluetooth Keyboard' }] },
    },
    'living-room-tv': { name: 'Living Room TV' },
  },
};

function app() {
  const fleetService = {
    configuration: () => DEVICES,
    list: () => [],
    state: async () => ({ kind: 'not_found' }),
  };
  const stub = new Proxy({}, { get: () => () => ({ ok: false }) });
  const server = express();
  server.use(deviceResolver());
  server.use('/device', createDeviceRouter({
    fleetService, presenceService: stub, sessionService: stub,
    screenService: stub, dispatchService: stub, recoveryService: stub,
  }));
  return server;
}

describe('GET /device/self/input', () => {
  test('a fleet device with a declared keyboard reports one', async () => {
    const res = await request(app()).get('/device/self/input')
      .set('X-Daylight-Device', 'fleet:portal');
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ ok: true, device: 'portal', keyboard: true });
  });

  test('a fleet device with no declared keyboard reports none', async () => {
    const res = await request(app()).get('/device/self/input')
      .set('X-Daylight-Device', 'fleet:living-room-tv');
    expect(res.body).toMatchObject({ ok: true, device: 'living-room-tv', keyboard: false });
  });

  // An anonymous browser is not a fleet device and must never be answered from
  // another device's row. `browser:<token>` and a bare User-Agent both land here.
  test('an unidentified browser is answered "unknown", never guessed', async () => {
    const res = await request(app()).get('/device/self/input')
      .set('X-Daylight-Device', 'browser:abc123');
    expect(res.body).toMatchObject({ ok: true, device: null, keyboard: false });
  });

  test('a device name that is not in the registry does not throw', async () => {
    const res = await request(app()).get('/device/self/input')
      .set('X-Daylight-Device', 'fleet:nonesuch');
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ ok: true, device: null, keyboard: false });
  });
});
