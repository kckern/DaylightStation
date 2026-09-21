import express from 'express';
import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';
import { createDeviceRouter } from './device.mjs';

const capture = { version: 1, transferId: 'transfer-1', op: 'capture' };

function appWith(sessionService) {
  const app = express();
  app.use(express.json());
  app.use('/api/v1/device', createDeviceRouter({ sessionService }));
  return app;
}

describe('POST /api/v1/device/:deviceId/session/handoff', () => {
  it('returns a complete correlated terminal unsupported result at 200', async () => {
    const sessionService = { configured: () => true, handoff: vi.fn().mockResolvedValue({ ok: false, commandId: 'handoff-1', code: 'HANDOFF_UNSUPPORTED', handoff: { transferId: 'transfer-1', phase: 'failed', code: 'HANDOFF_UNSUPPORTED' } }) };

    const response = await request(appWith(sessionService)).post('/api/v1/device/tv-a/session/handoff').send({ commandId: 'handoff-1', params: capture });
    expect(response.status).toBe(200);
    expect(response.body).toEqual({ ok: false, commandId: 'handoff-1', code: 'HANDOFF_UNSUPPORTED', handoff: { transferId: 'transfer-1', phase: 'failed', code: 'HANDOFF_UNSUPPORTED' } });
  });

  it.each([
    ['missing commandId', { params: capture }],
    ['unknown version', { commandId: 'handoff-1', params: { ...capture, version: 2 } }],
    ['unexpected top-level field', { commandId: 'handoff-1', params: capture, stop: true }],
  ])('rejects %s before invoking the session service', async (_label, body) => {
    const sessionService = { configured: () => true, handoff: vi.fn() };

    const response = await request(appWith(sessionService)).post('/api/v1/device/tv-a/session/handoff').send(body);
    expect(response.status).toBe(400);
    expect(sessionService.handoff).not.toHaveBeenCalled();
  });

  it('rejects an uncorrelated terminal-shaped result rather than trusting its handoff field', async () => {
    const sessionService = { configured: () => true, handoff: vi.fn().mockResolvedValue({ ok: false, commandId: 'other-command', code: 'HANDOFF_UNSUPPORTED', handoff: { transferId: 'transfer-1', phase: 'failed', code: 'HANDOFF_UNSUPPORTED' } }) };

    const response = await request(appWith(sessionService)).post('/api/v1/device/tv-a/session/handoff').send({ commandId: 'handoff-1', params: capture });
    expect(response.status).toBe(502);
    expect(response.body.code).toBe('INVALID_HANDOFF_RESULT');
  });

  it('rejects a generic ok receipt that has no handoff result', async () => {
    const sessionService = { configured: () => true, handoff: vi.fn().mockResolvedValue({ ok: true, commandId: 'handoff-1' }) };

    const response = await request(appWith(sessionService)).post('/api/v1/device/tv-a/session/handoff').send({ commandId: 'handoff-1', params: capture });
    expect(response.status).toBe(502);
    expect(response.body.code).toBe('INVALID_HANDOFF_RESULT');
  });

  it('returns a correlated status starting result at 202 without treating it as native success', async () => {
    const sessionService = { configured: () => true, handoff: vi.fn().mockResolvedValue({ ok: true, commandId: 'handoff-1', handoff: { transferId: 'transfer-1', phase: 'starting' } }) };

    const response = await request(appWith(sessionService)).post('/api/v1/device/tv-a/session/handoff').send({ commandId: 'handoff-1', params: { ...capture, op: 'status' } });
    expect(response.status).toBe(202);
    expect(response.body).toEqual({ ok: true, commandId: 'handoff-1', handoff: { transferId: 'transfer-1', phase: 'starting' } });
  });
});
