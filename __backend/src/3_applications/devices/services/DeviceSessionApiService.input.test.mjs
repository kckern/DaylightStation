import { describe, expect, it, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import { DeviceSessionApiService } from './DeviceSessionApiService.mjs';
import { createDeviceRouter } from '../../../4_api/v1/routers/device.mjs';

// The router is given this API service in production (5_composition/modules/deviceApi.mjs),
// not SessionControlService: a press must reach input() through it.
describe('DeviceSessionApiService.input', () => {
  it('passes a press to the session control and the router answers through it', async () => {
    const sessionControl = { input: vi.fn(async (_d, { commandId }) => ({ ok: true, commandId })) };
    const sessionService = new DeviceSessionApiService({ sessionControl, logger: { debug: vi.fn(), info: vi.fn() } });
    const app = express(); app.use(express.json());
    app.use('/api/v1/device', createDeviceRouter({ sessionService }));
    const res = await request(app).post('/api/v1/device/livingroom-tv/input').send({ action: 'navigate', direction: 'up', commandId: 'p1' });
    expect(res.status).toBe(200);
    expect(sessionControl.input).toHaveBeenCalledWith('livingroom-tv', { action: 'navigate', direction: 'up', commandId: 'p1', origin: undefined });
  });

  it('falls back to sendCommand with an input envelope', async () => {
    const sessionControl = { sendCommand: vi.fn(async (e) => ({ ok: true, commandId: e.commandId })) };
    const api = new DeviceSessionApiService({ sessionControl, logger: { debug: vi.fn() } });
    await api.input('tv', { action: 'select', direction: 'up', commandId: 'p2' });
    expect(sessionControl.sendCommand).toHaveBeenCalledWith({ targetDevice: 'tv', command: 'input', commandId: 'p2', params: { action: 'select' } });
  });
});
