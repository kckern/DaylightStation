import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import { createTriggerRouter } from '../../../../backend/src/4_api/v1/routers/trigger.mjs';

describe('createTriggerRouter', () => {
  let triggerDispatchService;
  let app;

  beforeEach(() => {
    triggerDispatchService = { handleTrigger: vi.fn(), setNote: vi.fn() };
    app = express();
    app.use(express.json());                    // enable JSON body parsing
    app.use('/api/v1/trigger', createTriggerRouter({
      triggerDispatchService,
      logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    }));
  });

  it('returns 200 on successful trigger', async () => {
    triggerDispatchService.handleTrigger.mockResolvedValue({ ok: true, action: 'queue', target: 'livingroom-tv' });
    const res = await request(app).get('/api/v1/trigger/livingroom/nfc/83_8e_68_06');
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(triggerDispatchService.handleTrigger).toHaveBeenCalledWith(
      'livingroom', 'nfc', '83_8e_68_06', expect.any(Object)
    );
  });

  it('returns 404 for LOCATION_NOT_FOUND', async () => {
    triggerDispatchService.handleTrigger.mockResolvedValue({ ok: false, code: 'LOCATION_NOT_FOUND', error: 'Unknown location' });
    const res = await request(app).get('/api/v1/trigger/attic/nfc/aa_bb');
    expect(res.status).toBe(404);
    expect(res.body.code).toBe('LOCATION_NOT_FOUND');
  });

  it('returns 404 for TRIGGER_NOT_REGISTERED', async () => {
    triggerDispatchService.handleTrigger.mockResolvedValue({ ok: false, code: 'TRIGGER_NOT_REGISTERED', error: 'Unknown trigger' });
    const res = await request(app).get('/api/v1/trigger/livingroom/nfc/zz');
    expect(res.status).toBe(404);
  });

  it('returns 401 for AUTH_FAILED', async () => {
    triggerDispatchService.handleTrigger.mockResolvedValue({ ok: false, code: 'AUTH_FAILED', error: 'auth' });
    const res = await request(app).get('/api/v1/trigger/livingroom/nfc/aa');
    expect(res.status).toBe(401);
  });

  it('returns 400 for UNKNOWN_ACTION and INVALID_INTENT', async () => {
    triggerDispatchService.handleTrigger.mockResolvedValueOnce({ ok: false, code: 'UNKNOWN_ACTION', error: 'x' });
    expect((await request(app).get('/api/v1/trigger/l/nfc/v')).status).toBe(400);
    triggerDispatchService.handleTrigger.mockResolvedValueOnce({ ok: false, code: 'INVALID_INTENT', error: 'y' });
    expect((await request(app).get('/api/v1/trigger/l/nfc/v')).status).toBe(400);
  });

  it('returns 502 for DISPATCH_FAILED', async () => {
    triggerDispatchService.handleTrigger.mockResolvedValue({ ok: false, code: 'DISPATCH_FAILED', error: 'boom' });
    const res = await request(app).get('/api/v1/trigger/l/nfc/v');
    expect(res.status).toBe(502);
  });

  it('passes ?token= and ?dryRun= through to options', async () => {
    triggerDispatchService.handleTrigger.mockResolvedValue({ ok: true });
    await request(app).get('/api/v1/trigger/l/nfc/v?token=secret&dryRun=1');
    expect(triggerDispatchService.handleTrigger).toHaveBeenCalledWith('l', 'nfc', 'v',
      expect.objectContaining({ token: 'secret', dryRun: true }));
  });

  describe('PUT /:location/:type/:value/note', () => {
    it('returns 200 on successful note set', async () => {
      triggerDispatchService.setNote = vi.fn().mockResolvedValue({
        ok: true, location: 'livingroom', modality: 'nfc', value: '04_a1_b2_c3', note: 'kids favorite',
      });
      const res = await request(app)
        .put('/api/v1/trigger/livingroom/nfc/04_a1_b2_c3/note')
        .send({ note: 'kids favorite' });
      expect(res.status).toBe(200);
      expect(res.body.ok).toBe(true);
      expect(triggerDispatchService.setNote).toHaveBeenCalledWith(
        'livingroom', 'nfc', '04_a1_b2_c3', 'kids favorite', expect.any(Object),
      );
    });

    it('passes token from query string to setNote', async () => {
      triggerDispatchService.setNote = vi.fn().mockResolvedValue({ ok: true });
      await request(app)
        .put('/api/v1/trigger/livingroom/nfc/04/note?token=secret')
        .send({ note: 'x' });
      expect(triggerDispatchService.setNote).toHaveBeenCalledWith(
        'livingroom', 'nfc', '04', 'x', expect.objectContaining({ token: 'secret' }),
      );
    });

    it('returns 400 for INVALID_NOTE', async () => {
      triggerDispatchService.setNote = vi.fn().mockResolvedValue({ ok: false, code: 'INVALID_NOTE', error: 'too long' });
      const res = await request(app)
        .put('/api/v1/trigger/livingroom/nfc/04/note')
        .send({ note: '' });
      expect(res.status).toBe(400);
    });

    it('returns 401 for AUTH_FAILED', async () => {
      triggerDispatchService.setNote = vi.fn().mockResolvedValue({ ok: false, code: 'AUTH_FAILED', error: 'auth' });
      const res = await request(app)
        .put('/api/v1/trigger/livingroom/nfc/04/note')
        .send({ note: 'x' });
      expect(res.status).toBe(401);
    });

    it('returns 404 for LOCATION_NOT_FOUND', async () => {
      triggerDispatchService.setNote = vi.fn().mockResolvedValue({ ok: false, code: 'LOCATION_NOT_FOUND', error: 'no loc' });
      const res = await request(app)
        .put('/api/v1/trigger/attic/nfc/04/note')
        .send({ note: 'x' });
      expect(res.status).toBe(404);
    });

    it('returns 400 for UNSUPPORTED_MODALITY', async () => {
      triggerDispatchService.setNote = vi.fn().mockResolvedValue({ ok: false, code: 'UNSUPPORTED_MODALITY', error: 'no' });
      const res = await request(app)
        .put('/api/v1/trigger/livingroom/state/on/note')
        .send({ note: 'x' });
      expect(res.status).toBe(400);
    });

    it('returns 500 for NOTE_WRITE_FAILED', async () => {
      triggerDispatchService.setNote = vi.fn().mockResolvedValue({ ok: false, code: 'NOTE_WRITE_FAILED', error: 'disk' });
      const res = await request(app)
        .put('/api/v1/trigger/livingroom/nfc/04/note')
        .send({ note: 'x' });
      expect(res.status).toBe(500);
    });

    it('returns 400 when body has no note field at all', async () => {
      triggerDispatchService.setNote = vi.fn().mockResolvedValue({ ok: false, code: 'INVALID_NOTE', error: 'missing' });
      const res = await request(app)
        .put('/api/v1/trigger/livingroom/nfc/04/note')
        .send({});
      expect(res.status).toBe(400);
      expect(triggerDispatchService.setNote).toHaveBeenCalledWith(
        'livingroom', 'nfc', '04', undefined, expect.any(Object),
      );
    });
  });
});
