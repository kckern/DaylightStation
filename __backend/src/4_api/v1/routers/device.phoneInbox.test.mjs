import express from 'express';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createDeviceRouter } from './device.mjs';
import { PhoneInboxService } from '#apps/devices/services/PhoneInboxService.mjs';
import { NodeApplicationScheduler } from '#adapters/scheduling/NodeApplicationScheduler.mjs';

function setup() {
  const sent = [];
  const phoneInbox = new PhoneInboxService({ scheduler: new NodeApplicationScheduler(), logger: {} });
  phoneInbox.connect({ serves: (id) => id === 'phone', publish: (m) => sent.push(m) });
  const app = express();
  app.use(express.json());
  app.use('/api/v1/device', createDeviceRouter({ phoneInbox }));
  return { app, phoneInbox, sent };
}

const envelope = (commandId) => ({ commandId, command: 'queue', targetDevice: 'phone', params: { op: 'play-now', contentId: 'plex:7' } });

describe('GET /device/:id/commands (the phone app long-polls)', () => {
  it('answers at once with what waits, once, and the phone reads online', async () => {
    const { app, phoneInbox, sent } = setup();
    phoneInbox.enqueue('phone', envelope('d1'));
    const res = await request(app).get('/api/v1/device/phone/commands?wait=25');
    expect(res.status).toBe(200);
    expect(res.body.commands.map((c) => c.commandId)).toEqual(['d1']);
    expect(phoneInbox.isPresent('phone')).toBe(true);
    expect(sent.some((m) => m.topic === 'device-state' && m.reason === 'heartbeat')).toBe(true);
    const again = await request(app).get('/api/v1/device/phone/commands?wait=0');
    expect(again.status).toBe(204);
  });

  it('holds until a command comes', async () => {
    const { app, phoneInbox } = setup();
    setTimeout(() => phoneInbox.enqueue('phone', envelope('d2')), 50);
    const res = await request(app).get('/api/v1/device/phone/commands?wait=5');
    expect(res.status).toBe(200);
    expect(res.body.commands[0].commandId).toBe('d2');
  });

  it('times out empty (204)', async () => {
    const { app } = setup();
    const res = await request(app).get('/api/v1/device/phone/commands?wait=0.2');
    expect(res.status).toBe(204);
  });

  it('takes a reported state with the poll', async () => {
    const { app, sent } = setup();
    await request(app).get('/api/v1/device/phone/commands?wait=0&state=playing&contentId=plex:9&title=Book');
    const states = sent.filter((m) => m.topic === 'device-state');
    expect(states[0].snapshot).toMatchObject({ state: 'playing', currentItem: { contentId: 'plex:9', title: 'Book' } });
  });

  it('is 404 for a device that is not an inbox device', async () => {
    const { app } = setup();
    expect((await request(app).get('/api/v1/device/livingroom-tv/commands?wait=0')).status).toBe(404);
  });
});

describe('POST /device/:id/ack', () => {
  it('publishes device-ack and the playing state', async () => {
    const { app, sent } = setup();
    const res = await request(app).post('/api/v1/device/phone/ack')
      .send({ commandId: 'd1', ok: true, state: { contentId: 'plex:7', title: 'A song', playing: true } });
    expect(res.status).toBe(204);
    expect(sent[0]).toMatchObject({ topic: 'device-ack', deviceId: 'phone', commandId: 'd1', ok: true });
    expect(sent[1]).toMatchObject({ topic: 'device-state', deviceId: 'phone', snapshot: { state: 'playing', sessionId: 'phone-d1' } });
  });

  it.each([
    [{ ok: true }],
    [{ commandId: 'd1' }],
    [{ commandId: 'd1', ok: true, state: 'playing' }],
  ])('refuses %j (400)', async (body) => {
    const { app } = setup();
    expect((await request(app).post('/api/v1/device/phone/ack').send(body)).status).toBe(400);
  });

  it('is 404 for a device that is not an inbox device', async () => {
    const { app } = setup();
    expect((await request(app).post('/api/v1/device/office-tv/ack').send({ commandId: 'd', ok: true })).status).toBe(404);
  });
});
