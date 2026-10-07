import { describe, expect, it } from 'vitest';
import request from 'supertest';
import { ORDINARY_DEVICE_ID, SECOND_DEVICE_ID, createMediaOrdinaryDeviceFixture } from './media-ordinary-device-fixture.mjs';

describe('media ordinary device fixture', () => {
  it('rejects a physical device load while retaining the one virtual identity', async () => {
    const fixture = createMediaOrdinaryDeviceFixture({ upstream: 'http://127.0.0.1:3111' });
    expect(fixture.deviceId).toBe(ORDINARY_DEVICE_ID);
    await request(fixture.app)
      .get('/livingroom-tv/load?play=plex:55854&dispatchId=physical-command')
      .expect(403, { ok: false, error: 'ordinary acceptance blocks physical device routes' });
    await request(fixture.app)
      .post('/livingroom-tv/session/transport')
      .send({ action: 'pause', commandId: 'physical-pause' })
      .expect(403, { ok: false, error: 'ordinary acceptance blocks physical device routes' });
    await fixture.stop();
  });

  it.each([
    ['pause', undefined],
    ['play', undefined],
    ['seekAbs', 42],
    ['seekRel', -10],
    ['skipNext', undefined],
    ['skipPrev', undefined],
    ['stop', undefined],
  ])('sends virtual %s through screen command and correlated device ack', async (action, value) => {
    const fixture = createMediaOrdinaryDeviceFixture({ upstream: 'http://127.0.0.1:3111' });
    const commands = [];
    // Unit-test boundary only: the live journey uses the mounted browser receiver.
    fixture.eventBus.subscribe('screen:acceptance-media', command => {
      commands.push(command);
      fixture.eventBus.broadcast('device-ack:acceptance-media', {
        deviceId: 'acceptance-media', commandId: command.commandId, ok: true,
      });
    });

    const body = { action, ...(value !== undefined ? { value } : {}), commandId: `virtual-${action}` };
    const response = await request(fixture.app)
      .post('/acceptance-media/session/transport')
      .send(body)
      .expect(200);

    expect(response.body).toMatchObject({ ok: true, commandId: body.commandId });
    expect(commands).toHaveLength(1);
    expect(commands[0]).toMatchObject({
      type: 'command', targetDevice: 'acceptance-media', command: 'transport', commandId: body.commandId,
      params: { action, ...(value !== undefined ? { value } : {}) },
    });
    expect(commands[0].ts).toMatch(/^\d{4}-\d\d-\d\dT/);
    await fixture.stop();
  });

  it.each([
    ['GET', '/acceptance-media/session/transport', null],
    ['POST', '/acceptance-media/session/transport', { action: 'unknownAction', commandId: 'skip' }],
    ['POST', '/acceptance-media/session/queue/play-now', { contentId: 'plex:1', commandId: 'queue' }],
    ['GET', '/acceptance-media-extra/load', null],
  ])('blocks non-allowlisted device request %s %s before command dispatch', async (method, path, body) => {
    const fixture = createMediaOrdinaryDeviceFixture({ upstream: 'http://127.0.0.1:3111' });
    let published = false;
    fixture.eventBus.subscribePattern(topic => topic.startsWith('screen:'), () => { published = true; });
    const req = request(fixture.app)[method.toLowerCase()](path);
    if (body) req.send(body);
    await req.expect(403, { ok: false, error: 'ordinary acceptance blocks physical device routes' });
    expect(published).toBe(false);
    await fixture.stop();
  });

  it('preserves the ordinary virtual load path', async () => {
    const fixture = createMediaOrdinaryDeviceFixture({ upstream: 'http://127.0.0.1:3111' });
    await request(fixture.app)
      .get('/acceptance-media/load?play=plex:55854&dispatchId=virtual-load')
      .expect(200);
    await fixture.stop();
  });

  it('allows the virtual receiver to claim its Task 3 item action without opening physical routes', async () => {
    const fixture = createMediaOrdinaryDeviceFixture({ upstream: 'http://127.0.0.1:3111' });
    await request(fixture.app)
      .post('/acceptance-media/session/item-action/operation-1/claim')
      .send({})
      .expect(200, { ok: true });
    await request(fixture.app)
      .post('/livingroom-tv/session/item-action/operation-1/claim')
      .send({})
      .expect(403, { ok: false, error: 'ordinary acceptance blocks physical device routes' });
    await fixture.stop();
  });

  it('routes typed handoff only to the ordinary virtual receiver', async () => {
    const fixture = createMediaOrdinaryDeviceFixture({ upstream: 'http://127.0.0.1:3111' });
    const commands = [];
    fixture.eventBus.subscribe('screen:acceptance-media', command => {
      commands.push(command);
      fixture.eventBus.broadcast('device-ack:acceptance-media', {
        deviceId: 'acceptance-media', commandId: command.commandId, ok: true,
        handoff: { transferId: command.params.transferId, phase: 'starting' },
      });
    });
    await request(fixture.app)
      .post('/acceptance-media/session/handoff')
      .send({ commandId: 'paused-handoff', params: { version: 1, transferId: 'transfer-paused', op: 'status' } })
      .expect(202);
    expect(commands[0]).toMatchObject({ command: 'handoff', commandId: 'paused-handoff' });
    await request(fixture.app)
      .post('/livingroom-tv/session/handoff')
      .send({ commandId: 'physical', params: { version: 1, transferId: 'transfer-paused', op: 'status' } })
      .expect(403);
    await fixture.stop();
  });

  it.each([
    ['put', '/session/add-only', { enabled: true }],
    ['put', '/session/end-of-queue', { mode: 'similar' }],
    ['post', '/session/sleep-timer', { minutes: 1 }],
    ['post', '/session/put-back', {}],
    ['post', '/session/countdown/cancel', {}],
  ])('routes virtual session control %s %s and blocks it for physical devices', async (method, path, body) => {
    const fixture = createMediaOrdinaryDeviceFixture({ upstream: 'http://127.0.0.1:3111' });
    fixture.eventBus.subscribe('screen:acceptance-media', command => {
      fixture.eventBus.broadcast('device-ack:acceptance-media', { deviceId: 'acceptance-media', commandId: command.commandId, ok: true });
    });
    await request(fixture.app)[method](`/acceptance-media${path}`).send({ ...body, commandId: `virtual-${path}` }).expect(200);
    await request(fixture.app)[method](`/livingroom-tv${path}`).send({ ...body, commandId: 'physical' })
      .expect(403, { ok: false, error: 'ordinary acceptance blocks physical device routes' });
    await fixture.stop();
  });

  it('serves the virtual start status from the wake-progress stream', async () => {
    const fixture = createMediaOrdinaryDeviceFixture({ upstream: 'http://127.0.0.1:3111' });
    fixture.eventBus.broadcast('homeline:acceptance-media', { type: 'wake-progress', dispatchId: 'd1', step: 'load', status: 'done' });
    const response = await request(fixture.app).get('/acceptance-media/start-status').expect(200);
    expect(response.body).toMatchObject({ ok: true, status: { phase: 'delivered', dispatchId: 'd1' } });
    await fixture.stop();
  });

  it('serves a second virtual receiver (several screens, line up, moves) with the same route boundary', async () => {
    const fixture = createMediaOrdinaryDeviceFixture({ upstream: 'http://127.0.0.1:3111' });
    fixture.eventBus.subscribe(`screen:${SECOND_DEVICE_ID}`, command => {
      fixture.eventBus.broadcast(`device-ack:${SECOND_DEVICE_ID}`, { deviceId: SECOND_DEVICE_ID, commandId: command.commandId, ok: true });
    });
    await request(fixture.app).get(`/${SECOND_DEVICE_ID}/load?play=plex:55854&dispatchId=virtual-b`).expect(200);
    const config = await request(fixture.app).get('/config').expect(200);
    expect(Object.keys(config.body.devices ?? config.body)).toEqual(expect.arrayContaining([ORDINARY_DEVICE_ID, SECOND_DEVICE_ID]));
    await fixture.stop();
  });

  it('routes a virtual claim (the stop half of a move) and blocks it for physical devices', async () => {
    const fixture = createMediaOrdinaryDeviceFixture({ upstream: 'http://127.0.0.1:3111' });
    await request(fixture.app).post('/livingroom-tv/session/claim').send({ commandId: 'physical' })
      .expect(403, { ok: false, error: 'ordinary acceptance blocks physical device routes' });
    const virtual = await request(fixture.app).post(`/${ORDINARY_DEVICE_ID}/session/claim`).send({ commandId: 'virtual-claim' });
    expect(virtual.status).not.toBe(403);
    await fixture.stop();
  });

  it('routes a virtual item-action cancel (the Undo of a far start) and blocks it for physical devices', async () => {
    const fixture = createMediaOrdinaryDeviceFixture({ upstream: 'http://127.0.0.1:3111' });
    await request(fixture.app).post('/livingroom-tv/session/item-action/abc/cancel').send({ commandId: 'physical' })
      .expect(403, { ok: false, error: 'ordinary acceptance blocks physical device routes' });
    const virtual = await request(fixture.app).post(`/${ORDINARY_DEVICE_ID}/session/item-action/abc/cancel`).send({ commandId: 'virtual-cancel' });
    expect(virtual.status).not.toBe(403);
    await request(fixture.app).post(`/${ORDINARY_DEVICE_ID}/session/item-action/abc/other`).send({ commandId: 'x' }).expect(403);
    await fixture.stop();
  });

  it('opens queue edits, Undo and shuffle/repeat for a virtual screen only; starting content stays on the load route', async () => {
    const fixture = createMediaOrdinaryDeviceFixture({ upstream: 'http://127.0.0.1:3111' });
    for (const op of ['undo', 'remove', 'reorder', 'jump', 'clear']) {
      await request(fixture.app).post(`/livingroom-tv/session/queue/${op}`).send({ commandId: 'p' }).expect(403);
      expect((await request(fixture.app).post(`/${ORDINARY_DEVICE_ID}/session/queue/${op}`).send({ commandId: `v-${op}` })).status).not.toBe(403);
    }
    await request(fixture.app).put('/livingroom-tv/session/shuffle').send({ commandId: 'p', enabled: true }).expect(403);
    expect((await request(fixture.app).put(`/${ORDINARY_DEVICE_ID}/session/shuffle`).send({ commandId: 'v', enabled: true })).status).not.toBe(403);
    expect((await request(fixture.app).put(`/${ORDINARY_DEVICE_ID}/session/repeat`).send({ commandId: 'v', mode: 'all' })).status).not.toBe(403);
    for (const op of ['play-now', 'add', 'item-action']) {
      await request(fixture.app).post(`/${ORDINARY_DEVICE_ID}/session/queue/${op}`).send({ commandId: `v-${op}`, contentId: 'plex:1' }).expect(403);
    }
    await fixture.stop();
  });
});
