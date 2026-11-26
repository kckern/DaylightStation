import express from 'express';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createDeviceRouter } from './device.mjs';
import { PhoneInboxService } from '#apps/devices/services/PhoneInboxService.mjs';
import { NodeApplicationScheduler } from '#adapters/scheduling/NodeApplicationScheduler.mjs';

function setup(opts = {}) {
  const sent = [];
  const phoneInbox = new PhoneInboxService({ scheduler: new NodeApplicationScheduler(), logger: {} });
  phoneInbox.connect({ serves: (id) => id === 'phone', publish: (m) => sent.push(m), authorize: (id, token) => (id === 'phone' && token === 't' ? true : 'wrong_token'), allowUnauthenticated: () => opts.allowNoToken === true, ...(opts.store ? { store: opts.store } : {}) });
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
    const res = await request(app).get('/api/v1/device/phone/commands?wait=25').set('Authorization', 'Bearer t');
    expect(res.status).toBe(200);
    expect(res.body.commands.map((c) => c.commandId)).toEqual(['d1']);
    expect(phoneInbox.isPresent('phone')).toBe(true);
    expect(sent.some((m) => m.topic === 'device-state' && m.reason === 'heartbeat')).toBe(true);
    const again = await request(app).get('/api/v1/device/phone/commands?wait=0').set('Authorization', 'Bearer t');
    expect(again.status).toBe(204);
  });

  it('holds until a command comes', async () => {
    const { app, phoneInbox } = setup();
    setTimeout(() => phoneInbox.enqueue('phone', envelope('d2')), 50);
    const res = await request(app).get('/api/v1/device/phone/commands?wait=5').set('Authorization', 'Bearer t');
    expect(res.status).toBe(200);
    expect(res.body.commands[0].commandId).toBe('d2');
  });

  it('times out empty (204)', async () => {
    const { app } = setup();
    const res = await request(app).get('/api/v1/device/phone/commands?wait=0.2').set('Authorization', 'Bearer t');
    expect(res.status).toBe(204);
  });

  it('takes a reported state with the poll', async () => {
    const { app, sent } = setup();
    await request(app).get('/api/v1/device/phone/commands?wait=0&state=playing&contentId=plex:9&title=Book').set('Authorization', 'Bearer t');
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
    const res = await request(app).post('/api/v1/device/phone/ack').set('Authorization', 'Bearer t')
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
    expect((await request(app).post('/api/v1/device/phone/ack').set('Authorization', 'Bearer t').send(body)).status).toBe(400);
  });

  it('is 404 for a device that is not an inbox device', async () => {
    const { app } = setup();
    expect((await request(app).post('/api/v1/device/office-tv/ack').send({ commandId: 'd', ok: true })).status).toBe(404);
  });
});

