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
});
