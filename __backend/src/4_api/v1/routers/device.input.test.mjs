import express from 'express';
import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';
import { createDeviceRouter } from './device.mjs';

function appWith(sessionService, deviceHeader) {
  const app = express();
  app.use(express.json());
  if (deviceHeader) app.use((req, _res, next) => { req.deviceId = deviceHeader; req.deviceIdSource = 'header'; next(); });
  app.use('/api/v1/device', createDeviceRouter({ sessionService }));
  return app;
}

const service = (result = { ok: true, commandId: 'c1' }) => ({ configured: () => true, input: vi.fn().mockResolvedValue(result) });

describe('POST /device/:id/input (a phone D-pad press)', () => {
  it('routes a direction press to input() with the caller as origin', async () => {
    const s = service();
    const res = await request(appWith(s, 'fleet:phone')).post('/api/v1/device/livingroom-tv/input')
      .send({ action: 'navigate', direction: 'left', commandId: 'c1', origin: { kind: 'device', name: 'Phone' } });
    expect(res.status).toBe(200);
    expect(s.input).toHaveBeenCalledWith('livingroom-tv', {
      action: 'navigate', direction: 'left', commandId: 'c1',
      origin: { kind: 'device', id: 'fleet:phone', name: 'Phone' },
    });
  });

  it('accepts select and escape without a direction', async () => {
    for (const action of ['select', 'escape']) {
      const s = service();
      const res = await request(appWith(s)).post('/api/v1/device/tv/input').send({ action, commandId: 'c1' });
      expect(res.status).toBe(200);
      expect(s.input.mock.calls[0][1].action).toBe(action);
    }
  });

  it.each([
    [{ action: 'navigate', commandId: 'c1' }],
    [{ action: 'navigate', direction: 'sideways', commandId: 'c1' }],
    [{ action: 'type', commandId: 'c1' }],
    [{ action: 'select' }],
  ])('refuses %j before anything is sent', async (body) => {
    const s = service();
    const res = await request(appWith(s)).post('/api/v1/device/tv/input').send(body);
    expect(res.status).toBe(400);
    expect(s.input).not.toHaveBeenCalled();
  });

  it('maps an offline screen to 409 and no ack to 502', async () => {
    const off = service({ ok: false, code: 'DEVICE_OFFLINE', error: 'Device offline' });
    expect((await request(appWith(off)).post('/api/v1/device/tv/input').send({ action: 'select', commandId: 'c1' })).status).toBe(409);
    const silent = service({ ok: false, code: 'DEVICE_REFUSED', error: 'Timeout waiting for ack' });
    expect((await request(appWith(silent)).post('/api/v1/device/tv/input').send({ action: 'select', commandId: 'c2' })).status).toBe(502);
  });
});
