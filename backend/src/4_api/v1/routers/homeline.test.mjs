import express from 'express';
import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';
import { createHomelineRouter } from './homeline.mjs';

const appWith = (leaseService, { user = { sub: 'caller' }, local = true, device = 'tv' } = {}) => {
  const app = express(); app.use(express.json());
  app.use((req, _res, next) => { req.user = user; req.isLocal = local; next(); });
  app.use('/api/v1/homeline', createHomelineRouter({ leaseService, canCall: () => true }));
  return { app, device };
};

describe('homeline router', () => {
  it('requires an authenticated user for reservation', async () => {
    const { app } = appWith({}, { user: null });
    expect((await request(app).post('/api/v1/homeline/calls').send({})).status).toBe(401);
  });

  it('requires explicit call permission', async () => {
    const app = express(); app.use(express.json());
    app.use((req, _res, next) => { req.user = { sub: 'caller' }; next(); });
    app.use('/api/v1/homeline', createHomelineRouter({ leaseService: {}, canCall: () => false }));
    expect((await request(app).post('/api/v1/homeline/calls').send({
      deviceId: 'tv', attemptId: 'a', phonePeerId: 'p',
    })).status).toBe(403);
  });

  it('maps not found and busy reservation outcomes', async () => {
    for (const [kind, status] of [['not_found', 404], ['busy', 409]]) {
      const { app } = appWith({ reserve: vi.fn(async () => ({ kind })) });
      const response = await request(app).post('/api/v1/homeline/calls')
        .send({ deviceId: 'tv', attemptId: 'a', phonePeerId: 'p' });
      expect(response.status).toBe(status);
    }
  });

  it('requires local exact device identity to join', async () => {
    const service = { joinActive: vi.fn(input => input.declaredDeviceId === input.deviceId && input.isLocal
      ? { kind: 'empty' } : { kind: 'forbidden' }) };
    const { app } = appWith(service);
    const denied = await request(app).post('/api/v1/homeline/devices/tv/join-active').set('X-Daylight-Device', 'other');
    expect(denied.status).toBe(403);
    expect(service.joinActive).toHaveBeenCalledWith({ deviceId: 'tv', declaredDeviceId: 'other', isLocal: true });
  });

  it('returns 204 for an authorized TV when no active lease exists', async () => {
    const service = { joinActive: vi.fn(() => ({ kind: 'empty' })) };
    const { app } = appWith(service);
    const response = await request(app).post('/api/v1/homeline/devices/tv/join-active').set('X-Daylight-Device', 'tv');
    expect(response.status).toBe(204);
    expect(response.text).toBe('');
  });

  it('returns truthful recovery failure status', async () => {
    const service = { recover: vi.fn(async () => ({ kind: 'failed', body: { ok: false, error: 'reload failed' } })) };
    const { app } = appWith(service);
    const response = await request(app).post('/api/v1/homeline/calls/c/recover').send({ level: 'soft' });
    expect(response.status).toBe(502); expect(response.body.ok).toBe(false);
  });

  it('passes hard-recovery confirmation and reports a missing confirmation', async () => {
    const service = { recover: vi.fn(async (_call, _caller, _level, { confirmed }) => confirmed
      ? { kind: 'ok', body: { ok: true } } : { kind: 'confirmation_required' }) };
    const { app } = appWith(service);
    expect((await request(app).post('/api/v1/homeline/calls/c/recover').send({ level: 'hard' })).status).toBe(409);
    expect((await request(app).post('/api/v1/homeline/calls/c/recover').send({ level: 'hard', confirmed: true })).status).toBe(200);
  });
});
