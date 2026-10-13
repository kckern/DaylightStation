import express from 'express';
import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';
import { createDeviceRouter } from './device.mjs';

const ok = (extra = {}) => vi.fn().mockResolvedValue({ ok: true, commandId: 'c1', ...extra });

function appWith({ sessionService, startStatusService, deviceHeader } = {}) {
  const app = express();
  app.use(express.json());
  if (deviceHeader) {
    app.use((req, _res, next) => { req.deviceId = deviceHeader; req.deviceIdSource = 'header'; next(); });
  }
  app.use('/api/v1/device', createDeviceRouter({ sessionService, startStatusService }));
  return app;
}

const service = (overrides = {}) => ({
  configured: () => true,
  config: ok(),
  session: ok(),
  transport: ok(),
  queue: ok(),
  ...overrides,
});

describe('screen session flags (PUT)', () => {
  it.each([
    ['add-only', { enabled: true }, 'addOnly', true],
    ['end-of-queue', { mode: 'similar' }, 'endOfQueue', 'similar'],
    ['stop-after-current', { enabled: false }, 'stopAfterCurrent', false],
  ])('PUT /session/%s routes to config(%s)', async (path, body, setting, value) => {
    const sessionService = service();
    const res = await request(appWith({ sessionService }))
      .put(`/api/v1/device/tv-a/session/${path}`).send({ ...body, commandId: 'c1' });
    expect(res.status).toBe(200);
    expect(sessionService.config).toHaveBeenCalledWith('tv-a', { setting, value, commandId: 'c1', origin: undefined });
  });

  it.each([
    ['add-only', { enabled: 'yes' }],
    ['end-of-queue', { mode: 'forever' }],
    ['stop-after-current', {}],
  ])('PUT /session/%s rejects an invalid value', async (path, body) => {
    const sessionService = service();
    const res = await request(appWith({ sessionService }))
      .put(`/api/v1/device/tv-a/session/${path}`).send({ ...body, commandId: 'c1' });
    expect(res.status).toBe(400);
    expect(sessionService.config).not.toHaveBeenCalled();
  });

  it('requires a commandId', async () => {
    const sessionService = service();
    const res = await request(appWith({ sessionService })).put('/api/v1/device/tv-a/session/add-only').send({ enabled: true });
    expect(res.status).toBe(400);
  });
});

describe('screen session actions (POST)', () => {
  it('sets a minutes sleep timer', async () => {
    const sessionService = service();
    const res = await request(appWith({ sessionService }))
      .post('/api/v1/device/tv-a/session/sleep-timer').send({ minutes: 30, commandId: 'c1' });
    expect(res.status).toBe(200);
    expect(sessionService.session).toHaveBeenCalledWith('tv-a', {
      action: 'sleep-timer', params: { minutes: 30 }, commandId: 'c1', origin: undefined,
    });
  });

  it('sets an end-of-item sleep timer', async () => {
    const sessionService = service();
    await request(appWith({ sessionService }))
      .post('/api/v1/device/tv-a/session/sleep-timer').send({ atEnd: 'item', commandId: 'c1' });
    expect(sessionService.session).toHaveBeenCalledWith('tv-a', expect.objectContaining({ params: { atEnd: 'item' } }));
  });

  it('rejects a sleep timer with neither minutes nor atEnd', async () => {
    const sessionService = service();
    const res = await request(appWith({ sessionService }))
      .post('/api/v1/device/tv-a/session/sleep-timer').send({ commandId: 'c1' });
    expect(res.status).toBe(400);
    expect(sessionService.session).not.toHaveBeenCalled();
  });

  it.each([
    ['sleep-timer/cancel', 'cancel-sleep-timer'],
    ['sleep-timer/resume', 'resume-sleep'],
    ['put-back', 'put-back'],
    ['countdown/cancel', 'cancel-countdown'],
    ['countdown/start-now', 'start-next-now'],
  ])('POST /session/%s sends action %s', async (path, action) => {
    const sessionService = service();
    const res = await request(appWith({ sessionService }))
      .post(`/api/v1/device/tv-a/session/${path}`).send({ commandId: 'c1' });
    expect(res.status).toBe(200);
    expect(sessionService.session).toHaveBeenCalledWith('tv-a', expect.objectContaining({ action, commandId: 'c1' }));
  });

  it('maps a screen refusal (no restore snapshot) to 502 with its code', async () => {
    const sessionService = service({ session: vi.fn().mockResolvedValue({ ok: false, code: 'PUT_BACK_UNAVAILABLE', error: 'Nothing to put back' }) });
    const res = await request(appWith({ sessionService }))
      .post('/api/v1/device/tv-a/session/put-back').send({ commandId: 'c1' });
    expect(res.status).toBe(502);
    expect(res.body.code).toBe('PUT_BACK_UNAVAILABLE');
  });
});

