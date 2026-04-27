import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import { createTriggerRouter } from '../../../../backend/src/4_api/v1/routers/trigger.mjs';

describe('createTriggerRouter — POST /side-effect', () => {
  let triggerDispatchService;
  let tvControlAdapter;
  let deviceService;
  let app;

  beforeEach(() => {
    triggerDispatchService = { handleTrigger: vi.fn(), setNote: vi.fn() };
    tvControlAdapter = { turnOff: vi.fn().mockResolvedValue({ ok: true }) };
    deviceService = { get: vi.fn() };
    app = express();
    app.use('/api/v1/trigger', createTriggerRouter({
      triggerDispatchService,
      tvControlAdapter,
      deviceService,
      logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    }));
  });

  it('200 + dispatches tv-off to the adapter', async () => {
    const res = await request(app)
      .post('/api/v1/trigger/side-effect')
      .send({ behavior: 'tv-off', location: 'living_room', markerId: 'm1' });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(tvControlAdapter.turnOff).toHaveBeenCalledWith('living_room');
  });

  it('400 when behavior is missing', async () => {
    const res = await request(app).post('/api/v1/trigger/side-effect').send({ location: 'x' });
    expect(res.status).toBe(400);
  });

  it('400 (UnknownSideEffectError) for unknown behavior', async () => {
    const res = await request(app)
      .post('/api/v1/trigger/side-effect')
      .send({ behavior: 'self-destruct', markerId: 'm2' });
    expect(res.status).toBe(400);
  });

  it('502 when handler throws (e.g., HA error)', async () => {
    tvControlAdapter.turnOff.mockRejectedValue(new Error('HA timeout'));
    const res = await request(app)
      .post('/api/v1/trigger/side-effect')
      .send({ behavior: 'tv-off', location: 'living_room', markerId: 'm3' });
    expect(res.status).toBe(502);
  });

  it('dedupes a second POST with the same markerId', async () => {
    await request(app)
      .post('/api/v1/trigger/side-effect')
      .send({ behavior: 'tv-off', location: 'living_room', markerId: 'm-dedup' });
    tvControlAdapter.turnOff.mockClear();

    const res = await request(app)
      .post('/api/v1/trigger/side-effect')
      .send({ behavior: 'tv-off', location: 'living_room', markerId: 'm-dedup' });
    expect(res.status).toBe(200);
    expect(res.body.deduped).toBe(true);
    expect(tvControlAdapter.turnOff).not.toHaveBeenCalled();
  });

  it('failed dispatch does NOT poison dedup window', async () => {
    tvControlAdapter.turnOff.mockRejectedValueOnce(new Error('transient'));
    await request(app)
      .post('/api/v1/trigger/side-effect')
      .send({ behavior: 'tv-off', location: 'living_room', markerId: 'm-retry' });

    tvControlAdapter.turnOff.mockResolvedValueOnce({ ok: true });
    const res = await request(app)
      .post('/api/v1/trigger/side-effect')
      .send({ behavior: 'tv-off', location: 'living_room', markerId: 'm-retry' });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.deduped).toBeUndefined();
  });
});
