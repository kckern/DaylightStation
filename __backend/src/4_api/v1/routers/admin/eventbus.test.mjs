import { describe, it, expect, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import { createEventBusRouter } from './eventbus.mjs';

function build() {
  const administration = {
    available: true,
    restart: vi.fn().mockResolvedValue(undefined),
    broadcastAdmin: vi.fn(),
    status: () => ({ running: true, metrics: { clients: 1 } }),
  };
  const app = express();
  app.use(express.json());
  app.use('/ws', createEventBusRouter({ eventBusAdministration: administration, logger: { info() {}, error() {} } }));
  return { app, administration };
}

describe('event bus admin router: state changes need POST', () => {
  it('restarts on POST only', async () => {
    const { app, administration } = build();
    expect((await request(app).get('/ws/restart')).status).toBe(404);
    expect(administration.restart).not.toHaveBeenCalled();
    expect((await request(app).post('/ws/restart')).status).toBe(200);
    expect(administration.restart).toHaveBeenCalledTimes(1);
  });

  it('broadcasts on POST only, never from a GET query string', async () => {
    const { app, administration } = build();
    for (const method of ['get', 'put', 'delete']) {
      expect((await request(app)[method]('/ws/broadcast?topic=x').send({})).status, method).toBe(404);
    }
    expect((await request(app).get('/ws?topic=x')).status).toBe(404);
    expect(administration.broadcastAdmin).not.toHaveBeenCalled();

    const sent = await request(app).post('/ws/broadcast').send({ hello: 'world' });
    expect(sent.status).toBe(200);
    expect(administration.broadcastAdmin).toHaveBeenCalledWith(expect.objectContaining({ hello: 'world' }));
  });

  it('keeps POST to the root as a broadcast alias', async () => {
    const { app, administration } = build();
    expect((await request(app).post('/ws').send({ hello: 'root' })).status).toBe(200);
    expect(administration.broadcastAdmin).toHaveBeenCalledWith(expect.objectContaining({ hello: 'root' }));
  });

  it('still reports status on GET', async () => {
    const { app } = build();
    const res = await request(app).get('/ws/status');
    expect(res.body).toMatchObject({ status: 'running', metrics: { clients: 1 } });
  });
});