describe('the right install (ops:docs/superpowers/plans/2026-11-26-phone-downloads-hardening.md §H)', () => {
  const A = 'install-aaaa-1111';
  const B = 'install-bbbb-2222';
  const auth = (r) => r.set('Authorization', 'Bearer t');

  it('refuses a poll, an ack or a keep report without the device token (401, reason only)', async () => {
    const { app } = setup();
    const poll = await request(app).get('/api/v1/device/phone/commands?wait=0');
    expect(poll.status).toBe(401);
    expect(poll.body).toMatchObject({ code: 'UNAUTHORIZED', details: ['no_token'] });
    const wrong = await request(app).get('/api/v1/device/phone/commands?wait=0').set('Authorization', 'Bearer nope');
    expect(wrong.status).toBe(401);
    expect(JSON.stringify(wrong.body)).not.toContain('nope');
    expect((await request(app).post('/api/v1/device/phone/ack').send({ commandId: 'x', ok: true })).status).toBe(401);
    expect((await request(app).post('/api/v1/device/phone/keeps').send({ installId: A, items: [] })).status).toBe(401);
  });

  it('during the transition a tokenless poll is let in, a wrong token still is not', async () => {
    const { app } = setup({ allowNoToken: true });
    expect((await request(app).get('/api/v1/device/phone/commands?wait=0')).status).toBe(204);
    expect((await request(app).get('/api/v1/device/phone/commands?wait=0').set('Authorization', 'Bearer nope')).status).toBe(401);
  });

  it('a web Play on goes to the install in use, never to another install polling as the phone', async () => {
    const { app, phoneInbox } = setup();
    await auth(request(app).get(`/api/v1/device/phone/commands?wait=0&installId=${A}&model=SM-S921U`));
    phoneInbox.enqueue('phone', envelope('web-1'));
    const other = await auth(request(app).get(`/api/v1/device/phone/commands?wait=0&installId=${B}&model=sdk_gphone64`));
    expect(other.status).toBe(204);
    const mine = await auth(request(app).get(`/api/v1/device/phone/commands?wait=0&installId=${A}`));
    expect(mine.body.commands.map((c) => c.commandId)).toEqual(['web-1']);
  });

  it('rejects a malformed installId', async () => {
    const { app } = setup();
    expect((await auth(request(app).get('/api/v1/device/phone/commands?wait=0&installId=x'))).status).toBe(400);
  });

  it('queues a keep, delivers it, takes the ack and the report, and shows each stage', async () => {
    const { app } = setup();
    await auth(request(app).get(`/api/v1/device/phone/commands?wait=0&installId=${A}&model=SM-S921U`));
    const queued = await request(app).post('/api/v1/device/phone/keep').send({ contentId: 'plex:9', title: 'A book' });
    expect(queued.status).toBe(202);
    expect(queued.body.queued).toMatchObject({ command: 'keep', contentId: 'plex:9', installId: A });
    expect(queued.body.queued.queuedAt).toBeTruthy();
    let view = (await request(app).get('/api/v1/device/phone/keeps')).body;
    expect(view.waiting.map((w) => w.contentId)).toEqual(['plex:9']);
    expect(view.installs[0]).toMatchObject({ installId: A, model: 'SM-S921U', current: true, live: true, gone: false });
    const got = await auth(request(app).get(`/api/v1/device/phone/commands?wait=0&installId=${A}`));
    expect(got.body.commands[0]).toMatchObject({ command: 'keep', params: { contentId: 'plex:9', title: 'A book' }, installId: A });
    await auth(request(app).post('/api/v1/device/phone/ack')).send({ commandId: got.body.commands[0].commandId, ok: true });
    view = (await request(app).get('/api/v1/device/phone/keeps')).body;
    expect(view.received.map((r) => r.contentId)).toEqual(['plex:9']);
    const report = await auth(request(app).post('/api/v1/device/phone/keeps'))
      .send({ installId: A, freeBytes: 15000000000, limitBytes: 4000000000, items: [{ contentId: 'plex:9', title: 'A book', state: 'downloading', done: 3, total: 12, bytes: 5000 }] });
    expect(report.status).toBe(204);
    view = (await request(app).get('/api/v1/device/phone/keeps')).body;
    expect(view.waiting).toEqual([]);
    expect(view.received).toEqual([]);
    expect(view.kept[A]).toMatchObject({ freeBytes: 15000000000, limitBytes: 4000000000 });
    expect(view.kept[A].items[0]).toMatchObject({ contentId: 'plex:9', state: 'downloading', done: 3, total: 12 });
  });

  it('two live installs and none named: 409 CHOOSE_PHONE with the installs', async () => {
    const { app } = setup();
    await auth(request(app).get(`/api/v1/device/phone/commands?wait=0&installId=${A}&model=SM-S921U`));
    await auth(request(app).get(`/api/v1/device/phone/commands?wait=0&installId=${B}&model=sdk_gphone64`));
    const res = await request(app).post('/api/v1/device/phone/keep').send({ contentId: 'plex:9' });
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('CHOOSE_PHONE');
    expect(res.body.installs.map((i) => i.model).sort()).toEqual(['SM-S921U', 'sdk_gphone64']);
  });

  it('a keep that cannot be stored is 503 with Retry-After, not 202', async () => {
    const store = { load: () => null, save: async () => { throw new Error('disk full'); } };
    const { app } = setup({ store });
    const res = await request(app).post('/api/v1/device/phone/keep').send({ contentId: 'plex:9' });
    expect(res.status).toBe(503);
    expect(res.headers['retry-after']).toBe('30');
    expect(res.body).toMatchObject({ code: 'STORE_UNAVAILABLE', retryable: true });
  });

  it('cancels a waiting keep', async () => {
    const { app } = setup();
    const queued = await request(app).post('/api/v1/device/phone/keep').send({ contentId: 'plex:9' });
    const res = await request(app).post('/api/v1/device/phone/keep/cancel').send({ commandId: queued.body.queued.commandId });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ cancelled: true });
    expect((await request(app).post('/api/v1/device/phone/keep/cancel').send({ commandId: 'nope' })).status).toBe(404);
  });

  it('validates keep requests and reports', async () => {
    const { app } = setup();
    expect((await request(app).post('/api/v1/device/phone/keep').send({})).status).toBe(400);
    expect((await request(app).post('/api/v1/device/livingroom-tv/keep').send({ contentId: 'plex:1' })).status).toBe(404);
    expect((await auth(request(app).post('/api/v1/device/phone/keeps')).send({ installId: 'x', items: [] })).status).toBe(400);
  });
});