describe('command origin passthrough', () => {
  it('forwards an explicit body origin on transport and queue commands', async () => {
    const sessionService = service();
    const app = appWith({ sessionService });
    const origin = { kind: 'device', id: 'browser:abc', name: "Dad's phone" };
    await request(app).post('/api/v1/device/tv-a/session/transport').send({ action: 'pause', commandId: 'c1', origin });
    expect(sessionService.transport).toHaveBeenCalledWith('tv-a', { action: 'pause', value: undefined, commandId: 'c1', origin });
    await request(app).post('/api/v1/device/tv-a/session/queue/play-now').send({ contentId: 'plex:1', commandId: 'c2', origin });
    expect(sessionService.queue).toHaveBeenCalledWith('tv-a', 'c2', { op: 'play-now', contentId: 'plex:1' }, origin);
  });

  it('forwards an explicit keepMusic on a stop and rejects a non-boolean', async () => {
    const sessionService = service();
    const app = appWith({ sessionService });
    const ok = await request(app).post('/api/v1/device/tv-a/session/transport').send({ action: 'stop', commandId: 'c1', keepMusic: true });
    expect(ok.status).toBeLessThan(400);
    expect(sessionService.transport).toHaveBeenCalledWith('tv-a', expect.objectContaining({ action: 'stop', keepMusic: true }));
    sessionService.transport.mockClear();
    const bad = await request(app).post('/api/v1/device/tv-a/session/transport').send({ action: 'stop', commandId: 'c2', keepMusic: 'yes' });
    expect(bad.status).toBe(400);
    expect(sessionService.transport).not.toHaveBeenCalled();
  });

  it('falls back to the asking fleet device when no body origin is given', async () => {
    const sessionService = service();
    await request(appWith({ sessionService, deviceHeader: 'fleet:office-tv' }))
      .post('/api/v1/device/tv-a/session/transport').send({ action: 'stop', commandId: 'c1' });
    expect(sessionService.transport).toHaveBeenCalledWith('tv-a', expect.objectContaining({
      origin: { kind: 'device', id: 'fleet:office-tv' },
    }));
  });

  it('rejects a malformed origin', async () => {
    const sessionService = service();
    const res = await request(appWith({ sessionService }))
      .post('/api/v1/device/tv-a/session/transport').send({ action: 'pause', commandId: 'c1', origin: { kind: 'alien' } });
    expect(res.status).toBe(400);
    expect(sessionService.transport).not.toHaveBeenCalled();
  });
});

describe('GET /:deviceId/start-status', () => {
  it('returns the last start status for the device', async () => {
    const status = { topic: 'device-start', deviceId: 'tv-a', phase: 'failed', error: 'boom', updatedAt: 'x' };
    const startStatusService = { get: vi.fn().mockReturnValue(status) };
    const res = await request(appWith({ startStatusService })).get('/api/v1/device/tv-a/start-status');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true, status });
    expect(startStatusService.get).toHaveBeenCalledWith('tv-a');
  });

  it('answers null when nothing was ever started there', async () => {
    const res = await request(appWith({ startStatusService: { get: () => null } })).get('/api/v1/device/tv-a/start-status');
    expect(res.body).toEqual({ ok: true, status: null });
  });

  it('is 503 when the start status service is not wired', async () => {
    const res = await request(appWith({})).get('/api/v1/device/tv-a/start-status');
    expect(res.status).toBe(503);
  });
});

describe('origin precedence and the load route (B5)', () => {
  it('prefers the fleet header over a body origin, keeping the body name', async () => {
    const sessionService = service();
    await request(appWith({ sessionService, deviceHeader: 'fleet:office-tv' }))
      .post('/api/v1/device/tv-a/session/transport')
      .send({ action: 'pause', commandId: 'c1', origin: { kind: 'device', id: 'fleet:livingroom-tv', name: 'Office' } });
    expect(sessionService.transport).toHaveBeenCalledWith('tv-a', expect.objectContaining({
      origin: { kind: 'device', id: 'fleet:office-tv', name: 'Office' },
    }));
  });

  it('GET /load attributes the dispatch to the asking device', async () => {
    const dispatchService = {
      logLoadStart: vi.fn(), configured: () => true, checkInput: () => ({ ok: true }),
      load: vi.fn().mockResolvedValue({ ok: true }),
    };
    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => { req.deviceId = 'browser:abc'; req.deviceIdSource = 'header'; next(); });
    app.use('/api/v1/device', createDeviceRouter({ dispatchService }));
    await request(app).get('/api/v1/device/tv-a/load?play=plex:1').expect(200);
    expect(dispatchService.load).toHaveBeenCalledWith('tv-a', { play: 'plex:1' }, { origin: { kind: 'device', id: 'browser:abc' } });
  });

  it('GET /load from an un-named caller (HA) carries no device origin', async () => {
    const dispatchService = {
      logLoadStart: vi.fn(), configured: () => true, checkInput: () => ({ ok: true }),
      load: vi.fn().mockResolvedValue({ ok: true }),
    };
    const app = express();
    app.use('/api/v1/device', createDeviceRouter({ dispatchService }));
    await request(app).get('/api/v1/device/tv-a/load?play=plex:1').expect(200);
    expect(dispatchService.load).toHaveBeenCalledWith('tv-a', { play: 'plex:1' }, {});
  });
});
