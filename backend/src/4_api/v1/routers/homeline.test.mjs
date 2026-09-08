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
  // A tin can: no user provisioning, no sign-in, no identification. Someone on
  // the house network who never signed in must be able to place a call.
  it('lets an unidentified caller on the home network place a call', async () => {
    const reserve = vi.fn(async () => ({ kind: 'ok', body: { callId: 'c1' } }));
    const { app } = appWith({ reserve }, { user: null, local: true });
    const response = await request(app).post('/api/v1/homeline/calls')
      .send({ deviceId: 'tv', attemptId: 'a', phonePeerId: 'p' });
    expect(response.status).toBe(201);
    // The lease still gets an owner, so a stray tab cannot end this call and a
    // refreshed phone can resume its own.
    expect(reserve).toHaveBeenCalledWith(expect.objectContaining({ callerId: 'trusted-local-network' }));
  });

  it('prefers a real user identity when a token happens to be present', async () => {
    const reserve = vi.fn(async () => ({ kind: 'ok', body: { callId: 'c1' } }));
    const { app } = appWith({ reserve }, { user: { sub: 'kckern' }, local: true });
    await request(app).post('/api/v1/homeline/calls').send({ deviceId: 'tv', attemptId: 'a', phonePeerId: 'p' });
    expect(reserve).toHaveBeenCalledWith(expect.objectContaining({ callerId: 'kckern' }));
  });

  it('refuses a caller that is not on the home network', async () => {
    const { app } = appWith({}, { user: null, local: false });
    const response = await request(app).post('/api/v1/homeline/calls').send({});
    expect(response.status).toBe(401);
    expect(response.body.code).toBe('NOT_ON_HOME_NETWORK');
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
