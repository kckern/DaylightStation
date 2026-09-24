import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import { createTriggerRouter } from './trigger.mjs';

const sideEffectExecutor = { execute: vi.fn() };
const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };

function appWith(voiceTriggerService) {
  const app = express();
  app.use('/api/v1/trigger', createTriggerRouter({
    triggerDispatchService: { handleTrigger: vi.fn(), setNote: vi.fn() },
    voiceTriggerService, sideEffectExecutor, logger,
  }));
  return app;
}

describe('trigger router — voice', () => {
  let voice;
  beforeEach(() => {
    voice = { handleTranscript: vi.fn(), confirm: vi.fn() };
  });

  it('POST /:location/voice passes transcript, token and dryRun', async () => {
    voice.handleTranscript.mockResolvedValue({ ok: true, confirm: true, proposal: { id: 'p1' } });
    const res = await request(appWith(voice)).post('/api/v1/trigger/kitchen/voice?token=t&dryRun=1').send({ transcript: 'put jazz on' });
    expect(res.status).toBe(200);
    expect(res.body.proposal.id).toBe('p1');
    expect(voice.handleTranscript).toHaveBeenCalledWith('kitchen', 'put jazz on', { token: 't', dryRun: true });
  });

  it('accepts the token in the body for callers that cannot set query strings', async () => {
    voice.handleTranscript.mockResolvedValue({ ok: true });
    await request(appWith(voice)).post('/api/v1/trigger/kitchen/voice').send({ transcript: 'x', token: 'bt' });
    expect(voice.handleTranscript).toHaveBeenCalledWith('kitchen', 'x', { token: 'bt' });
  });

  it.each([
    ['INVALID_TRANSCRIPT', 400],
    ['VOICE_NO_MATCH', 404],
    ['AUTH_FAILED', 401],
    ['LOCATION_NOT_FOUND', 404],
    ['DISPATCH_FAILED', 502],
  ])('maps %s to %i', async (code, status) => {
    voice.handleTranscript.mockResolvedValue({ ok: false, code });
    const res = await request(appWith(voice)).post('/api/v1/trigger/kitchen/voice').send({ transcript: 'x' });
    expect(res.status).toBe(status);
  });

  it('POST /:location/voice/confirm dispatches a proposal; 410 when gone', async () => {
    voice.confirm.mockResolvedValueOnce({ ok: true, voice: { command: 'play_jazz' } });
    const ok = await request(appWith(voice)).post('/api/v1/trigger/kitchen/voice/confirm?token=t').send({ proposal: 'p1' });
    expect(ok.status).toBe(200);
    expect(voice.confirm).toHaveBeenCalledWith('kitchen', 'p1', { token: 't' });

    voice.confirm.mockResolvedValueOnce({ ok: false, code: 'PROPOSAL_NOT_FOUND' });
    const gone = await request(appWith(voice)).post('/api/v1/trigger/kitchen/voice/confirm').send({ proposal: 'p1' });
    expect(gone.status).toBe(410);
  });

  it('without a voice service the routes are not mounted', async () => {
    const res = await request(appWith(null)).post('/api/v1/trigger/kitchen/voice').send({ transcript: 'x' });
    expect(res.status).toBe(404);
    expect(res.body.code).toBeUndefined();
  });
});
