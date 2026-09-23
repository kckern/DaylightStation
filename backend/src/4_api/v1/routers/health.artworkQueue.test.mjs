import { describe, it, expect, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import { createHealthRouter } from './health.mjs';

const appFor = service => {
  const app = express();
  app.use(createHealthRouter({ healthOperations: { defaultUsername: () => 'owner' },
    artworkProvider: () => service, logger: { info() {}, warn() {}, error() {} } }));
  return app;
};

describe('artwork remediation queue HTTP contract', () => {
  it('queues a browser report for the server-owned user and answers 202', async () => {
    const service = { report: vi.fn(async () => ({ key: 'photo:ph_x', attempts: 0 })), view: vi.fn() };
    const result = await request(appFor(service)).post('/nutrition/artwork-failures')
      .send({ kind: 'photo-failed', key: 'ph_x', uuid: 'row-1', name: 'Shake', icon: 'default', userId: 'impostor' });
    expect(result.status).toBe(202);
    expect(result.body).toEqual({ queued: true, key: 'photo:ph_x', attempts: 0 });
    expect(service.report).toHaveBeenCalledWith('owner', { kind: 'photo-failed', key: 'ph_x', uuid: 'row-1', name: 'Shake', icon: 'default' });
  });

  it('validates the kind and key', async () => {
    const service = { report: vi.fn(), view: vi.fn() };
    expect((await request(appFor(service)).post('/nutrition/artwork-failures').send({ kind: 'photo', key: 'ph_x' })).status).toBe(400);
    expect((await request(appFor(service)).post('/nutrition/artwork-failures').send({ kind: 'icon-failed' })).status).toBe(400);
    expect((await request(appFor(service)).post('/nutrition/artwork-failures').send({ kind: 'icon-failed', key: 'apple', uuid: 7 })).status).toBe(400);
    expect(service.report).not.toHaveBeenCalled();
  });

  it('lists open and recently resolved items', async () => {
    const view = { open: [{ key: 'food:f1', attempts: 2 }], recentlyResolved: [] };
    const service = { report: vi.fn(), view: vi.fn(() => view) };
    const result = await request(appFor(service)).get('/nutrition/artwork-queue');
    expect(result.status).toBe(200);
    expect(result.body).toEqual(view);
    expect(service.view).toHaveBeenCalledWith('owner');
  });

  it('answers 503 when the queue is not composed', async () => {
    expect((await request(appFor(null)).get('/nutrition/artwork-queue')).status).toBe(503);
    expect((await request(appFor(null)).post('/nutrition/artwork-failures').send({ kind: 'icon-failed', key: 'apple' })).status).toBe(503);
  });
});
