import { describe, expect, it, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import { createDeviceRouter } from './device.mjs';
import { DeviceSessionApiService } from '../../../3_applications/devices/services/DeviceSessionApiService.mjs';
import { SessionControlService } from '../../../3_applications/devices/services/SessionControlService.mjs';
import { EventBusDeviceTransportGateway } from '../../../1_adapters/devices/EventBusDeviceTransportGateway.mjs';

const BROWSER = 'browser:abcd1234ef';
const logger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };

/** A bus on which an ad-hoc screen page answers every command it is sent, as useCommandAckPublisher does. */
function busWithScreen(pageId) {
  const patterns = [];
  const published = [];
  return {
    published,
    subscribePattern(match, handler) { const e = { match, handler }; patterns.push(e); return () => patterns.splice(patterns.indexOf(e), 1); },
    broadcast(topic, payload) {
      published.push(topic);
      if (topic === `screen:${pageId}`) {
        const ack = { topic: `device-ack:${pageId}`, deviceId: pageId, commandId: payload.commandId, ok: true };
        queueMicrotask(() => patterns.filter((p) => p.match(ack.topic)).forEach((p) => p.handler(ack)));
      }
    },
  };
}

function app({ snapshot = null } = {}) {
  const bus = busWithScreen(BROWSER);
  const sessions = new SessionControlService({
    transportGateway: new EventBusDeviceTransportGateway({ eventBus: bus }),
    livenessService: { getLastSnapshot: (id) => (id === BROWSER ? snapshot : null) },
    logger, ackTimeoutMs: 500,
  });
  const a = express(); a.use(express.json());
  a.use('/api/v1/device', createDeviceRouter({ sessionService: new DeviceSessionApiService({ sessionControl: sessions, logger }) }));
  return { a, bus };
}

describe('an ad-hoc browser screen through the device routes', () => {
  it('takes a D-pad press on screen:<browser id> and answers once the page acked', async () => {
    const { a, bus } = app();
    const res = await request(a).post(`/api/v1/device/${encodeURIComponent(BROWSER)}/input`)
      .send({ action: 'navigate', direction: 'left', commandId: 'press-1' });
    expect(res.status).toBe(200);
    expect(bus.published).toContain(`screen:${BROWSER}`);
  });

  it('answers its session like a screen: its snapshot, or 204 idle', async () => {
    const playing = { state: 'playing', currentItem: { contentId: 'plex:1', title: 'x' }, queue: { items: [] } };
    expect((await request(app({ snapshot: { online: true, snapshot: playing } }).a).get(`/api/v1/device/${BROWSER}/session`)).status).toBe(200);
    const idle = { state: 'idle', currentItem: null, queue: { items: [] } };
    expect((await request(app({ snapshot: { online: true, snapshot: idle } }).a).get(`/api/v1/device/${BROWSER}/session`)).status).toBe(204);
    expect((await request(app().a).get(`/api/v1/device/${BROWSER}/session`)).status).toBe(404);
  });

  it('refuses a malformed browser id on every device route', async () => {
    const { a, bus } = app();
    for (const bad of ['browser:x', 'browser:has space', 'browser:' + 'a'.repeat(65), 'browser:a.b.c.d']) {
      const res = await request(a).post(`/api/v1/device/${encodeURIComponent(bad)}/input`).send({ action: 'select', commandId: 'p' });
      expect(res.status).toBe(400);
    }
    expect((await request(a).get('/api/v1/device/browser:x/session')).status).toBe(400);
    expect(bus.published).toHaveLength(0);
  });
});
