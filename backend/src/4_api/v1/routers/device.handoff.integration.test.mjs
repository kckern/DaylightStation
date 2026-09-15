import express from 'express';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { EventBusDeviceTransportGateway } from '#adapters/devices/EventBusDeviceTransportGateway.mjs';
import { DeviceSessionApiService } from '#apps/devices/services/DeviceSessionApiService.mjs';
import { SessionControlService } from '#apps/devices/services/SessionControlService.mjs';
import { createDeviceRouter } from './device.mjs';

const capture = { version: 1, transferId: 'transfer-1', op: 'capture' };
const logger = { info() {}, warn() {} };

function makeApp({ reply }) {
  const subscriptions = [];
  const timers = [];
  const published = [];
  const eventBus = {
    subscribePattern(predicate, handler) {
      const entry = { predicate, handler };
      subscriptions.push(entry);
      return () => subscriptions.splice(subscriptions.indexOf(entry), 1);
    },
    broadcast(topic, command) {
      published.push({ topic, command });
      if (topic !== 'screen:tv-a') return;
      if (reply === 'unsupported') {
        for (const entry of [...subscriptions]) {
          if (entry.predicate('device-ack:tv-a')) entry.handler({ deviceId: 'tv-a', commandId: command.commandId, ok: false, code: 'HANDOFF_UNSUPPORTED', handoff: { transferId: command.params.transferId, phase: 'failed', code: 'HANDOFF_UNSUPPORTED' } });
        }
      } else if (reply === 'starting') {
        for (const entry of [...subscriptions]) {
          if (entry.predicate('device-ack:tv-a')) entry.handler({ deviceId: 'tv-a', commandId: command.commandId, ok: true, handoff: { transferId: command.params.transferId, phase: 'starting' } });
        }
      } else timers.at(-1).callback();
    },
  };
  const gateway = new EventBusDeviceTransportGateway({
    eventBus,
    setTimer: (callback, ms) => { const timer = { callback, ms }; timers.push(timer); return timer; },
    clearTimer: () => {},
  });
  const control = new SessionControlService({ transportGateway: gateway, livenessService: { getLastSnapshot: () => null }, logger });
  const sessionService = new DeviceSessionApiService({ sessionControl: control, logger });
  const app = express();
  app.use(express.json());
  app.use('/api/v1/device', createDeviceRouter({ sessionService }));
  return { app, timers, published };
}

describe('device handoff HTTP to transport correlation', () => {
  it('relays a typed unsupported terminal result through the actual services and gateway', async () => {
    const { app, timers, published } = makeApp({ reply: 'unsupported' });

    const response = await request(app).post('/api/v1/device/tv-a/session/handoff').send({ commandId: 'handoff-1', params: capture });
    expect(response.status).toBe(200);
    expect(response.body).toEqual({ ok: false, commandId: 'handoff-1', code: 'HANDOFF_UNSUPPORTED', handoff: { transferId: 'transfer-1', phase: 'failed', code: 'HANDOFF_UNSUPPORTED' } });
    expect(timers).toHaveLength(1);
    expect(timers[0].ms).toBe(5000);
    expect(published).toEqual([{ topic: 'screen:tv-a', command: { targetDevice: 'tv-a', command: 'handoff', commandId: 'handoff-1', params: capture } }]);
  });

  it('keeps the unchanged gateway timeout distinct from a terminal handoff result', async () => {
    const { app, timers } = makeApp({ reply: false });

    const response = await request(app).post('/api/v1/device/tv-a/session/handoff').send({ commandId: 'handoff-timeout', params: capture });
    expect(response.status).toBe(502);
    expect(response.body.code).toBe('DEVICE_REFUSED');
    expect(response.body).not.toHaveProperty('handoff');
    expect(timers[0].ms).toBe(5000);
  });

  it('returns a real correlated status starting observation at 202 with one handoff publish', async () => {
    const { app, published } = makeApp({ reply: 'starting' });
    const params = { ...capture, op: 'status' };

    const response = await request(app).post('/api/v1/device/tv-a/session/handoff').send({ commandId: 'handoff-status', params });
    expect(response.status).toBe(202);
    expect(response.body).toEqual({ ok: true, commandId: 'handoff-status', handoff: { transferId: 'transfer-1', phase: 'starting' } });
    expect(published).toEqual([{ topic: 'screen:tv-a', command: { targetDevice: 'tv-a', command: 'handoff', commandId: 'handoff-status', params } }]);
  });
});
